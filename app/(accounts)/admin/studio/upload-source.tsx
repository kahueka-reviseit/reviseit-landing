'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { moduleLabel } from '../../../../lib/studio/presentation';
import { button } from '../../system/button';
import s from './studio.module.css';
import { createSource, finishUpload, startUpload } from './actions';

/**
 * Source upload: hash in the browser, PUT the bytes to the signed provisional address, then ask the
 * server to verify and finalise. The browser's digest is only a claim; the server recomputes it.
 */
export function UploadSource({ modules }: { modules: string[] }) {
  const router = useRouter(), busy = useRef(false);
  const [pending,setPending] = useState(false);
  const [status, setStatus] = useState<string>('');
  async function submit(form: FormData) {
    if (busy.current) return;
    busy.current=true; setPending(true);
    try {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) { setStatus('Choose a PDF or image first.'); return; }
    setStatus('Checking the file…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    const started = await startUpload({ moduleId: String(form.get('moduleId')), sha256: digest, size: bytes.length, mediaType: file.type, filename: file.name, command: crypto.randomUUID() });
    if (!started.ok) { setStatus(started.error); return; }
    const { sessionId, upload } = started.value as { sessionId: string; upload: { url: string; headers: Record<string, string> } };
    setStatus('Uploading…');
    const target = upload.url.startsWith('studio-local://') ? `/admin/studio/upload?url=${encodeURIComponent(upload.url)}` : upload.url;
    const put = await fetch(target, { method: 'PUT', headers: upload.headers, body: bytes });
    if (!put.ok) { setStatus('The upload did not complete. Nothing was saved; try again.'); return; }
    setStatus('Verifying…');
    const done = await finishUpload(sessionId);
    if (!done.ok) { setStatus(done.error); return; }
    const v = done.value as { state: string; blobId?: string; reason?: string };
    if (v.state !== 'finalised') { setStatus(`The file was not accepted (${v.reason || v.state}).`); return; }
    const fd = new FormData(); fd.set('moduleId', String(form.get('moduleId'))); fd.set('title', String(form.get('title'))); fd.set('blobId', v.blobId!);
    fd.set('role', String(form.get('role'))); fd.set('filename', file.name); fd.set('command', crypto.randomUUID());
    const source = await createSource(fd);
    setStatus(source.ok ? 'Source saved. The file is verified and ready to open.' : source.error);
    if(source.ok) router.refresh();
    } catch { setStatus('Upload interrupted. Refresh to check whether the source was saved before trying again.'); }
    finally { busy.current=false;setPending(false); }
  }
  return <form action={submit} className={s.form}>
    <label>Module<select name="moduleId">{modules.map(m => <option key={m} value={m}>{moduleLabel(m)}</option>)}</select></label>
    <label>Title<input name="title" required minLength={3} maxLength={200}/></label>
    <label>Role<select name="role" defaultValue="combined"><option value="combined">Paper and memorandum</option><option value="question_paper">Question paper</option><option value="memorandum">Memorandum</option></select></label>
    <label>File<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"/></label>
    <button disabled={pending} className={button('secondary', { size: 'small' })}>{pending ? 'Uploading…' : 'Upload source'}</button>
    {status && <p className={s.note} role="status">{status}</p>}
  </form>;
}
