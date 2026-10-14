'use server';
import {revalidatePath} from 'next/cache';
import {requireStudioEditor} from '../../../../lib/studio/server';
import {call,StudioError,isUuid} from '../../../../lib/studio/contracts';
export async function requestReleasePreparation(input:{snapshotId:string;expectedCurrent:string|null;command:string}) {
 const {rpc}=await requireStudioEditor();
 try {if(!isUuid(input.snapshotId)||!isUuid(input.command))throw new StudioError('Select an accepted bank.');
 const result=await call<{preparationId:string}>(rpc,'studio_request_release_preparation',{p_snapshot:input.snapshotId,p_expected_current:input.expectedCurrent,p_command:input.command});revalidatePath('/admin/studio/releases');return {ok:true as const,...result};}
 catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'Preparation was not confirmed. Retry explicitly to check the request.'};}
}
export async function cancelReleasePreparation(id:string) {
 const {rpc}=await requireStudioEditor();
 try {if(!isUuid(id))throw new StudioError('Select a preparation.');await call(rpc,'studio_cancel_release_preparation',{p_preparation:id});revalidatePath('/admin/studio/releases');return {ok:true as const};}
 catch(e){return {ok:false as const,error:e instanceof StudioError?e.message:'Cancellation was not confirmed. Refresh to check its state.'};}
}
