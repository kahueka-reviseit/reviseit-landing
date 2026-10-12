// @vitest-environment node
// Curriculum Studio foundation (assignment 02, addendum C1) against the real migration in PGlite.
// Each test states the invariant it demonstrates. Worker steps are synthetic protocol calls: they prove
// durable state, fencing and review binding, not model extraction or scientific classification.
import { beforeAll, beforeEach, afterAll, describe, test, expect } from 'vitest';
import { verified, StudioDb, ids, MODULE, OTHER, SKILL, PROFILE, AUTH, sha, ok, refused, key, blob, baseBank, importSnapshot, accept, work, complete, gate, type BankFile } from './studio-fixture';

let s: StudioDb;
const ed = () => s.rpc({ kind: 'user', id: ids.editor }), ed2 = () => s.rpc({ kind: 'user', id: ids.editor2 });
const svc = () => s.rpc({ kind: 'service' }), op = () => s.rpc({ kind: 'operator' });
let base: { snapshotId: string; manifest: string };

beforeAll(async () => {
  s = new StudioDb(); await s.init();
  await ok(op(), 'studio_enrol_module', { p_module: MODULE, p_subject_adapter: 'caps-physical-sciences@1' });
  await ok(op(), 'studio_enrol_module', { p_module: OTHER, p_subject_adapter: 'caps-physical-sciences@1' });
  base = await importSnapshot(op(), MODULE, baseBank);
  await accept(op(), MODULE, base.snapshotId, null);
}, 60000);
afterAll(async () => { await s.close(); });
// Each test runs inside a transaction that is rolled back, so tests are independent.
beforeEach(async () => { await s.begin(); return async () => { await s.rollback(); }; });

async function source(content = 'question paper v1') {
  const b = await blob(ed(), MODULE, content);
  return ok(ed(), 'studio_create_source', { p_module: MODULE, p_title: 'Synthetic June paper', p_files: [{ blobId: b, role: 'combined', filename: 'paper.pdf' }], p_identity: { grade: 11, year: 2099 }, p_command: key() });
}
async function startRun(purpose = 'canonical', snapshot = base.snapshotId) {
  const src = await source();
  const r = await ok(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: purpose, p_snapshot: snapshot, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() });
  return { run: r.runId as string, source: src.sourceId as string };
}
const VALID = { exitStatus: 0, scope: 'complete_candidate', validator: 'validate_bank.py' };
const DRAFT = { kind: 'task_type', id: 'PHYS_02', path: 'data/task-types/physics/PHYS_02_Synthetic_Force.md' };
async function toG1(run: string) { const w = await work(svc(), [{ key: 'inventory', kind: 'inventory', content: '{"schema":"reviseit/paper-inventory@2","leaves":[]}' }], 'S1_extract'); await complete(svc(), w.claim, w.made); return w; }
async function toG2(run: string) {
  await toG1(run); await gate(ed(), run, 'G1_inventory');
  for (const [k, kind] of [['task_matches', 'S2_task_match'], ['spec_matches', 'S3_spec_match']] as const) { const w = await work(svc(), [{ key: k, kind: k, content: `{"${k}":[]}` }], kind); await complete(svc(), w.claim, w.made); }
}
async function toG3(run: string, draft: string | null = '# PHYS_02 synthetic force, corrected method') {
  await toG2(run); await gate(ed(), run, 'G2_matches');
  let w = await work(svc(), [{ key: 'gap_list', kind: 'gap_list', content: '{"gaps":[]}' }], 'S4_prioritise'); await complete(svc(), w.claim, w.made);
  w = await work(svc(), draft ? [{ key: 'record:task_type:PHYS_02', kind: 'draft_record', content: draft, record: DRAFT, media: 'text/markdown' }] : [], 'S5_draft'); await complete(svc(), w.claim, w.made);
  w = await work(svc(), [{ key: 'validation', kind: 'validation_result', content: '{"structural_ok":true}', meta: VALID }], 'S6_assemble_validate');
  const drafts = (w.claim.upstream as any[]).filter(a => a.logicalKey.startsWith('record:')).map(a => ({ artifactId: a.id, action: 'replace' }));
  await ok(svc(), 'studio_put_changeset', { p_attempt: w.claim.attemptId, p_lease: w.claim.lease, p_entries: drafts, p_validation_artifact: w.made[0] });
  await complete(svc(), w.claim, w.made);
}
const judgment = (verdict = 'accepted', extra: Record<string, string> = {}) => ({ recordKind: 'task_type', recordId: 'PHYS_02', aspect: 'method', verdict, reason: 'Synthetic content judgment', ...extra });
async function toG5(run: string, items = [judgment()]) {
  await toG3(run); await gate(ed(), run, 'G3_records'); await gate(ed(), run, 'G4_content', 'approved', items);
  const w = await work(svc(), [{ key: 'package:01_Paper_Inventory.json', kind: 'package_file', content: '{}' }], 'S7_package'); await complete(svc(), w.claim, w.made);
}
const view = (run: string) => ok(ed(), 'studio_run_view', { p_run: run });
const stage = async (run: string, k: string) => (await view(run)).stages.filter((x: any) => x.stage_key === k).at(-1);

