import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../../lib/studio/contracts';
import {readBlob} from '../../../../../../../lib/studio/uploads';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import type {MaintenanceCheck,CheckEntry} from '../../../../../../../lib/studio/maintenance-checks';
import type {MaintenanceDraft,DraftSummary} from '../../../../../../../lib/studio/maintenance-drafts';
import {StaffHeader} from '../../../../../staff-header';
import {StudioShell,StudioHeading} from '../../../components';
import {CheckPreparation,MaintenanceCheckView} from '../../../maintenance-check';
import {IntegrationPreparation} from '../../../integration-review';
export const dynamic='force-dynamic';
export default async function Check({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{snapshot?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),{id}=await params,q=await searchParams;let check:MaintenanceCheck|null=null,entries:CheckEntry[]=[],checks:any[]=[],integrations:any[]=[],verified=false,error=false,moduleId:string|undefined;
 try {
 if(id==='new'){
  if(!isUuid(q.snapshot))throw new Error('Choose a snapshot');
  const ds=await call<DraftSummary[]>(rpc,'studio_maintenance_drafts_view',{p_snapshot:q.snapshot});
  for(const d of ds.filter(x=>x.state==='draft')){const v=await call<MaintenanceDraft>(rpc,'studio_maintenance_draft_view',{p_draft:d.id});moduleId=v.file.moduleId;const r=v.revisions.find(r=>r.revision===v.revision)!;entries.push({draftId:v.id,revision:v.revision,path:v.file.path,blobId:r.blobId,sha256:r.sha256});}
  checks=await call(rpc,'studio_maintenance_checks_view',{p_snapshot:q.snapshot});
 }else {if(!isUuid(id))throw new Error('Invalid check');check=await call(rpc,'studio_maintenance_check_view',{p_check:id});moduleId=check!.moduleId;integrations=await call(rpc,'studio_check_integrations_view',{p_check:id});
  if(check!.reportBlobId&&check!.reportSha256){try{const storage=studioStorage();if(!storage)throw new Error('Storage unavailable');const b=await readBlob(rpc,storage,check!.reportBlobId);verified=b.info.sha256===check!.reportSha256;}catch{}}
 }
 }catch{error=true;}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={moduleId}>{error?<><StudioHeading title="Bank check unavailable" breadcrumb="Library"/><p role="alert">Refresh or reopen this check from its saved drafts.</p></>:check?<><MaintenanceCheckView check={check} verified={verified}/><IntegrationPreparation check={check} integrations={integrations}/></>:<CheckPreparation snapshotId={q.snapshot!} entries={entries} checks={checks}/>}</StudioShell></>;
}
