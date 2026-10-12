/** Attempt-bound immutable evidence, verified before settlement; never dispatches a model. */
import {call,sha256,StudioError,type Rpc} from './contracts';
import type {StudioStorage} from './storage/types';
import {placeImmutable,readForWorker} from './uploads';
export const EVIDENCE_PART=1048576;
export async function evidenceInfo(rpc:Rpc,attempt:string,kind:string){
 const info=await call<any>(rpc,'studio_evidence_info',{p_provider_attempt:attempt,p_kind:kind});
 if(!info)throw new StudioError('Evidence missing; explicit recovery required','invalid');
 return info;
}
export async function evidencePart(rpc:Rpc,storage:StudioStorage,attempt:string,kind:string,ordinal:number,bytes?:Uint8Array){
 const info=await evidenceInfo(rpc,attempt,kind),part=info.parts.find((p:any)=>p.ordinal===ordinal);
 if(!part)throw new StudioError('Evidence part not declared','invalid');
 if(bytes){
  if(bytes.length!==part.size||sha256(bytes)!==part.sha256)throw new StudioError('Evidence part digest mismatch','invalid');
  await placeImmutable(storage,part.key,bytes,part.sha256,'application/octet-stream');
  return call(rpc,'studio_evidence_part_commit',{p_provider_attempt:attempt,p_kind:kind,p_ordinal:ordinal});
 }
 if(!part.blobId)throw new StudioError('Evidence part not yet retained','invalid');
 const data=await readForWorker(rpc,storage,part);
 return {sha256:part.sha256,size:part.size,content:Buffer.from(data).toString('base64')};
}
export async function finishEvidence(rpc:Rpc,storage:StudioStorage,attempt:string,kind:string){
 const info=await evidenceInfo(rpc,attempt,kind),chunks=[];
 for(const p of info.parts){if(!p.blobId)throw new StudioError('Evidence parts incomplete','invalid');chunks.push(await readForWorker(rpc,storage,p));}
 const data=Buffer.concat(chunks);if(data.length!==info.size||sha256(data)!==info.sha256)throw new StudioError('Evidence envelope digest mismatch','invalid');
 let v:any;try{v=JSON.parse(data.toString('utf8'));}catch{throw new StudioError('Evidence envelope is not JSON','invalid');}
 if(v.providerAttemptId!==attempt||v.operation!==info.operation||v.requestDigest!==info.requestDigest)throw new StudioError('Evidence attempt identity mismatch','invalid');
 if(kind==='request'){
  if(v.schema!=='reviseit/studio-provider-request@1'||typeof v.request!=='string'||sha256(Buffer.from(v.request,'base64'))!==info.requestDigest)throw new StudioError('Evidence request digest mismatch','invalid');
 }else{
  if(v.schema!=='reviseit/studio-provider-exchange@2'||typeof v.body!=='string'||sha256(Buffer.from(v.body,'base64'))!==v.bodyDigest||(info.resultDigest&&info.resultDigest!==info.sha256))throw new StudioError('Evidence response digest mismatch','invalid');
 }
 return call(rpc,'studio_evidence_finish',{p_provider_attempt:attempt,p_kind:kind});
}
