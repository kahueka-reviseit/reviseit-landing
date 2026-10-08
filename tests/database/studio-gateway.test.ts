// @vitest-environment node
// The Studio worker gateway handler with the real migration (PGlite) and local storage emulation.
// It checks the separate token, the closed action list, durable outputs before completion, verified
// input reads and stale-writer refusal. Synthetic protocol only; no model or provider is called.
import { beforeAll, beforeEach, afterAll, describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStudioGateway } from '../../lib/studio/gateway';
import { LocalStudioStorage } from '../../lib/studio/storage/local';
import { StudioDb, ids, MODULE, SKILL, PROFILE, sha, ok, key, blob, baseBank, importSnapshot, accept } from './studio-fixture';

const TOKEN = 's'.repeat(40), CONTENT = 'c'.repeat(40);
let s: StudioDb, dir: string, store: LocalStudioStorage, snapshot: string;
const ed = () => s.rpc({ kind: 'user', id: ids.editor });
beforeAll(async () => {
  s = new StudioDb(); await s.init();
  const op = s.rpc({ kind: 'operator' });
  await ok(op, 'studio_enrol_module', { p_module: MODULE, p_subject_adapter: 'caps-physical-sciences@1' });
  snapshot = (await importSnapshot(op, MODULE, baseBank)).snapshotId; await accept(op, MODULE, snapshot, null);
}, 60000);
afterAll(async () => { await s.close(); });
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'studio-gw-')); store = new LocalStudioStorage(dir); await s.begin(); return async () => { await s.rollback(); rmSync(dir, { recursive: true, force: true }); }; });

const post = (body: unknown, auth = 'Bearer ' + TOKEN, deps: Partial<Parameters<typeof handleStudioGateway>[1]> = {}) =>
  handleStudioGateway(new Request('http://local/api/internal/studio', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { token: TOKEN, otherTokens: [CONTENT], rpc: s.rpc({ kind: 'service' }), storage: store, ...deps }).then(async r => ({ status: r.status, body: await r.json() as any }));
async function run() {
  const content = '%PDF-1.7 synthetic gateway paper', b = await blob(ed(), MODULE, 'gateway paper');
  await store.put(`studio/blobs/${MODULE}/${sha(content)}`, new TextEncoder().encode(content), 'application/pdf');
  const src = await ok(ed(), 'studio_create_source', { p_module: MODULE, p_title: 'Gateway paper', p_files: [{ blobId: b, role: 'combined', filename: 'p.pdf' }], p_identity: {}, p_command: key() });
  await ok(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'canonical', p_snapshot: snapshot, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() });
  return { blobId: b, content };
}

describe('authentication and allowlist', () => {
  test('missing, short or shared tokens leave the gateway closed; a wrong bearer is refused', async () => {
    expect((await post({ action: 'claim', worker: 'w' }, undefined, { token: undefined })).status).toBe(503);
    expect((await post({ action: 'claim', worker: 'w' }, undefined, { token: 'short' })).status).toBe(503);
    expect((await post({ action: 'claim', worker: 'w' }, 'Bearer ' + CONTENT, { token: CONTENT })).status).toBe(503); // must not equal the paid worker token
    expect((await post({ action: 'claim', worker: 'w' }, 'Bearer ' + CONTENT)).status).toBe(401);
    expect((await post({ action: 'claim', worker: 'w' }, 'Bearer ' + TOKEN + 'x')).status).toBe(401);
  });
  test('unknown actions and malformed fields are refused before any database call', async () => {
    for (const body of [{ action: 'claim_paper_job', worker: 'w' }, { action: 'checkpoint' }, { action: 'claim', worker: '../w' }, { action: 'complete', attemptId: 'x', lease: 'y', outputs: [] }, [1], 'text'])
      expect((await post(body)).status).toBe(400);
  });
});

