import { NextResponse } from 'next/server';
import { access,body,originError,reply } from '../../../../lib/jobs/server';
import { isCheckoutRequest } from '../../../../lib/payments/contracts';
import { createCheckoutSession,stripeConfig } from '../../../../lib/payments/stripe';
import { serviceClient } from '../../../../lib/supabase/service';
import { authConfig } from '../../../../lib/supabase/config';
export const dynamic='force-dynamic';
function refusal(message:string){
 if(/Pilot capacity unavailable/.test(message))return reply({error:'Pilot places are fully booked at the moment. Please contact kahueka@reviseit.io.'},409);
 if(/Pilot purchasing unavailable/.test(message))return reply({error:'Purchasing is not open yet.'},503);
 if(/Saved selection changed/.test(message))return reply({error:'Your saved selection has changed. Save it again before paying.'},409);
 if(/not available to order/.test(message))return reply({error:'A selected question is no longer available. Review your selection and save it again.'},422);
 if(/Invalid mark allocations|Invalid checkout/.test(message))return reply({error:'Check the marks for each question.'},422);
 if(/access required/.test(message))return reply({error:'Your curriculum access has changed. Return to your account.'},403);
 return reply({error:'Checkout could not be started. Nothing has been charged. Please try again.'},503);
}
// Admission (seat, frozen inputs, fixed price) happens in the database under the
// teacher's own identity. Stripe's hosted page is created only afterwards.
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 const c=await access();if(c instanceof NextResponse)return c;
 const stripe=stripeConfig(),service=serviceClient(),site=authConfig()?.siteUrl;
 if(!stripe||!service||!site)return reply({error:'Purchasing is not open yet.'},503);
 let value;try{value=await body(request,8000);}catch{return reply({error:'Invalid request'},400);}
 if(!isCheckoutRequest(value))return reply({error:'Check the marks for each question.'},422);
 const begun=await c.supabase.rpc('begin_paper_checkout',{request_key:value.requestKey,target_module:value.moduleId,selection_revision:value.selectionRevision,allocations:value.allocations});
 if(begun.error)return refusal(begun.error.message);
 const r=begun.data as {orderId:string;mode:string;status:string;checkoutUrl:string|null;expiresAt:string;existing:boolean};
 if(r.mode!==stripe.mode)return reply({error:'Purchasing is not open yet.'},503);
 if(r.status==='open'&&r.checkoutUrl)return reply({orderId:r.orderId,checkoutUrl:r.checkoutUrl,existing:r.existing});
 if(r.status!=='creating')return reply({orderId:r.orderId,checkoutUrl:null,existing:r.existing});
 try{
  const session=await createCheckoutSession(stripe,{orderId:r.orderId,siteUrl:site,email:c.user.email||'',expiresAt:new Date(r.expiresAt)});
  if(!session.url||session.livemode!==(stripe.mode==='live'))throw new Error('Unexpected session');
  const attached=await service.rpc('attach_paper_checkout',{target:r.orderId,session_id:session.id,session_url:session.url,session_livemode:session.livemode});
  if(attached.error)throw new Error('Attach failed');
  return reply({orderId:r.orderId,checkoutUrl:session.url,existing:r.existing});
 }catch{
  // The order stays in awaiting payment and releases its seat when it expires.
  // Retrying the same request reuses the same Stripe idempotency key.
  return reply({error:'Checkout could not be started. Nothing has been charged. Please try again.',orderId:r.orderId},503);
 }
}
