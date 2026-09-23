import { NextResponse } from 'next/server';
import { access,body,originError,reply } from '../../../../../../lib/jobs/server';
import { isUuid } from '../../../../../../lib/jobs/contracts';
import { expireCheckoutSession,retrieveCheckoutSession,sessionRecord,stripeConfig } from '../../../../../../lib/payments/stripe';
import { serviceClient } from '../../../../../../lib/supabase/service';
export const dynamic='force-dynamic';
// After returning from Stripe the server asks Stripe directly. The return URL
// is never evidence of payment; only a retrieved paid session is recorded.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const origin=originError(request);if(origin)return origin;
 const c=await access();if(c instanceof NextResponse)return c;
 const {id}=await params;if(!isUuid(id))return reply({error:'Request not found'},404);
 let value:any;try{value=await body(request,1000);}catch{return reply({error:'Invalid request'},400);}
 if(!value||typeof value!=='object'||!['reconcile','cancel'].includes(value.action)||Object.keys(value).length!==1)return reply({error:'Invalid request'},400);
 const stripe=stripeConfig(),service=serviceClient();if(!stripe||!service)return reply({error:'Payments are unavailable.'},503);
 // The teacher must still be able to read this order under current access rules.
 const visible=await c.supabase.rpc('teacher_orders',{target:id});if(visible.error)return reply({error:'Request unavailable'},503);if(!visible.data?.[0])return reply({error:'Request not found'},404);
 const found=await service.rpc('paper_checkout_for_teacher',{target:id,target_teacher:c.user.id});
 if(found.error)return reply({error:'Payments are unavailable.'},503);if(!found.data)return reply({error:'Request not found'},404);
 const p=found.data as {mode:string;status:string;sessionId:string|null};
 if(p.mode!==stripe.mode)return reply({error:'Payments are unavailable.'},503);
 try{
  let session=p.sessionId?await retrieveCheckoutSession(stripe,p.sessionId):null;
  if(value.action==='cancel'&&session&&session.status==='open')session=await expireCheckoutSession(stripe,session.id);
  if(session){const recorded=await service.rpc('record_stripe_checkout',{event_id:'reconcile',event_type:'reconcile',event_livemode:session.livemode,session:sessionRecord(session)});if(recorded.error)throw new Error('Record failed');}
  if(value.action==='cancel'&&!(session&&session.paymentStatus==='paid')){const cancelled=await service.rpc('cancel_paper_checkout',{target:id,target_teacher:c.user.id});if(cancelled.error&&!/already paid/.test(cancelled.error.message))throw new Error('Cancel failed');}
 }catch{return reply({error:'We could not confirm your payment yet. Nothing is lost; refresh in a moment.'},503);}
 const after=await c.supabase.rpc('teacher_orders',{target:id});
 return after.error||!after.data?.[0]?reply({error:'Request unavailable'},503):reply(after.data[0]);
}
