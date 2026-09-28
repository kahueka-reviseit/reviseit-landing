// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, afterAll, test, expect, describe } from 'vitest';

// C09 outbox against the real migration stack. Synthetic identities only.
let db: PGlite;
const teacher = '00000000-0000-4000-8000-000000000002', other = '00000000-0000-4000-8000-000000000003', reviewer = '00000000-0000-4000-8000-000000000004', applicant = '00000000-0000-4000-8000-000000000005';
const school = '00000000-0000-4000-8000-000000000010', second = '00000000-0000-4000-8000-000000000020';
const order = '00000000-0000-4000-8000-000000000100', key = '00000000-0000-4000-8000-000000000101';
const form = [{ id: 'axes', label: 'Choose graph axes', options: ['V vertically', 'I vertically'] }];
const docs = Object.fromEntries(['paper', 'memo', 'learner-memo', 'teacher-description'].map(n => [n, Buffer.from('PK\x03\x04synthetic-' + n).toString('base64')]));
const address = (id: string) => `${id}@synthetic.example`;

async function owner() { await db.exec('reset role'); }
async function asUser(id: string) { await owner(); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); }
async function service() { await owner(); await db.exec('set role service_role'); }
async function refuse(run: () => Promise<unknown>, pattern: RegExp) { await db.exec('savepoint refusal'); await expect(run()).rejects.toThrow(pattern); await db.exec('rollback to savepoint refusal'); }
async function mode(m: 'off' | 'allowlist' | 'on', list: string[] = []) { await owner(); await db.query('select private.set_email_mode($1,$2,$3)', [m, list, 'Synthetic test setting']); }
async function rows() { await owner(); return (await db.query<any>('select * from private.email_notifications order by created_at,logical_key')).rows; }
async function claim(max = 10, worker = 'dispatch-a') { await service(); return (await db.query<{ c: any[] }>('select public.claim_email_notifications($1,$2) as c', [worker, max])).rows[0].c; }
async function payload(id: string, lease: string, to = address(teacher), subject = 'Your paper is ready') {
  await service(); return (await db.query<{ p: any }>('select public.record_email_payload($1,$2,$3) as p', [id, lease, JSON.stringify({ to, subject, html: '<p>Synthetic</p>', text: 'Synthetic' })])).rows[0].p;
}
async function complete(id: string, lease: string, outcome: string, provider: string | null = null, ambiguous = false) {
  await service(); return (await db.query<{ r: string }>('select public.complete_email_attempt($1,$2,$3,$4,$5,$6) as r', [id, lease, outcome, provider, outcome === 'accepted' ? null : 'synthetic failure', ambiguous])).rows[0].r;
}
async function event(id: string, type: string, provider: string, at = '2026-09-28T10:00:00Z', bounce: string | null = null) {
  await service(); return (await db.query<{ r: string }>('select public.record_email_event($1,$2,$3,$4,$5) as r', [id, type, provider, at, bounce])).rows[0].r;
}
/** Runs the real worker path: submission, claim, rendering and the atomic finish. */
async function release() {
  await asUser(teacher); await db.query('select public.submit_paper_answers($1,$2,$3)', [order, key, JSON.stringify({ axes: 'V vertically' })]);
  await service(); const job = (await db.query<{ j: any }>("select public.claim_paper_job('w1') as j")).rows[0].j;
  await db.query("select public.checkpoint_paper_job($1,$2,'rendering')", [order, job.lease]);
  await db.query('select public.complete_paper_job($1,$2,$3)', [order, job.lease, JSON.stringify(docs)]);
  return job.lease as string;
}
async function hold() {
  await asUser(teacher); await db.query('select public.submit_paper_answers($1,$2,$3)', [order, key, JSON.stringify({ axes: 'V vertically' })]);
  await service(); const job = (await db.query<{ j: any }>("select public.claim_paper_job('w1') as j")).rows[0].j;
  await db.query("select public.checkpoint_paper_job($1,$2,'held')", [order, job.lease]);
}
async function approve(target = applicant, department = school) {
  await owner(); const rev = (await db.query<{ revision: number }>('select revision from public.teacher_accounts where user_id=$1', [target])).rows[0].revision;
  await asUser(reviewer); await db.query("select public.review_teacher_account($1,$2,'approved',$3,'Synthetic verification evidence')", [target, rev, department]);
}
/** Moves a claimed row's lease and timestamps into the past, as if the process died. */
async function age(id: string, fields: string) { await owner(); await db.query(`update private.email_notifications set ${fields} where id=$1`, [id]); }

