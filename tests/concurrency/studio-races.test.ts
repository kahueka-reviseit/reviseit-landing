// Curriculum Studio under genuine concurrency: separate PostgreSQL sessions racing reviews, explicit
// provider retries, command replays, claims, upload finalisation and garbage-collection claims.
// Synthetic data; a disposable loopback database is created and dropped by this test.
import { Client } from 'pg';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { baseBank, snapshotPayload, sha, ids, MODULE, SKILL, PROFILE, AUTH } from '../database/studio-fixture';

const url = process.env.REVISEIT_CONCURRENCY_DATABASE_URL || '';
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) throw new Error('Set REVISEIT_CONCURRENCY_DATABASE_URL to a disposable loopback PostgreSQL server');
const name = 'studio_races_' + Date.now(), dbUrl = url.replace(/\/[^/]*$/, '/' + name);
let admin: Client, owner: Client, snapshot: string;
const types = new Map<string, { names: string[]; types: string[] }>();
const evidence: Record<string, unknown> = {};
type Who = { role: 'authenticated'; id: string } | { role: 'service_role' } | { role: 'reviseit_studio_operator' };
async function session(who: Who) {
  const c = new Client({ connectionString: dbUrl }); await c.connect();
  await c.query("select set_config('request.jwt.claim.sub',$1,false)", [who.role === 'authenticated' ? who.id : '']);
  await c.query('set role ' + who.role);
  return c;
}
async function rpc(c: Client, fn: string, args: Record<string, unknown>) {
  const t = types.get(fn)!, keys = Object.keys(args);
  const params = keys.map(k => { const ty = t.types[t.names.indexOf(k)], v = args[k]; return v === null ? null : ty === 'jsonb' ? JSON.stringify(v) : ty.endsWith('[]') ? `{${(v as unknown[]).join(',')}}` : v; });
  const r = await c.query(`select public.${fn}(${keys.map((k, i) => `${k}=>$${i + 1}::${t.types[t.names.indexOf(k)]}`).join(',')}) as r`, params);
  return r.rows[0].r;
}
// Explicit test-only server attestation session; editor RPCs themselves remain unprivileged.
async function verify(c: Client, fn: string, args: Record<string, unknown>) {
  const actor = (await c.query('select auth.uid() id')).rows[0].id;
  const trusted = await worker();
  try { return await rpc(trusted, fn, {...args,p_actor:actor}); }
  finally { await trusted.end(); }
}
const editor = () => session({ role: 'authenticated', id: ids.editor }), editor2 = () => session({ role: 'authenticated', id: ids.editor2 }), worker = () => session({ role: 'service_role' });

beforeAll(async () => {
  admin = new Client({ connectionString: url }); await admin.connect(); await admin.query(`create database ${name}`);
  owner = new Client({ connectionString: dbUrl }); await owner.connect();
  await owner.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
   if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
   if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
   create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $f$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$f$;
   grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
  for (const f of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) await owner.query(readFileSync('supabase/migrations/' + f, 'utf8'));
  const r = await owner.query(`select p.proname, p.proargnames names, array(select format_type(t,null) from unnest(p.proargtypes) t) types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'studio\\_%'`);
  for (const row of r.rows) types.set(row.proname, { names: row.names || [], types: row.types });
  for (const id of [ids.editor, ids.editor2]) {
    await owner.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, id + '@synthetic.example']);
    await owner.query('insert into private.account_reviewers values($1)', [id]); await owner.query('insert into private.studio_editors(user_id) values($1)', [id]);
  }
  await owner.query(`insert into public.curriculum_modules(id,name,current_release) values('${MODULE}','Synthetic','1')`);
  const op = await session({ role: 'reviseit_studio_operator' });
  await rpc(op, 'studio_enrol_module', { p_module: MODULE, p_subject_adapter: 'caps-physical-sciences@1' });
  const p = snapshotPayload(MODULE, baseBank);
  snapshot = (await rpc(op, 'studio_register_snapshot', { p_module: MODULE, p_manifest_sha256: p.manifest, p_files: p.files, p_records: p.records, p_links: p.links, p_origin: 'operator_import', p_purpose: 'canonical', p_parent: null, p_changeset: null, p_created_by: 'race' })).snapshotId;
  await rpc(op, 'studio_accept_snapshot', { p_module: MODULE, p_snapshot: snapshot, p_expected_previous: null }); await op.end();
}, 120000);
afterAll(async () => {
  if (process.env.REVISEIT_CONCURRENCY_EVIDENCE) writeFileSync(process.env.REVISEIT_CONCURRENCY_EVIDENCE, JSON.stringify(evidence, null, 1));
  await owner?.end(); await admin?.query(`drop database if exists ${name} with (force)`); await admin?.end();
});

