import {accountContext} from '../../../../lib/auth/access';
import {body,originError,reply} from '../../../../lib/jobs/server';
import {creditsEnabled,creditMode} from '../../../../lib/credits/server';
import {isUuid} from '../../../../lib/jobs/contracts';
import {moneyInput} from '../../../../lib/credits/contracts';
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 if(!creditsEnabled())return reply({error:'Offers are not open yet.'},503);
 const c=await accountContext();if(c.kind!=='authenticated')return reply({error:'Sign in required'},401);
 let v;try{v=await body(request,5000);}catch{return reply({error:'Invalid request'},400);}const x=v as Record<string,unknown>;if(!x)return reply({error:'Invalid request'},400);
 let r;
 if(x.action==='claim'&&isUuid(x.offerId)&&isUuid(x.requestKey))r=await c.supabase.rpc('claim_department_offer',{target:x.offerId,request_key:x.requestKey});
 else if(x.action==='enable'&&isUuid(x.offerId)&&typeof x.enabled==='boolean')r=await c.supabase.rpc('set_department_offer_enabled',{target:x.offerId,enabled:x.enabled});
 else if(x.action==='create'&&typeof x.title==='string'&&typeof x.amount==='string'&&moneyInput(x.amount)!==null&&Array.isArray(x.departments)&&x.departments.every(isUuid)&&Number.isInteger(x.places)&&typeof x.opensAt==='string'&&typeof x.claimBy==='string'&&typeof x.useBy==='string'){
 r=await c.supabase.rpc('create_department_offer',{title:x.title,target_mode:creditMode(),amount_minor:moneyInput(x.amount),opens_at:x.opensAt,claim_by:x.claimBy,use_by:x.useBy,places:x.places,departments:x.departments});
 }else return reply({error:'Check the offer details.'},422);
 if(r.error)return reply({error:'This offer action could not be confirmed. Check your access, the offer dates and eligibility.'},409);
 return reply({result:r.data});
}
