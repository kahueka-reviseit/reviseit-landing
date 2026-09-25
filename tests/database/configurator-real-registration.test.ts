// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {describe,beforeAll,afterAll,it,expect} from 'vitest';
// Private CFG01A check. The registration payloads come from the private adapter and never
// enter this repository; without both environment variables this suite is skipped. It
// registers real forms, workflows and classifications in a throwaway in-memory database.
const current=process.env.CONFIGURATOR_BOUND_REGISTRATIONS||'',old=process.env.CONFIGURATOR_OLD_BOUND_REGISTRATIONS||'';
describe.skipIf(!current||!old)('real bound registration (private, disposable in-memory database)',()=>{
 let db:PGlite;
 const regs=current?JSON.parse(readFileSync(current,'utf8')):{};const olds=old?JSON.parse(readFileSync(old,'utf8')):{};
 async function publisher(sql:string,args:unknown[]){await db.exec('set role reviseit_catalogue_publisher');try{return await db.query<any>(sql,args);}finally{await db.exec('reset role');}}
 async function prepare(set:any[]){
  for(const c of set){
   await db.query('insert into public.curriculum_modules(id,name,current_release) values($1,$1,$2) on conflict(id) do nothing',[c.module,c.release]);
   await db.query("insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values($1,$2,$3,$3,'x','',$4,$5) on conflict do nothing",[c.module,c.release,c.entryId,c.catalogueMarks.min,c.catalogueMarks.max]);
  }
  for(const c of set) await db.query("insert into private.catalogue_published_releases(module_id,release,payload) values($1,$2,jsonb_build_object('contentDigest',$3::text)) on conflict do nothing",[c.module,c.release,c.catalogueContentDigest]);
  for(const c of set){
   const r=c.registration;
   await publisher('select public.register_catalogue_authored_form($1)',[JSON.stringify(r)]);
   await publisher('select public.register_catalogue_execution($1,$2,$3,$4)',[c.module,c.release,r.manifestSha256,c.binding?.workflowManifestSha256??c.workflowManifestSha256]);
  }
  for(const p of regs.profiles) await publisher('select public.register_curriculum_requirements($1,$2,$3)',[p.ref,p.sha256,JSON.stringify(p.profile)]);
 }
 const register=(c:any,binding:any)=>publisher('select public.register_catalogue_classification_bound($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [c.module,c.release,c.entryId,c.sha256,JSON.stringify(c.envelope),c.requirementsSha256,JSON.stringify(binding),JSON.stringify(c.bundleSources),c.catalogueContentDigest]);
 const bindingOf=(r:any,w:string)=>({schema:'reviseit/cfg-source-binding@1',moduleId:r.module,release:r.release,entryId:r.entryId,privateManifestSha256:r.manifestSha256,privateBundleDigest:r.bundleDigest,formRevision:r.formRevision,workflowManifestSha256:w,sources:r.sources});
 beforeAll(async()=>{
  db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
  for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 },60000);
 afterAll(async()=>{await db?.close();});
 it('registers every coherent candidate classification with its exact source binding',async()=>{
  expect(regs.classifications.length).toBe(64);
  await prepare(regs.classifications);
  for(const c of regs.classifications) await register(c,c.binding);
  const rows=(await db.query<any>('select count(*)::int n,count(distinct module_id)::int m from private.catalogue_classifications where source_binding is not null')).rows[0];
  expect(rows).toEqual({n:64,m:2});
 },120000);
 it('refuses every old pairing whose classification describes other source bytes',async()=>{
  const refused=olds.refusedForDatabaseCheck??[];expect(refused.length).toBe(29);
  await prepare(refused);
  const outcomes:string[]=[];
  for(const c of refused){
   await db.exec('begin;set local role reviseit_catalogue_publisher');
   try{await db.query('select public.register_catalogue_classification_bound($1,$2,$3,$4,$5,$6,$7,$8,$9)',[c.module,c.release,c.entryId,c.sha256,JSON.stringify(c.envelope),c.requirementsSha256,
     JSON.stringify(bindingOf(c.registration,c.workflowManifestSha256)),JSON.stringify(c.bundleSources),c.catalogueContentDigest]);outcomes.push('accepted:'+c.entryId);}
   catch(e){outcomes.push((e as Error).message);}
   await db.exec('rollback');
  }
  expect(new Set(outcomes)).toEqual(new Set(['Classification source version mismatch']));
 },120000);
});