beforeAll(async () => {
  db = new PGlite(); await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
  for (const f of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
  await db.exec("insert into public.curriculum_modules(id,name,current_release,is_demo) values('test-module','Grade 11 Physical Sciences','test-1',true)");
  for (const id of [teacher, other, reviewer, applicant]) await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)", [id, address(id), JSON.stringify({ full_name: 'Synthetic Teacher', school: 'Synthetic School', department: 'Sciences' })]);
  for (const [id, name] of [[school, 'First'], [second, 'Second']]) {
    await db.query('insert into public.schools(id,slug,name) values($1,$2,$3)', [id, name.toLowerCase(), name + ' Synthetic School']);
    await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')", [id]);
    await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'test-module')", [id]);
  }
  await db.query('insert into private.account_reviewers values($1)', [reviewer]);
  // Existing approvals predate the outbox: set directly, as historic records would be.
  for (const [id, s] of [[teacher, school], [other, second]]) await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$3,reviewed_at=now() where user_id=$1", [id, s, reviewer]);
  await db.exec('delete from private.email_notifications');
  await db.query("insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot) values($1,$2,$3,'test-module','test-1','Internal example','internal_test','test-adapter',$4,'{}')", [order, teacher, school, JSON.stringify(form)]);
}, 60000);
beforeEach(async () => { await db.exec('begin'); await mode('on'); });
afterEach(async () => { await db.exec('rollback;reset role'); });
afterAll(async () => { await db.close(); });

describe('event ownership and prospective activation', () => {
  test('the migration starts off and records historic-style events as skipped, never sendable later', async () => {
    await mode('off'); await approve();
    expect((await rows()).map(r => [r.kind, r.status, r.reason])).toEqual([['access_approved', 'skipped', 'disabled']]);
    await mode('on'); expect(await claim()).toEqual([]);
    await approve(applicant); // already approved: a repeated decision is not a transition
    expect(await rows()).toHaveLength(1);
  });
  test('an approval transition records one message bound to the decision revision; a repeated save adds none', async () => {
    await approve();
    const [n] = await rows();
    expect(n).toMatchObject({ kind: 'access_approved', status: 'queued', recipient: address(applicant), school_id: school });
    expect(n.logical_key).toBe(`access-approved:${applicant}:${n.account_revision}`);
    await approve(applicant, school); await approve(applicant, school);
    expect(await rows()).toHaveLength(1);
  });
  test('suspension then a fresh approval is a new decision revision and a new message', async () => {
    await approve();
    await owner(); const rev = (await db.query<{ revision: number }>('select revision from public.teacher_accounts where user_id=$1', [applicant])).rows[0].revision;
    await asUser(reviewer); await db.query("select public.review_teacher_account($1,$2,'suspended',null,'Synthetic pause')", [applicant, rev]);
    await approve();
    expect((await rows()).map(r => r.kind)).toEqual(['access_approved', 'access_approved']);
  });
  test('a released pack records one readiness message bound to the order and pack version', async () => {
    await release();
    const [n] = await rows();
    await owner(); const pack = (await db.query<{ pack_hash: string }>('select pack_hash from private.paper_orders where id=$1', [order])).rows[0].pack_hash;
    expect(n).toMatchObject({ kind: 'paper_ready', order_id: order, pack_hash: pack, logical_key: `paper-ready:${order}:${pack}`, status: 'queued' });
  });
  test('a failed release transaction leaves no notification behind', async () => {
    await asUser(teacher); await db.query('select public.submit_paper_answers($1,$2,$3)', [order, key, JSON.stringify({ axes: 'V vertically' })]);
    await service(); const job = (await db.query<{ j: any }>("select public.claim_paper_job('w1') as j")).rows[0].j;
    await db.query("select public.checkpoint_paper_job($1,$2,'rendering')", [order, job.lease]);
    await refuse(() => db.query('select public.complete_paper_job($1,$2,$3)', [order, job.lease, JSON.stringify({ ...docs, memo: Buffer.from('not a word file').toString('base64') })]), /Invalid Word document/);
    expect(await rows()).toEqual([]);
  });
  test('a hold during creation records one attention message; a payment-side hold does not', async () => {
    await hold();
    expect((await rows()).map(r => [r.kind, r.logical_key])).toEqual([['paper_attention', `paper-attention:${order}`]]);
    await owner(); await db.query("update private.paper_orders set state='cancelled' where id=$1", [order]);
    await db.query("update private.paper_orders set state='held' where id=$1", [order]);
    expect(await rows()).toHaveLength(1);
  });
  test('email bookkeeping failure never blocks the release itself', async () => {
    await owner(); await db.exec("alter table private.email_notifications add constraint synthetic_break check(false) not valid");
    await release();
    await owner(); expect((await db.query<{ state: string }>('select state from private.paper_orders where id=$1', [order])).rows[0].state).toBe('released');
    expect(await rows()).toEqual([]);
  });
  test('allowlist mode queues only named recipients', async () => {
    await mode('allowlist', [address(other)]); await approve();
    expect((await rows())[0]).toMatchObject({ status: 'skipped', reason: 'not_allowlisted' });
  });
});

