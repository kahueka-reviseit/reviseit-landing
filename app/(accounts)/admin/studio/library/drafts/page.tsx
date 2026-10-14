import Link from 'next/link';
import {creditsEnabled} from '../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../lib/studio/server';
import {call} from '../../../../../../lib/studio/contracts';
import {draftUrl,type DraftSummary} from '../../../../../../lib/studio/maintenance-drafts';
import {moduleLabel} from '../../../../../../lib/studio/presentation';
import {StaffHeader} from '../../../../staff-header';
import {StudioShell,StudioHeading} from '../../components';
import s from '../../studio.module.css';
export const dynamic='force-dynamic';
export default async function Drafts({searchParams}:{searchParams:Promise<{module?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),q=await searchParams;let drafts:DraftSummary[]|null=null;
 try{drafts=await call(rpc,'studio_maintenance_drafts_view',{p_module:q.module||null});}catch{}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={q.module}>
 <StudioHeading title="Private drafts & history" breadcrumb="Library">Saved edits retain their source snapshot. Discarded drafts remain inspectable.</StudioHeading>
 <Link href={`/admin/studio/library${q.module?`?module=${encodeURIComponent(q.module)}&tab=files`:''}`}>Browse bank files →</Link>
 {drafts===null?<p role="alert">Drafts could not be loaded. Refresh to try again.</p>:!drafts.length?<section className={s['studio-panel']}><h2>No private file drafts yet</h2><p>Open a Markdown or JSON bank file and choose “Edit private draft”. Saving does not change the accepted bank or teacher release.</p></section>:<div className={s['studio-list']}>{drafts.map(d=><article className={s['studio-library-row']} key={d.id}><div><h2><Link href={draftUrl(d.id)}>{d.path.split('/').pop()}</Link></h2><p className={s.note}>{moduleLabel(d.moduleId)} · {d.purpose==='rehearsal'?'Rehearsal':'Bank'} copy · revision {d.revision}</p><p className={s.note}>{d.path}</p></div><div className={s['studio-library-row__status']}><span>{d.state==='draft'?'Private draft':'Discarded'}</span><Link href={draftUrl(d.id)}>Open history →</Link><Link href={`/admin/studio/library/checks/new?snapshot=${d.snapshotId}`}>Bank checks & review →</Link></div></article>)}</div>}
 </StudioShell></>;
}
