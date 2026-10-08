// @vitest-environment node
// Cross-process proof: the real Python Studio worker (separate checkout) against this repository's
// gateway handler and migration, over loopback HTTP, with LOCAL STORAGE EMULATION and the MOCK
// provider. Skipped unless STUDIO_E2E_WORKER points at the worker checkout containing studio/.
// It proves the protocol across processes, including a worker killed after a provider dispatch;
// it does not prove model extraction, classification or hosted behaviour.
import { beforeAll, afterAll, test, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStudioGateway } from '../../lib/studio/gateway';
import { LocalStudioStorage } from '../../lib/studio/storage/local';
import { StudioDb, ids, MODULE, SKILL, PROFILE, sha, ok, key, blob, baseBank, importSnapshot, accept, gate } from './studio-fixture';

const WORKER = process.env.STUDIO_E2E_WORKER, PYTHON = process.env.STUDIO_E2E_PYTHON || 'python3';
const TOKEN = 'e'.repeat(48);
let s: StudioDb, server: Server, origin = '', dir: string, store: LocalStudioStorage, snapshot: string;
const ed = () => s.rpc({ kind: 'user', id: ids.editor });

beforeAll(async () => {
  if (!WORKER) return;
  s = new StudioDb(); await s.init();
  const op = s.rpc({ kind: 'operator' });
  await ok(op, 'studio_enrol_module', { p_module: MODULE, p_subject_adapter: 'caps-physical-sciences@1' });
  snapshot = (await importSnapshot(op, MODULE, baseBank)).snapshotId; await accept(op, MODULE, snapshot, null);
  dir = mkdtempSync(join(tmpdir(), 'studio-e2e-')); store = new LocalStudioStorage(join(dir, 'store'));
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const response = await handleStudioGateway(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }),
      { token: TOKEN, otherTokens: [], rpc: s.rpc({ kind: 'service' }), storage: store });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries())); res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const a = server.address(); origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
}, 60000);
afterAll(async () => { if (!WORKER) return; server.close(); await s.close(); rmSync(dir, { recursive: true, force: true }); });

function stateDir() { const d = mkdtempSync(join(dir, 'state-')); chmodSync(d, 0o700); return d; }
// Only what the worker needs: no inherited credentials reach the Python process.
const env = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH || '', TEACHER_PLATFORM_URL: origin, STUDIO_WORKER_TOKEN: TOKEN, PYTHONDONTWRITEBYTECODE: '1', ...extra }) as unknown as NodeJS.ProcessEnv;
function workerOnce(state: string, extra: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string; err: string }>(resolve => {
    const p = spawn(PYTHON, ['-m', 'studio', '--state', state, '--once', '--allow-local-test', '--stages', 'mock'], { cwd: WORKER, env: env(extra) });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d); p.on('close', code => resolve({ code, out, err }));
  });
}
async function newRun(label: string) {
  const content = '%PDF-1.7 synthetic ' + label, b = await blob(ed(), MODULE, label);
  await store.put(`studio/blobs/${MODULE}/${sha(content)}`, new TextEncoder().encode(content), 'application/pdf');
  const src = await ok(ed(), 'studio_create_source', { p_module: MODULE, p_title: 'E2E ' + label, p_files: [{ blobId: b, role: 'combined', filename: 'p.pdf' }], p_identity: {}, p_command: key() });
  return (await ok(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'canonical', p_snapshot: snapshot, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() })).runId as string;
}
const view = (run: string) => ok(ed(), 'studio_run_view', { p_run: run });

test.skipIf(!WORKER)('the Python worker drives a run through every stage; humans make every review decision', async () => {
  const run = await newRun('full journey'), state = stateDir();
  const once = async (stage: string) => {
    const r = await workerOnce(state); expect(r.code, r.err).toBe(0);
    const result = JSON.parse(r.out.trim()); expect(result).toMatchObject({ state: 'succeeded' });
    expect((await view(run)).stages.find((x: any) => x.id === result.stageId).stage_key).toBe(stage);
  };
  await once('S1_extract'); await gate(ed(), run, 'G1_inventory');
  await once('S2_task_match'); await once('S3_spec_match'); await gate(ed(), run, 'G2_matches');
  await once('S4_prioritise'); await once('S5_draft'); await once('S6_assemble_validate');
  await gate(ed(), run, 'G3_records'); await gate(ed(), run, 'G4_content', 'approved', []);
  await once('S7_package');
  const v = await view(run);
  expect(v.run.state).toBe('completed'); // synthetic no-change path: no integration decision required
  expect(v.providerOperations.map((o: any) => o.attempts.map((a: any) => a.dispatch_state))).toEqual([['succeeded'], ['succeeded'], ['succeeded'], ['succeeded']]);
  expect(v.decisions.map((d: any) => d.gate)).toEqual(['G1_inventory', 'G2_matches', 'G3_records', 'G4_content']);
}, 120000);

test.skipIf(!WORKER)('a worker killed after dispatch leaves the stage uncertain; nothing is replayed until an explicit retry', async () => {
  await s.sql("update private.studio_stages set state='cancelled' where state in ('queued','running')");
  const run = await newRun('crash'), state = stateDir();
  const p = spawn(PYTHON, ['-m', 'studio', '--state', state, '--once', '--allow-local-test', '--stages', 'mock'], { cwd: WORKER, env: env({ STUDIO_MOCK_HANG_AFTER_DISPATCH: 'extract:inventory' }) });
  const exited = new Promise(r => p.on('close', r));
  for (let i = 0; i < 100; i++) {
    const v = await view(run);
    if (v.providerOperations[0]?.attempts[0]?.dispatch_state === 'dispatched') break;
    await new Promise(r => setTimeout(r, 100));
  }
  p.kill('SIGKILL'); await exited;
  await s.sql("update private.studio_stage_attempts set lease_until=now()-interval '1 second' where state='claimed'");
  const second = await workerOnce(stateDir());
  expect(second.out.trim()).toBe(''); // nothing claimable: the stage is uncertain, not requeued
  let v = await view(run);
  expect(v.stages[0].state).toBe('uncertain');
  expect(v.providerOperations[0].attempts.map((a: any) => [a.attempt_number, a.dispatch_state, a.possible_charge])).toEqual([[1, 'uncertain', true]]);
  await ok(ed(), 'studio_retry_stage', { p_stage: v.stages[0].id, p_expected_attempts: 1, p_reason: 'Mock provider confirmed no completion; explicit retry', p_command: key() });
  const third = await workerOnce(stateDir());
  expect(JSON.parse(third.out.trim())).toMatchObject({ state: 'succeeded' });
  v = await view(run);
  expect(v.providerOperations[0].attempts.map((a: any) => [a.attempt_number, a.dispatch_state])).toEqual([[1, 'uncertain'], [2, 'succeeded']]);
}, 120000);

test.skipIf(!WORKER)('the worker refuses to start with the paid worker token in its environment', () => {
  const r = spawnSync(PYTHON, ['-m', 'studio', '--state', stateDir(), '--once', '--allow-local-test', '--stages', 'mock'], { cwd: WORKER, env: env({ CONTENT_WORKER_TOKEN: 'c'.repeat(40) }), encoding: 'utf8' });
  expect(r.status).not.toBe(0); expect(r.stderr).toMatch(/CONTENT_WORKER_TOKEN is present/);
});