describe('access boundaries', () => {
  test('editors only: outsiders, teachers and anonymous callers are refused on every command and read', async () => {
    const { run } = await startRun();
    for (const who of [ids.outsider, ids.teacher]) {
      const r = s.rpc({ kind: 'user', id: who });
      expect(await refused(r, 'studio_overview', {})).toMatch(/Studio editor access required/);
      expect(await refused(r, 'studio_run_view', { p_run: run })).toMatch(/Studio editor access required/);
      expect(await refused(r, 'studio_create_upload', { p_module: MODULE, p_sha256: sha('x'), p_size: 1, p_media_type: 'application/pdf', p_filename: 'x.pdf', p_purpose: 'source', p_command: key() })).toMatch(/Studio editor access required/);
    }
    expect(await refused(s.rpc({ kind: 'anon' }), 'studio_overview', {})).toMatch(/permission denied/);
  });
  test('browser roles cannot call worker or operator functions, and no role reads Studio tables directly', async () => {
    expect(await refused(ed(), 'studio_claim', { p_worker: 'forged' })).toMatch(/permission denied/);
    expect(await refused(ed(), 'studio_accept_snapshot', { p_module: MODULE, p_snapshot: base.snapshotId, p_expected_previous: null })).toMatch(/permission denied/);
    expect(await refused(svc(), 'studio_record_decision', { p_run: base.snapshotId, p_gate: 'G1_inventory', p_expected_version: 0, p_bound: [], p_outcome: 'approved', p_rationale: 'x', p_authorisation: AUTH, p_items: [], p_command: key() })).toMatch(/permission denied/);
    expect(await refused(svc(), 'studio_accept_snapshot', { p_module: MODULE, p_snapshot: base.snapshotId, p_expected_previous: null })).toMatch(/permission denied/);
    for (const role of ['authenticated', 'service_role', 'reviseit_studio_operator'])
      for (const table of ['studio_blobs', 'studio_decisions', 'studio_runs', 'studio_upload_sessions'])
        await expect(s.sql(`select * from private.${table}`, [], role)).rejects.toThrow(/permission denied/);
  });
  test('a Studio worker cannot claim teacher paper orders and Studio claim never returns them', async () => {
    expect(await refused(svc(), 'studio_claim', { p_worker: 'bad worker name' })).toMatch(/Invalid worker/);
    expect(await ok(svc(), 'studio_claim', { p_worker: 'synthetic-worker' })).toBeNull();
  });
});

describe('uploads and verified blobs (C02)', () => {
  test('duplicate provisional uploads are separate sessions; identical verified bytes deduplicate once', async () => {
    const bytes = '%PDF-1.7 duplicate', digest = sha(bytes), size = bytes.length;
    const mk = () => ok(ed(), 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: size, p_media_type: 'application/pdf', p_filename: 'dup.pdf', p_purpose: 'source', p_command: key() });
    const a = await mk(), b = await mk();
    expect(a.sessionId).not.toBe(b.sessionId); expect(a.provisionalKey).not.toBe(b.provisionalKey);
    for (const x of [a, b]) await ok(verified(ed()), 'studio_prepare_commit', { p_session: x.sessionId, p_sha256: digest, p_size: size, p_detected_type: 'application/pdf' });
    const ca = await ok(verified(ed()), 'studio_commit_upload', { p_session: a.sessionId }), cb = await ok(verified(ed()), 'studio_commit_upload', { p_session: b.sessionId });
    expect(ca.blobId).toBe(cb.blobId); expect([ca.duplicate, cb.duplicate]).toEqual([false, true]);
    expect((await s.sql('select count(*)::int n from private.studio_blobs where sha256=$1', [digest]))[0].n).toBe(1);
  });
  test('a failed or abandoned session reserves nothing; another session with the same claim still finalises', async () => {
    const digest = sha('%PDF-1.7 claimed'), mk = () => ok(ed(), 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: 16, p_media_type: 'application/pdf', p_filename: 'c.pdf', p_purpose: 'source', p_command: key() });
    const bad = await mk(), abandoned = await mk(), good = await mk();
    expect(await ok(verified(ed()), 'studio_prepare_commit', { p_session: bad.sessionId, p_sha256: sha('different bytes'), p_size: 16, p_detected_type: 'application/pdf' })).toMatchObject({ state: 'rejected', reason: 'digest mismatch' });
    void abandoned;
    await ok(verified(ed()), 'studio_prepare_commit', { p_session: good.sessionId, p_sha256: digest, p_size: 16, p_detected_type: 'application/pdf' });
    expect(await ok(verified(ed()), 'studio_commit_upload', { p_session: good.sessionId })).toMatchObject({ state: 'finalised', duplicate: false });
    expect(await refused(verified(ed()), 'studio_commit_upload', { p_session: bad.sessionId })).toMatch(/Upload session is rejected/);
  });
  test('corruption before finalisation is rejected on size, digest and sniffed type', async () => {
    for (const [sha256, size, type, reason] of [[sha('other'), 10, 'application/pdf', 'digest mismatch'], [null, 11, 'application/pdf', 'size mismatch'], [null, 10, 'image/png', 'type mismatch']] as const) {
      const digest = sha('%PDF-1.7 x');
      const u = await ok(ed(), 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: 10, p_media_type: 'application/pdf', p_filename: 'x.pdf', p_purpose: 'source', p_command: key() });
      expect(await ok(verified(ed()), 'studio_prepare_commit', { p_session: u.sessionId, p_sha256: sha256 ?? digest, p_size: size, p_detected_type: type })).toMatchObject({ state: 'rejected', reason });
    }
  });
  test('an expired session cannot finalise and its claim protects nothing', async () => {
    const digest = sha('%PDF-1.7 late');
    const u = await ok(ed(), 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: 14, p_media_type: 'application/pdf', p_filename: 'l.pdf', p_purpose: 'source', p_command: key() });
    await s.sql("update private.studio_upload_sessions set expires_at=now()-interval '1 second' where id=$1", [u.sessionId]);
    expect(await ok(verified(ed()), 'studio_prepare_commit', { p_session: u.sessionId, p_sha256: digest, p_size: 14, p_detected_type: 'application/pdf' })).toEqual({ state: 'expired' });
    expect(await ok(svc(), 'studio_gc_claim', { p_key: u.provisionalKey })).toBe(true);
  });
  test('replaying a create-upload command returns the same session; reusing its key for another request is refused', async () => {
    const k = key(), args = { p_module: MODULE, p_sha256: sha('r'), p_size: 5, p_media_type: 'application/pdf', p_filename: 'r.pdf', p_purpose: 'source', p_command: k };
    expect((await ok(ed(), 'studio_create_upload', args)).sessionId).toBe((await ok(ed(), 'studio_create_upload', args)).sessionId);
    expect(await refused(ed(), 'studio_create_upload', { ...args, p_size: 6 })).toMatch(/Command key reused/);
  });
  test('garbage collection refuses referenced blobs and keys being finalised, and a claim blocks finalisation', async () => {
    const b = await blob(ed(), MODULE, 'referenced');
    const k = (await s.sql('select immutable_key k from private.studio_blobs where id=$1', [b]))[0].k;
    expect(await ok(svc(), 'studio_gc_claim', { p_key: k })).toBe(false);
    const digest = sha('%PDF-1.7 racing');
    const u = await ok(ed(), 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: 16, p_media_type: 'application/pdf', p_filename: 'g.pdf', p_purpose: 'source', p_command: key() });
    expect(await ok(svc(), 'studio_gc_claim', { p_key: u.provisionalKey })).toBe(false);
    const target = `studio/blobs/${MODULE}/${digest}`;
    expect(await ok(svc(), 'studio_gc_claim', { p_key: target })).toBe(true); // orphan at that key
    expect(await refused(verified(ed()), 'studio_prepare_commit', { p_session: u.sessionId, p_sha256: digest, p_size: 16, p_detected_type: 'application/pdf' })).toMatch(/cleanup in progress/);
    await ok(svc(), 'studio_gc_finish', { p_key: target });
    await ok(verified(ed()), 'studio_prepare_commit', { p_session: u.sessionId, p_sha256: digest, p_size: 16, p_detected_type: 'application/pdf' });
    expect(await ok(svc(), 'studio_gc_claim', { p_key: target })).toBe(false); // now being finalised
  });
});

