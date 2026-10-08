// @vitest-environment node
// Studio upload finalisation, controlled reads, recovery and reconciliation: the real migration in
// PGlite plus LocalStudioStorage. LABEL: LOCAL STORAGE EMULATION. These prove Studio's protocol
// across a non-transactional byte store; they are not evidence of Cloudflare R2 behaviour.
import { beforeAll, beforeEach, afterAll, describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStudioStorage } from '../../lib/studio/storage/local';
import { createUpload, finaliseUpload, readBlob, recoverBlob } from '../../lib/studio/uploads';
import { reconcileStorage } from '../../lib/studio/reconcile';
import type { Rpc } from '../../lib/studio/contracts';
import { StudioDb, ids, MODULE, sha, ok, key } from './studio-fixture';

let s: StudioDb, dir: string, store: LocalStudioStorage;
const ed = () => s.rpc({ kind: 'user', id: ids.editor }), svc = () => s.rpc({ kind: 'service' });
const pdf = (t: string) => new TextEncoder().encode('%PDF-1.7 ' + t);
beforeAll(async () => {
  s = new StudioDb(); await s.init();
  await ok(s.rpc({ kind: 'operator' }), 'studio_enrol_module', { p_module: MODULE, p_subject_adapter: 'caps-physical-sciences@1' });
}, 60000);
afterAll(async () => { await s.close(); });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-storage-')); store = new LocalStudioStorage(dir);
  await s.begin();
  return async () => { await s.rollback(); rmSync(dir, { recursive: true, force: true }); };
});

async function upload(bytes: Uint8Array, claimed = bytes, rpc: Rpc = ed()) {
  const u = await createUpload(rpc, store, { moduleId: MODULE, sha256: sha(claimed), size: claimed.length, mediaType: 'application/pdf', filename: 'paper.pdf', purpose: 'source', command: key() });
  await store.acceptSignedPut(u.upload.url, bytes);
  return u;
}
const blobRows = (digest: string) => s.sql('select id, integrity from private.studio_blobs where sha256=$1', [digest]);

describe('finalisation protocol', () => {
  test('duplicate uploads of identical bytes produce one immutable object and one verified blob', async () => {
    const bytes = pdf('duplicate'), a = await upload(bytes), b = await upload(bytes);
    const [ra, rb] = [await finaliseUpload(ed(), store, a.sessionId), await finaliseUpload(ed(), store, b.sessionId)];
    expect(ra).toMatchObject({ state: 'finalised', duplicate: false }); expect(rb).toMatchObject({ state: 'finalised', duplicate: true });
    expect((ra as any).blobId).toBe((rb as any).blobId);
    expect((await store.list('studio/blobs/')).map(o => o.key)).toEqual([`studio/blobs/${MODULE}/${sha(bytes)}`]);
  });
  test('replaying a still-valid signed URL after finalisation cannot change committed evidence', async () => {
    const bytes = pdf('original'), u = await upload(bytes);
    const f = await finaliseUpload(ed(), store, u.sessionId) as any;
    await store.acceptSignedPut(u.upload.url, pdf('replaced through a replayed URL'));
    expect(Buffer.from((await readBlob(ed(), store, f.blobId)).bytes).toString()).toBe('%PDF-1.7 original');
    expect(await finaliseUpload(ed(), store, u.sessionId)).toMatchObject({ state: 'finalised', blobId: f.blobId });
    // The signed URL can only ever address the provisional key.
    await expect(store.presignPut(`studio/blobs/${MODULE}/${sha(bytes)}`, { expiresSeconds: 60, contentType: 'application/pdf' })).rejects.toThrow(/Only provisional upload keys/);
  });
  test('corruption before finalisation is rejected and nothing reaches the immutable key', async () => {
    const u = await upload(pdf('actually sent'), pdf('what the client claimed'));
    expect(await finaliseUpload(ed(), store, u.sessionId)).toMatchObject({ state: 'rejected', reason: 'digest mismatch' });
    expect(await store.list('studio/blobs/')).toEqual([]);
    const v = await upload(new TextEncoder().encode('not a pdf at all'), new TextEncoder().encode('not a pdf at all'));
    expect(await finaliseUpload(ed(), store, v.sessionId)).toMatchObject({ state: 'rejected', reason: 'type mismatch' });
  });
  test('storage write succeeds but the database commit fails: a retry commits once, reusing the verified object', async () => {
    const bytes = pdf('db failure'), u = await upload(bytes);
    let fail = true;
    const flaky: Rpc = (name, args) => name === 'studio_commit_upload' && fail ? (fail = false, Promise.resolve({ data: null, error: { message: 'connection reset' } })) : ed()(name, args);
    await expect(finaliseUpload(flaky, store, u.sessionId)).rejects.toThrow(/connection reset/);
    expect(await store.get(`studio/blobs/${MODULE}/${sha(bytes)}`)).not.toBeNull();
    expect(await blobRows(sha(bytes))).toEqual([]);
    expect(await finaliseUpload(flaky, store, u.sessionId)).toMatchObject({ state: 'finalised', duplicate: false });
    expect(await blobRows(sha(bytes))).toHaveLength(1);
  });
  test('concurrent finalisation of one session and of two identical sessions converges on one blob', async () => {
    const bytes = pdf('concurrent'), a = await upload(bytes), b = await upload(bytes);
    const results = await Promise.all([finaliseUpload(ed(), store, a.sessionId), finaliseUpload(ed(), store, a.sessionId), finaliseUpload(ed(), store, b.sessionId)]);
    expect(new Set(results.map((r: any) => r.blobId)).size).toBe(1);
    expect(await blobRows(sha(bytes))).toHaveLength(1);
  });
  test('an existing digest key holding different bytes is never overwritten; reconciliation clears the orphan', async () => {
    const bytes = pdf('genuine'), target = `studio/blobs/${MODULE}/${sha(bytes)}`;
    await store.put(target, pdf('tampered orphan'), 'application/pdf');
    const u = await upload(bytes);
    await expect(finaliseUpload(ed(), store, u.sessionId)).rejects.toThrow(/differs from its digest; recorded and not overwritten/);
    expect(Buffer.from((await store.get(target))!).toString()).toBe('%PDF-1.7 tampered orphan');
    const report = await reconcileStorage(svc(), store, { graceMs: 0, deleteOrphans: true });
    expect(report.refused).toContain(target); // the session is still verifying that key
    await s.sql("update private.studio_upload_sessions set expires_at=now()-interval '2 hours' where id=$1", [u.sessionId]);
    const second = await reconcileStorage(svc(), store, { graceMs: 0, deleteOrphans: true });
    expect(second.deleted).toContain(target);
    const v = await upload(bytes);
    expect(await finaliseUpload(ed(), store, v.sessionId)).toMatchObject({ state: 'finalised' });
  });
});

