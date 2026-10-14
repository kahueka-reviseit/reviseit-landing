// In-memory rehearsal only. No database connection, provider or publication endpoint.
// node scripts/studio-release-rehearsal.mjs package module output.json
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const [root,moduleId,output]=process.argv.slice(2),app=fileURLToPath(new URL('..',import.meta.url));
if(!root||!moduleId||!output)throw new Error('Package, module and output required');
const publication=JSON.parse(readFileSync(join(root,'export/public',moduleId,'publication-input.json'),'utf8'));
const rows=JSON.parse(readFileSync(join(root,'registrations/verified-bindings.json'),'utf8')).classifications;
if(publication.module.id!==moduleId||rows.some(r=>r.module!==moduleId||r.release!==publication.release))throw new Error('Package identity mismatch');
const db=new PGlite();
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 const migrations=readdirSync(join(app,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const path of migrations)await db.exec(readFileSync(join(app,'supabase/migrations',path),'utf8'));
 const previous=(await db.query('select current_release from public.curriculum_modules where id=$1',[moduleId])).rows[0]?.current_release??null;
 async function publisher(sql,args){await db.exec('set role reviseit_catalogue_publisher');try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
 await publisher('select public.publish_catalogue_release($1::jsonb,$2)',[JSON.stringify(publication),previous]);
 async function register(){
  for(const r of rows)await publisher('select public.register_catalogue_authored_form($1::jsonb)',[JSON.stringify(r.registration)]);
  if(rows.length){const b=rows[0].binding;await publisher('select public.register_catalogue_execution($1,$2,$3,$4)',[moduleId,publication.release,b.privateManifestSha256,b.workflowManifestSha256]);}
  for(const r of rows)await publisher('select public.register_bloom_classification($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)',[r.module,r.release,r.entryId,r.sha256,JSON.stringify(r.envelope),JSON.stringify(r.binding),JSON.stringify(r.bundleSources),r.catalogueContentDigest]);
  await db.query('select public.sync_supported_catalogue_readiness($1)',[moduleId]);
 }
 await register();
 const state=async()=>JSON.stringify((await db.query(`select (select jsonb_agg(to_jsonb(f) order by entry_id,manifest_sha256) from private.catalogue_authored_forms f where module_id=$1) forms,(select jsonb_agg(to_jsonb(c) order by entry_id,sha256) from private.catalogue_classifications c where module_id=$1) classifications`,[moduleId])).rows);
 const before=await state();await register();if(await state()!==before)throw new Error('Repeat registration changed immutable records');
 let tamperedRejected=0;
 if(rows.length)for(const mutate of [r=>{r.bundleSources[0].sha256='0'.repeat(64);},r=>{r.envelope.release='wrong-release';}]){
  const r=structuredClone(rows[0]);mutate(r);await db.exec('begin');let rejected=false;
  try{await db.exec('set role reviseit_catalogue_publisher');await db.query('select public.register_bloom_classification($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)',[r.module,r.release,r.entryId,r.sha256,JSON.stringify(r.envelope),JSON.stringify(r.binding),JSON.stringify(r.bundleSources),r.catalogueContentDigest]);}catch{rejected=true;}finally{await db.exec('rollback;reset role');}
  if(!rejected)throw new Error('Tampered classification accepted');tamperedRejected++;
 }
 const ready=(await db.query('select entry_id from public.catalogue_ordering_readiness where module_id=$1 and release=$2 and orderable order by entry_id',[moduleId,publication.release])).rows.map(r=>r.entry_id);
 const teacher='00000000-0000-4000-8000-000000000002',reviewer='00000000-0000-4000-8000-000000000004',school='00000000-0000-4000-8000-000000000010';
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'teacher@synthetic.invalid',now()),($2,'reviewer@synthetic.invalid',now())",[teacher,reviewer]);
 await db.query("insert into public.schools(id,slug,name) values($1,'studio-rehearsal','Synthetic Studio rehearsal')",[school]);await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[school]);
 await db.query('insert into public.school_curriculum_access(school_id,module_id) values($1,$2)',[school,moduleId]);await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$3,reviewed_at=now() where user_id=$1",[teacher,school,reviewer]);
 const fieldCount=Object.fromEntries(rows.map(r=>[r.entryId,r.fields.length])),batches=[];let current=[],used=0;
 for(const id of ready){if(current.length===30||used+fieldCount[id]>180){batches.push(current);current=[];used=0;}current.push(id);used+=fieldCount[id];}if(current.length)batches.push(current);
 const compiled=[];let revision=0;
 for(const selection of batches){
  const marks=Object.fromEntries((await db.query('select entry_id,marks_min from public.catalogue_summaries where module_id=$1 and release=$2 and entry_id=any($3)',[moduleId,publication.release,selection])).rows.map(r=>[r.entry_id,r.entry_id.startsWith('mcq:')?2:r.marks_min]));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await db.exec('set role authenticated');revision=(await db.query('select public.save_paper_selection($1,$2,$3,$4) revision',[moduleId,publication.release,revision,selection])).rows[0].revision;await db.exec('reset role');
  const value=(await db.query('select * from private.compile_configured_order($1,$2,$3,$4::jsonb,$5::jsonb)',[teacher,moduleId,revision,JSON.stringify(marks),JSON.stringify({paper:Object.values(marks).reduce((a,b)=>a+b,0)})])).rows[0];
  if(value.snapshot.lines.length!==selection.length||value.form.items.length!==selection.length)throw new Error('Compiled order is incomplete');compiled.push({entries:selection,form:value.form,snapshot:value.snapshot});
 }
 const all=publication.entries.map(e=>e.id);writeFileSync(output,JSON.stringify({schema:'reviseit/release-registration-rehearsal@1',moduleId,release:publication.release,isolated:true,migrations:migrations.length,lastMigration:migrations.at(-1),registered:rows.length,orderable:ready,unavailable:all.filter(id=>!ready.includes(id)),idempotent:true,tamperedRejected,compiledOrders:compiled.length,compiledLines:compiled.reduce((n,c)=>n+c.entries.length,0),compiled},null,2)+'\n');
 console.log(JSON.stringify({registered:rows.length,orderable:ready.length,compiledOrders:compiled.length,tamperedRejected}));
}finally{await db.close();}