async function blob(c: Client, content: string, revision = false) {
  const bytes = revision ? content : '%PDF-1.7 ' + content, digest = sha(bytes), size = Buffer.byteLength(bytes);
  const media = revision ? 'application/json' : 'application/pdf';
  const s = await rpc(c, 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: size, p_media_type: media, p_filename: revision ? 'revision.json' : 'r.pdf', p_purpose: revision ? 'revision' : 'source', p_command: randomUUID() });
  await verify(c, 'studio_prepare_commit', { p_session: s.sessionId, p_sha256: digest, p_size: size, p_detected_type: media });
  return (await verify(c, 'studio_commit_upload', { p_session: s.sessionId })).blobId;
}
async function startRun(c: Client) {
  const b = await blob(c, randomUUID());
  const src = await rpc(c, 'studio_create_source', { p_module: MODULE, p_title: 'Race paper', p_files: [{ blobId: b, role: 'combined', filename: 'r.pdf' }], p_identity: {}, p_command: randomUUID() });
  return (await rpc(c, 'studio_start_run', { p_source: src.sourceId, p_expected_source_revision: 1, p_purpose: 'canonical', p_snapshot: snapshot, p_skill_contract: SKILL, p_profile: PROFILE, p_command: randomUUID() })).runId;
}

test('40 simultaneous reviewer pairs on one gate version produce exactly one decision each time', async () => {
  const a = await editor(), b = await editor2(), w = await worker(); let winsA = 0, winsB = 0;
  try {
    for (let i = 0; i < 40; i++) {
      await owner.query("update private.studio_stages set state='cancelled' where state in ('queued','running')");
      const run = await startRun(a);
      const c = await rpc(w, 'studio_claim', { p_worker: 'race' });
      const out = await rpc(w, 'studio_put_output', { p_attempt: c.attemptId, p_lease: c.lease, p_logical_key: 'inventory', p_kind: 'inventory', p_sha256: sha('inv' + i), p_size: 3 + String(i).length, p_media_type: 'application/json', p_schema: null, p_record: null, p_meta: {}, p_provider_attempt: null });
      await rpc(w, 'studio_complete', { p_attempt: c.attemptId, p_lease: c.lease, p_outputs: [out.artifactId] });
      const v = await rpc(a, 'studio_gate_view', { p_run: run, p_gate: 'G1_inventory' });
      const decide = (cl: Client) => rpc(cl, 'studio_record_decision', { p_run: run, p_gate: 'G1_inventory', p_expected_version: v.version, p_bound: v.binding.artifacts.map((x: any) => x.id), p_outcome: 'approved', p_rationale: 'Race review', p_authorisation: AUTH, p_items: [], p_command: randomUUID() });
      const r = await Promise.allSettled([decide(a), decide(b)]);
      expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(String((r.find(x => x.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/Gate changed|Gate already approved/);
      if (r[0].status === 'fulfilled') winsA++; else winsB++;
      expect((await owner.query('select count(*)::int n from private.studio_decisions where run_id=$1', [run])).rows[0].n).toBe(1);
    }
    evidence.reviews = { pairs: 40, winsA, winsB };
  } finally { await a.end(); await b.end(); await w.end(); }
});

test('40 simultaneous explicit retries of one uncertain provider attempt create exactly one next attempt', async () => {
  const a = await editor(), b = await editor2(), w = await worker();
  try {
    for (let i = 0; i < 40; i++) {
      await owner.query("update private.studio_stages set state='cancelled' where state in ('queued','running')");
      await startRun(a);
      const c = await rpc(w, 'studio_claim', { p_worker: 'race' });
      const p = await rpc(w, 'studio_provider_prepare', { p_attempt: c.attemptId, p_lease: c.lease, p_operation: 'extract:inventory', p_request_digest: sha('req') });
      await rpc(w, 'studio_provider_dispatched', { p_attempt: c.attemptId, p_lease: c.lease, p_provider_attempt: p.providerAttemptId });
      await rpc(w, 'studio_mark_uncertain', { p_attempt: c.attemptId, p_lease: c.lease, p_reason: 'race timeout' });
      const retry = (cl: Client, k = randomUUID()) => rpc(cl, 'studio_retry_provider_operation', { p_operation: p.operationId, p_expected_attempt: 1, p_reason: 'Explicit concurrent retry', p_command: k });
      const r = await Promise.allSettled([retry(a), retry(b)]);
      expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      const attempts = (await owner.query('select attempt_number, dispatch_state, possible_charge from private.studio_provider_attempts where operation_id=$1 order by attempt_number', [p.operationId])).rows;
      expect(attempts).toEqual([{ attempt_number: 1, dispatch_state: 'uncertain', possible_charge: true }, { attempt_number: 2, dispatch_state: 'prepared', possible_charge: false }]);
    }
    evidence.providerRetries = { pairs: 40, attemptsPerOperation: 2 };
  } finally { await a.end(); await b.end(); await w.end(); }
});

test('the same command key sent twice at once returns one result from two sessions', async () => {
  const a = await editor(), a2 = await editor();
  try {
    for (let i = 0; i < 20; i++) {
      const k = randomUUID(), args = { p_module: MODULE, p_sha256: sha('k' + i), p_size: 9, p_media_type: 'application/pdf', p_filename: 'k.pdf', p_purpose: 'source', p_command: k };
      const [x, y] = await Promise.all([rpc(a, 'studio_create_upload', args), rpc(a2, 'studio_create_upload', args)]);
      expect(x.sessionId).toBe(y.sessionId);
    }
  } finally { await a.end(); await a2.end(); }
});

test('competing workers never claim one stage twice and respect the Studio running limit', async () => {
  const a = await editor(); const workers = await Promise.all(Array.from({ length: 6 }, worker));
  try {
    await owner.query('update private.studio_stages set state=\'cancelled\' where state in (\'queued\',\'running\')');
    await owner.query('update private.studio_settings set max_running=3');
    for (let i = 0; i < 8; i++) await startRun(a);
    const claims = (await Promise.all(workers.map((w, i) => rpc(w, 'studio_claim', { p_worker: 'race-' + i })))).filter(Boolean);
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((c: any) => c.stageId)).size).toBe(3);
    evidence.claims = { workers: 6, queued: 8, limit: 3, claimed: claims.length };
  } finally { await owner.query('update private.studio_settings set max_running=2'); await a.end(); for (const w of workers) await w.end(); }
});

test('simultaneous finalisation of identical bytes in separate sessions yields one verified blob', async () => {
  const a = await editor(), b = await editor2();
  try {
    for (let i = 0; i < 20; i++) {
      const bytes = '%PDF-1.7 same ' + i, digest = sha(bytes), size = Buffer.byteLength(bytes);
      const mk = (c: Client) => rpc(c, 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: size, p_media_type: 'application/pdf', p_filename: 's.pdf', p_purpose: 'source', p_command: randomUUID() });
      const [sa, sb] = await Promise.all([mk(a), mk(b)]);
      const fin = async (c: Client, s: any) => { await verify(c, 'studio_prepare_commit', { p_session: s.sessionId, p_sha256: digest, p_size: size, p_detected_type: 'application/pdf' }); return verify(c, 'studio_commit_upload', { p_session: s.sessionId }); };
      const [ra, rb] = await Promise.all([fin(a, sa), fin(b, sb)]);
      expect(ra.blobId).toBe(rb.blobId);
      expect((await owner.query('select count(*)::int n from private.studio_blobs where sha256=$1', [digest])).rows[0].n).toBe(1);
    }
  } finally { await a.end(); await b.end(); }
});

