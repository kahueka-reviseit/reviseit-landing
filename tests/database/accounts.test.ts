// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, afterAll, expect, test } from 'vitest';
let db: PGlite;
const reviewer = '00000000-0000-4000-8000-000000000001';
const teacher = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const school = '00000000-0000-4000-8000-000000000010';
const department = '00000000-0000-4000-8000-000000000011';
async function asUser(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
}
async function approve(id = teacher, revision = 1) {
  await asUser(reviewer);
  return db.query("select public.review_teacher_account($1,$2,'approved',$3,'Verified independently with synthetic school')", [id, revision, department]);
}
async function approvedSchool() { return (await db.query<{id: string | null}>('select public.approved_school_id() as id')).rows[0].id; }
beforeAll(async () => {
  db = new PGlite();
  // Emulate only Supabase's auth tables/identity function. All application SQL below is the real migration.
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
  await db.exec(readFileSync('supabase/migrations/202609120001_teacher_accounts.sql', 'utf8'));
  for (const [id, email] of [[reviewer,'reviewer@reviseit.example'],[teacher,'teacher@synthetic-school.example'],[other,'other@second-school.example']]) {
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),$3)", [id,email,JSON.stringify({full_name:'Synthetic Teacher',school:'Synthetic School',department:'Physical Sciences',status:'approved',role:'admin'})]);
  }
  await db.query('insert into private.account_reviewers values($1)',[reviewer]);
  await db.query("insert into public.schools(id,slug,name) values($1,'synthetic-school','Synthetic School')",[school]);
  await db.query("insert into public.departments(id,school_id,name) values($1,$2,'Physical Sciences')",[department,school]);
}, 30000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback; reset role'); });
afterAll(async () => { await db.close(); });

test('signup metadata cannot grant approval or reviewer privileges', async () => {
  await asUser(teacher);
  expect((await db.query<{status:string}>('select status from public.teacher_accounts')).rows).toEqual([{status:'pending'}]);
  expect((await db.query<{value:boolean}>('select public.is_account_reviewer() as value')).rows[0].value).toBe(false);
  expect(await approvedSchool()).toBeNull();
});
test('anonymous visitors cannot read school accounts', async () => {
  await db.exec('set role anon');
  await expect(db.query('select * from public.teacher_accounts')).rejects.toThrow(/permission denied/);
});
test('teachers cannot read another account or unapproved school records', async () => {
  await asUser(teacher);
  expect((await db.query('select * from public.teacher_accounts where user_id=$1',[other])).rows).toHaveLength(0);
  expect((await db.query('select * from public.schools')).rows).toHaveLength(0);
});
test('teachers cannot write their own approval directly', async () => {
  await asUser(teacher);
  await expect(db.query("update public.teacher_accounts set status='approved' where user_id=$1",[teacher])).rejects.toThrow(/permission denied/);
});
test('teachers cannot give themselves reviewer rights', async () => {
  await asUser(teacher);
  await expect(db.query('insert into private.account_reviewers values($1)',[teacher])).rejects.toThrow(/permission denied/);
});
test('calling the approval procedure directly still requires reviewer authority', async () => {
  await asUser(teacher);
  await expect(db.query("select public.review_teacher_account($1,1,'approved',$2,'Forged review')",[teacher,department])).rejects.toThrow(/Reviewer access required/);
});
test('even reviewers need a second person to approve their own account', async () => {
  await expect(approve(reviewer)).rejects.toThrow(/second reviewer/);
});
test('mailbox confirmation is required independently of human approval', async () => {
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[teacher]);
  await expect(approve()).rejects.toThrow(/Confirm the school email first/);
});
test('approval records evidence and unlocks only the verified school', async () => {
  await approve();
  const history = await db.query<{reviewer_id:string;decision:string;created_at:Date}>('select reviewer_id,decision,created_at from public.account_reviews');
  expect(history.rows[0].reviewer_id).toBe(reviewer);
  expect(history.rows[0].decision).toBe('approved');
  expect(history.rows[0].created_at).toBeTruthy();
  await asUser(teacher);
  expect(await approvedSchool()).toBe(school);
  expect((await db.query('select * from public.schools')).rows).toHaveLength(1);
  await asUser(other);
  expect(await approvedSchool()).toBeNull();
});
test('an old review cannot approve school details edited in the meantime', async () => {
  await asUser(teacher);
  await db.query("select public.submit_school_details('Synthetic Teacher','Changed School','Mathematics')");
  await expect(approve()).rejects.toThrow(/Account changed/);
});
test('an approved teacher changing school details immediately returns to pending', async () => {
  await approve();
  await asUser(teacher);
  await db.query("select public.submit_school_details('Synthetic Teacher','Changed School','Mathematics')");
  expect(await approvedSchool()).toBeNull();
});
test('changing the authenticated email revokes approval even with an existing session', async () => {
  await approve();
  await db.exec('reset role');
  await db.query("update auth.users set email='new@new-school.example' where id=$1",[teacher]);
  await asUser(teacher);
  expect(await approvedSchool()).toBeNull();
});
test('suspension revokes access and the teacher cannot reset it by editing details', async () => {
  await approve();
  await db.query("select public.review_teacher_account($1,2,'suspended',null,'School affiliation under review')",[teacher]);
  await asUser(teacher);
  expect(await approvedSchool()).toBeNull();
  await expect(db.query("select public.submit_school_details('Synthetic Teacher','New School','Maths')")).rejects.toThrow(/cannot be changed/);
});
test('email changes cannot clear a suspension', async () => {
  await asUser(reviewer);
  await db.query("select public.review_teacher_account($1,1,'suspended',null,'School affiliation under review')",[teacher]);
  await db.exec('reset role');
  await db.query("update auth.users set email='new@new-school.example' where id=$1",[teacher]);
  await asUser(teacher);
  expect((await db.query<{status:string}>('select status from public.teacher_accounts')).rows[0].status).toBe('suspended');
});
test('reviewer authority is checked from the database on every decision', async () => {
  await db.query('delete from private.account_reviewers where user_id=$1',[reviewer]);
  await expect(approve()).rejects.toThrow(/Reviewer access required/);
});
test('teachers cannot create school departments through the reviewer procedure', async () => {
  await asUser(teacher);
  await expect(db.query("select public.register_school_department('forged-school','Forged School','Science')")).rejects.toThrow(/Reviewer access required/);
});
test('reviewers can register a school department without duplicating it', async () => {
  await asUser(reviewer);
  const q = "select public.register_school_department('new-synthetic-school','New Synthetic School','Science') as id";
  const first = (await db.query<{id:string}>(q)).rows[0].id;
  expect((await db.query<{id:string}>(q)).rows[0].id).toBe(first);
});

test('a caller cannot omit the expected revision to bypass stale-review protection', async () => {
  await asUser(reviewer);
  await expect(db.query("select public.review_teacher_account($1,null,'approved',$2,'Missing revision')",[teacher,department])).rejects.toThrow(/Account changed/);
});
