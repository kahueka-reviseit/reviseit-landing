import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../../lib/studio/contracts';
import type {FileImpact} from '../../../../../../../lib/studio/dependencies';
import {StaffHeader} from '../../../../../staff-header';
import {Notice} from '../../../../../system/notice';
import {StudioShell,StudioHeading} from '../../../components';
import {DependencyImpact} from '../../../dependency-impact';
export const dynamic='force-dynamic';
export default async function Impact({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{path?:string;sha256?:string;draft?:string;revision?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),{id}=await params,q=await searchParams;let data:FileImpact|null=null;
 try {const revision=Number(q.revision||0);if(!isUuid(id)||(q.draft&&!isUuid(q.draft))||!Number.isSafeInteger(revision)||revision<0||!q.sha256||!/^[a-f0-9]{64}$/.test(q.sha256))throw new Error('Invalid binding');
 data=await call(rpc,'studio_file_impact_view',{p_snapshot:id,p_path:q.path||'',p_sha256:q.sha256,p_draft:q.draft||null,p_revision:revision});}catch{}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={data?.file.moduleId}>{data?<DependencyImpact data={data}/>:<><StudioHeading title="Impact report unavailable" breadcrumb="Library"/><Notice tone="problem">The source or saved draft may have changed, or the dependency read failed. Reopen the report from the current source or draft. No approval has been recorded.</Notice></>}</StudioShell></>;
}
