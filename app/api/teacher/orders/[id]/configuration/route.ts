import { NextResponse } from 'next/server';
import { access,body,originError,reply } from '../../../../../../lib/jobs/server';
import { isUuid } from '../../../../../../lib/jobs/contracts';
import { isConfigurationSave } from '../../../../../../lib/configurator/contracts';
import { ConfigurationError,loadConfiguration,saveConfiguration } from '../../../../../../lib/configurator/server';
import { serviceClient } from '../../../../../../lib/supabase/service';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
// Every request repeats the account check, confirms the order is visible to the
// teacher's own session, and lets the database repeat school, curriculum and
// payment checks. Only the server projection leaves this route.
async function context(id:string){
 const c=await access();if(c instanceof NextResponse)return c;
 if(!isUuid(id))return reply({error:'Request not found'},404);
 const service=serviceClient();if(!service)return reply({error:'Configuration is unavailable.'},503);
 const visible=await c.supabase.rpc('teacher_orders',{target:id});if(visible.error)return reply({error:'Request unavailable'},503);if(!visible.data?.[0])return reply({error:'Request not found'},404);
 return {c,service};
}
function failure(e:unknown){return e instanceof ConfigurationError?reply({error:e.message},e.status):reply({error:'Configuration is unavailable. Please try again.'},503);}
export async function GET(_:Request,{params}:Params){
 const {id}=await params;const x=await context(id);if(x instanceof NextResponse)return x;
 try{const loaded=await loadConfiguration(x.service,id,x.c.user.id);return loaded?reply(loaded.view):reply({error:'Request not found'},404);}catch(e){return failure(e);}
}
export async function PUT(request:Request,{params}:Params){
 const origin=originError(request);if(origin)return origin;
 const {id}=await params;const x=await context(id);if(x instanceof NextResponse)return x;
 let value;try{value=await body(request,70000);}catch{return reply({error:'Invalid request'},400);}
 if(!isConfigurationSave(value))return reply({error:'Check your choices and try again.'},422);
 try{
  const loaded=await loadConfiguration(x.service,id,x.c.user.id);if(!loaded)return reply({error:'Request not found'},404);
  const after=await saveConfiguration(x.service,loaded,x.c.user.id,value.revision,value.configuration);
  return reply(after.view);
 }catch(e){return failure(e);}
}
