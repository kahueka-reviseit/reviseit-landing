import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { creditsEnabled } from '../../../../lib/credits/server';
import { requireStudioEditor } from '../../../../lib/studio/server';
import { call, stageLabels, STAGES } from '../../../../lib/studio/contracts';
import { StaffHeader } from '../../staff-header';
import { Notice } from '../../system/notice';
import { button } from '../../system/button';
import ui from '../../experience.module.css';
import s from './studio.module.css';
import { startRun } from './actions';
import { UploadSource } from './upload-source';
export const dynamic = 'force-dynamic';

type Overview = { modules: any[]; snapshots: any[]; sources: any[]; runs: any[] };
/** Curriculum Studio (Paper CS-A1 to CS-A3): sources, persistent runs and their next human decision. */
export default async function Studio() {
  const { rpc, account } = await requireStudioEditor();
  let data: Overview | null = null;
  try { data = await call<Overview>(rpc, 'studio_overview', {}); } catch { data = null; }
  const execution = await call<any>(rpc, 'studio_execution_options', {});
  const first = (account.full_name || '').split(/\s+/)[0];
  return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={first || undefined}/>
    <main className={ui['site-shell__main']}><div className={ui['page--staff']}>
      <header className={ui['page-header--staff']}><div className={ui['page-header__titles--staff']}><h1 className={ui['page-header__title--staff']}>Curriculum Studio</h1>
        <p className={ui['page-header__lede--staff']}>Past-paper analysis runs. The accepted bank stays on the operator&apos;s machine; Studio keeps verified copies and proposals.</p></div></header>
      {!data ? <Notice tone="problem">Studio could not be loaded. Nothing was changed.</Notice> : <div className={s.studio}>
        <section className={s.card} aria-labelledby="modules"><h2 id="modules" className={s.card__title}>Modules and accepted snapshots</h2>
          {data.modules.length === 0 ? <p className={s.note}>No module is enrolled. The operator enrols a module and imports a verified snapshot first.</p> :
          <table className={s.table}><thead><tr><th>Module</th><th>Subject adapter</th><th>Accepted snapshot</th></tr></thead><tbody>
            {data.modules.map(m => <tr key={m.moduleId}><td>{m.moduleId}</td><td>{m.subjectAdapter}</td><td className={s.mono}>{m.acceptedManifestSha256 ? m.acceptedManifestSha256.slice(0, 16) + '…' : 'none accepted'}</td></tr>)}</tbody></table>}
        </section>
        <section className={s.card} aria-labelledby="sources"><h2 id="sources" className={s.card__title}>Sources</h2>
          {data.modules.length > 0 && <UploadSource modules={data.modules.map(m => m.moduleId)}/>}
          <table className={s.table}><thead><tr><th>Title</th><th>Module</th><th>Revision</th><th>Start a run</th></tr></thead><tbody>
            {data.sources.map(src => { const snaps = data!.snapshots.filter(x => x.moduleId === src.moduleId);
              return <tr key={src.id}><td>{src.title}</td><td>{src.moduleId}</td><td>{src.revision}</td><td>
                <form action={startRun} className={s.form}><input type="hidden" name="sourceId" value={src.id}/><input type="hidden" name="revision" value={src.revision}/>
                  <input type="hidden" name="command" value={randomUUID()}/>
                  <label>Analysis skill<select name="skillContract" required>{execution.skills.map((x: any) => <option key={x.id} value={x.id}>{x.id}</option>)}</select></label>
                  <label>Recorded runtime profile<select name="profile" required>{execution.profiles.map((x: any) => <option key={x.id} value={x.id}>{x.id} · recorded replies</option>)}</select></label>
                  <p className={s.note}>The operator must bind this run to a matching runtime allowance before its worker can start. No live model calls are enabled.</p>
                  <label>Purpose<select name="purpose" defaultValue="rehearsal"><option value="rehearsal">Rehearsal (isolated)</option><option value="canonical">Canonical</option></select></label>
                  <label>Bank snapshot<select name="snapshotId">{snaps.map(x => <option key={x.id} value={x.id}>{x.purpose} · {x.origin} · {x.manifestSha256.slice(0, 10)}</option>)}</select></label>
                  <button disabled={!execution.profiles.length || !execution.skills.length || !snaps.length} className={button('secondary', { size: 'small' })}>Start recorded run</button></form></td></tr>; })}
          </tbody></table>
        </section>
        <section className={s.card} aria-labelledby="runs"><h2 id="runs" className={s.card__title}>Runs</h2>
          {data.runs.length === 0 ? <p className={s.note}>No runs yet.</p> :
          <table className={s.table}><thead><tr><th>Run</th><th>Purpose</th><th>State</th><th>Inputs</th>{STAGES.map(k => <th key={k}>{stageLabels[k]}</th>)}</tr></thead><tbody>
            {data.runs.map(r => <tr key={r.id}><td><Link className={ui['link']} href={`/admin/studio/runs/${r.id}`}>{r.id.slice(0, 8)}</Link></td><td>{r.purpose}</td><td>{r.state}</td><td>revision {r.inputRevision}</td>
              {STAGES.map(k => <td key={k}><span className={['failed', 'uncertain', 'blocked'].includes(r.stages[k]) ? s['state--problem'] : r.stages[k] === 'succeeded' ? s['state--done'] : s.state}>{r.stages[k] || '·'}</span></td>)}</tr>)}</tbody></table>}
        </section>
      </div>}
    </div></main></>;
}
