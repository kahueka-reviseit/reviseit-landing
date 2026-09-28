import {NextResponse} from 'next/server';
import {access,body,originError,reply} from '../../../../../../../lib/jobs/server';
import {isUuid} from '../../../../../../../lib/jobs/contracts';
import {ConfigurationError,loadConfiguration,saveConfiguration} from '../../../../../../../lib/configurator/server';
import {applyInterpretation} from '../../../../../../../lib/configurator/brief';
import {serviceClient} from '../../../../../../../lib/supabase/service';
import {jevAllowed} from '../../../../../../../lib/jev/pilot';
import {savedBrief} from '../../../../../../../lib/jev/saved-brief';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const origin=originError(request);if(origin)return origin;
 const c=await access();if(c instanceof NextResponse)return c;
 const {id}=await params;if(!isUuid(id))return reply({error:'Request not found'},404);
 if(!jevAllowed(id))return reply({error:'Paragraph configuration is unavailable.'},503);
 let v:any;try{v=await body(request,2000);}catch{return reply({error:'Invalid request'},400);}
 if(!v||Object.keys(v).sort().join()!=='lineId,requestKey,revision'||!Number.isSafeInteger(v.revision)||typeof v.lineId!=='string'||!isUuid(v.requestKey))return reply({error:'Invalid request'},400);
 const service=serviceClient();if(!service)return reply({error:'Configuration is unavailable.'},503);
 try{
  const loaded=await loadConfiguration(service,id,c.user.id);
  if(!loaded)return reply({error:'Request not found'},404);
  if(!loaded.row.paid||loaded.row.submitted||loaded.row.state!=='awaiting_answers'||loaded.row.revision!==v.revision)return reply({error:'This paper changed. Reload the saved choices before configuring.'},409);
  if(!loaded.configuration.briefs?.[v.lineId]?.text.trim())return reply({error:'Write and save your description first.'},422);
  const interpretation=await savedBrief(service,loaded,c.user.id,v.lineId,v.requestKey);
  if(!interpretation)return reply({error:'Your brief is saved. We could not configure it just now. Try again or choose options yourself.'},503);
  // The same optimistic revision check used for manual edits makes late replies harmless.
  const after=await saveConfiguration(service,loaded,c.user.id,v.revision,applyInterpretation(loaded.configuration,v.lineId,interpretation.answers));
  return reply({...after.view,briefEnabled:true,interpretation:{unanswered:interpretation.unanswered}});
 }catch(e){return e instanceof ConfigurationError?reply({error:e.message},e.status):reply({error:'Your brief is saved. Try again or choose options yourself.'},503);}
}