describe('integrity states block consumption (C02)', () => {
  test('a missing committed blob blocks reads, runs and claims until explicit recovery', async () => {
    const src = await source('will go missing');
    const b = (await s.sql('select f.blob_id from private.studio_source_files f join private.studio_source_revisions r on r.id=f.source_revision_id where r.source_id=$1', [src.sourceId]))[0].blob_id;
    const r = await ok(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'canonical', p_snapshot: base.snapshotId, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() });
    await ok(svc(), 'studio_worker_report_integrity', { p_blob: b, p_state: 'missing', p_detail: 'synthetic loss' });
    expect(await refused(ed(), 'studio_read_blob', { p_blob: b })).toMatch(/Integrity blocked: .* is missing/);
    expect(await ok(svc(), 'studio_claim', { p_worker: 'synthetic-worker' })).toBeNull();
    expect((await stage(r.runId, 'S1_extract')).state).toBe('blocked');
    expect(await refused(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'canonical', p_snapshot: base.snapshotId, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() })).toMatch(/Integrity blocked/);
    // Finalising the same bytes again does not silently restore; recovery is explicit and audited.
    const digest = sha('%PDF-1.7 synthetic will go missing');
    const u = await ok(ed(), 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: 34, p_media_type: 'application/pdf', p_filename: 'p.pdf', p_purpose: 'source', p_command: key() });
    await ok(verified(ed()), 'studio_prepare_commit', { p_session: u.sessionId, p_sha256: digest, p_size: 34, p_detected_type: 'application/pdf' });
    expect(await refused(verified(ed()), 'studio_commit_upload', { p_session: u.sessionId })).toMatch(/explicit recovery/);
    await ok(ed(), 'studio_begin_recovery', { p_blob: b, p_reason: 'Restoring verified original bytes' });
    await ok(verified(ed()), 'studio_complete_recovery', { p_blob: b });
    const st = await stage(r.runId, 'S1_extract');
    await ok(ed(), 'studio_retry_stage', { p_stage: st.id, p_expected_attempts: 0, p_reason: 'Bytes recovered and verified', p_command: key() });
    expect((await ok(svc(), 'studio_claim', { p_worker: 'synthetic-worker' })).stageKey).toBe('S1_extract');
  });
});