describe('integrity and recovery', () => {
  test('a missing committed object is detected on read, blocks further reads, and recovers only explicitly', async () => {
    const bytes = pdf('to lose'), u = await upload(bytes), f = await finaliseUpload(ed(), store, u.sessionId) as any;
    await store.delete(`studio/blobs/${MODULE}/${sha(bytes)}`);
    await expect(readBlob(ed(), store, f.blobId)).rejects.toThrow(/Integrity blocked: bytes missing/);
    expect(await blobRows(sha(bytes))).toEqual([{ id: f.blobId, integrity: 'missing' }]);
    await expect(readBlob(ed(), store, f.blobId)).rejects.toThrow(/Integrity blocked/);
    await expect(recoverBlob(ed(), store, f.blobId, pdf('wrong bytes'), 'Restore from scanner archive', 'application/pdf')).rejects.toThrow(/do not match/);
    expect((await blobRows(sha(bytes)))[0].integrity).toBe('recovering'); // still blocks consumption
    await recoverBlob(ed(), store, f.blobId, bytes, 'Restore from scanner archive', 'application/pdf');
    expect(Buffer.from((await readBlob(ed(), store, f.blobId)).bytes).toString()).toBe('%PDF-1.7 to lose');
  });
  test('corrupt committed bytes are detected by digest on every read', async () => {
    const bytes = pdf('to corrupt'), u = await upload(bytes), f = await finaliseUpload(ed(), store, u.sessionId) as any;
    await store.put(`studio/blobs/${MODULE}/${sha(bytes)}`, pdf('to c0rrupt'), 'application/pdf');
    await expect(readBlob(ed(), store, f.blobId)).rejects.toThrow(/bytes corrupt/);
    expect((await blobRows(sha(bytes)))[0].integrity).toBe('corrupt');
  });
  test('denied or unavailable storage is recorded as inaccessible, not as success', async () => {
    const bytes = pdf('denied'), u = await upload(bytes), f = await finaliseUpload(ed(), store, u.sessionId) as any;
    store.fault = op => { if (op === 'get') throw new Error('403'); };
    await expect(readBlob(ed(), store, f.blobId)).rejects.toThrow(/inaccessible/);
    store.fault = null;
    expect((await blobRows(sha(bytes)))[0].integrity).toBe('inaccessible');
  });
});

describe('reconciliation', () => {
  test('young orphans are kept, old orphans deleted under a claim, referenced blobs kept, missing blobs reported', async () => {
    const keep = pdf('referenced'), u = await upload(keep); await finaliseUpload(ed(), store, u.sessionId);
    const orphan = `studio/blobs/${MODULE}/${sha('orphan')}`; await store.put(orphan, new TextEncoder().encode('orphan'), 'application/pdf');
    const young = await reconcileStorage(svc(), store, { deleteOrphans: true });
    expect(young.keptYoung).toContain(orphan); expect(young.deleted).toEqual([]);
    const reportOnly = await reconcileStorage(svc(), store, { graceMs: 0 });
    expect(reportOnly.orphans).toContain(orphan); expect(await store.get(orphan)).not.toBeNull(); // default: report only
    const old = await reconcileStorage(svc(), store, { graceMs: 0, deleteOrphans: true });
    expect(old.deleted).toEqual(expect.arrayContaining([orphan, `studio/uploads/${MODULE}/${u.sessionId}`]));
    expect(await store.get(`studio/blobs/${MODULE}/${sha(keep)}`)).not.toBeNull();
    await store.delete(`studio/blobs/${MODULE}/${sha(keep)}`);
    expect((await reconcileStorage(svc(), store, { graceMs: 0 })).missing).toEqual([`studio/blobs/${MODULE}/${sha(keep)}`]);
  });
  test('an interrupted deletion claim is completed by the next reconciliation', async () => {
    const orphan = `studio/blobs/${MODULE}/${sha('half deleted')}`;
    await store.put(orphan, new TextEncoder().encode('half deleted'), 'application/pdf');
    expect(await ok(svc(), 'studio_gc_claim', { p_key: orphan })).toBe(true); // crash before delete and finish
    const r = await reconcileStorage(svc(), store, { graceMs: 0, deleteOrphans: true });
    expect(r.finishedClaims).toEqual([orphan]); expect(await store.get(orphan)).toBeNull();
    expect(await s.sql('select * from private.studio_gc_claims')).toEqual([]);
  });
});
