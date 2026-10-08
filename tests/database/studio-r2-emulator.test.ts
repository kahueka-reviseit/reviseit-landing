// @vitest-environment node
// The R2 adapter against a LOCAL S3-COMPATIBLE EMULATOR (for example moto_server on loopback), with
// the real migration in PGlite. Skipped unless STUDIO_S3_TEST_ENDPOINT names a loopback emulator.
// LABEL: emulator evidence only. Real Cloudflare R2 behaviour (signature acceptance, consistency,
// conditional writes, error codes) is UNPROVED until a bounded test with a throwaway bucket.
import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { R2StudioStorage, signV4 } from '../../lib/studio/storage/r2';
import { createUpload, finaliseUpload, readBlob } from '../../lib/studio/uploads';
import { reconcileStorage } from '../../lib/studio/reconcile';
import { verified, StudioDb, ids, MODULE, sha, ok, key } from './studio-fixture';

const endpoint = process.env.STUDIO_S3_TEST_ENDPOINT || '';
const enabled = /^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint);
const bucket = 'studio-emulator-' + randomUUID().slice(0, 8);
let s: StudioDb, r2: R2StudioStorage;
const ed = () => s.rpc({ kind: 'user', id: ids.editor });
beforeAll(async () => {
  if (!enabled) return;
  const creds = { accessKeyId: 'emulator', secretAccessKey: 'emulator-secret' };
  // Create the throwaway emulator bucket (the adapter itself never creates or deletes buckets).
  const url = new URL(`${endpoint}/${bucket}`);
  const signed = signV4({ method: 'PUT', url, headers: {}, payloadHash: sha(''), ...creds, region: 'us-east-1', now: new Date() });
  expect((await fetch(signed.url, { method: 'PUT', headers: signed.headers })).status).toBe(200);
  r2 = new R2StudioStorage({ endpoint, bucket, ...creds, region: 'us-east-1' });
  s = new StudioDb(); await s.init();
  await ok(s.rpc({ kind: 'operator' }), 'studio_enrol_module', { p_module: MODULE, p_subject_adapter: 'caps-physical-sciences@1' });
}, 60000);
afterAll(async () => { if (enabled) await s.close(); });

test.skipIf(!enabled)('storage contract: missing reads are null, writes verify, listing pages, deletes are idempotent', async () => {
  const k = `studio/blobs/${MODULE}/${sha('contract')}`;
  expect(await r2.get(k)).toBeNull();
  await r2.put(k, new TextEncoder().encode('contract'), 'text/plain');
  expect(Buffer.from((await r2.get(k))!).toString()).toBe('contract');
  expect((await r2.list(`studio/blobs/${MODULE}/`)).map(o => o.key)).toContain(k);
  await r2.delete(k); await r2.delete(k);
  expect(await r2.get(k)).toBeNull();
});

test.skipIf(!enabled)('presigned provisional upload, verified finalisation, and signed-URL replay cannot alter committed evidence', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 emulator upload');
  const u = await createUpload(ed(), r2, { moduleId: MODULE, sha256: sha(bytes), size: bytes.length, mediaType: 'application/pdf', filename: 'e.pdf', purpose: 'source', command: key() });
  expect(u.upload.url).toContain('/studio/uploads/');
  expect((await fetch(u.upload.url, { method: 'PUT', headers: u.upload.headers, body: bytes })).status).toBe(200);
  const f = await finaliseUpload(verified(ed()), r2, u.sessionId) as any;
  expect(f).toMatchObject({ state: 'finalised', duplicate: false });
  // Replay the same still-valid signed URL with different bytes.
  expect((await fetch(u.upload.url, { method: 'PUT', headers: u.upload.headers, body: new TextEncoder().encode('%PDF-1.7 replaced') })).status).toBe(200);
  expect(Buffer.from((await readBlob(ed(), r2, f.blobId)).bytes).toString()).toBe('%PDF-1.7 emulator upload');
  expect(await finaliseUpload(verified(ed()), r2, u.sessionId)).toMatchObject({ state: 'finalised', blobId: f.blobId });
});

test.skipIf(!enabled)('a deleted committed object is detected as missing on read and by reconciliation', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 emulator loss');
  const u = await createUpload(ed(), r2, { moduleId: MODULE, sha256: sha(bytes), size: bytes.length, mediaType: 'application/pdf', filename: 'l.pdf', purpose: 'source', command: key() });
  await fetch(u.upload.url, { method: 'PUT', headers: u.upload.headers, body: bytes });
  const f = await finaliseUpload(verified(ed()), r2, u.sessionId) as any;
  await r2.delete(`studio/blobs/${MODULE}/${sha(bytes)}`);
  const report = await reconcileStorage(s.rpc({ kind: 'service' }), r2, { graceMs: 0 });
  expect(report.missing).toContain(`studio/blobs/${MODULE}/${sha(bytes)}`);
  await expect(readBlob(ed(), r2, f.blobId)).rejects.toThrow(/Integrity blocked/);
});