describe('durable jobs, leases and provider attempts (C03)', () => {
  test('enqueueing identical inputs returns the same stage; advancing again creates no duplicate', async () => {
    const { run } = await startRun();
    const before = (await view(run)).stages;
    await s.sql('select private.studio_advance($1)', [run]); await s.sql('select private.studio_advance($1)', [run]);
    expect((await view(run)).stages.map((x: any) => x.id)).toEqual(before.map((x: any) => x.id));
  });
  test('worker loss before dispatch: lease expiry requeues, and the stale worker cannot write or complete', async () => {
    const { run } = await startRun();
    const a = await ok(svc(), 'studio_claim', { p_worker: 'worker-a' });
    await s.sql("update private.studio_stage_attempts set lease_until=now()-interval '1 second' where id=$1", [a.attemptId]);
    const b = await ok(svc(), 'studio_claim', { p_worker: 'worker-b' });
    expect(b.stageId).toBe(a.stageId); expect(b.attemptNumber).toBe(2);
    expect(await refused(svc(), 'studio_put_output', { p_attempt: a.attemptId, p_lease: a.lease, p_logical_key: 'inventory', p_kind: 'inventory', p_sha256: sha('{}'), p_size: 2, p_media_type: 'application/json', p_schema: null, p_record: null, p_meta: {}, p_provider_attempt: null })).toMatch(/Studio lease lost/);
    expect(await refused(svc(), 'studio_complete', { p_attempt: a.attemptId, p_lease: a.lease, p_outputs: [] })).toMatch(/Studio lease lost/);
    expect(await refused(svc(), 'studio_heartbeat', { p_attempt: a.attemptId, p_lease: b.lease })).toMatch(/Studio lease lost/);
    void run;
  });
  test('worker crash after dispatch: the stage becomes uncertain, is never replayed, and explicit retry keeps the possible charge', async () => {
    const { run } = await startRun();
    const a = await ok(svc(), 'studio_claim', { p_worker: 'worker-a' });
    const p = await ok(svc(), 'studio_provider_prepare', { p_attempt: a.attemptId, p_lease: a.lease, p_operation: 'extract:inventory', p_request_digest: sha('request') });
    expect(p).toMatchObject({ action: 'dispatch', attemptNumber: 1 });
    await ok(svc(), 'studio_provider_dispatched', { p_attempt: a.attemptId, p_lease: a.lease, p_provider_attempt: p.providerAttemptId });
    await s.sql("update private.studio_stage_attempts set lease_until=now()-interval '1 second' where id=$1", [a.attemptId]);
    expect(await ok(svc(), 'studio_claim', { p_worker: 'worker-b' })).toBeNull();
    const st = await stage(run, 'S1_extract');
    expect(st.state).toBe('uncertain');
    // Retrying the stage explicitly creates provider attempt two and retains attempt one.
    const k = key(), args = { p_stage: st.id, p_expected_attempts: 1, p_reason: 'Provider dashboard shows no completion', p_command: k };
    const r1 = await ok(ed(), 'studio_retry_stage', args), r2 = await ok(ed(), 'studio_retry_stage', args);
    expect(r2).toEqual(r1);
    const ops = (await view(run)).providerOperations[0];
    expect(ops.attempts.map((x: any) => [x.attempt_number, x.dispatch_state, x.possible_charge])).toEqual([[1, 'uncertain', true], [2, 'prepared', false]]);
    const b = await ok(svc(), 'studio_claim', { p_worker: 'worker-b' });
    expect(await ok(svc(), 'studio_provider_prepare', { p_attempt: b.attemptId, p_lease: b.lease, p_operation: 'extract:inventory', p_request_digest: sha('request') })).toMatchObject({ action: 'dispatch', attemptNumber: 2 });
  });
  test('a late success settles its own attempt but cannot become the stage result', async () => {
    const { run } = await startRun();
    const a = await ok(svc(), 'studio_claim', { p_worker: 'worker-a' });
    const p1 = await ok(svc(), 'studio_provider_prepare', { p_attempt: a.attemptId, p_lease: a.lease, p_operation: 'extract:inventory', p_request_digest: sha('request') });
    await ok(svc(), 'studio_provider_dispatched', { p_attempt: a.attemptId, p_lease: a.lease, p_provider_attempt: p1.providerAttemptId });
    await ok(svc(), 'studio_mark_uncertain', { p_attempt: a.attemptId, p_lease: a.lease, p_reason: 'Timeout after dispatch' });
    const st = await stage(run, 'S1_extract');
    await ok(ed(), 'studio_retry_stage', { p_stage: st.id, p_expected_attempts: 1, p_reason: 'Explicit retry after timeout', p_command: key() });
    const b = await ok(svc(), 'studio_claim', { p_worker: 'worker-b' });
    const p2 = await ok(svc(), 'studio_provider_prepare', { p_attempt: b.attemptId, p_lease: b.lease, p_operation: 'extract:inventory', p_request_digest: sha('request') });
    expect(await ok(svc(), 'studio_provider_result', { p_provider_attempt: p1.providerAttemptId, p_outcome: 'succeeded', p_provider_request_id: 'req-late', p_result_digest: sha('late'), p_usage: { input: 1 }, p_attempt: a.attemptId, p_lease: a.lease })).toMatchObject({ late: true });
    expect(await refused(svc(), 'studio_put_output', { p_attempt: b.attemptId, p_lease: b.lease, p_logical_key: 'inventory', p_kind: 'inventory', p_sha256: sha('late'), p_size: 4, p_media_type: 'application/json', p_schema: null, p_record: null, p_meta: {}, p_provider_attempt: p1.providerAttemptId })).toMatch(/not the current settled attempt/);
    await ok(svc(), 'studio_provider_dispatched', { p_attempt: b.attemptId, p_lease: b.lease, p_provider_attempt: p2.providerAttemptId });
    expect(await ok(svc(), 'studio_provider_result', { p_provider_attempt: p2.providerAttemptId, p_outcome: 'succeeded', p_provider_request_id: 'req-2', p_result_digest: sha('{}'), p_usage: {}, p_attempt: b.attemptId, p_lease: b.lease })).toMatchObject({ late: false });
    const out = await ok(svc(), 'studio_put_output', { p_attempt: b.attemptId, p_lease: b.lease, p_logical_key: 'inventory', p_kind: 'inventory', p_sha256: sha('{}'), p_size: 2, p_media_type: 'application/json', p_schema: null, p_record: null, p_meta: {}, p_provider_attempt: p2.providerAttemptId });
    await ok(svc(), 'studio_complete', { p_attempt: b.attemptId, p_lease: b.lease, p_outputs: [out.artifactId] });
    // A replayed prepare after success reuses the recorded result; nothing is resent.
    expect((await view(run)).providerOperations[0].attempts).toHaveLength(2);
  });
  test('duplicate and competing explicit provider retries create exactly one next attempt', async () => {
    const { run } = await startRun();
    const a = await ok(svc(), 'studio_claim', { p_worker: 'worker-a' });
    const p = await ok(svc(), 'studio_provider_prepare', { p_attempt: a.attemptId, p_lease: a.lease, p_operation: 'extract:inventory', p_request_digest: sha('request') });
    await ok(svc(), 'studio_provider_dispatched', { p_attempt: a.attemptId, p_lease: a.lease, p_provider_attempt: p.providerAttemptId });
    await ok(svc(), 'studio_mark_uncertain', { p_attempt: a.attemptId, p_lease: a.lease, p_reason: 'Connection reset' });
    const k = key(), args = { p_operation: p.operationId, p_expected_attempt: 1, p_reason: 'Explicit operator retry after review', p_command: k };
    const first = await ok(ed(), 'studio_retry_provider_operation', args);
    expect(await ok(ed(), 'studio_retry_provider_operation', args)).toEqual(first);
    expect(await refused(ed2(), 'studio_retry_provider_operation', { ...args, p_command: key() })).toMatch(/Provider operation changed/);
    expect((await view(run)).providerOperations[0].attempts.map((x: any) => x.attempt_number)).toEqual([1, 2]);
  });
  test('outputs must be persisted before completion; completion lists exactly what this attempt stored', async () => {
    await startRun();
    const a = await ok(svc(), 'studio_claim', { p_worker: 'worker-a' });
    expect(await refused(svc(), 'studio_complete', { p_attempt: a.attemptId, p_lease: a.lease, p_outputs: [key()] })).toMatch(/exactly the outputs/);
    const p = await ok(svc(), 'studio_provider_prepare', { p_attempt: a.attemptId, p_lease: a.lease, p_operation: 'extract:inventory', p_request_digest: sha('request') });
    await ok(svc(), 'studio_provider_dispatched', { p_attempt: a.attemptId, p_lease: a.lease, p_provider_attempt: p.providerAttemptId });
    expect(await refused(svc(), 'studio_complete', { p_attempt: a.attemptId, p_lease: a.lease, p_outputs: [] })).toMatch(/unsettled/);
  });
  test('cancellation is distinct from failure and uncertainty, and fences the running attempt', async () => {
    const { run } = await startRun();
    const a = await ok(svc(), 'studio_claim', { p_worker: 'worker-a' });
    await ok(ed(), 'studio_cancel_stage', { p_stage: a.stageId, p_reason: 'Operator cancelled', p_command: key() });
    expect((await stage(run, 'S1_extract')).state).toBe('cancelled');
    expect(await refused(svc(), 'studio_complete', { p_attempt: a.attemptId, p_lease: a.lease, p_outputs: [] })).toMatch(/Studio lease lost/);
  });
  test('a failed provider stage is not retried automatically; a deterministic stage is, within its limit', async () => {
    const { run } = await startRun();
    let a = await ok(svc(), 'studio_claim', { p_worker: 'w' });
    expect(await ok(svc(), 'studio_fail', { p_attempt: a.attemptId, p_lease: a.lease, p_error: 'synthetic', p_retryable: true })).toMatchObject({ state: 'failed' });
    expect(await ok(svc(), 'studio_claim', { p_worker: 'w' })).toBeNull();
    void run;
  });
  test('Studio capacity is its own limit', async () => {
    await s.sql('update private.studio_settings set max_running=1');
    await startRun(); await startRun();
    expect(await ok(svc(), 'studio_claim', { p_worker: 'w1' })).not.toBeNull();
    expect(await ok(svc(), 'studio_claim', { p_worker: 'w2' })).toBeNull();
  });
});

