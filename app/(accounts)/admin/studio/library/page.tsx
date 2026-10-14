import {creditsEnabled} from '../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../lib/studio/contracts';
import type {LibraryData} from '../../../../../lib/studio/library';
import {StaffHeader} from '../../../staff-header';
import {Notice} from '../../../system/notice';
import {StudioShell,StudioHeading} from '../components';
import {LibraryView} from '../library-view';
export const dynamic='force-dynamic';
export default async function Library({searchParams}:{searchParams:Promise<{module?:string;snapshot?:string;tab?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),q=await searchParams;let data:LibraryData|null=null;
 try {if(q.snapshot&&!isUuid(q.snapshot))throw new Error('Invalid snapshot');data=await call(rpc,'studio_library_view',{p_module:q.module||null,p_snapshot:q.snapshot||null});}catch{}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={q.module} modules={data?.modules.map(m=>m.id)}>{data?<LibraryView key={`${q.module}:${q.snapshot}`} data={data} moduleId={q.module} initialTab={q.tab}/>:<><StudioHeading title="Question library" breadcrumb="Library"/><Notice tone="problem">The library could not be loaded. Check the selected module and snapshot, then refresh.</Notice></>}</StudioShell></>;
}
