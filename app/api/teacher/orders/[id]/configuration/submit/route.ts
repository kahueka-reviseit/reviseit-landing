import { NextResponse } from 'next/server';
import { access,body,originError,reply } from '../../../../../../../lib/jobs/server';
import { isUuid } from '../../../../../../../lib/jobs/contracts';
import { isConfigurationSubmit } from '../../../../../../../lib/configurator/contracts';
import { ConfigurationError,loadConfiguration,submitConfiguration } from '../../../../../../../lib/configurator/server';
import { serviceClient } from '../../../../../../../lib/supabase/service';
export const dynamic='force-dynamic';
// Submission freezes the current saved revision only. The database checks
// payment, refund, revision, totals and the stored ready verdict atomically.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const origin=originError(request);if(origin)return origin;
 const c=await access();if(c instanceof NextResponse)return c;
 const {id}=await params;if(!isUuid(id))return reply({error:'Request not found'},404);
 const service=serviceClient();if(!service)return reply({error:'Configuration is unavailable.'},503);
 let value;try{value=await body(request,1000);}catch{return reply({error:'Invalid request'},400);}
 if(!isConfigurationSubmit(value))return reply({error:'Invalid request'},400);
 const visible=await c.supabase.rpc('teacher_orders',{target:id});if(visible.error)return reply({error:'Request unavailable'},503);if(!visible.data?.[0])return reply({error:'Request not found'},404);
 try{
  const loaded=await loadConfiguration(service,id,c.user.id);if(!loaded)return reply({error:'Request not found'},404);
  return reply({id:await submitConfiguration(service,loaded,c.user.id,value.requestKey,value.revision)},202);
 }catch(e){return e instanceof ConfigurationError?reply({error:e.message},e.status):reply({error:'Submission could not be confirmed. Retry; this will not create a second request.'},503);}
}