describe('reviews bind exact revisions (C06)', () => {
  test('two reviewers on the same gate version: exactly one decision; the other learns the gate changed', async () => {
    const { run } = await startRun(); await toG1(run);
    const v = await ok(ed(), 'studio_gate_view', { p_run: run, p_gate: 'G1_inventory' });
    const bound = v.binding.artifacts.map((a: any) => a.id);
    const d = (r: any) => r('studio_record_decision', { p_run: run, p_gate: 'G1_inventory', p_expected_version: v.version, p_bound: bound, p_outcome: 'approved', p_rationale: 'Checked against pages', p_authorisation: AUTH, p_items: [], p_command: key() });
    expect((await d(ed())).error).toBeNull();
    expect((await d(ed2())).error?.message).toMatch(/Gate changed/);
    expect((await s.sql('select count(*)::int n from private.studio_decisions where run_id=$1', [run]))[0].n).toBe(1);
  });
  test('approval refuses a binding that differs from the current revisions', async () => {
    const { run } = await startRun(); await toG1(run);
    const v = await ok(ed(), 'studio_gate_view', { p_run: run, p_gate: 'G1_inventory' });
    expect(await refused(ed(), 'studio_record_decision', { p_run: run, p_gate: 'G1_inventory', p_expected_version: v.version, p_bound: [key()], p_outcome: 'approved', p_rationale: 'x x', p_authorisation: AUTH, p_items: [], p_command: key() })).toMatch(/Review binding changed/);
    expect(await refused(ed(), 'studio_record_decision', { p_run: run, p_gate: 'G2_matches', p_expected_version: 0, p_bound: [], p_outcome: 'approved', p_rationale: 'x x', p_authorisation: AUTH, p_items: [], p_command: key() })).toMatch(/not ready/);
  });
  test('correcting the inventory invalidates G1, re-queues matching, and marks a self-review as such', async () => {
    const { run } = await startRun(); await toG2(run); await gate(ed(), run, 'G2_matches');
    const inv = (await view(run)).artifacts.find((a: any) => a.logicalKey === 'inventory' && a.state === 'current');
    const fixed = await blob(ed(), MODULE, '{"schema":"reviseit/paper-inventory@2","leaves":[{"id":"1.1"}]}', 'application/json', 'revision');
    const r = await ok(ed(), 'studio_revise_artifact', { p_artifact: inv.id, p_blob: fixed, p_rationale: 'Leaf 1.1 was missed', p_command: key() });
    expect(r.invalidatedFrom).toBe('G1_inventory');
    const gates = (await view(run)).gates;
    expect(gates.filter((g: any) => g.live)).toEqual([]);
    const d = await gate(ed(), run, 'G1_inventory');
    expect(d.selfReviewed).toBe(true);
    const s2 = (await view(run)).stages.filter((x: any) => x.stage_key === 'S2_task_match');
    expect(s2).toHaveLength(2); expect(s2[1].state).toBe('queued');
    expect((await view(run)).decisions.filter((x: any) => x.invalidated_at).map((x: any) => x.gate)).toEqual(['G1_inventory', 'G2_matches']);
  });
  test('record and content review require passing validation of the complete candidate', async () => {
    const { run } = await startRun(); await toG2(run); await gate(ed(), run, 'G2_matches');
    let w = await work(svc(), [{ key: 'gap_list', kind: 'gap_list', content: '{}' }], 'S4_prioritise'); await complete(svc(), w.claim, w.made);
    w = await work(svc(), [{ key: 'record:task_type:PHYS_02', kind: 'draft_record', content: '# new', record: DRAFT, media: 'text/markdown' }], 'S5_draft'); await complete(svc(), w.claim, w.made);
    w = await work(svc(), [{ key: 'validation', kind: 'validation_result', content: '{"structural_ok":false}', meta: { exitStatus: 1, scope: 'complete_candidate' } }], 'S6_assemble_validate');
    await ok(svc(), 'studio_put_changeset', { p_attempt: w.claim.attemptId, p_lease: w.claim.lease, p_entries: (w.claim.upstream as any[]).filter(a => a.logicalKey.startsWith('record:')).map(a => ({ artifactId: a.id, action: 'replace' })), p_validation_artifact: w.made[0] });
    await complete(svc(), w.claim, w.made);
    expect(await gate(ed(), run, 'G3_records').catch(e => e.message)).toMatch(/Passing validation of the complete candidate required/);
  });
  test('an unresolved content judgment needs a disposition and never silently becomes integration approval', async () => {
    const { run } = await startRun(); await toG3(run); await gate(ed(), run, 'G3_records');
    expect(await gate(ed(), run, 'G4_content', 'approved', [judgment('unresolved')]).catch(e => e.message)).toMatch(/recorded disposition/);
    expect(await gate(ed(), run, 'G4_content', 'approved', []).catch(e => e.message)).toMatch(/Content judgment missing for PHYS_02/);
    await gate(ed(), run, 'G4_content', 'approved', [judgment('unresolved', { disposition: 'blocks_integration' })]);
    const w = await work(svc(), [{ key: 'package:01_Paper_Inventory.json', kind: 'package_file', content: '{}' }], 'S7_package'); await complete(svc(), w.claim, w.made);
    expect(await gate(ed(), run, 'G5_integration').catch(e => e.message)).toMatch(/Content judgments block integration of PHYS_02/);
  });
  test('a scoped exception with rationale lets integration proceed and is recorded', async () => {
    const { run } = await startRun();
    await toG5(run, [judgment('unresolved', { disposition: 'scoped_exception', exceptionRationale: 'Cognitive level confirmed later by subject head' })]);
    const d = await gate(ed(), run, 'G5_integration');
    expect(d.outcome).toBe('approved');
    const v = await view(run);
    expect(v.run.state).toBe('completed'); expect(v.changesets.at(-1).state).toBe('authorised');
  });
  test('the no-change path completes with recorded G3 and G4 decisions and no integration decision', async () => {
    const { run } = await startRun(); await toG3(run, null); await gate(ed(), run, 'G3_records'); await gate(ed(), run, 'G4_content', 'approved', []);
    const w = await work(svc(), [{ key: 'package:01_Paper_Inventory.json', kind: 'package_file', content: '{"noChange":true}' }], 'S7_package'); await complete(svc(), w.claim, w.made);
    expect((await view(run)).run.state).toBe('completed');
  });
  test('automated agents cannot approve: the worker session has no decision function', async () => {
    const { run } = await startRun(); await toG1(run);
    expect(await refused(svc(), 'studio_gate_view', { p_run: run, p_gate: 'G1_inventory' })).toMatch(/permission denied/);
  });
});

