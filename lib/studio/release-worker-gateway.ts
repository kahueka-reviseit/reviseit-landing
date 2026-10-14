import {call,isUuid,isSha256,sha256,type Rpc} from './contracts';
import type {StudioStorage} from './storage/types';
/** Authenticated teacher worker only. This dispatch never accepts an approval or activation command. */
export async function releaseWorkerOperation(v:any,rpc:Rpc,storage:StudioStorage){
 if(v?.action==='queue'&&Object.keys(v).length===1)return call(rpc,'studio_release_worker_queue',{});
 if(v?.action==='file'&&isUuid(v.id)&&typeof v.path==='string'&&v.path.length<500&&Number.isInteger(v.offset)&&v.offset>=0){
  const f=await call<{key:string;sha256:string;size:number}>(rpc,'studio_release_worker_file',{p_candidate:v.id,p_path:v.path});
  if(v.offset>=f.size||f.size>50_000_000)throw new Error('Invalid range');
  const raw=await storage.get(f.key);if(!raw||raw.length!==f.size||sha256(raw)!==f.sha256)throw new Error('Integrity blocked');
  return {content:Buffer.from(raw.subarray(v.offset,v.offset+524288)).toString('base64'),size:f.size,sha256:f.sha256};
 }
 if(v?.action==='confirm'&&isUuid(v.id)&&isUuid(v.approval)&&isSha256(v.report)&&isSha256(v.bundle)&&isSha256(v.workflow)&&typeof v.worker==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v.worker))
  return call(rpc,'studio_confirm_release_worker',{p_candidate:v.id,p_approval:v.approval,p_report_sha256:v.report,p_bundle:v.bundle,p_workflow:v.workflow,p_worker:v.worker});
 throw new Error('Unsupported release worker operation');
}
