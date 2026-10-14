'use server';
import {revalidatePath} from 'next/cache';
import {requireStudioEditor} from '../../../../lib/studio/server';
import {studioStorage} from '../../../../lib/studio/storage';
import {call,StudioError} from '../../../../lib/studio/contracts';
import {saveMaintenanceDraft} from '../../../../lib/studio/maintenance-save';
import type {SaveDraftInput} from '../../../../lib/studio/maintenance-drafts';
import type {FormSaveInput} from '../../../../lib/studio/form-authoring';
import {saveFormDraft} from '../../../../lib/studio/form-save';

export type DraftActionResult={ok:true;draftId:string;revision:number}|{ok:false;error:string};
function failure(error:unknown):DraftActionResult {
 return {ok:false,error:error instanceof StudioError?error.message:'The request could not be completed. Your text is still in the editor; retry explicitly when the connection is available.'};
}
export async function saveDraftAction(input:SaveDraftInput):Promise<DraftActionResult> {
 const {rpc,verifiedRpc}=await requireStudioEditor();
 try {
  const storage=studioStorage();if(!storage)throw new StudioError('Studio storage is unavailable.');
  const result=await saveMaintenanceDraft(rpc,verifiedRpc,storage,input);
  revalidatePath('/admin/studio/library','layout');return {ok:true,...result};
 }catch(error){return failure(error);}
}
export async function saveFormDraftAction(input:FormSaveInput):Promise<DraftActionResult> {
 const {rpc,verifiedRpc}=await requireStudioEditor();
 try {
  const storage=studioStorage();if(!storage)throw new StudioError('Studio storage is unavailable.');
  const result=await saveFormDraft(rpc,verifiedRpc,storage,input);
  revalidatePath('/admin/studio/library','layout');return {ok:true,...result};
 }catch(error){return failure(error);}
}
export async function discardDraftAction(input:{draftId:string;expectedRevision:number;expectedSha256:string;reason:string;command:string}):Promise<DraftActionResult> {
 const {rpc}=await requireStudioEditor();
 try {
  const result=await call<{draftId:string;revision:number}>(rpc,'studio_discard_maintenance_draft',{p_draft:input.draftId,p_expected_revision:input.expectedRevision,p_expected_sha256:input.expectedSha256,p_reason:input.reason,p_command:input.command});
  revalidatePath('/admin/studio/library','layout');return {ok:true,...result};
 }catch(error){return failure(error);}
}