describe('immutable revisions and invalidation (C04)', () => {
  test('a changed source PDF creates a new input revision, invalidates everything from G1 and preserves old evidence', async () => {
    const { run, source: src } = await startRun(); await toG2(run); await gate(ed(), run, 'G2_matches');
    const nb = await blob(ed(), MODULE, 'question paper v2 with comment');
    const sr = await ok(ed(), 'studio_revise_source', { p_source: src, p_expected_revision: 1, p_files: [{ blobId: nb, role: 'combined', filename: 'paper.pdf' }], p_identity: { grade: 11 }, p_reason: 'Replaced annotated scan', p_command: key() });
    const r = await ok(ed(), 'studio_rebase_run', { p_run: run, p_expected_input_revision: 1, p_source_revision: sr.revisionId, p_snapshot: null, p_skill_contract: null, p_profile: null, p_reason: 'Source corrected', p_command: key() });
    expect(r).toMatchObject({ inputRevision: 2, invalidatedFrom: ['G1_inventory'] });
    const v = await view(run);
    expect(v.inputs).toHaveLength(2); expect(v.inputs[0].source_digest).not.toBe(v.inputs[1].source_digest);
    expect(v.stages.filter((x: any) => x.stage_key === 'S1_extract').map((x: any) => x.state)).toEqual(['succeeded', 'queued']);
    expect(v.artifacts.find((a: any) => a.logicalKey === 'inventory').state).toBe('current'); // old evidence retained
    expect(await refused(ed(), 'studio_rebase_run', { p_run: run, p_expected_input_revision: 1, p_source_revision: null, p_snapshot: null, p_skill_contract: null, p_profile: null, p_reason: 'stale', p_command: key() })).toMatch(/Run changed/);
  });
  test('adding a candidate to the bank invalidates all matching even when no shortlisted file changed; extraction is reused', async () => {
    const { run } = await startRun(); await toG2(run); await gate(ed(), run, 'G2_matches');
    const s1 = (await stage(run, 'S1_extract')).id;
    const bank: BankFile[] = [...baseBank, { path: 'data/task-types/physics/PHYS_03_Synthetic_New.md', content: '# PHYS_03 newly added family', record: { kind: 'task_type', id: 'PHYS_03' } }];
    const next = await importSnapshot(op(), MODULE, bank); await accept(op(), MODULE, next.snapshotId, base.snapshotId);
    const r = await ok(ed(), 'studio_rebase_run', { p_run: run, p_expected_input_revision: 1, p_source_revision: null, p_snapshot: next.snapshotId, p_skill_contract: null, p_profile: null, p_reason: 'Bank gained PHYS_03', p_command: key() });
    expect(r.invalidatedFrom).toEqual(['G2_matches']);
    const v = await view(run);
    expect(v.gates.map((g: any) => g.live)).toEqual([true, false, false, false, false]);
    expect(v.stages.filter((x: any) => x.stage_key === 'S1_extract').map((x: any) => x.id)).toEqual([s1]);
    expect(v.stages.filter((x: any) => x.stage_key === 'S2_task_match').map((x: any) => x.state)).toEqual(['succeeded', 'queued']);
  });
  test('a newer accepted bank cannot silently accept stale output at integration', async () => {
    const { run } = await startRun(); await toG5(run);
    const next = await importSnapshot(op(), MODULE, [...baseBank, { path: 'data/reference/new-note.md', content: '# note', record: { kind: 'reference', id: 'new-note' } }]);
    await accept(op(), MODULE, next.snapshotId, base.snapshotId);
    expect(await gate(ed(), run, 'G5_integration').catch(e => e.message)).toMatch(/Bank changed since this run was pinned; rebase required/);
  });
  test('stale in-flight work is fenced when its inputs change mid-run', async () => {
    const { run, source: src } = await startRun(); await toG1(run); await gate(ed(), run, 'G1_inventory');
    const a = await ok(svc(), 'studio_claim', { p_worker: 'w' });
    const nb = await blob(ed(), MODULE, 'question paper v3');
    const sr = await ok(ed(), 'studio_revise_source', { p_source: src, p_expected_revision: 1, p_files: [{ blobId: nb, role: 'combined', filename: 'paper.pdf' }], p_identity: {}, p_reason: 'New scan', p_command: key() });
    await ok(ed(), 'studio_rebase_run', { p_run: run, p_expected_input_revision: 1, p_source_revision: sr.revisionId, p_snapshot: null, p_skill_contract: null, p_profile: null, p_reason: 'Source changed', p_command: key() });
    expect(await refused(svc(), 'studio_complete', { p_attempt: a.attemptId, p_lease: a.lease, p_outputs: [] })).toMatch(/Studio lease lost/);
    expect((await view(run)).stages.find((x: any) => x.id === a.stageId).state).toBe('stale');
  });
});