test('a garbage-collection claim and a finalisation of the same key never both proceed', async () => {
  const a = await editor(), w = await worker(); let gcWins = 0, finWins = 0;
  try {
    for (let i = 0; i < 40; i++) {
      const bytes = '%PDF-1.7 gc ' + i, digest = sha(bytes), size = Buffer.byteLength(bytes), target = `studio/blobs/${MODULE}/${digest}`;
      const s = await rpc(a, 'studio_create_upload', { p_module: MODULE, p_sha256: digest, p_size: size, p_media_type: 'application/pdf', p_filename: 'g.pdf', p_purpose: 'source', p_command: randomUUID() });
      const [gc, prep] = await Promise.allSettled([rpc(w, 'studio_gc_claim', { p_key: target }), verify(a, 'studio_prepare_commit', { p_session: s.sessionId, p_sha256: digest, p_size: size, p_detected_type: 'application/pdf' })]);
      const claimed = gc.status === 'fulfilled' && gc.value === true, prepared = prep.status === 'fulfilled';
      expect(claimed && prepared).toBe(false); expect(claimed || prepared).toBe(true);
      if (claimed) { gcWins++; await rpc(w, 'studio_gc_finish', { p_key: target }); } else finWins++;
    }
    evidence.gcVsFinalise = { pairs: 40, gcWins, finWins };
  } finally { await a.end(); await w.end(); }
});

