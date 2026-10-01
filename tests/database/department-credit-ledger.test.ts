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
  await db.exec(readFileSync('supabase/migrations/202610010032_department_credit_ledger.sql','utf8'));
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



const key=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup(){await approve();await db.exec('reset role');await db.query('insert into private.credit_administrators values($1)',[reviewer]);await asUser(reviewer);}
async function grant(amount:number,n:number,expires:string|null=null){return (await db.query<{id:string}>("select public.grant_department_credit($1,'test',$2,'staff_grant',$3,null,'Test funding',$4) as id",[department,amount,expires,key(n)])).rows[0].id;}
async function spend(amount:number,n:number){await db.exec('reset role');return (await db.query<{id:string}>("select private.spend_department_credit($1,'test',$2,$3,$4,$5,'{}') as id",[department,teacher,key(n+100),amount,key(n)])).rows[0].id;}
async function balance(){return (await db.query<{n:number}>("select private.credit_balance($1,'test')::integer as n",[department])).rows[0].n;}
async function denied(sql:string,params:unknown[],pattern:RegExp){await db.exec('savepoint denied');await expect(db.query(sql,params)).rejects.toThrow(pattern);await db.exec('rollback to savepoint denied');}
test('a grant is exactly once and its request binds amount',async()=>{
 await setup();const a=await grant(50000,1);expect(await grant(50000,1)).toBe(a);
 await denied("select public.grant_department_credit($1,'test',60000,'staff_grant',null,null,'Test funding',$2)",[department,key(1)],/Request key/);
 await db.exec('reset role');expect(await balance()).toBe(50000);
});
test('one spend splits sources and returns to exactly the original sources',async()=>{
 await setup();await grant(9000,1,'2099-01-01');await grant(100000,2);
 const id=await spend(14000,3);expect(await balance()).toBe(95000);
 const allocations=(await db.query<{amount_minor:number}>('select amount_minor::integer from private.credit_entries where operation_id=$1 order by amount_minor',[id])).rows;
 expect(allocations).toEqual([{amount_minor:-9000},{amount_minor:-5000}]);
 await asUser(reviewer);
 const sql="select public.return_department_credit($1,'Failed delivery',$2) as id";
 const ret=await db.query(sql,[id,key(4)]);expect((await db.query(sql,[id,key(4)])).rows).toEqual(ret.rows);
 await denied(sql,[id,key(5)],/already returned/);
 await db.exec('reset role');expect(await balance()).toBe(109000);
 expect((await db.query('select original_minor=remaining_minor as restored from private.credit_sources')).rows).toEqual([{restored:true},{restored:true}]);
});
test('insufficient balance fails atomically and cannot use another mode',async()=>{
 await setup();await grant(10000,1);await db.exec('reset role');
 await denied("select private.spend_department_credit($1,'test',$2,$3,10001,$4,'{}')",[department,teacher,key(103),key(3)],/Insufficient/);
 await denied("select private.spend_department_credit($1,'live',$2,$3,100,$4,'{}')",[department,teacher,key(104),key(4)],/Insufficient/);
 expect(await balance()).toBe(10000);
 expect((await db.query("select * from private.credit_operations where kind='spend'")).rows).toHaveLength(0);
});
test('ordinary teachers cannot grant, read other wallets or invoke internal spending',async()=>{
 await setup();await asUser(teacher);
 await denied("select public.grant_department_credit($1,'test',100,'staff_grant',null,null,'Self funding',$2)",[department,key(1)],/administrator/);
 await denied("select public.department_credit_summary($1,'test')",[school],/Department access/);
 await denied("select private.spend_department_credit($1,'test',$2,$3,100,$4,'{}')",[department,teacher,key(103),key(3)],/permission denied/);
});
test('expired sources remain recorded but cannot be spent or revived by return',async()=>{
 await setup();await grant(10000,1);const id=await spend(2000,2);
 await db.query("update private.credit_sources set expires_at=now()-interval '1 second'");
 expect(await balance()).toBe(0);await asUser(reviewer);
 await denied("select public.return_department_credit($1,'Delivery failed',$2)",[id,key(3)],/needs review/);
});
test('ledger history cannot be rewritten',async()=>{
 await setup();await grant(10000,1);await db.exec('reset role');
 await denied('delete from private.credit_entries',[],/immutable/);
 await denied("update private.credit_operations set amount_minor=1",[],/immutable/);
});
test('paused members cannot spend',async()=>{
 await setup();await grant(10000,1);await db.exec('reset role');
 await db.query('update public.teacher_accounts set can_spend_credits=false where user_id=$1',[teacher]);
 await denied("select private.spend_department_credit($1,'test',$2,$3,100,$4,'{}')",[department,teacher,key(103),key(3)],/spending access/);
 expect(await balance()).toBe(10000);
});
