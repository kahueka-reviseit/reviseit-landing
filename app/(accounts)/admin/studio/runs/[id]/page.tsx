import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { creditsEnabled } from '../../../../../../lib/credits/server';
import { requireStudioEditor } from '../../../../../../lib/studio/server';
import { call, gateLabels, isUuid, stageLabels, GATES, type Gate } from '../../../../../../lib/studio/contracts';
import { StaffHeader } from '../../../../staff-header';
import { button } from '../../../../system/button';
import ui from '../../../../experience.module.css';
import s from '../../studio.module.css';
import { RequestChanges } from '../../request-changes';
import { cancelStage, recordDecision, retryStage } from '../../actions';
export const dynamic = 'force-dynamic';

/** One persistent run: pinned inputs, stage attempts, named revisions, the five reviews and resume actions. */
export default async function StudioRun({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!isUuid(id)) notFound();
  const { rpc, account } = await requireStudioEditor();
  let v: any;
  try { v = await call(rpc, 'studio_run_view', { p_run: id }); } catch { notFound(); }
  const views = await Promise.all(GATES.map(g => call<any>(rpc, 'studio_gate_view', { p_run: id, p_gate: g }).catch(() => null)));
  const execution = await call<any>(rpc, 'studio_execution_view', { p_run: id });
  const pins = v.inputs.at(-1);
  return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name || '').split(/\s+/)[0] || undefined} record={{ back: '/admin/studio', label: 'Curriculum Studio' }}/>
    <main className={ui['site-shell__main']}><div className={ui['page--staff']}><div className={s.studio}>
      <header className={ui['page-header--staff']}><div className={ui['page-header__titles--staff']}><h1 className={ui['page-header__title--staff']}>Run {id.slice(0, 8)}</h1>
        <p className={ui['page-header__lede--staff']}>{v.run.purpose === 'rehearsal' ? 'Rehearsal: isolated, can never update the accepted bank or a live release.' : 'Canonical run pinned to the accepted bank snapshot.'} State: {v.run.state}. Input revision {v.run.current_input_revision}.</p></div></header>
      <section className={s.card}><h2 className={s.card__title}>Pinned inputs (revision {pins.input_revision})</h2>
        <table className={s.table}><tbody>{[['Source digest', pins.source_digest], ['Bank manifest', pins.bank_manifest_sha256], ['Policy', pins.policy_sha256], ['Skill contract', `${pins.skill_contract_id} · ${pins.skill_sha256}`], ['Validator', pins.validator_sha256], ['Subject adapter', pins.subject_adapter], ['Provider profile', `${pins.provider_profile_id} · ${pins.adapter_version} · ${pins.prompt_version}`]]
          .map(([k, val]) => <tr key={k}><th>{k}</th><td className={s.mono}>{val}</td></tr>)}</tbody></table></section>
      <section className={s.card}><h2 className={s.card__title}>Execution</h2>
        <p className={s.note}>{execution.budget ? `Recorded replies only. Allowance: ${execution.budget.trialState}. This is workflow testing, not live model analysis.` : 'Waiting for the operator to bind a recorded runtime allowance. Starting a run does not grant spending authority.'}</p>
        {execution.budget && <p className={s.mono}>Contract {execution.budget.contractId} · bundle {execution.budget.bundleSha256.slice(0, 16)} · held {execution.budget.heldMicro} / settled {execution.budget.settledMicro} micro-USD of {execution.budget.runLimitMicro} allowed (recorded simulation)</p>}
      </section>
      <section className={s.card}><h2 className={s.card__title}>Stages</h2>
        <table className={s.table}><thead><tr><th>Stage</th><th>State</th><th>Attempts</th><th>Error</th><th>Action</th></tr></thead><tbody>
          {v.stages.map((st: any) => <tr key={st.id}><td>{stageLabels[st.stage_key as keyof typeof stageLabels]}{!execution.currentStages.includes(st.id) && <small> · historical</small>}<div className={s.mono}>{st.input_digest.slice(0, 12)}</div></td>
            <td><span className={['failed', 'uncertain', 'blocked'].includes(st.state) ? s['state--problem'] : st.state === 'succeeded' ? s['state--done'] : s.state}>{st.state}</span></td>
            <td>{st.attempts.map((a: any) => `${a.attempt_number}: ${a.state}`).join(', ') || '—'}</td><td>{st.error || st.blocked_reason || ''}</td>
            <td>{v.run.state === 'active' && execution.currentStages.includes(st.id) && ['failed', 'uncertain', 'cancelled', 'blocked'].includes(st.state) && <form action={retryStage} className={s.form}><input type="hidden" name="runId" value={id}/><input type="hidden" name="stageId" value={st.id}/><input type="hidden" name="attempts" value={st.attempt_count}/><input type="hidden" name="command" value={randomUUID()}/>
              <label>Reason (an uncertain provider call may already have been charged)<input name="reason" required minLength={10}/></label><button className={button('secondary', { size: 'xsmall' })}>Retry explicitly</button></form>}
              {v.run.state === 'active' && execution.currentStages.includes(st.id) && ['queued', 'running', 'blocked'].includes(st.state) && <form action={cancelStage}><input type="hidden" name="runId" value={id}/><input type="hidden" name="stageId" value={st.id}/><input type="hidden" name="command" value={randomUUID()}/><button className={button('danger', { size: 'xsmall' })}>Cancel</button></form>}</td></tr>)}
        </tbody></table></section>
      <section className={s.card}><h2 className={s.card__title}>Human checkpoints</h2>
        <p className={s.note}>Each review binds the exact revisions listed. A changed revision or pinned input invalidates it and every later review.</p>
        <table className={s.table}><thead><tr><th>Review</th><th>Status</th><th>Bound revisions</th><th>Decision</th></tr></thead><tbody>
          {GATES.map((g: Gate, i) => { const gv = views[i]; const bound = gv?.binding?.artifacts || [];
            return <tr key={g}><td>{gateLabels[g]}</td><td>{gv?.live ? `approved${gv.live.self_reviewed ? ' (self-reviewed)' : ''}` : gv?.binding ? (gv.previousApproved ? 'ready for review' : 'waiting for earlier checkpoint') : 'waiting'}</td>
              <td>{bound.map((a: any) => <div key={a.id}><Link className={ui['link']} href={`/admin/studio/files/${a.id}`}>{a.logicalKey}</Link> <span className={s.mono}>{a.sha256.slice(0, 10)}</span></div>)}</td>
              <td>{v.run.state === 'active' && gv?.binding && !gv.live && gv.previousApproved && <form action={recordDecision} className={s.form}>
                <input type="hidden" name="runId" value={id}/><input type="hidden" name="gate" value={g}/><input type="hidden" name="version" value={gv.version}/><input type="hidden" name="bound" value={bound.map((a: any) => a.id).join(',')}/><input type="hidden" name="command" value={randomUUID()}/>
                <label>Outcome<select name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
                <label>Rationale<input name="rationale" required minLength={3}/></label>
                <label>Authorisation reference<input name="reference" required minLength={3} defaultValue="Studio review screen"/></label>
                <label>Scope<input name="scope" required minLength={3} defaultValue={`This run, ${gateLabels[g].toLowerCase()} only`}/></label>
                {g === 'G4_content' && <label>Content judgments (JSON)<textarea name="items" rows={3} defaultValue={JSON.stringify((gv.changeset?.records || []).map((r: any) => ({ recordKind: r.kind, recordId: r.id, aspect: 'method', verdict: 'unresolved', disposition: 'blocks_integration', reason: 'Not yet judged' })))}/></label>}
                <button className={button('primary', { size: 'xsmall' })}>Record decision</button></form>}
                {v.run.state === 'active' && gv?.binding && ['G3_records', 'G4_content'].includes(g) && <details><summary>Request changes</summary><RequestChanges key={`${g}:${gv.version}:${bound.map((a: any) => a.id).join(',')}`} runId={id} gate={g} version={gv.version} bound={bound.map((a: any) => a.id)} command={randomUUID()}/></details>}
              </td></tr>; })}
        </tbody></table></section>
      <section className={s.card}><h2 className={s.card__title}>Feedback and revision history</h2>
        {execution.revisionRequests.length === 0 ? <p className={s.note}>No revision requests yet. Request changes at the drafted-record or content checkpoint.</p> : execution.revisionRequests.map((q: any) => <article key={q.id}><p><strong>Request {q.sequence}</strong> · {gateLabels[q.gate as Gate]} · {q.created_at}</p><p style={{whiteSpace:'pre-wrap'}}>{q.instruction}</p><p className={s.note}>Reviewer {q.created_by}; tied to {q.bound.artifacts.length} reviewed revisions. This request grants no approval.</p></article>)}
        {v.decisions.map((d: any) => <p key={d.id}>{gateLabels[d.gate as Gate]}: {d.outcome}{d.invalidated_at ? ' · invalidated' : ''} · {d.rationale}</p>)}
      </section>
      <section className={s.card}><h2 className={s.card__title}>Revisions</h2>
        <table className={s.table}><thead><tr><th>Logical key</th><th>Revision</th><th>State</th><th>Author</th><th>Integrity</th><th>Digest</th></tr></thead><tbody>
          {v.artifacts.map((a: any) => <tr key={a.id}><td><Link className={ui['link']} href={`/admin/studio/files/${a.id}`}>{a.logicalKey}</Link></td><td>{a.revision}</td><td>{a.state}</td><td>{a.author}</td>
            <td><span className={a.integrity === 'verified' ? s.state : s['state--problem']}>{a.integrity}</span></td><td className={s.mono}>{a.sha256.slice(0, 16)}</td></tr>)}</tbody></table></section>
      <section className={s.card}><h2 className={s.card__title}>Provider attempts</h2>
        {v.providerOperations.length === 0 ? <p className={s.note}>No recorded exchanges yet. Live model calls are disabled.</p> :
        <table className={s.table}><thead><tr><th>Operation</th><th>Attempts</th></tr></thead><tbody>{v.providerOperations.map((o: any) => <tr key={o.id}><td>{o.operation}</td>
          <td>{o.attempts.map((p: any) => `${p.attempt_number}: ${p.dispatch_state}${p.possible_charge ? ' (possible charge)' : ''}${p.late ? ' (late)' : ''}`).join(', ')}</td></tr>)}</tbody></table>}</section>
      <section className={s.card}><h2 className={s.card__title}>Audit history</h2>
        <table className={s.table}><tbody>{v.events.slice(-40).map((e: any) => <tr key={e.id}><td className={s.mono}>{e.created_at}</td><td>{e.actor_kind}</td><td>{e.event}</td></tr>)}</tbody></table></section>
    </div></div></main></>;
}
