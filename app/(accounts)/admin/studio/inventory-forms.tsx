'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { addInventorySourceReviewAction, correctInventoryMarkAction, correctInventoryCognitionAction, reviewInventoryAction, type ActionResult } from './actions';
import { button } from '../../system/button';
import s from './studio.module.css';
import { COGNITIVE_CATEGORIES } from '../../../../lib/studio/cognitive-classification';

function SubmitForm({ children, action, label, success, requireValid = false }: { children: React.ReactNode; action: (form: FormData) => Promise<ActionResult>; label: string; success: string; requireValid?: boolean }) {
  const [result, setResult] = useState<ActionResult | null>(null), [pending, setPending] = useState(false), [valid,setValid] = useState(!requireValid);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending || result?.ok || (requireValid && !e.currentTarget.checkValidity())) return;
    const data = new FormData(e.currentTarget); setPending(true);
    try { const r = await action(data); setResult(r); if (r.ok) router.refresh(); }
    catch { setResult({ ok: false, error: 'The save did not complete. Refresh to check its status before trying again.' }); }
    finally { setPending(false); }
  }
  return <form className={`${s.form} ${requireValid ? s['studio-decision'] : ''}`} onChange={e=>{if(requireValid)setValid(e.currentTarget.checkValidity());}} onSubmit={submit}>{children}<button disabled={!valid || pending || result?.ok === true} className={button('secondary', { size: 'xsmall' })}>{pending ? 'Saving…' : label}</button>{result && <p role={result.ok ? 'status' : 'alert'}>{result.ok ? success : result.error}</p>}</form>;
}
export function MarkCorrectionForm({ runId, artifactId, expectedSha256, partId, marks, command, asOf }: { runId: string; artifactId: string; expectedSha256: string; partId: string; marks: number | null; command: string; asOf: string }) {
  return <SubmitForm action={correctInventoryMarkAction} label="Save mark correction" success="Correction saved as a new revision. Inventory approval is still required.">
    {Object.entries({ runId, artifactId, expectedSha256, partId, command, asOf }).map(([name, value]) => <input key={name} type="hidden" name={name} value={value}/>)}
    <label>Marks for {partId}<input name="marks" type="number" min="0" max="1000" step="any" defaultValue={marks ?? ''}/><small>Leave blank if unknown.</small></label>
    <label>Reason for correcting {partId}<textarea name="reason" required minLength={10} maxLength={2000} rows={2}/></label>
  </SubmitForm>;
}
export function InventoryDecisionForm({ runId, version, bound, command }: { runId: string; version: number; bound: string[]; command: string }) {
  return <SubmitForm requireValid action={reviewInventoryAction} label="Record inventory decision" success="Inventory decision recorded for the exact reviewed revisions.">
    {Object.entries({ runId, version, bound: bound.join(','), command, gate: 'G1_inventory', reference: 'Studio inventory review screen', scope: 'This inventory and its bound source evidence only' }).map(([name, value]) => <input key={name} type="hidden" name={name} value={value}/>)}
    <label>Decision<select name="outcome" required defaultValue=""><option value="" disabled>Choose a decision</option><option value="approved">Approve inventory for matching</option><option value="rejected">Reject inventory</option></select></label>
    <label>Review rationale<textarea name="rationale" required minLength={3} rows={3}/></label>
    <label><input name="reviewed" type="checkbox" value="yes" required/>I have reviewed the inventory, source evidence, corrections and open issues.</label>
  </SubmitForm>;
}

export function CognitiveCorrectionForm({ runId, artifactId, expectedSha256, partId, category, reason, command, asOf }: {
  runId: string; artifactId: string; expectedSha256: string; partId: string;
  category: string | null; reason: string; command: string; asOf: string;
}) {
  return <SubmitForm action={correctInventoryCognitionAction} label="Save Bloom’s correction" success="Bloom’s correction saved as a new revision. Inventory approval is still required.">
    {Object.entries({ runId, artifactId, expectedSha256, partId, command, asOf }).map(([name,value]) => <input key={name} type="hidden" name={name} value={value}/>)}
    <label>Bloom’s level for {partId}<select name="category" defaultValue={category ?? ''}><option value="">Unresolved</option>{category && !(COGNITIVE_CATEGORIES as readonly string[]).includes(category) && <option value={category} disabled>{category} (existing label)</option>}{COGNITIVE_CATEGORIES.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <label>Reason for Bloom’s classification of {partId}<textarea name="reason" required minLength={10} maxLength={2000} rows={3} defaultValue={reason}/></label>
    <p className={s.note}>Recorded as a reviewer judgement, or unresolved if the Bloom’s level is unknown. Earlier classifications remain in revision history.</p>
  </SubmitForm>;
}

export function SourceReviewForm({ runId, artifactId, expectedSha256, partId, command, asOf }: {
  runId: string; artifactId: string; expectedSha256: string; partId: string; command: string; asOf: string;
}) {
  return <SubmitForm action={addInventorySourceReviewAction} label="Save source finding" success="Finding saved in a new inventory revision. Approval is still required.">
    {Object.entries({runId,artifactId,expectedSha256,partId,command,asOf}).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
    <label>Source finding for {partId}<textarea name="reason" required minLength={10} maxLength={2000} rows={4}/></label>
    <p className={s.note}>Cite the source and page. This note reaches matching and drafting with the approved inventory. It does not change the original transcription, marks or Bloom’s level.</p>
  </SubmitForm>;
}
