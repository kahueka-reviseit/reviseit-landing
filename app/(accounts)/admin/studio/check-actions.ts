'use server';
import {revalidatePath} from 'next/cache';
import {requireStudioEditor} from '../../../../lib/studio/server';
import {call,StudioError,isUuid,isSha256} from '../../../../lib/studio/contracts';
import {studioStorage} from '../../../../lib/studio/storage';
import {readBlob} from '../../../../lib/studio/uploads';
import type {MaintenanceCheck} from '../../../../lib/studio/maintenance-checks';
export async function requestCheckAction(input:{snapshotId:string;entries:Array<{draftId:string;revision:number;sha256:string}>;command:string}) {
 const {rpc}=await requireStudioEditor();
 try {if(!isUuid(input.snapshotId)||!isUuid(input.command))throw new StudioError('Select a bank and saved revisions.');
 const result=await call<{checkId:string}>(rpc,'studio_request_maintenance_check',{p_snapshot:input.snapshotId,p_entries:input.entries,p_command:input.command});return {ok:true as const,...result};}
 catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'The request failed. Retry explicitly to check its result.'};}
}
export async function reviewCheckAction(input:{checkId:string;version:number;reportSha256:string;outcome:string;rationale:string;acknowledgements:Record<string,boolean>;command:string}) {
 const {rpc}=await requireStudioEditor();
 try {
 if(!isUuid(input.checkId)||!isUuid(input.command)||!isSha256(input.reportSha256))throw new StudioError('Open a verified check report first.');
 const view=await call<MaintenanceCheck>(rpc,'studio_maintenance_check_view',{p_check:input.checkId});
 const storage=studioStorage();if(!storage||!view.reportBlobId)throw new StudioError('The retained report is unavailable.');
 const retained=await readBlob(rpc,storage,view.reportBlobId);if(retained.info.sha256!==input.reportSha256)throw new StudioError('Report changed. Refresh before reviewing.');
 const result=await call<{checkId:string}>(rpc,'studio_review_maintenance_check',{p_check:input.checkId,p_version:input.version,p_report_sha256:input.reportSha256,p_outcome:input.outcome,p_rationale:input.rationale,p_acknowledgements:input.acknowledgements,p_command:input.command});
 revalidatePath('/admin/studio/library/checks','layout');return {ok:true as const,...result};
 }catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'Review was not confirmed. Your reason is retained; retry explicitly.'};}
}