describe('worker protocol through the gateway', () => {
  test('claim, verified input read, durable output at the module digest key, then completion', async () => {
    const { blobId, content } = await run();
    const c = (await post({ action: 'claim', worker: 'studio-a' })).body.result;
    expect(c).toMatchObject({ stageKey: 'S1_extract', moduleId: MODULE, sources: [{ blobId }] });
    const read = (await post({ action: 'read', attemptId: c.attemptId, lease: c.lease, blobId })).body.result;
    expect(Buffer.from(read.content, 'base64').toString()).toBe(content);
    const inventory = '{"schema":"reviseit/paper-inventory@2","leaves":[]}';
    const out = await post({ action: 'output', attemptId: c.attemptId, lease: c.lease, logicalKey: 'inventory', kind: 'inventory', mediaType: 'application/json', content: Buffer.from(inventory).toString('base64'), sha256: sha(inventory) });
    expect(out.status).toBe(200);
    expect(Buffer.from((await store.get(`studio/blobs/${MODULE}/${sha(inventory)}`))!).toString()).toBe(inventory);
    expect((await post({ action: 'complete', attemptId: c.attemptId, lease: c.lease, outputs: [out.body.result.artifactId] })).body.result.state).toBe('succeeded');
  });
  test('a stale worker gets a lease-lost refusal and its output is not stored as a revision', async () => {
    await run();
    const a = (await post({ action: 'claim', worker: 'studio-a' })).body.result;
    await s.sql("update private.studio_stage_attempts set lease_until=now()-interval '1 second' where id=$1", [a.attemptId]);
    const b = (await post({ action: 'claim', worker: 'studio-b' })).body.result;
    const stale = await post({ action: 'output', attemptId: a.attemptId, lease: a.lease, logicalKey: 'inventory', kind: 'inventory', mediaType: 'application/json', content: Buffer.from('{}').toString('base64') });
    expect(stale).toEqual({ status: 409, body: { error: 'Studio lease lost' } });
    expect((await post({ action: 'heartbeat', attemptId: b.attemptId, lease: b.lease })).status).toBe(200);
    expect(await s.sql('select count(*)::int n from private.studio_artifacts')).toEqual([{ n: 0 }]);
  });
  test('corrupt input bytes are reported and refused instead of being served', async () => {
    const { blobId, content } = await run();
    await store.put(`studio/blobs/${MODULE}/${sha(content)}`, new TextEncoder().encode('%PDF-1.7 tampered'), 'application/pdf');
    const c = (await post({ action: 'claim', worker: 'studio-a' })).body.result;
    const r = await post({ action: 'read', attemptId: c.attemptId, lease: c.lease, blobId });
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/Integrity blocked/);
    expect(await s.sql('select integrity from private.studio_blobs where id=$1', [blobId])).toEqual([{ integrity: 'corrupt' }]);
  });
  test('a worker cannot read bytes outside its pinned inputs, and a digest mismatch on output is refused', async () => {
    await run();
    const other = await blob(ed(), MODULE, 'unrelated source');
    const c = (await post({ action: 'claim', worker: 'studio-a' })).body.result;
    expect((await post({ action: 'read', attemptId: c.attemptId, lease: c.lease, blobId: other })).body.error).toMatch(/Input not available/);
    expect((await post({ action: 'output', attemptId: c.attemptId, lease: c.lease, logicalKey: 'inventory', kind: 'inventory', mediaType: 'application/json', content: Buffer.from('{}').toString('base64'), sha256: sha('other') })).status).toBe(422);
  });
  test('provider intent is persisted before dispatch, and an uncertain outcome is never redispatched by the gateway', async () => {
    await run();
    const c = (await post({ action: 'claim', worker: 'studio-a' })).body.result;
    const p = (await post({ action: 'provider_prepare', attemptId: c.attemptId, lease: c.lease, operation: 'extract:inventory', requestDigest: sha('req') })).body.result;
    expect((await post({ action: 'provider_dispatched', attemptId: c.attemptId, lease: c.lease, providerAttemptId: p.providerAttemptId })).status).toBe(200);
    expect((await post({ action: 'uncertain', attemptId: c.attemptId, lease: c.lease, reason: 'timeout' })).status).toBe(200);
    expect(await post({ action: 'claim', worker: 'studio-b' })).toEqual({ status: 200, body: { result: null } });
  });
});
