import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { body,reply } from '../../../../lib/jobs/server';
import { documents,isUuid,type DocumentName } from '../../../../lib/jobs/contracts';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const secret=process.env.CONTENT_WORKER_TOKEN;
 if(!secret||secret.length<32)return reply({error:'Worker gateway not configured'},503);
 const got=Buffer.from(request.headers.get('authorization')||'');const wanted=Buffer.from('Bearer '+secret);
 if(got.length!==wanted.length||!timingSafeEqual(got,wanted))return reply({error:'Worker authentication required'},401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return reply({error:'Worker gateway not configured'},503);
 let v:any;try{v=await body(request,2100000);}catch{return reply({error:'Invalid request'},400);}
 if(!v||typeof v!=='object'||Array.isArray(v))return reply({error:'Invalid request'},400);
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 let name:string,args:Record<string,unknown>;
 if(v.action==='claim'&&typeof v.worker==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v.worker)){
  // Optional declared execution capabilities. Omitted: the previous claim exactly.
  if(v.capabilities!==undefined&&!(Array.isArray(v.capabilities)&&v.capabilities.length<=10&&v.capabilities.every((x:unknown)=>x==='configured-plan@1'||x==='configured-plan@2')))return reply({error:'Invalid worker operation'},400);
  name='claim_paper_job';args=v.capabilities===undefined?{worker:v.worker}:{worker:v.worker,capabilities:v.capabilities};}
 else{
  if(!isUuid(v.id)||!isUuid(v.lease))return reply({error:'Invalid job identity'},400);
  args={target:v.id,token:v.lease};
  if(v.action==='heartbeat')name='heartbeat_paper_job';
  else if(v.action==='checkpoint'&&['awaiting_memo_review','rendering','held'].includes(v.stage)&&(v.artifact===undefined||typeof v.artifact==='string')){name='checkpoint_paper_job';args={...args,stage:v.stage,artifact:v.artifact??null};}
  else if(v.action==='upload'&&documents.includes(v.name as DocumentName)&&Number.isInteger(v.part)&&v.part>=0&&v.part<20&&typeof v.content==='string'&&v.content.length<=700000){name='upload_paper_chunk';args={...args,document_name:v.name,part_number:v.part,content:v.content};}
  else if(v.action==='finish'&&v.hashes&&typeof v.hashes==='object'&&Object.keys(v.hashes).sort().join(',')===[...documents].sort().join(',')&&Object.values(v.hashes).every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))){name='finish_paper_upload';args={...args,expected_hashes:v.hashes};}
  else return reply({error:'Invalid worker operation'},400);
 }
 const r=await client.rpc(name,args);
 if(r.error)return reply({error:/lease lost/.test(r.error.message)?'Worker lease lost':'Worker operation refused'},409);
 return reply({result:r.data});
}
