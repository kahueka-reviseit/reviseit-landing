import {NextResponse} from 'next/server';
import {access,body,originError,reply} from '../../../../lib/jobs/server';
import {isUuid} from '../../../../lib/jobs/contracts';
import {creditsEnabled,creditMode} from '../../../../lib/credits/server';
import {createCreditCheckoutSession,stripeConfig,retrieveCheckoutSession,creditSessionRecord} from '../../../../lib/payments/stripe';
import {serviceClient} from '../../../../lib/supabase/service';
import {authConfig} from '../../../../lib/supabase/config';
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 if(!creditsEnabled())return reply({error:'Top-ups are not open yet.'},503);
 const c=await access();if(c instanceof NextResponse)return c;
 const stripe=stripeConfig(),service=serviceClient(),site=authConfig()?.siteUrl;if(!stripe||stripe.mode!==creditMode()||!service||!site)return reply({error:'Top-ups are not open yet.'},503);
 let v;try{v=await body(request,1500);}catch{return reply({error:'Invalid request'},400);}
 const x=v as Record<string,unknown>;if(!x||!Number.isInteger(x.amountMinor)||typeof x.reference!=='string'||x.reference.length>200||!isUuid(x.requestKey))return reply({error:'Choose a top-up amount.'},422);
 const r=await c.supabase.rpc('begin_credit_purchase',{amount_minor:x.amountMinor,reference:x.reference,request_key:x.requestKey});
 if(r.error)return reply({error:'This top-up is not available. Check your department access and selected amount.'},409);
 const p=r.data;if(p.mode!==stripe.mode)return reply({error:'Top-up mode unavailable.'},503);
 if(p.status==='open'&&p.checkoutUrl)return reply({purchaseId:p.id,checkoutUrl:p.checkoutUrl});
 if(p.status==='paid'||p.status==='attention')return reply({purchaseId:p.id,checkoutUrl:null});
 if(p.status==='expired'||Date.parse(p.expiresAt)<=Date.now())return reply({error:'This top-up checkout has expired. Start a new top-up.',terminal:true},409);
 try{
 const session=await createCreditCheckoutSession(stripe,{purchaseId:p.id,amountMinor:p.amountMinor,siteUrl:site,email:c.user.email||'',expiresAt:new Date(p.expiresAt)});
 if(!session.url)throw new Error('Missing URL');
 const attached=await service.rpc('attach_credit_checkout',{target:p.id,session_id:session.id,session_url:session.url,session_livemode:session.livemode});if(attached.error)throw new Error('Attach failed');
 return reply({purchaseId:p.id,checkoutUrl:session.url});
 }catch{return reply({error:'Checkout could not be confirmed. Retry this same top-up.',purchaseId:p.id},503);}
}
export async function GET(request:Request){
 const c=await access();if(c instanceof NextResponse)return c;
 const id=new URL(request.url).searchParams.get('id');if(!isUuid(id))return reply({error:'Invalid purchase'},400);
 const p=await c.supabase.rpc('credit_purchase_for_head',{target:id});if(p.error||!p.data)return reply({error:'Purchase unavailable'},404);
 const stripe=stripeConfig(),service=serviceClient();
 if(stripe&&service&&stripe.mode===p.data.mode&&p.data.sessionId){try{
 const s=await retrieveCheckoutSession(stripe,p.data.sessionId);if(s.metadataPurchaseId!==id)throw new Error('Identity mismatch');
 const r=await service.rpc('record_credit_checkout',{event_id:`reconcile-credit-${id}-${s.status}-${s.paymentStatus}`,event_type:'server_reconciliation',event_livemode:s.livemode,session:creditSessionRecord(s)});
 if(r.error)throw new Error('Record failed');
 const fresh=await c.supabase.rpc('credit_purchase_for_head',{target:id});if(fresh.error)throw new Error('Read failed');return reply(fresh.data);
 }catch{return reply({error:'Payment confirmation is still being checked.'},503);}}
 return reply(p.data);
}
