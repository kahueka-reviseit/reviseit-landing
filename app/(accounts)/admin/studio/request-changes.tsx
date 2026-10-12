'use client';
import { useState, type FormEvent } from 'react';
import { requestRevision, type ActionResult } from './actions';
import { button } from '../../system/button';
import s from './studio.module.css';
export function RequestChanges({ runId, gate, version, bound, command }: { runId: string; gate: string; version: number; bound: string[]; command: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || result?.ok) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    try { setResult(await requestRevision(null, form)); }
    catch { setResult({ok:false,error:'The request did not complete. Refresh to check its status before trying again.'}); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className={s.form}>
    <input type="hidden" name="runId" value={runId}/><input type="hidden" name="gate" value={gate}/>
    <input type="hidden" name="version" value={version}/><input type="hidden" name="bound" value={bound.join(',')}/><input type="hidden" name="command" value={command}/>
    <label>Changes needed<textarea name="instruction" required minLength={10} maxLength={8000} rows={4} placeholder="Name the record, explain the problem and describe the correction needed."/></label>
    <p className={s.note}>Creates a new drafting pass. Earlier drafts remain in history; record, content and integration approvals must be renewed after validation.</p>
    <button disabled={pending || result?.ok === true} className={button('secondary', { size: 'xsmall' })}>{pending ? 'Saving…' : 'Request changes and redraft'}</button>
    {result && <p role={result.ok ? 'status' : 'alert'}>{result.ok ? 'Feedback saved. A new drafting pass is queued for the recorded worker.' : result.error}</p>}
  </form>;
}
