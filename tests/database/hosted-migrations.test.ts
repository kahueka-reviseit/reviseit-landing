// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
import {prepare} from '../../scripts/prepare-hosted-migrations.mjs';
async function baseline(){
 const db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
 insert into supabase_migrations.schema_migrations values('202609120001','teacher_accounts',null);`);
 await db.exec(readFileSync('supabase/migrations/202609120001_teacher_accounts.sql','utf8'));
 await db.exec("insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-4000-8000-000000000001','synthetic@example.invalid',now())");
 return db;
}
test('prepared upgrade preserves the original account and history and records seven exact migrations',async()=>{
 const db=await baseline();try{
  const before=(await db.query('select * from public.teacher_accounts')).rows;
  const {sql}=prepare();await db.exec(sql);
  expect((await db.query('select * from public.teacher_accounts')).rows).toEqual(before);
  expect((await db.query("select statements from supabase_migrations.schema_migrations where version='202609120001'")).rows).toEqual([{statements:null}]);
  expect((await db.query('select * from supabase_migrations.schema_migrations')).rows).toHaveLength(8);
  expect((await db.query("select to_regclass('private.paper_orders') as table_name")).rows[0]).toEqual({table_name:'private.paper_orders'});
  await expect(db.exec(sql)).rejects.toThrow(/baseline changed/);await db.exec('rollback');
 }finally{await db.close();}
},30000);
test('unexpected migration history is refused before schema changes',async()=>{
 const db=await baseline();try{
  await db.exec("insert into supabase_migrations.schema_migrations(version) values('unexpected')");
  await expect(db.exec(prepare().sql)).rejects.toThrow(/baseline changed/);await db.exec('rollback');
  expect((await db.query("select to_regclass('public.curriculum_modules') as t")).rows).toEqual([{t:null}]);
 }finally{await db.close();}
});
test('an error near the end rolls back all seven schema and history changes',async()=>{
 const db=await baseline();try{
  const sql=prepare().sql.replace(/commit;\s*$/,"select missing_function_for_rollback_test();\ncommit;");
  await expect(db.exec(sql)).rejects.toThrow(/missing_function/);await db.exec('rollback');
  expect((await db.query('select * from supabase_migrations.schema_migrations')).rows).toHaveLength(1);
  expect((await db.query("select to_regclass('private.paper_orders') as t,to_regclass('public.curriculum_modules') as m")).rows).toEqual([{t:null,m:null}]);
  expect((await db.query('select * from public.teacher_accounts')).rows).toHaveLength(1);
 }finally{await db.close();}
});
