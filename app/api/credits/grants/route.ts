import {accountContext} from '../../../../lib/auth/access';
import {body,originError,reply} from '../../../../lib/jobs/server';
import {creditsEnabled,creditMode} from '../../../../lib/credits/server';
import {moneyInput} from '../../../../lib/credits/contracts';
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 if(!creditsEnabled())return reply({error:'Department services are not open yet.'},503);
 const c=await accountContext();if(c.kind!=='authenticated')return reply({error:'Sign in required'},401);
 const authority=await c.supabase.rpc('is_credit_administrator');if(authority.error||authority.data!==true)return reply({error:'Credit administrator access required'},403);
 let v;try{v=await body(request,4000);}catch{return reply({error:'Invalid request'},400);}
 const x=v as Record<string,unknown>;if(!x||typeof x!=='object')return reply({error:'Invalid request'},400);
 const amount=typeof x.amount==='string'?moneyInput(x.amount):null;
 if(amount===null||typeof x.departmentId!=='string'||!/^[0-9a-f-]{36}$/i.test(x.departmentId)||typeof x.requestKey!=='string'||!/^[0-9a-f-]{36}$/i.test(x.requestKey)
 ||!['staff_grant','paid_invoice'].includes(String(x.kind))||typeof x.reason!=='string'||x.reason.trim().length<3||x.reason.length>2000
 ||typeof x.reference!=='string'||x.reference.length>200||(x.kind==='paid_invoice'&&!x.reference.trim())
 ||(x.useBy!==null&&(typeof x.useBy!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x.useBy)||!Number.isFinite(Date.parse(x.useBy)))))return reply({error:'Check the amount, source, use-by date and reason.'},422);
 const r=await c.supabase.rpc('grant_department_credit',{target_department:x.departmentId,target_mode:creditMode(),amount_minor:amount,source_kind:x.kind,use_by:x.useBy,source_reference:x.reference||null,reason:x.reason,request_key:x.requestKey});
 if(r.error)return reply({error:/Request key already used/.test(r.error.message)?'This request was already used with different details. Refresh before continuing.':'The grant could not be confirmed. Retry these same details to check its outcome.'},409);
 return reply({operationId:r.data});
}
