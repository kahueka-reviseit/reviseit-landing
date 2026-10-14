import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../../lib/studio/contracts';
import {readBlob} from '../../../../../../../lib/studio/uploads';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import type {Integration} from '../../../../../../../lib/studio/integration';
import type {MaintenanceCheck} from '../../../../../../../lib/studio/maintenance-checks';
import {impactUrl,type FileImpact} from '../../../../../../../lib/studio/dependencies';
import {StaffHeader} from '../../../../../staff-header';
import {StudioShell,StudioHeading} from '../../../components';
import {IntegrationReview,type ChangeEvidence} from '../../../integration-review';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {rpc,account}=await requireStudioEditor(),{id}=await params;let v:Integration|null=null,reportVerified=false;const evidence:ChangeEvidence[]=[];
 try{if(!isUuid(id))throw new Error('Invalid integration');v=await call(rpc,'studio_maintenance_integration_view',{p_changeset:id});const storage=studioStorage(),check=await call<MaintenanceCheck>(rpc,'studio_maintenance_check_view',{p_check:v!.checkId});
 if(storage&&check.reportBlobId){try{reportVerified=(await readBlob(rpc,storage,check.reportBlobId)).info.sha256===check.reportSha256;}catch{}}
 for(const e of v!.entries){const out:ChangeEvidence={path:e.path,before:null,after:null,verified:false,impactUrl:impactUrl({snapshotId:v!.snapshotId,path:e.path,sha256:e.beforeSha256}),catalogueItems:[],orderCount:0,unresolvedLinks:0,impactAvailable:false};
 if(storage){try{const a=await readBlob(rpc,storage,e.beforeBlobId),b=await readBlob(rpc,storage,e.afterBlobId);out.verified=a.info.sha256===e.beforeSha256&&b.info.sha256===e.afterSha256;out.before=new TextDecoder('utf-8',{fatal:true}).decode(a.bytes);out.after=new TextDecoder('utf-8',{fatal:true}).decode(b.bytes);}catch{out.verified=false;}}
 try{const impact=await call<FileImpact>(rpc,'studio_file_impact_view',{p_snapshot:v!.snapshotId,p_path:e.path,p_sha256:e.beforeSha256});out.catalogueItems=[...new Map([...impact.catalogueUses,...impact.formItems].map(x=>[`${x.release}:${x.entryId}`,x])).values()];out.orderCount=impact.orders.pinningSourceBytes;out.unresolvedLinks=impact.unresolvedLinkCount;out.impactAvailable=true;}catch{}
 evidence.push(out);}
 }catch{v=null;}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={v?.moduleId}>{v?<IntegrationReview integration={v} evidence={evidence} reportVerified={reportVerified}/>:<><StudioHeading title="Integration unavailable" breadcrumb="Library"/><p role="alert">Reopen this integration from its proposed bank review.</p></>}</StudioShell></>;
}
