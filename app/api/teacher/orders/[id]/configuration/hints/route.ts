import { NextResponse } from 'next/server';
import { access,body,originError,reply } from '../../../../../../../lib/jobs/server';
import { isUuid } from '../../../../../../../lib/jobs/contracts';
import { loadConfiguration } from '../../../../../../../lib/configurator/server';
import { serviceClient } from '../../../../../../../lib/supabase/service';
import { Advisor,jevSettings } from '../../../../../../../lib/jev/advisor';
export const dynamic='force-dynamic';
// Optional, off by default (JEV_MODE). Hints are authored wording only and never
// change answers or block anything. Any failure returns no hints.
let advisor:Advisor|null=null;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const origin=originError(request);if(origin)return origin;
 const c=await access();if(c instanceof NextResponse)return c;
 const settings=jevSettings();if(settings.mode==='off')return reply({hints:[]});
 const {id}=await params;if(!isUuid(id))return reply({error:'Request not found'},404);
 let v:any;try{v=await body(request,2000);}catch{return reply({error:'Invalid request'},400);}
 if(!v||!Number.isSafeInteger(v.revision)||typeof v.lineId!=='string'||Object.keys(v).some(k=>!['revision','lineId','changed'].includes(k))||(v.changed!==undefined&&!(Array.isArray(v.changed)&&v.changed.length<=40&&v.changed.every((x:unknown)=>typeof x==='string'))))return reply({error:'Invalid request'},400);
 const service=serviceClient();if(!service)return reply({hints:[]});
 try{
  const loaded=await loadConfiguration(service,id,c.user.id);
  const def=loaded?.defs.lines.find(l=>l.id===v.lineId);
  if(!loaded||!def?.classification||!loaded.row.paid||loaded.row.revision!==v.revision)return reply({hints:[]});
  advisor??=new Advisor(settings);
  const hints=await advisor.advise({orderId:id,revision:v.revision,doc:def.classification.doc,answers:loaded.configuration.answers.items[def.id]||{},stage:'post',changed:v.changed,
   current:async()=>(await loadConfiguration(service,id,c.user.id))?.row.revision??-1});
  return reply({hints});
 }catch{return reply({hints:[]});}
}
