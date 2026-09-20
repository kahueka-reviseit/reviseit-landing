// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll,beforeEach,afterEach,afterAll,test,expect } from 'vitest';
let db:PGlite;
const teacher='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',reviewer='00000000-0000-4000-8000-000000000004';
const school='00000000-0000-4000-8000-000000000010',second='00000000-0000-4000-8000-000000000020';
const order='00000000-0000-4000-8000-000000000100',key='00000000-0000-4000-8000-000000000101';
const form=[{id:'axes',label:'Choose graph axes',options:['V vertically','I vertically']}];
const answers={axes:'V vertically'};
async function asUser(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function worker(){await db.exec('reset role;set role service_role');}
async function submit(k=key,a:unknown=answers){return db.query('select public.submit_paper_answers($1,$2,$3)',[order,k,JSON.stringify(a)]);}
async function claim(w='test-worker'){await worker();return (await db.query<{job:any}>('select public.claim_paper_job($1) as job',[w])).rows[0].job;}
async function checkpoint(token:string,stage:string,artifact:string|null=null){return db.query('select public.checkpoint_paper_job($1,$2,$3,$4)',[order,token,stage,artifact]);}
async function listing(){return (await db.query<{orders:any[]}>('select public.teacher_orders($1) as orders',[order])).rows[0].orders;}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of ['202609120001_teacher_accounts','202609120002_teacher_workspace','202609190008_teacher_jobs','202609200009_grouped_questionnaires','202609200010_order_generation_plan','202609200011_answer_compatibility','202609200012_semantic_shadow','202609200013_skill_acceptance']) await db.exec(readFileSync('supabase/migrations/'+f+'.sql','utf8'));
 await db.exec("insert into public.curriculum_modules(id,name,current_release,is_demo) values('test-module','Test module','test-1',true)");
 for(const id of [teacher,other,reviewer]) await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id,`${id}@synthetic.example`]);
 for(const [id,name] of [[school,'First'],[second,'Second']]){
  await db.query('insert into public.schools(id,slug,name) values($1,$2,$3)',[id,name.toLowerCase(),name]);
  await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[id]);
  await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'test-module')",[id]);
 }
 for(const [id,s] of [[teacher,school],[other,second]]) await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$3,reviewed_at=now() where user_id=$1",[id,s,reviewer]);
 await db.query('insert into private.paper_reviewers values($1)',[reviewer]);
 await db.query("insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot) values($1,$2,$3,'test-module','test-1','Internal example','internal_test','test-adapter',$4,'{}')",[order,teacher,school,JSON.stringify(form)]);
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});

test('worker delivers all four documents without a content reviewer',async()=>{
 await asUser(teacher);await submit();const job=await claim();await checkpoint(job.lease,'rendering');
 const documents=Object.fromEntries(['paper','memo','learner-memo','teacher-description'].map(n=>[n,Buffer.from('PK\x03\x04synthetic-'+n).toString('base64')]));
 await db.query('select public.complete_paper_job($1,$2,$3)',[order,job.lease,JSON.stringify(documents)]);
 await asUser(teacher);expect((await listing())[0].state).toBe('released');expect((await listing())[0].documents).toHaveLength(4);
 expect((await db.query('select public.paper_document($1,$2,false)',[order,'memo'])).rows).toHaveLength(1);
 await asUser(other);await expect(db.query('select public.paper_document($1,$2,false)',[order,'memo'])).rejects.toThrow(/access required/);
});
test('retired memo checkpoint cannot suspend the new flow',async()=>{
 await asUser(teacher);await submit();const job=await claim();await expect(checkpoint(job.lease,'awaiting_memo_review','{}')).rejects.toThrow(/content approval/);
});
test('a partial pack still cannot be delivered',async()=>{
 await asUser(teacher);await submit();const job=await claim();await checkpoint(job.lease,'rendering');
 await expect(db.query('select public.complete_paper_job($1,$2,$3)',[order,job.lease,'{}'])).rejects.toThrow(/Four documents/);
});
test('teachers still cannot impersonate a worker',async()=>{
 await asUser(teacher);await expect(db.query('select public.complete_paper_job($1,$2,$3)',[order,key,'{}'])).rejects.toThrow(/permission denied/);
});
test('retired reviewer action cannot release historical content',async()=>{
 await asUser(reviewer);await expect(db.query("select public.review_paper_job($1,'release',$2,true,'Old reviewer action')",[order,'a'.repeat(64)])).rejects.toThrow(/retired/);
});