describe('claims, payload snapshots and retries', () => {
  test('a claimed message cannot be claimed again while leased, and carries only safe metadata', async () => {
    await release();
    const first = await claim(); const again = await claim(10, 'dispatch-b');
    expect(first).toHaveLength(1); expect(again).toEqual([]);
    expect(first[0].metadata).toEqual({ name: 'Synthetic Teacher', school: 'First Synthetic School', curriculum: 'Grade 11 Physical Sciences', orderId: order });
    expect(JSON.stringify(first[0])).not.toMatch(/V vertically|axes|answers/);
  });
  test('the first rendered payload is frozen and reused by every retry after a crash', async () => {
    await release();
    const [c] = await claim(); const stored = await payload(c.id, c.lease, address(teacher), 'First subject');
    await age(c.id, "lease_until=now()-interval '1 second'");
    const [retry] = await claim(10, 'dispatch-b');
    expect(retry.id).toBe(c.id); expect(retry.lease).not.toBe(c.lease); expect(retry.attempt).toBe(2);
    expect(await payload(retry.id, retry.lease, address(teacher), 'Different subject')).toEqual(stored);
    const [n] = await rows(); expect(n.ambiguous).toBe(true);
    await refuse(() => complete(c.id, c.lease, 'accepted', 'em_old'), /lease lost/);
    expect(await complete(retry.id, retry.lease, 'accepted', 'em_synthetic1')).toBe('accepted');
  });
  test('a payload for a different recipient is refused', async () => {
    await release(); const [c] = await claim();
    await refuse(() => payload(c.id, c.lease, 'someone@else.example'), /Invalid email payload/);
  });
  test('transient failures back off, and exhaustion ends in failed or unknown, never a blind resend', async () => {
    await release();
    let [c] = await claim(); await payload(c.id, c.lease);
    expect(await complete(c.id, c.lease, 'retry', null, false)).toBe('queued');
    let [n] = await rows(); expect(new Date(n.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 50_000);
    for (let i = 0; i < 3; i++) { await age(n.id, 'next_attempt_at=now()'); [c] = await claim(); expect(await complete(c.id, c.lease, 'retry', null, false)).toBe('queued'); [n] = await rows(); }
    await age(n.id, 'next_attempt_at=now()'); [c] = await claim(); expect(c.attempt).toBe(5);
    expect(await complete(c.id, c.lease, 'retry', null, false)).toBe('failed');
  });
  test('an ambiguous send outside the idempotency window becomes unknown and needs a recorded staff outcome', async () => {
    await release(); const [c] = await claim(); await payload(c.id, c.lease);
    await age(c.id, "lease_until=now()-interval '1 minute',first_attempt_at=now()-interval '24 hours'");
    expect(await claim()).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'unknown', reason: 'acceptance_unresolved' });
    await asUser(teacher); await refuse(() => db.query("select public.resolve_email_notification($1,'treat_as_sent','Synthetic note')", [c.id]), /Reviewer access required/);
    await asUser(reviewer); await db.query("select public.resolve_email_notification($1,'treat_as_sent','Checked with the teacher')", [c.id]);
    expect((await rows())[0]).toMatchObject({ status: 'resolved', reason: 'treat_as_sent', resolved_by: reviewer });
  });
  test('switching delivery off pauses sending without discarding queued messages', async () => {
    await release(); await mode('off'); expect(await claim()).toEqual([]);
    await mode('on'); expect(await claim()).toHaveLength(1);
  });
});

describe('eligibility is rechecked before each send', () => {
  test('a changed address cancels the message rather than retargeting it', async () => {
    await release(); await owner(); await db.query("update auth.users set email='moved@synthetic.example' where id=$1", [teacher]);
    expect(await claim()).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'cancelled', reason: 'recipient_changed', recipient: address(teacher) });
  });
  test('revoked access cancels a readiness message', async () => {
    await release(); await owner(); await db.query("update public.teacher_accounts set status='suspended' where user_id=$1", [teacher]);
    expect(await claim()).toEqual([]); expect((await rows())[0]).toMatchObject({ status: 'cancelled', reason: 'access_changed' });
  });
  test('an attention message is withdrawn when the hold was resolved before sending', async () => {
    await hold(); await owner(); await db.query("update private.paper_orders set state='queued' where id=$1", [order]);
    expect(await claim()).toEqual([]); expect((await rows())[0].reason).toBe('resolved_before_send');
  });
  test('an intent never attempted within 48 hours expires instead of arriving late', async () => {
    await release(); const [n] = await rows(); await age(n.id, "created_at=now()-interval '3 days'");
    expect(await claim()).toEqual([]); expect((await rows())[0].reason).toBe('expired');
  });
});

