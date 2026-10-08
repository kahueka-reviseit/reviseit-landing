// @vitest-environment node
// Schema rollback and forward recovery for the Studio migration, plus proof that the existing funded
// order and teacher generation queue contracts are unchanged by it. Synthetic data only.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { test, expect } from 'vitest';

const STUDIO = '202610080039_studio_foundation.sql';
const migrations = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
async function database(files: string[]) {
  const db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
  for (const f of files) await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
  return db;
}
// Every non-Studio object definition, privilege and policy: the existing contract surface.
async function surface(db: PGlite) {
  const q = async (sql: string) => (await db.query<{ x: string }>(sql)).rows.map(r => r.x);
  return {
    functions: await q(`select p.oid::regprocedure::text||' '||md5(pg_get_functiondef(p.oid))||' '||coalesce(array_to_string(p.proacl,','),'') x from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname not like 'studio\\_%' and p.prokind='f' order by 1`),
    tables: await q(`select c.oid::regclass::text||' '||coalesce(array_to_string(c.relacl,','),'')||' '||c.relrowsecurity x from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind='r' and c.relname not like 'studio\\_%' order by 1`),
    columns: await q(`select table_schema||'.'||table_name||'.'||column_name||' '||data_type||' '||coalesce(column_default,'') x from information_schema.columns
      where table_schema in ('public','private') and table_name not like 'studio\\_%' order by 1`),
    policies: await q(`select schemaname||'.'||tablename||'.'||policyname||' '||coalesce(qual,'')||' '||coalesce(with_check,'') x from pg_policies where tablename not like 'studio\\_%' order by 1`),
    triggers: await q(`select tgrelid::regclass::text||'.'||tgname x from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'private.studio\\_%' order by 1`),
  };
}

test('the Studio migration is additive: every existing function, table, column, policy and privilege is byte-identical', async () => {
  const before = await database(migrations.filter(f => f !== STUDIO)), after = await database(migrations);
  expect(await surface(after)).toEqual(await surface(before));
  await before.close(); await after.close();
}, 120000);

test('rollback removes only Studio objects, and the migration applies forward again cleanly', async () => {
  const db = await database(migrations), original = await surface(db);
  await db.exec(readFileSync('lib/studio/rollback/202610080039_studio_foundation.down.sql', 'utf8'));
  expect((await db.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname like 'studio\\_%'`)).rows).toEqual([]);
  expect((await db.query(`select 1 from pg_proc where proname like 'studio\\_%'`)).rows).toEqual([]);
  expect((await db.query(`select 1 from pg_roles where rolname='reviseit_studio_operator'`)).rows).toEqual([]);
  expect(await surface(db)).toEqual(original);
  await db.exec(readFileSync('supabase/migrations/' + STUDIO, 'utf8'));
  expect((await db.query(`select count(*)::int n from pg_proc where proname like 'studio\\_%'`)).rows[0]).toMatchObject({ n: expect.any(Number) });
  expect(await surface(db)).toEqual(original);
  await db.close();
}, 120000);

test('an existing funded order and the teacher generation queue behave identically with Studio work queued', async () => {
  const db = await database(migrations);
  const teacher = '00000000-0000-4000-8000-000000000002', school = '00000000-0000-4000-8000-000000000010', order = '00000000-0000-4000-8000-000000000100';
  await db.exec("insert into public.curriculum_modules(id,name,current_release,is_demo) values('test-module','Test module','test-1',true)");
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [teacher, teacher + '@synthetic.example']);
  await db.query("insert into public.schools(id,slug,name) values($1,'first','First')", [school]);
  await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')", [school]);
  await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'test-module')", [school]);
  await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$1,reviewed_at=now() where user_id=$1", [teacher, school]);
  const form = [{ id: 'axes', label: 'Choose graph axes', options: ['V vertically', 'I vertically'] }];
  await db.query("insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot) values($1,$2,$3,'test-module','test-1','Internal example','internal_test','test-adapter',$4,'{}')", [order, teacher, school, JSON.stringify(form)]);
  // Revision-checked teacher submit freezes the answers and queues generation, as before.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [teacher]); await db.exec('set role authenticated');
  await db.query('select public.submit_paper_answers($1,$2,$3)', [order, '00000000-0000-4000-8000-000000000101', JSON.stringify({ axes: 'V vertically' })]);
  await db.exec('reset role');
  // Studio work in its own queue, enrolled on the same module.
  await db.exec("set role reviseit_studio_operator; select public.studio_enrol_module('test-module','caps-physical-sciences@1'); reset role;");
  await db.exec("update private.studio_settings set max_running=0");
  await db.exec('set role service_role');
  expect((await db.query<{ r: any }>("select public.studio_claim('studio-worker') r")).rows[0].r).toBeNull();
  const job = (await db.query<{ j: any }>("select public.claim_paper_job('paid-worker') j")).rows[0].j;
  expect(job).toMatchObject({ id: order, adapterKey: 'test-adapter', internalTest: true, answers: { axes: 'V vertically' } });
  await expect(db.query("select public.studio_heartbeat($1,$2)", [order, job.lease])).rejects.toThrow(/Studio lease lost/);
  await db.exec('reset role');
  expect((await db.query<{ e: string }>("select event e from private.paper_job_events where order_id=$1 order by id", [order])).rows.map(r => r.e)).toEqual(['submitted', 'claimed']);
  await db.close();
}, 120000);
