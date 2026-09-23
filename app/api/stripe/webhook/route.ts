import { retrieveCheckoutSession,sessionRecord,stripeConfig,verifySignature } from '../../../../lib/payments/stripe';
import { serviceClient } from '../../../../lib/supabase/service';
import { reply } from '../../../../lib/jobs/server';
export const dynamic='force-dynamic';
const checkoutEvents=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'];
// Signature over the exact raw body first; then the session is re-read from
// Stripe with this deployment's own key, so account and mode are confirmed.
// A database failure returns 500 so Stripe retries; nothing is lost.
export async function POST(request:Request){
 const stripe=stripeConfig(),service=serviceClient();
 if(!stripe||!service)return reply({error:'Not configured'},503);
 if(Number(request.headers.get('content-length')||0)>1_000_000)return reply({error:'Too large'},413);
 const raw=await request.text();if(raw.length>1_000_000)return reply({error:'Too large'},413);
 if(!verifySignature(raw,request.headers.get('stripe-signature'),stripe.webhookSecret))return reply({error:'Invalid signature'},400);
 let event:any;try{event=JSON.parse(raw);}catch{return reply({error:'Invalid payload'},400);}
 if(!event||event.object!=='event'||typeof event.id!=='string'||typeof event.type!=='string')return reply({error:'Invalid payload'},400);
 if(event.livemode!==(stripe.mode==='live'))return reply({error:'Mode mismatch'},400);
 const object=event.data?.object;
 try{
  if(checkoutEvents.includes(event.type)){
   const session=await retrieveCheckoutSession(stripe,String(object?.id||''));
   const r=await service.rpc('record_stripe_checkout',{event_id:event.id,event_type:event.type,event_livemode:event.livemode,session:sessionRecord(session)});
   if(r.error)throw new Error('Record failed');
   return reply({received:true,outcome:r.data?.outcome??null});
  }
  if(event.type==='charge.refunded'&&typeof object?.payment_intent==='string'){
   const r=await service.rpc('record_stripe_refund',{event_id:event.id,event_livemode:event.livemode,payment_intent:object.payment_intent,amount_refunded:Number(object.amount_refunded),refund_currency:String(object.currency)});
   if(r.error)throw new Error('Record failed');
   return reply({received:true,outcome:r.data?.outcome??null});
  }
  return reply({received:true,outcome:'ignored'});
 }catch{return reply({error:'Temporarily unavailable'},500);}
}
