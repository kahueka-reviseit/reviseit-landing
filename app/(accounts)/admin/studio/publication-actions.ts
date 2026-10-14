'use server';
import {revalidatePath} from 'next/cache';
import {requireStudioEditor} from '../../../../lib/studio/server';
import {call,isUuid,isSha256,StudioError} from '../../../../lib/studio/contracts';
import {studioStorage} from '../../../../lib/studio/storage';
import {readBlob} from '../../../../lib/studio/uploads';
const failure=(e:unknown)=>({ok:false as const,error:e instanceof StudioError?e.message:'The result could not be confirmed. Refresh or explicitly retry the same action.'});
export async function stageRelease(input:{preparationId:string;reportSha256:string;moduleId:string;command:string}){
 const {rpc}=await requireStudioEditor();try{
  if(!isUuid(input.preparationId)||!isUuid(input.command)||!isSha256(input.reportSha256)||!/^[a-z0-9-]+$/.test(input.moduleId))throw new StudioError('Select an exact checked package.');
  const storage=studioStorage();if(!storage)throw new StudioError('Private storage is unavailable.');
  const read=async(path:string)=>{const f=await call<{blobId:string}>(rpc,'studio_release_preparation_file',{p_preparation:input.preparationId,p_path:path});const {bytes}=await readBlob(rpc,storage,f.blobId);return new TextDecoder('utf-8',{fatal:true}).decode(bytes);};
  const [publication,registrations]=await Promise.all([read(`export/public/${input.moduleId}/publication-input.json`),read('registrations/verified-bindings.json')]);
  await call(rpc,'studio_stage_release',{p_preparation:input.preparationId,p_report_sha256:input.reportSha256,p_publication:publication,p_registrations:registrations,p_command:input.command});revalidatePath('/admin/studio/releases');return {ok:true as const};
 }catch(e){return failure(e);}
}
export async function reviewRelease(input:{candidateId:string;reportSha256:string;decision:'approved'|'revoked';reason:string;command:string}){
 const {rpc}=await requireStudioEditor();try{
  if(!isUuid(input.candidateId)||!isUuid(input.command)||!isSha256(input.reportSha256))throw new StudioError('Select an exact package.');
  await call(rpc,'studio_review_release',{p_candidate:input.candidateId,p_report_sha256:input.reportSha256,p_decision:input.decision,p_reason:input.reason,p_command:input.command});revalidatePath('/admin/studio/releases');return {ok:true as const};
 }catch(e){return failure(e);}
}
export async function activateRelease(input:{candidateId:string;approvalId:string;expectedRelease:string;expectedActivation:string|null;kind:'publish'|'rollback'|'confirm_current';reason:string;command:string}){
 const {rpc}=await requireStudioEditor();try{
  if(!isUuid(input.candidateId)||!isUuid(input.approvalId)||!isUuid(input.command)||(input.expectedActivation!==null&&!isUuid(input.expectedActivation)))throw new StudioError('Refresh the release before activation.');
  await call(rpc,'studio_activate_release',{p_candidate:input.candidateId,p_approval:input.approvalId,p_expected_release:input.expectedRelease,p_expected_activation:input.expectedActivation,p_kind:input.kind,p_reason:input.reason,p_command:input.command});revalidatePath('/admin/studio/releases');return {ok:true as const};
 }catch(e){return failure(e);}
}
