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
  await db.exec(readFileSync('supabase/migrations/202610010031_department_roles.sql','utf8'));
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


async function denied(sql:string, params:unknown[], pattern:RegExp){
 await db.exec('savepoint denied');
 await expect(db.query(sql,params)).rejects.toThrow(pattern);
 await db.exec('rollback to savepoint denied');
}
async function appoint(){
 await approve(); await db.exec('reset role');
 await db.query('insert into private.credit_administrators values($1)',[reviewer]);
 await asUser(reviewer);
 await db.query("select public.set_department_role($1,2,'head','Founder appointed department head')",[teacher]);
}
test('ordinary reviewer is not a credit administrator',async()=>{
 await approve();
 await expect(db.query("select public.set_department_role($1,2,'head','An appointment')",[teacher])).rejects.toThrow(/Credit administrator/);
});
test('head appointment is audited and scoped to verified department',async()=>{
 await appoint(); await asUser(teacher);
 expect((await db.query('select public.is_department_head($1) as head',[department])).rows).toEqual([{head:true}]);
 expect((await db.query('select public.is_department_head($1) as head',[school])).rows).toEqual([{head:false}]);
 await db.exec('reset role');
 expect((await db.query("select previous_role,new_role,reason from private.department_membership_events")).rows)
 .toEqual([{previous_role:'teacher',new_role:'head',reason:'Founder appointed department head'}]);
});
test('teachers cannot appoint themselves, edit roles or read the private authority table',async()=>{
 await appoint();await asUser(teacher);
 await denied("select public.set_department_role($1,3,'head','Self appointment')",[teacher],/Credit administrator/);
 await denied("update public.teacher_accounts set department_role='head'",[],/permission denied/);
 await expect(db.query('select * from private.credit_administrators')).rejects.toThrow(/permission denied/);
});
test('email change revokes head authority permanently until appointed again',async()=>{
 await appoint();await db.exec('reset role');
 await db.query("update auth.users set email='changed@school.example' where id=$1",[teacher]);
 await asUser(teacher);
 expect((await db.query('select public.is_department_head($1) as head',[department])).rows).toEqual([{head:false}]);
 expect((await db.query('select department_role from public.teacher_accounts where user_id=$1',[teacher])).rows).toEqual([{department_role:'teacher'}]);
});
test('suspension clears head authority without altering another account',async()=>{
 await appoint(); await asUser(reviewer);
 await db.query("select public.review_teacher_account($1,3,'suspended',null,'Account suspended for review')",[teacher]);
 await asUser(teacher);
 expect((await db.query('select public.is_department_head($1) as head',[department])).rows).toEqual([{head:false}]);
});
test('stale appointment refuses before updating role',async()=>{
 await appoint();await asUser(reviewer);
 await expect(db.query("select public.set_department_role($1,2,'teacher','Stale change')",[teacher])).rejects.toThrow(/Account changed/);
});
test('head can pause a colleague, not another head or a foreign department',async()=>{
 await appoint();await approve(other); await asUser(teacher);
 await db.query("select public.set_department_member_spending($1,2,false,'Department spending paused')",[other]);
 const members=(await db.query<{members:any[]}>('select public.department_members($1) as members',[department])).rows[0].members;
 expect(members.find(m=>m.userId===other).canSpend).toBe(false);
 await denied("select public.set_department_member_spending($1,3,false,'Pause self')",[teacher],/Department head/);
 await asUser(other);
 await expect(db.query('select public.department_members($1)',[department])).rejects.toThrow(/Department head/);
});
test('signup supplied role has no authority and an unconfirmed account cannot be appointed',async()=>{
 await approve(); await db.exec('reset role');
 await db.query('insert into private.credit_administrators values($1)',[reviewer]);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[teacher]);
 await asUser(reviewer);
 await expect(db.query("select public.set_department_role($1,2,'head','Confirmed role requested')",[teacher])).rejects.toThrow(/Verified department/);
});
