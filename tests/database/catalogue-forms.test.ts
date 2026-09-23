// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,test,expect} from 'vitest';
let db:PGlite;
const teacher='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',school='00000000-0000-4000-8000-000000000010',order='00000000-0000-4000-8000-000000000100';
const hash=(s:string)=>s.repeat(64);
const field=(id:string)=>({id,label:'Synthetic '+id,hint:'',required:true,allowAutomatic:false,type:'text',maxLength:100});
const registration=(id='structured:SPEC_01',manifest=hash('c'))=>({module:'synthetic-module',release:'1',entryId:id,kind:id.startsWith('mcq:')?'multiple-choice':'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:manifest,sharedFormsSha256:hash('d'),fields:id.startsWith('mcq:')?[]:[field('setting')],shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},sources:[{role:id.startsWith('mcq:')?'task-type':'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:id.startsWith('mcq:')});
async function register(p=registration()){await db.exec('reset role;set role reviseit_catalogue_publisher');await db.query('select public.register_catalogue_authored_form($1)',[JSON.stringify(p)]);await db.exec('reset role');}
async function enable(id:string){await db.exec('set role reviseit_catalogue_publisher');await db.query('select public.set_catalogue_form_binding($1,$2,$3,$4,$5,$6,true)',['synthetic-module','1',id,hash('a'),hash('b'),hash('d')]);await db.exec('reset role');}
async function asUser(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function select(){await asUser(teacher);await db.query('select public.save_paper_selection($1,$2,0,$3)',['synthetic-module','1',['structured:SPEC_01','mcq:MCQ_01']]);await db.exec('reset role');}
async function provision(){return db.query('select public.provision_catalogue_internal_order($1,$2,$3,1,$4,$5,$6)',[order,teacher,'synthetic-module',JSON.stringify({'structured:SPEC_01':8,'mcq:MCQ_01':2}),JSON.stringify({'structured:SPEC_01':hash('c'),'mcq:MCQ_01':hash('c')}),'synthetic-unclaimed-worker']);}
async function execution(){await db.exec('set role reviseit_catalogue_publisher');await db.query('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('8')]);await db.exec('reset role');}
async function ready(){await register();await register(registration('mcq:MCQ_01'));await execution();await enable('structured:SPEC_01');await enable('mcq:MCQ_01');await select();await db.exec('set role service_role');await provision();await db.exec('reset role');}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into public.curriculum_modules(id,name,current_release) values('synthetic-module','Synthetic','1');
 insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values
 ('synthetic-module','1','structured:SPEC_01','Synthetic structured','Synthetic','',2,10),('synthetic-module','1','mcq:MCQ_01','Synthetic MCQ','Synthetic','',2,2);`);
 for(const id of [teacher,other]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@synthetic.example']);
 await db.query("insert into public.schools(id,slug,name) values($1,'synthetic','Synthetic school')",[school]);
 await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[school]);
 await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[school]);
 await db.query("update public.teacher_accounts set status='approved',school_id=$1,department_id=$1,reviewed_by=$2,reviewed_at=now() where user_id in ($2,$3)",[school,teacher,other]);
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});
test('registration remains private, preserves an explicit empty form and cannot enable by itself',async()=>{
 await register(registration('mcq:MCQ_01'));
 expect((await db.query('select orderable from public.catalogue_ordering_readiness')).rows).toEqual([{orderable:false}]);
 await asUser(teacher);await db.exec('savepoint denied');await expect(db.query('select payload from private.catalogue_authored_forms')).rejects.toThrow(/permission denied/);await db.exec('rollback to savepoint denied');
 await expect(db.query('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration())])).rejects.toThrow(/permission denied/);
});
test('digest-only binding cannot enable selection',async()=>{await expect(enable('structured:SPEC_01')).rejects.toThrow(/Registered private form required/);});
test('current binding and selection are consumed into the entitled mixed order',async()=>{
 await ready();const o=(await db.query<any>('select form,snapshot,entitlement from private.paper_orders where id=$1',[order])).rows[0];
 expect(o.entitlement).toBe('internal_test');expect(o.form.items[1].fields).toEqual([]);expect(o.form.paperFields.map((f:any)=>f.id)).toEqual(['logistics','block']);
 expect(o.snapshot.lines[1].binding.sources[0].role).toBe('task-type');
 expect(o.snapshot.execution.workflowManifestSha256).toBe(hash('8'));expect(o.snapshot.formatting.schoolId).toBe(school);
 await asUser(teacher);const visible=(await db.query<any>('select public.teacher_orders($1) as orders',[order])).rows[0].orders[0];
 expect(visible.form).toEqual(o.form);expect(JSON.stringify(visible)).not.toMatch(/manifestSha256|sourceDependencies|bundleDigest|snapshot/);
 await expect(provision()).rejects.toThrow(/permission denied/);
});
test('execution registration is required for new orders and remains private and immutable',async()=>{
 await register();await register(registration('mcq:MCQ_01'));await enable('structured:SPEC_01');await enable('mcq:MCQ_01');await select();
 await db.exec('savepoint missing');await expect(provision()).rejects.toThrow(/Connected workflow/);await db.exec('rollback to savepoint missing');
 await execution();await db.exec('set role reviseit_catalogue_publisher');
 await expect(db.query('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('7')])).rejects.toThrow(/immutable/);
});
test('a first claim of a worker-fenced order is not a resumed job',async()=>{
 await ready();await db.query("update private.paper_orders set state='queued' where id=$1",[order]);await db.exec('set role service_role');
 const first=(await db.query<any>("select public.claim_paper_job('synthetic-unclaimed-worker') as job")).rows[0].job;
 expect(first.resumed).toBe(false);expect(first.snapshot.execution.workflowManifestSha256).toBe(hash('8'));
 await db.exec('reset role');await db.query("update private.paper_orders set lease_until=now()-interval '1 minute' where id=$1",[order]);await db.exec('set role service_role');
 expect((await db.query<any>("select public.claim_paper_job('synthetic-unclaimed-worker') as job")).rows[0].job.resumed).toBe(true);
});
test('later registration cannot alter issued inputs or unfreeze the old order',async()=>{
 await ready();const original=(await db.query<any>('select form,snapshot from private.paper_orders where id=$1',[order])).rows[0];
 await register({...registration('structured:SPEC_01',hash('9')),fields:[{...field('setting'),label:'Updated wording'}]});
 expect((await db.query<any>('select form,snapshot from private.paper_orders where id=$1',[order])).rows[0]).toEqual(original);
 await expect(db.query("update private.paper_orders set snapshot='{}' where id=$1",[order])).rejects.toThrow(/immutable/);
});
test('same-school unrelated teacher and pending owner cannot read the entitled form',async()=>{
 await ready();await asUser(other);expect((await db.query<any>('select public.teacher_orders($1) as orders',[order])).rows[0].orders).toEqual([]);
 await db.exec('reset role');await db.query("update public.teacher_accounts set status='pending' where user_id=$1",[teacher]);await asUser(teacher);
 expect((await db.query<any>('select public.teacher_orders($1) as orders',[order])).rows[0].orders).toEqual([]);
});
test('a form update after selection prevents issuing an order with the old requested manifest',async()=>{
 await register();await register(registration('mcq:MCQ_01'));await enable('structured:SPEC_01');await enable('mcq:MCQ_01');await select();
 await register(registration('structured:SPEC_01',hash('9')));await db.exec('set role service_role');await expect(provision()).rejects.toThrow(/changed or execution unavailable/);
});
