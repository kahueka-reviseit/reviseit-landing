import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Loaded} from '../configurator/server';
import {compile,directTransport,hintFor,jevSettings,readAnswers,type Hint} from './advisor';

// Empty allowlist means off. The first activation is restricted to the founder's order.
export function jevAllowed(orderId:string,env:Record<string,string|undefined>=process.env){
 return jevSettings(env).mode==='advisory' && (env.JEV_ORDER_IDS??'').split(',').map(s=>s.trim()).includes(orderId);
}
export function eligibleLines(loaded:Loaded):string[]{
 return loaded.defs.lines.filter(l=>l.classification?.doc.jevChecks.some(c=>c.activation==='shadow'&&c.stage==='post')).map(l=>l.id);
}
export type AdviceResult={status:'checked'|'unavailable'|'limit'|'not_applicable';hints:Hint[]};
export async function savedAdvice(service:SupabaseClient,loaded:Loaded,teacherId:string,lineId:string):Promise<AdviceResult>{
 const settings=jevSettings();
 const def=loaded.defs.lines.find(l=>l.id===lineId);
 const answers=loaded.configuration.answers.items[lineId]??{};
 const doc=def?.classification?.doc;
 if(!doc)return {status:'not_applicable',hints:[]};
 // Never spend on blank/delegated answers or unrelated text fields.
 const eligible=doc.jevChecks.filter(c=>c.fields.some(f=>answers[f]?.kind==='text'&&(answers[f] as {text:string}).text.trim()));
 const scoped={...doc,jevChecks:eligible};
 const compiled=compile(scoped,answers,{stage:'post',model:settings.model});
 if(!compiled)return {status:'not_applicable',hints:[]};
 const payload=JSON.stringify(compiled.request);
 if(Buffer.byteLength(payload)>16384||compiled.checks.length>8)return {status:'unavailable',hints:[]};
 const hash=createHash('sha256').update(payload).digest('hex');
 const args={target:loaded.row.orderId,target_teacher:teacherId,target_line:lineId,expected_revision:loaded.row.revision,request_hash:hash,call_limit:Math.min(100,settings.requestsPerOrder)};
 const reservation=await service.rpc('reserve_jev_advice',args);
 if(reservation.error)return {status:'unavailable',hints:[]};
 const slot=reservation.data;
 if(slot?.status==='limit')return {status:'limit',hints:[]};
 let raw:unknown=slot?.response;
 if(slot?.status==='dispatch'){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),settings.timeoutMs);
  try{
   raw=await directTransport(compiled.request,settings.apiKey!,controller.signal);
   // Store only typed judgments and usage. No teacher text or raw request is stored.
   if(!readAnswers(raw,compiled.request))throw new Error('Malformed response');
   const r=raw as any;
   raw={model:typeof r.model==='string'?r.model:null,answers:r.answers,usage:r.usage??null};
   const finished=await service.rpc('finish_jev_advice',{target:args.target,target_line:lineId,request_hash:hash,result:raw});
   if(finished.error)return {status:'unavailable',hints:[]};
  }catch{
   // A failed/uncertain dispatch consumes its slot and is never automatically retried.
   await service.rpc('finish_jev_advice',{target:args.target,target_line:lineId,request_hash:hash,result:null});
   return {status:'unavailable',hints:[]};
  }finally{clearTimeout(timer);}
 }else if(slot?.status!=='complete')return {status:'unavailable',hints:[]};
 const parsed=readAnswers(raw,compiled.request);
 if(!parsed)return {status:'unavailable',hints:[]};
 return {status:'checked',hints:compiled.checks.flatMap(c=>{const hint=hintFor(doc,c,parsed[c.id],answers);return hint?[hint]:[];})};
}
