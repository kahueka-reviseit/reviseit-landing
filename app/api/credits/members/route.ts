import {accountContext} from '../../../../lib/auth/access';
import {body,originError,reply} from '../../../../lib/jobs/server';
import {creditsEnabled} from '../../../../lib/credits/server';
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 if(!creditsEnabled())return reply({error:'Department services are not open yet.'},503);
 const c=await accountContext();if(c.kind!=='authenticated')return reply({error:'Sign in required'},401);
 let v;try{v=await body(request,1500);}catch{return reply({error:'Invalid request'},400);}
 if(!v||typeof v!=='object')return reply({error:'Invalid request'},400);
 const x=v as Record<string,unknown>;
 if(typeof x.userId!=='string'||!/^[0-9a-f-]{36}$/i.test(x.userId)||!Number.isInteger(x.revision))return reply({error:'Invalid member'},400);
 let r;
 if(x.action==='role'&&(x.value==='head'||x.value==='teacher'))r=await c.supabase.rpc('set_department_role',{target_user:x.userId,expected_revision:x.revision,new_role:x.value,reason:'Staff confirmed department role change'});
 else if(x.action==='spending'&&typeof x.value==='boolean')r=await c.supabase.rpc('set_department_member_spending',{target_user:x.userId,expected_revision:x.revision,allowed:x.value,reason:'Confirmed department spending change'});
 else return reply({error:'Invalid member change'},400);
 if(r.error)return reply({error:/Account changed/.test(r.error.message)?'This member changed. Refresh before trying again.':'This change could not be made. Check your department access.'},409);
 return reply({saved:true});
}
