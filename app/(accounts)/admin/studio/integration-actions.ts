'use server';
import {revalidatePath} from 'next/cache';
import {requireStudioEditor} from '../../../../lib/studio/server';
import {call,StudioError,isUuid,isSha256} from '../../../../lib/studio/contracts';
import {studioStorage} from '../../../../lib/studio/storage';
import {readBlob} from '../../../../lib/studio/uploads';
import type {MaintenanceCheck} from '../../../../lib/studio/maintenance-checks';
import type {Integration} from '../../../../lib/studio/integration';
async function verifyCheck(rpc:Parameters<typeof call>[0],id:string){
 const v=await call<MaintenanceCheck>(rpc,'studio_maintenance_check_view',{p_check:id}),storage=studioStorage();
 if(!storage||!v.reportBlobId||!v.current)throw new StudioError('Current retained report required.');
 const report=await readBlob(rpc,storage,v.reportBlobId);if(report.info.sha256!==v.reportSha256)throw new StudioError('Report integrity changed.');
}
export async function prepareIntegrationAction(input:{checkId:string;reviewVersion:number;rationale:string;command:string}){
 const {rpc}=await requireStudioEditor();try{
 if(!isUuid(input.checkId)||!isUuid(input.command))throw new StudioError('Open a reviewed candidate.');await verifyCheck(rpc,input.checkId);
 const r=await call<{changesetId:string}>(rpc,'studio_prepare_maintenance_integration',{p_check:input.checkId,p_review_version:input.reviewVersion,p_rationale:input.rationale,p_command:input.command});return {ok:true as const,...r};
 }catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'Preparation was not confirmed. Retry explicitly.'};}
}
export async function authoriseIntegrationAction(input:{id:string;manifestSha256:string;rationale:string;acknowledgements:Record<string,boolean>;command:string}){
 const {rpc}=await requireStudioEditor();try{
 if(!isUuid(input.id)||!isUuid(input.command)||!isSha256(input.manifestSha256))throw new StudioError('Open the exact integration first.');
 const v=await call<Integration>(rpc,'studio_maintenance_integration_view',{p_changeset:input.id});await verifyCheck(rpc,v.checkId);
 const storage=studioStorage();if(!storage)throw new StudioError('Evidence storage unavailable.');
 for(const e of v.entries){const before=await readBlob(rpc,storage,e.beforeBlobId),after=await readBlob(rpc,storage,e.afterBlobId);if(before.info.sha256!==e.beforeSha256||after.info.sha256!==e.afterSha256)throw new StudioError('Change evidence failed integrity.');}
 const r=await call<{changesetId:string}>(rpc,'studio_authorise_maintenance_integration',{p_changeset:input.id,p_manifest_sha256:input.manifestSha256,p_rationale:input.rationale,p_acknowledgements:input.acknowledgements,p_command:input.command});
 revalidatePath('/admin/studio/library/integrations','layout');return {ok:true as const,...r};
 }catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'Authorisation was not confirmed. Your reason is retained; retry explicitly.'};}
}
export async function cancelIntegrationAction(input:{id:string;reason:string;command:string}){
 const {rpc}=await requireStudioEditor();try{
 if(!isUuid(input.id)||!isUuid(input.command))throw new StudioError('Open an integration first.');
 await call(rpc,'studio_cancel_maintenance_integration',{p_changeset:input.id,p_reason:input.reason,p_command:input.command});revalidatePath('/admin/studio/library/integrations','layout');return {ok:true as const};
 }catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'Cancellation was not confirmed. Refresh and retry explicitly.'};}
}
