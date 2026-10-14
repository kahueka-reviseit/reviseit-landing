import {call,isUuid,isSha256,sha256,StudioError,type Rpc} from './contracts';
import {finaliseUpload,readBlob} from './uploads';
import {canDraftFile,draftTextProblem,type MaintenanceDraft,type SaveDraftInput} from './maintenance-drafts';
import type {FileDetail} from './library';
import type {StudioStorage} from './storage/types';

export async function readDraftText(rpc:Rpc,storage:StudioStorage,blobId:string,expectedSha256:string) {
 const {info,bytes}=await readBlob(rpc,storage,blobId);
 if(info.sha256!==expectedSha256||bytes.length>262144)throw new StudioError('The retained text failed its integrity or size check.');
 // Preserve a BOM, if present, as part of the exact source bytes.
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}

export async function saveMaintenanceDraft(rpc:Rpc,verifiedRpc:Rpc,storage:StudioStorage,input:SaveDraftInput) {
 if(!isUuid(input.snapshotId)||!isUuid(input.command)||(input.draftId!==null&&!isUuid(input.draftId))||!isSha256(input.expectedSha256)
  ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||typeof input.text!=='string'||typeof input.reason!=='string'
  ||input.reason.trim().length<10||input.reason.trim().length>2000||(input.restoredFrom!==null&&(!Number.isSafeInteger(input.restoredFrom)||input.restoredFrom<0)))
  throw new StudioError('Check the draft revision and enter a reason of 10 to 2000 characters.');
 const file=await call<FileDetail>(rpc,'studio_bank_file_view',{p_snapshot:input.snapshotId,p_path:input.path});
 if(!canDraftFile(file))throw new StudioError('This file cannot be edited here. Use a verified Markdown or JSON bank file up to 256 KB.');
 const problem=draftTextProblem(file.path,input.text);if(problem)throw new StudioError(problem);
 const data=Buffer.from(input.text,'utf8'),digest=sha256(data);
 // Verify the pinned base bytes again, rather than trusting an old integrity badge.
 await readDraftText(rpc,storage,file.blobId,file.sha256);
 if(input.draftId) {
  const draft=await call<MaintenanceDraft>(rpc,'studio_maintenance_draft_view',{p_draft:input.draftId});
  if(draft.file.snapshotId!==file.snapshotId||draft.file.path!==file.path||draft.state!=='draft')throw new StudioError('This draft is no longer editable.');
  // An exact command replay is allowed through the SQL idempotency boundary, even after a newer edit.
  const current=draft.revisions.find(r=>r.revision===input.expectedRevision);
  if(!current||current.sha256!==input.expectedSha256)throw new StudioError('The starting revision does not match this draft.');
  await readDraftText(rpc,storage,current.blobId,current.sha256);
  if(input.restoredFrom!==null) {
   const from=input.restoredFrom===0?file:draft.revisions.find(r=>r.revision===input.restoredFrom);
   if(!from||from.sha256!==digest)throw new StudioError('Restore must use the exact retained text. Save an edited version as a normal revision.');
  }
 } else if(input.expectedRevision!==0||input.expectedSha256!==file.sha256||input.restoredFrom!==null)throw new StudioError('The starting file changed. Reload before saving.');
 if(digest===input.expectedSha256)throw new StudioError('The text is unchanged.');
 const h=sha256('maintenance-upload:'+input.command);
 const uploadCommand=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
 const mediaType=file.path.endsWith('.json')?'application/json':'text/markdown';
 const upload=await call<any>(rpc,'studio_create_upload',{p_module:file.moduleId,p_sha256:digest,p_size:data.length,p_media_type:mediaType,p_filename:file.path.split('/').pop(),p_purpose:'revision',p_command:uploadCommand});
 const session=await call<any>(rpc,'studio_upload_session',{p_session:upload.sessionId});
 if(session.state==='open')await storage.put(upload.provisionalKey,data,mediaType);
 const result=await finaliseUpload(verifiedRpc,storage,upload.sessionId);
 if(result.state!=='finalised')throw new StudioError('The saved bytes could not be verified. Your text is still in the editor.');
 return call<{draftId:string;revision:number;sha256:string}>(rpc,'studio_save_maintenance_draft',{
  p_draft:input.draftId,p_snapshot:file.snapshotId,p_path:file.path,p_expected_revision:input.expectedRevision,p_expected_sha256:input.expectedSha256,
  p_blob:result.blobId,p_reason:input.reason,p_restored_from:input.restoredFrom,p_command:input.command,
 });
}