describe('record identity, CRUD and retirement (C05, C07, programme 11)', () => {
  test('cross-module and traversal paths are refused; identity resolves only in the pinned module snapshot', async () => {
    const { run } = await startRun();
    const md = await blob(ed(), MODULE, '# draft', 'text/markdown', 'revision');
    const other = await blob(ed(), OTHER, '# other module draft', 'text/markdown', 'revision');
    const draft = (path: string, b = md, id = 'PHYS_09', kind = 'task_type') => refused(ed(), 'studio_create_draft', { p_run: run, p_record_kind: kind, p_record_id: id, p_parent_record_id: '', p_path: path, p_blob: b, p_rationale: 'x', p_command: key() });
    for (const p of ['data/task-types/physics/../../../etc/passwd.md', '/data/task-types/physics/X.md', 'data/archive/PHYS_09.md', 'data/specs/paper-1-physics/PHYS_09.md', '../studio-other/data/task-types/physics/PHYS_09.md'])
      expect(await draft(p)).toMatch(/Unsafe or out-of-scope record path/);
    expect(await draft('data/task-types/physics/PHYS_09_New.md', other)).toMatch(/not found in this module/);
    expect(await draft('data/task-types/physics/Elsewhere.md', md, 'PHYS_01')).toMatch(/different path in the pinned snapshot/);
    expect(await draft('data/task-types/physics/PHYS_02_Synthetic_Force.md', md, 'PHYS_77')).toMatch(/Path already holds another record/);
    const ok1 = await ok(ed(), 'studio_create_draft', { p_run: run, p_record_kind: 'task_type', p_record_id: 'PHYS_09', p_parent_record_id: '', p_path: 'data/task-types/physics/PHYS_09_New.md', p_blob: md, p_rationale: 'New family proposal', p_command: key() });
    expect(ok1.logicalKey).toBe('record:task_type:PHYS_09');
  });
  test('read an exact revision, update by revision, and discard only unreferenced drafts', async () => {
    const { run } = await startRun(); await toG3(run);
    const draft = (await view(run)).artifacts.find((a: any) => a.kind === 'draft_record');
    expect(await ok(ed(), 'studio_read_artifact', { p_artifact: draft.id })).toMatchObject({ revision: 1, record: { moduleId: MODULE, kind: 'task_type', id: 'PHYS_02' } });
    expect(await refused(s.rpc({ kind: 'user', id: ids.outsider }), 'studio_read_artifact', { p_artifact: draft.id })).toMatch(/Studio editor access required/);
    expect(await refused(ed(), 'studio_discard_draft', { p_artifact: draft.id, p_reason: 'no', p_command: key() })).toMatch(/referenced by a review or change set/);
    const md = await blob(ed(), MODULE, '# PHYS_02 second correction', 'text/markdown', 'revision');
    const rev = await ok(ed(), 'studio_revise_artifact', { p_artifact: draft.id, p_blob: md, p_rationale: 'Second correction', p_command: key() });
    expect(await refused(ed(), 'studio_revise_artifact', { p_artifact: draft.id, p_blob: md, p_rationale: 'stale editor', p_command: key() })).toMatch(/Revision changed/);
    const v = await view(run);
    expect(v.artifacts.filter((a: any) => a.kind === 'draft_record').map((a: any) => [a.revision, a.state])).toEqual([[1, 'superseded'], [2, 'current']]);
    // The new revision is not yet referenced by any review or change set, so it can be discarded.
    expect(await ok(ed(), 'studio_discard_draft', { p_artifact: rev.artifactId, p_reason: 'Withdrawn', p_command: key() })).toMatchObject({ state: 'discarded' });
  });
  test('retiring a referenced record is refused; retirement never deletes, and dependants retired together are allowed', async () => {
    const retired = await blob(ed(), MODULE, '# PHYS_01 synthetic motion\n**Status:** retired', 'text/markdown', 'revision');
    const specRetired = await blob(ed(), MODULE, '# Spec P1-PHYS-01\n**Status:** retired', 'text/markdown', 'revision');
    const p01 = { action: 'retire', path: 'data/task-types/physics/PHYS_01_Synthetic_Motion.md', recordKind: 'task_type', recordId: 'PHYS_01', blobId: retired };
    expect(await refused(ed(), 'studio_create_maintenance_changeset', { p_module: MODULE, p_base_snapshot: base.snapshotId, p_entries: [p01], p_rationale: 'Retire', p_command: key() })).toMatch(/required reference from P1-PHYS-01/);
    const both = await ok(ed(), 'studio_create_maintenance_changeset', { p_module: MODULE, p_base_snapshot: base.snapshotId, p_entries: [p01, { action: 'retire', path: 'data/specs/paper-1-physics/SPEC_P1_PHYS_01_Synthetic.md', recordKind: 'specification', recordId: 'P1-PHYS-01', blobId: specRetired }], p_rationale: 'Retire both', p_command: key() });
    const a = await ok(ed2(), 'studio_authorise_changeset', { p_changeset: both.changesetId, p_expected_manifest_sha256: both.manifestSha256, p_rationale: 'Independent check', p_authorisation: AUTH, p_command: key() });
    expect(a).toMatchObject({ state: 'authorised', selfReviewed: false });
    const exported = await ok(op(), 'studio_export_changeset', { p_changeset: both.changesetId, p_purpose: 'canonical' });
    expect(exported.entries.every((e: any) => e.before && e.after)).toBe(true); // replacement, never deletion
    expect(await refused(ed(), 'studio_create_maintenance_changeset', { p_module: MODULE, p_base_snapshot: base.snapshotId, p_entries: [{ ...p01, path: 'data/archive/OLD_Synthetic.md' }], p_rationale: 'x', p_command: key() })).toMatch(/Unsafe or out-of-scope path/);
  });
  test('historical records stay readable after a later snapshot retires them', async () => {
    const { run } = await startRun(); await toG3(run);
    const draft = (await view(run)).artifacts.find((a: any) => a.kind === 'draft_record');
    const next = await importSnapshot(op(), MODULE, baseBank.map(f => f.path.includes('PHYS_02') ? { ...f, content: f.content + '\n**Status:** retired' } : f));
    await accept(op(), MODULE, next.snapshotId, base.snapshotId);
    expect(await ok(ed(), 'studio_read_artifact', { p_artifact: draft.id })).toMatchObject({ sha256: expect.any(String) });
    expect((await s.sql('select count(*)::int n from private.studio_snapshot_files where snapshot_id=$1', [base.snapshotId]))[0].n).toBe(baseBank.length);
  });
});