describe('provider callbacks', () => {
  async function accepted(provider = 'em_synthetic1') { await release(); const [c] = await claim(); await payload(c.id, c.lease); await complete(c.id, c.lease, 'accepted', provider); return c.id as string; }
  test('duplicates are recorded once and out-of-order events never move a message backwards', async () => {
    await accepted();
    expect(await event('msg_1', 'email.delivered', 'em_synthetic1')).toBe('delivered');
    expect(await event('msg_1', 'email.delivered', 'em_synthetic1')).toBe('duplicate');
    expect(await event('msg_0', 'email.sent', 'em_synthetic1', '2026-09-28T09:59:00Z')).toBe('kept:delivered');
    expect(await event('msg_2', 'email.delivery_delayed', 'em_synthetic1')).toBe('kept:delivered');
    expect(await event('msg_3', 'email.opened', 'em_synthetic1')).toBe('ignored');
    expect((await rows())[0].status).toBe('delivered');
  });
  test('an event that arrives before the acceptance is recorded is applied once the identifier is known', async () => {
    expect(await event('early_1', 'email.delivered', 'em_early')).toBe('pending');
    await accepted('em_early');
    expect((await rows())[0].status).toBe('delivered');
    await owner(); expect((await db.query<any>("select notification_id,outcome from private.email_events where event_id='early_1'")).rows[0].outcome).toBe('delivered');
  });
  test('a permanent bounce suppresses the address, so a later message is not sent to it', async () => {
    await accepted();
    expect(await event('b_1', 'email.bounced', 'em_synthetic1', '2026-09-28T10:00:00Z', 'Permanent')).toBe('bounced');
    await owner(); expect((await db.query<any>('select reason from private.email_suppressions where address=$1', [address(teacher)])).rows[0].reason).toBe('bounced');
    await owner(); await db.query("update public.teacher_accounts set status='suspended' where user_id=$1", [teacher]);
    await approve(teacher, school);
    expect((await rows()).find(r => r.kind === 'access_approved')).toMatchObject({ status: 'suppressed', reason: 'address_suppressed' });
    await asUser(teacher); expect((await db.query<{ d: any }>('select public.my_email_delivery() as d')).rows[0].d.completionEmail).toBe(false);
  });
  test('a transient bounce is a delay, not a suppression; a complaint suppresses', async () => {
    await accepted();
    expect(await event('t_1', 'email.bounced', 'em_synthetic1', '2026-09-28T10:00:00Z', 'Transient')).toBe('delayed');
    expect(await event('c_1', 'email.complained', 'em_synthetic1')).toBe('complained');
    await owner(); expect((await db.query<any>('select reason from private.email_suppressions')).rows).toEqual([{ reason: 'complained' }]);
  });
  test('a delivery callback resolves an uncertain message without resending it', async () => {
    await release(); const [c] = await claim(); await payload(c.id, c.lease);
    await age(c.id, "status='unknown',provider_id='em_late',lease=null");
    expect(await event('late_1', 'email.delivered', 'em_late')).toBe('delivered');
  });
});

describe('permissions', () => {
  test('teachers cannot claim, record, forge callbacks or read the outbox', async () => {
    await release(); await asUser(teacher);
    await refuse(() => db.query("select public.claim_email_notifications('x',1)"), /permission denied/);
    await refuse(() => db.query("select public.record_email_event('e','email.delivered','em',now(),null)"), /permission denied/);
    await refuse(() => db.query('select public.email_notifications_for_staff()'), /Reviewer access required/);
    await refuse(() => db.query('select * from private.email_notifications'), /permission denied/);
    await refuse(() => db.query("select private.set_email_mode('on','{}','Teacher switch')"), /permission denied/);
  });
  test('reviewers see delivery state without message bodies', async () => {
    await release(); const [c] = await claim(); await payload(c.id, c.lease);
    await asUser(reviewer); const list = (await db.query<{ l: any[] }>('select public.email_notifications_for_staff() as l')).rows[0].l;
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ kind: 'paper_ready', status: 'sending', orderId: order });
    expect(JSON.stringify(list)).not.toMatch(/Synthetic<\/p>|html/);
  });
  test('the paper page promises email only when it is on for that teacher', async () => {
    await asUser(teacher); expect((await db.query<{ d: any }>('select public.my_email_delivery() as d')).rows[0].d).toEqual({ completionEmail: true, address: address(teacher) });
    await mode('allowlist', [address(other)]); await asUser(teacher); expect((await db.query<{ d: any }>('select public.my_email_delivery() as d')).rows[0].d.completionEmail).toBe(false);
    await mode('off'); await asUser(teacher); expect((await db.query<{ d: any }>('select public.my_email_delivery() as d')).rows[0].d.completionEmail).toBe(false);
  });
});
