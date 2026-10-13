import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireStudioEditor } from '../../../../../../../lib/studio/server';
import { call, isUuid } from '../../../../../../../lib/studio/contracts';
import { studioStorage } from '../../../../../../../lib/studio/storage';
import { readArtifact } from '../../../../../../../lib/studio/uploads';
import { inventorySummary } from '../../../../../../../lib/studio/inventory-review';
import { creditsEnabled } from '../../../../../../../lib/credits/server';
import { StaffHeader } from '../../../../../staff-header';
import { MarkCorrectionForm, CognitiveCorrectionForm, InventoryDecisionForm } from '../../../inventory-forms';
import ui from '../../../../../experience.module.css';
import s from '../../../studio.module.css';
export const dynamic = 'force-dynamic';
export default async function InventoryReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!isUuid(id)) notFound();
  const { rpc, account } = await requireStudioEditor(), storage = studioStorage();
  const v = await call<any>(rpc, 'studio_run_view', { p_run: id });
  const gate = await call<any>(rpc, 'studio_gate_view', { p_run: id, p_gate: 'G1_inventory' });
  const bound = gate.binding?.artifacts || [], selected = v.artifacts.find((a: any) => a.kind === 'inventory' && a.logicalKey === 'inventory' && a.state === 'current' && bound.some((b: any) => b.id === a.id));
  if (!storage || !selected) return <main className={ui['site-shell__main']}><div className={ui['page--staff']}><h1>Inventory is not ready for review</h1><Link href={`/admin/studio/runs/${id}`}>Return to run</Link></div></main>;
  const { info, bytes } = await readArtifact(rpc, storage, selected.id);
  const inventory = JSON.parse(new TextDecoder().decode(bytes)), totals = inventorySummary(inventory);
  const ledgerRef = bound.find((a: any) => a.logicalKey === 'evidence:source_pages');
  const ledger = ledgerRef ? JSON.parse(new TextDecoder().decode((await readArtifact(rpc, storage, ledgerRef.id)).bytes)) : null;
  const pageLinks = new Map<string, string>();
  for (const ref of ledger?.pageArtifacts || []) {
    const artifact = bound.find((a: any) => a.logicalKey === ref.logicalKey);
    if (artifact) pageLinks.set(JSON.stringify([ref.sourceId, ref.filePage]), `/admin/studio/pages/${artifact.id}`);
  }
  const corrections = inventory.human_mark_corrections || [], cognitiveCorrections = inventory.human_cognitive_corrections || [], asOf = new Date().toISOString().slice(0,10);
  const editable = v.run.state === 'active';
  return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name || '').split(/\s+/)[0] || undefined} record={{ back: `/admin/studio/runs/${id}`, label: 'Analysis run' }}/>
    <main className={ui['site-shell__main']}><div className={ui['page--staff']}><div className={s.studio}>
      <header><h1>Review question inventory</h1><p>{inventory.source_identity?.year} · {inventory.source_identity?.period} · Grade {inventory.source_identity?.grade} · {inventory.source_identity?.paper_designation}</p>
        <p>Revision {info.revision} · {gate.live ? 'Approved for matching' : 'Awaiting inventory decision'} · {v.run.purpose === 'rehearsal' ? 'Rehearsal' : 'Canonical run'}</p>
        <p className={s.note}>{inventory.meta?.status}</p></header>
      <section className={s.card}><h2 className={s.card__title}>Inventory checks</h2>
        <p>{totals.questions} questions · {totals.parts} assessed parts · {totals.marks} recorded marks / {totals.printedTotal ?? 'unknown'} printed total · {totals.unknownMarks} unknown marks</p>
        <p>{totals.unknownMarks === 0 && totals.marks === totals.printedTotal ? 'The assessed marks reconcile to the printed paper total.' : 'The marks need review against the source.'}</p>
        <p>{totals.unresolvedClassifications} Bloom’s classifications unresolved. Memorandum comparison: {inventory.memorandum?.comparison_status === 'not_performed' ? 'not performed' : inventory.memorandum?.comparison_status || 'not available'}.</p>
        <p className={s.note}>These checks describe this inventory revision. Original page observations and earlier extraction reports remain unchanged. Approving the inventory allows matching; it does not approve scientific content or changes to the question bank.</p>
      </section>
      <section className={s.card}><h2 className={s.card__title}>Recorded mark corrections</h2>
        {!corrections.length ? <p>No mark corrections recorded.</p> : corrections.map((c: any) => <article key={c.command}><p><strong>Part {c.part_id}: {c.previous_marks ?? 'unknown'} → {c.corrected_marks ?? 'unknown'} marks</strong></p><p>{c.reason}</p><p className={s.note}>Recorded through editor account {c.recorded_by} · {c.date}. Original source observation retained. This correction grants no approval.</p></article>)}
      </section>
      <section className={s.card}><h2 className={s.card__title}>Recorded Bloom’s corrections</h2>
        {!cognitiveCorrections.length ? <p>No Bloom’s corrections recorded.</p> : cognitiveCorrections.map((c: any) => <article key={c.command}><p><strong>Part {c.part_id}: {c.previous.taxonomy_description ?? 'unresolved'} → {c.corrected.taxonomy_description ?? 'unresolved'}</strong></p><p>{c.reason}</p><p className={s.note}>Recorded through editor account {c.recorded_by} · {c.date}. Earlier classification preserved. This correction grants no approval.</p></article>)}
      </section>
      {inventory.questions.map((q: any) => <section key={q.number} className={s.card} id={`question-${q.number}`}>
        <h2>Question {q.number} <small>· {q.marks ?? 'unknown'} printed marks</small></h2>
        <div className={s.reviewGrid}><div>
          {(q.source_content?.fragments || []).map((f: any) => <details key={`${f.source_id}-${f.file_page}`}><summary>Shared wording, diagrams and page notes · page {f.file_page}</summary><p className={s.sourceText}>{f.question?.content?.shared_stem}</p>{(f.question?.content?.figures || []).map((figure: any) => <p key={figure.id}><strong>{figure.id}</strong>: {figure.description}<br/>{figure.notes}</p>)}<p className={s.note}>{f.page_notes}</p></details>)}
          {q.sub_questions.map((part: any) => { const corrected = corrections.filter((c: any) => c.part_id === part.id).at(-1); return <article key={part.id} className={s.reviewPart}>
            <h3>Part {part.id} · {part.marks ?? 'unknown'} marks{corrected ? ' · editor correction' : ''}</h3>
            {(part.source_observations || []).map((o: any, n: number) => <div key={n}><p className={s.sourceText}>{o.content?.source_text || o.task}</p>{(o.content?.answer_choices || []).map((choice: any) => <p key={choice.label}>{choice.label}. {choice.text}</p>)}<p className={s.note}>Source page {o.file_page} · extracted mark: {o.marks ?? 'unknown'}</p></div>)}
            <p className={s.note}>Bloom’s level: {part.taxonomy_description ?? 'unresolved'} · {part.classification_provenance}. {part.classification_reason}</p>
            {editable && <details><summary>Correct marks for {part.id}</summary><p className={s.note}>Saves a new revision and invalidates any inventory approval and dependent reviews. Source transcriptions stay unchanged.</p><MarkCorrectionForm key={`${selected.id}:${part.id}`} runId={id} artifactId={selected.id} expectedSha256={info.sha256} partId={part.id} marks={part.marks} command={randomUUID()} asOf={asOf}/></details>}
            {editable && <details><summary>Correct Bloom’s level for {part.id}</summary><p className={s.note}>Saves a new revision and requires a fresh inventory approval. Marks and source transcriptions stay unchanged.</p><CognitiveCorrectionForm key={`cognition:${selected.id}:${part.id}`} runId={id} artifactId={selected.id} expectedSha256={info.sha256} partId={part.id} category={part.taxonomy_description} reason={part.classification_provenance === 'reviewer_judgement' ? part.classification_reason : ''} command={randomUUID()} asOf={asOf}/></details>}
          </article>; })}
        </div><aside>{(q.source_content?.fragments || []).map((f: any) => { const url = pageLinks.get(JSON.stringify([f.source_id, f.file_page])); return <figure key={`${f.source_id}-${f.file_page}`} className={s.sourceFigure}>{url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Original source page ${f.file_page} for question ${q.number}`} loading="lazy"/></a> : <p>Source image not available.</p>}<figcaption>Original page {f.file_page} · select image to enlarge</figcaption></figure>; })}</aside></div>
      </section>)}
      <section className={s.card}><h2 className={s.card__title}>Inventory decision</h2>
        <p>Review all {totals.parts} parts and the open issues above. Saving a correction does not approve the inventory. Any later correction requires a fresh decision.</p>
        {gate.live ? <p>Approved for matching. Any remaining content questions still require later review.</p> : editable && <InventoryDecisionForm key={`${gate.version}:${selected.id}`} runId={id} version={gate.version} bound={bound.map((a: any) => a.id)} command={randomUUID()}/>}
      </section>
      <section className={s.card}><h2 className={s.card__title}>Inventory revision history</h2>{v.artifacts.filter((a: any) => a.kind === 'inventory').map((a: any) => <p key={a.id}><Link href={`/admin/studio/files/${a.id}`}>Download inventory revision {a.revision}</Link> · {a.state} · {a.author} · {a.createdAt}</p>)}<Link href={`/admin/studio/runs/${id}`}>All source evidence, decisions and audit history</Link></section>
    </div></div></main></>;
}
