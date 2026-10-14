import {creditsEnabled} from '../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../lib/studio/server';
import {call} from '../../../../../lib/studio/contracts';
import type {ReleasesData} from '../../../../../lib/studio/library';
import {StaffHeader} from '../../../staff-header';
import {Notice} from '../../../system/notice';
import {StudioShell,StudioHeading} from '../components';
import {ReleasesView} from '../releases-view';
import {ReleasePreparations} from '../release-preparation';
import type {ReleasePreparationData} from '../../../../../lib/studio/release-preparation';
import {ReleasePublication} from '../release-publication';
import type {ReleasePublicationData} from '../../../../../lib/studio/release-publication';
export const dynamic='force-dynamic';
export default async function Releases({searchParams}:{searchParams:Promise<{module?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),q=await searchParams;let data:ReleasesData|null=null,preparations:ReleasePreparationData|null=null,publication:ReleasePublicationData|null=null;
 await Promise.all([call<ReleasePublicationData>(rpc,'studio_release_publication_view',{p_module:q.module||null}).then(x=>{publication=x;}).catch(()=>{}),call<ReleasesData>(rpc,'studio_releases_view',{p_module:q.module||null}).then(x=>{data=x;}).catch(()=>{}),call<ReleasePreparationData>(rpc,'studio_release_preparations_view',{p_module:q.module||null}).then(x=>{preparations=x;}).catch(()=>{})]);
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="releases" moduleId={q.module} modules={(data as ReleasesData|null)?.modules.map(m=>m.id)}>{data?<ReleasesView data={data} moduleId={q.module}/>:<><StudioHeading title="Catalogue releases" breadcrumb="Releases"/><Notice tone="problem">Release records could not be loaded. Check the module and refresh.</Notice></>}{preparations?<ReleasePreparations data={preparations}/>:<Notice tone="problem">Release preparations could not be loaded. Refresh to try again.</Notice>}{publication&&preparations?<ReleasePublication data={publication} preparations={preparations}/>:<Notice tone="problem">Publication controls could not be loaded. Refresh to try again.</Notice>}</StudioShell></>;
}