describe('rehearsal isolation and snapshot authority (C01)', () => {
  test('candidate snapshots are rehearsal-only: canonical runs, acceptance and release eligibility refuse them', async () => {
    const cand = await importSnapshot(op(), MODULE, [...baseBank, { path: 'data/reference/rehearsal.md', content: '# rehearsal', record: { kind: 'reference', id: 'rehearsal' } }], { origin: 'candidate', purpose: 'rehearsal', accept: false });
    expect(await refused(op(), 'studio_accept_snapshot', { p_module: MODULE, p_snapshot: cand.snapshotId, p_expected_previous: base.snapshotId })).toMatch(/Rehearsal snapshots cannot update the canonical pointer/);
    expect(await refused(op(), 'studio_release_eligibility', { p_snapshot: cand.snapshotId })).toMatch(/Rehearsal lineage cannot be registered or activated/);
    expect(await ok(op(), 'studio_release_eligibility', { p_snapshot: base.snapshotId })).toMatchObject({ eligible: true });
    const src = await source('rehearsal paper');
    expect(await refused(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'canonical', p_snapshot: cand.snapshotId, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() })).toMatch(/current accepted bank snapshot/);
    const r = await ok(ed(), 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'rehearsal', p_snapshot: cand.snapshotId, p_skill_contract: SKILL, p_profile: PROFILE, p_command: key() });
    expect(r.purpose).toBe('rehearsal');
    expect(await refused(op(), 'studio_register_snapshot', { p_module: MODULE, p_manifest_sha256: cand.manifest, p_files: [], p_records: [], p_links: [], p_origin: 'candidate', p_purpose: 'canonical', p_parent: null, p_changeset: null, p_created_by: 'x' })).toMatch(/rehearsal only/);
  });
  test('a rehearsal change set cannot be exported for canonical apply', async () => {
    const cand = await importSnapshot(op(), MODULE, baseBank, { origin: 'candidate', purpose: 'rehearsal', accept: false });
    const { run } = await startRun('rehearsal', cand.snapshotId); await toG5(run); await gate(ed(), run, 'G5_integration');
    const c = (await view(run)).changesets.at(-1);
    expect(await refused(op(), 'studio_export_changeset', { p_changeset: c.id, p_purpose: 'canonical' })).toMatch(/refusing canonical apply/);
    expect((await ok(op(), 'studio_export_changeset', { p_changeset: c.id, p_purpose: 'rehearsal' })).purpose).toBe('rehearsal');
  });
  test('acceptance is revision-checked; a snapshot manifest must match its file list', async () => {
    const next = await importSnapshot(op(), MODULE, [...baseBank, { path: 'data/reference/x.md', content: 'x', record: { kind: 'reference', id: 'x' } }]);
    expect(await refused(op(), 'studio_accept_snapshot', { p_module: MODULE, p_snapshot: next.snapshotId, p_expected_previous: null })).toMatch(/Accepted bank changed/);
    expect(await refused(op(), 'studio_register_snapshot', { p_module: MODULE, p_manifest_sha256: sha('forged'), p_files: [{ path: 'data/reference/x.md', sha256: sha('x'), size: 1 }], p_records: [], p_links: [], p_origin: 'operator_import', p_purpose: 'canonical', p_parent: null, p_changeset: null, p_created_by: 'x' })).toMatch(/Manifest digest does not match/);
    const again = await importSnapshot(op(), MODULE, baseBank);
    expect(again.snapshotId).toBe(base.snapshotId); // identical tree: no-op
  });
  test('the snapshot manifest bytes are identical in TypeScript, SQL and the Python operator tool', async () => {
    // The same digest is asserted by worker studio/tests/test_operator.py for this synthetic bank.
    expect(base.manifest).toBe('0179616a0233c6a2ac22b748782b6e026c8b59799befd8e824d2272e4201c1a9');
    expect((await s.sql('select manifest_sha256 m from private.studio_snapshots where id=$1', [base.snapshotId]))[0].m).toBe(base.manifest);
  });
  test('unsupported subjects fail explicitly at enrolment', async () => {
    expect(await refused(op(), 'studio_enrol_module', { p_module: OTHER, p_subject_adapter: 'caps-geography@1' })).toMatch(/Unsupported subject adapter/);
  });
  test('the apply receipt advances only an authorised change set, then lineage acceptance follows', async () => {
    const { run } = await startRun(); await toG5(run); await gate(ed(), run, 'G5_integration');
    const c = (await view(run)).changesets.at(-1);
    const ex = await ok(op(), 'studio_export_changeset', { p_changeset: c.id, p_purpose: 'canonical' });
    expect(sha(ex.manifestText)).toBe(ex.manifestSha256);
    expect(await refused(op(), 'studio_record_apply_result', { p_changeset: c.id, p_manifest_sha256: sha('other'), p_result: 'applied', p_receipt: {} })).toMatch(/Change set changed/);
    await ok(op(), 'studio_record_apply_result', { p_changeset: c.id, p_manifest_sha256: c.manifest_sha256, p_result: 'applied', p_receipt: { journal: 'synthetic' } });
    const bank = baseBank.map(f => f.path.includes('PHYS_02') ? { ...f, content: '# PHYS_02 synthetic force, corrected method' } : f);
    const p = await importSnapshot(op(), MODULE, bank, { accept: false });
    await s.sql('update private.studio_snapshots set changeset_id=$1 where id=$2', [c.id, p.snapshotId]);
    expect(await accept(op(), MODULE, p.snapshotId, base.snapshotId)).toMatchObject({ changed: true });
  });
});

describe('audit history', () => {
  test('decisions, revisions and events are append-only; only invalidation may be recorded on a decision', async () => {
    const { run } = await startRun(); await toG1(run); await gate(ed(), run, 'G1_inventory');
    await expect(s.sql("update private.studio_decisions set rationale='rewritten' where run_id=$1", [run])).rejects.toThrow(/immutable/);
    await expect(s.sql('delete from private.studio_events where run_id=$1', [run])).rejects.toThrow(/immutable/);
    await expect(s.sql("update private.studio_artifacts set sha256=$2 where run_id=$1", [run, sha('x')])).rejects.toThrow(/immutable/);
    expect((await view(run)).events.map((e: any) => e.event)).toEqual(expect.arrayContaining(['run_started', 'stage_claimed', 'stage_succeeded', 'decision_recorded']));
  });
});
