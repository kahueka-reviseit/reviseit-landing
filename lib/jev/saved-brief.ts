import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Loaded} from '../configurator/server';
import {compileBrief,interpretBrief,type BriefInterpretation} from './interpret';
import {directTransport,jevSettings,readAnswers} from './advisor';

/** One explicit Configure click. The reservation survives failures and timeouts. */
export async function savedBrief(service:SupabaseClient,loaded:Loaded,teacherId:string,lineId:string,retryId:string):Promise<BriefInterpretation|null>{
 const settings=jevSettings(),def=loaded.defs.lines.find(l=>l.id===lineId),brief=loaded.configuration.briefs?.[lineId];
 if(!def||!brief?.text.trim()||!settings.apiKey)return null;
 if(!def.fields.length)return {answers:{},understood:[],unanswered:[]};
 const compiled=compileBrief(brief.text,def.fields,settings.model);
 const payload=JSON.stringify(compiled.request);
 // One request over the purchased form only, with explicit teacher-triggered retries.
 if(Buffer.byteLength(payload)>60000)return null;
 const hash=createHash('sha256').update('paragraph-v1:'+retryId+':'+payload).digest('hex');
 const reservation=await service.rpc('reserve_jev_advice',{target:loaded.row.orderId,target_teacher:teacherId,target_line:lineId,
   expected_revision:loaded.row.revision,request_hash:hash,call_limit:Math.min(100,settings.requestsPerOrder)});
 if(reservation.error)return null;
 const slot=reservation.data;let raw=slot?.response;
 if(slot?.status==='dispatch'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),settings.timeoutMs);
  try{
   raw=await directTransport(compiled.request,settings.apiKey,controller.signal);
   if(!readAnswers(raw,compiled.request))throw new Error('Invalid interpretation');
   raw={model:raw.model,answers:raw.answers,usage:raw.usage??null};
   const finished=await service.rpc('finish_jev_advice',{target:loaded.row.orderId,target_line:lineId,request_hash:hash,result:raw});
   if(finished.error)return null;
  }catch{
   await service.rpc('finish_jev_advice',{target:loaded.row.orderId,target_line:lineId,request_hash:hash,result:null});return null;
  }finally{clearTimeout(timer);}
 }else if(slot?.status!=='complete')return null;
 return interpretBrief(compiled,raw);
}