test('a late completion races lease-expiry reclaim: exactly one attempt can succeed', async () => {
  const a = await editor(), w1 = await worker(), w2 = await worker(); let lateWins = 0, newWins = 0;
  try {
    await owner.query('update private.studio_stages set state=\'cancelled\' where state in (\'queued\',\'running\')');
    for (let i = 0; i < 20; i++) {
      await startRun(a);
      const c = await rpc(w1, 'studio_claim', { p_worker: 'old' });
      const out = await rpc(w1, 'studio_put_output', { p_attempt: c.attemptId, p_lease: c.lease, p_logical_key: 'inventory', p_kind: 'inventory', p_sha256: sha('late' + i), p_size: 5, p_media_type: 'application/json', p_schema: null, p_record: null, p_meta: {}, p_provider_attempt: null });
      await owner.query("update private.studio_stage_attempts set lease_until=now()+interval '200 milliseconds' where id=$1", [c.attemptId]);
      await new Promise(r => setTimeout(r, 200));
      const [late, reclaim] = await Promise.allSettled([rpc(w1, 'studio_complete', { p_attempt: c.attemptId, p_lease: c.lease, p_outputs: [out.artifactId] }), rpc(w2, 'studio_claim', { p_worker: 'new' })]);
      const lateOk = late.status === 'fulfilled', claimed = reclaim.status === 'fulfilled' && reclaim.value && reclaim.value.stageId === c.stageId;
      expect(lateOk && claimed).toBe(false);
      if (lateOk) lateWins++; else { expect(String((late as PromiseRejectedResult).reason)).toMatch(/Studio lease lost/); newWins++; }
      await owner.query('update private.studio_stages set state=\'cancelled\' where state in (\'queued\',\'running\')');
    }
    evidence.lateCompletion = { pairs: 20, lateWins, newWins };
  } finally { await a.end(); await w1.end(); await w2.end(); }
});


test('review racing an editor replacement never leaves authority for superseded evidence', async () => {
  const a = await editor(), b = await editor2(), w = await worker(); let approvedFirst = 0, editFirst = 0;
  try {
    for (let i = 0; i < 20; i++) {
      await owner.query("update private.studio_stages set state='cancelled' where state in ('queued','running')");
      const run = await startRun(a), c = await rpc(w,'studio_claim',{p_worker:'authority-race'});
      const out = await rpc(w,'studio_put_output',{p_attempt:c.attemptId,p_lease:c.lease,p_logical_key:'inventory',p_kind:'inventory',p_sha256:sha('{}'),p_size:2,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:null});
      await rpc(w,'studio_complete',{p_attempt:c.attemptId,p_lease:c.lease,p_outputs:[out.artifactId]});
      const v = await rpc(a,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});
      const newBlob = await blob(b,JSON.stringify({revision:i}),true);
      const [review,edit] = await Promise.allSettled([
        rpc(a,'studio_record_decision',{p_run:run,p_gate:'G1_inventory',p_expected_version:v.version,p_bound:[out.artifactId],p_outcome:'approved',p_rationale:'Reviewed original evidence',p_authorisation:AUTH,p_items:[],p_command:randomUUID()}),
        rpc(b,'studio_revise_artifact',{p_artifact:out.artifactId,p_blob:newBlob,p_rationale:'Correct the source reading',p_command:randomUUID()})
      ]);
      expect(edit.status).toBe('fulfilled');
      if(review.status==='fulfilled') approvedFirst++;
      else { editFirst++; expect(String(review.reason)).toMatch(/Gate changed|Review binding changed/); }
      const after=await rpc(a,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});
      expect(after.live).toBeNull();
      expect(after.binding.artifacts.map((x:any)=>x.id)).toEqual([(edit as PromiseFulfilledResult<any>).value.artifactId]);
      expect((await owner.query("select count(*)::int n from private.studio_stages where run_id=$1 and stage_key in ('S2_task_match','S3_spec_match') and state in ('queued','running')",[run])).rows[0].n).toBe(0);
    }
    evidence.approvalVsReplacement={pairs:20,approvedFirst,editFirst,staleApprovals:0};
  } finally { await a.end();await b.end();await w.end(); }
});
