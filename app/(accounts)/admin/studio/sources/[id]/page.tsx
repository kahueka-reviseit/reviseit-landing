import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { call, isUuid } from '../../../../../../lib/studio/contracts';
import { requireStudioEditor } from '../../../../../../lib/studio/server';
import { StaffHeader } from '../../../../staff-header';
import { StudioHeading, StudioShell } from '../../components';
import { startRun } from '../../actions';
import { studioStorage } from '../../../../../../lib/studio/storage';
import { readArtifact } from '../../../../../../lib/studio/uploads';
import { inventorySummary } from '../../../../../../lib/studio/inventory-review';
import { SourceRecord } from '../../source-record';
import s from '../../studio.module.css';
export const dynamic='force-dynamic';
export default async function SourcePage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!isUuid(id))notFound();
  const {rpc,account}=await requireStudioEditor();
  const [source,overview,execution]=await Promise.all([call<any>(rpc,'studio_source_view',{p_source:id}),call<any>(rpc,'studio_overview',{}),call<any>(rpc,'studio_execution_options',{})]);
  const runs=overview.runs.filter((r:any)=>r.sourceId===id),snaps=overview.snapshots.filter((x:any)=>x.moduleId===source.moduleId);
  let analysis: any = null;
  const completedExtraction = runs.find((r:any)=>r.stages.S1_extract==='succeeded');
  if(completedExtraction) {
    try {
      const view=await call<any>(rpc,'studio_run_view',{p_run:completedExtraction.id});
      const current=view.artifacts.find((a:any)=>a.kind==='inventory'&&a.logicalKey==='inventory'&&a.state==='current');
      const storage=studioStorage();
      if(current&&storage){const {bytes}=await readArtifact(rpc,storage,current.id);const inventory=JSON.parse(new TextDecoder().decode(bytes));analysis={runId:completedExtraction.id,revision:current.revision,totals:inventorySummary(inventory),identity:inventory.source_identity};}
    } catch { analysis={unavailable:true}; }
  }
  return <><StaffHeader current="studio" studioEnabled signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell moduleId={source.moduleId} modules={overview.modules.map((m:any)=>m.moduleId)}>
    <SourceRecord source={source} runs={runs} analysis={analysis}/>
    <details className={s['studio-panel']}><summary>Set up a recorded rehearsal</summary><p>Uses recorded replies. Live analysis needs a separate operator allowance; this form does not enable paid calls.</p>
      <form action={startRun} className={s.form}><input type="hidden" name="sourceId" value={id}/><input type="hidden" name="revision" value={source.revision}/><input type="hidden" name="command" value={randomUUID()}/>
        <label>Analysis skill<select name="skillContract" required>{execution.skills.map((x:any)=><option key={x.id}>{x.id}</option>)}</select></label>
        <label>Recorded runtime profile<select name="profile" required>{execution.profiles.map((x:any)=><option key={x.id}>{x.id}</option>)}</select></label>
        <label>Purpose<select name="purpose" defaultValue="rehearsal"><option value="rehearsal">Rehearsal (isolated)</option><option value="canonical">Canonical</option></select></label>
        <label>Bank snapshot<select name="snapshotId" required>{snaps.map((x:any)=><option key={x.id} value={x.id}>{x.purpose} · {x.manifestSha256.slice(0,10)}</option>)}</select></label>
        <button className={s['studio-button']} disabled={!execution.profiles.length||!execution.skills.length||!snaps.length||source.state!=='active'}>Start recorded run</button>
      </form>
    </details>
  </StudioShell></>;
}
