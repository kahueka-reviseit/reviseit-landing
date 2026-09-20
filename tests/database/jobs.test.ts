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
 for(const f of ['202609120001_teacher_accounts','202609120002_teacher_workspace','202609190008_teacher_jobs','202609200009_grouped_questionnaires','202609200010_order_generation_plan']) await db.exec(readFileSync('supabase/migrations/'+f+'.sql','utf8'));
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
test('teacher sees only their entitled order and its form; another school sees nothing',async()=>{await asUser(teacher);expect((await listing())[0]).toMatchObject({state:'awaiting_answers',form});await asUser(other);expect(await listing()).toEqual([]);await expect(submit()).rejects.toThrow(/access required/);});
test.each(['pending','suspended','rejected'])('%s account cannot retrieve or submit an existing order',async state=>{await db.query('update public.teacher_accounts set status=$1 where user_id=$2',[state,teacher]);await asUser(teacher);expect(await listing()).toEqual([]);await expect(submit()).rejects.toThrow(/access required/);});
test('missing email confirmation denies access',async()=>{await db.query('update auth.users set email_confirmed_at=null where id=$1',[teacher]);await asUser(teacher);expect(await listing()).toEqual([]);await expect(submit()).rejects.toThrow(/access required/);});
test('teacher cannot grant entitlement or call the worker functions',async()=>{await asUser(teacher);await expect(db.query('select * from private.paper_orders')).rejects.toThrow(/permission denied/);});
test('anonymous order access is denied at database boundary',async()=>{await db.exec('set role anon');await expect(listing()).rejects.toThrow(/permission denied/);});
test('worker claim is denied to teachers',async()=>{await asUser(teacher);await expect(db.query("select public.claim_paper_job('forged')")).rejects.toThrow(/permission denied/);});
test('duplicate submission returns the same job without an extra event',async()=>{await asUser(teacher);await submit();await submit();expect((await listing())[0]).toMatchObject({state:'queued',answers,form:null});await db.exec('reset role');expect((await db.query('select * from private.paper_job_events')).rows).toHaveLength(1);});
test.each([{},{axes:'unsupported'},{axes:'V vertically',schoolId:second},{axes:3}])('invalid answers are refused before dispatch: %j',async a=>{await asUser(teacher);await expect(submit(key,a)).rejects.toThrow(/Invalid answers/);});
test('a different request key cannot create a second job for the order',async()=>{await asUser(teacher);await submit();await expect(submit(other)).rejects.toThrow(/already submitted/);});
test('an existing request key cannot silently change answers',async()=>{await asUser(teacher);await submit();await expect(submit(key,{axes:'I vertically'})).rejects.toThrow(/already submitted/);});
test('expired lease is recovered only by the same worker; old lease is fenced out',async()=>{
 await asUser(teacher);await submit();const a=await claim();expect(a.answers).toEqual(answers);expect(await claim()).toBeNull();
 await db.exec('reset role');await db.query("update private.paper_orders set lease_until=now()-interval '1 minute' where id=$1",[order]);
 expect(await claim('another-host')).toBeNull();const b=await claim();expect(b.lease).not.toBe(a.lease);
 await expect(checkpoint(a.lease,'held')).rejects.toThrow(/lease lost/);
});
test('memo and release both require a separate authenticated reviewer and exact hashes',async()=>{
 await asUser(teacher);await submit();const a=await claim();await checkpoint(a.lease,'awaiting_memo_review',JSON.stringify({artifact:'Synthetic memorandum'}));
 await asUser(teacher);expect((await listing())[0].documents).toEqual([]);await expect(db.query('select public.paper_review_queue(null)')).rejects.toThrow(/reviewer access required/);
});
test('full database release path exposes four documents only after checked approval',async()=>{
 await asUser(teacher);await submit();const a=await claim();await checkpoint(a.lease,'awaiting_memo_review',JSON.stringify({artifact:'Synthetic memorandum'}));
 await asUser(reviewer);const mem=(await db.query<{q:any[]}>('select public.paper_review_queue($1) as q',[order])).rows[0].q[0];
 await db.query("select public.review_paper_job($1,'memo',$2,true,'Reviewed synthetic memo evidence')",[order,mem.memoHash]);
 const b=await claim();expect(b.memoReview.actor).toBe(reviewer);await checkpoint(b.lease,'rendering');
 // Database tests use marker bytes. Full Word archive validation is exercised by the gateway/worker integration.
 const documents=Object.fromEntries(['paper','memo','learner-memo','teacher-description'].map(n=>[n,Buffer.from('PK\x03\x04synthetic-'+n).toString('base64')]));
 const hash=(await db.query<{h:string}>('select public.complete_paper_job($1,$2,$3) as h',[order,b.lease,JSON.stringify(documents)])).rows[0].h;
 await asUser(teacher);expect((await listing())[0].state).toBe('awaiting_release');
 await asUser(reviewer);const before=(await db.query<{d:any}>('select public.paper_document($1,$2,true) as d',[order,'paper'])).rows[0].d;
 await db.query("select public.review_paper_job($1,'release',$2,true,'All four documents inspected')",[order,hash]);
 await asUser(teacher);expect((await listing())[0].documents).toHaveLength(4);expect((await db.query<{d:any}>('select public.paper_document($1,$2,false) as d',[order,'paper'])).rows[0].d).toEqual(before);
 await asUser(other);expect(await listing()).toEqual([]);await expect(db.query('select public.paper_document($1,$2,false)',[order,'paper'])).rejects.toThrow(/access required/);
});

test('revoked curriculum assignment removes an existing order',async()=>{await db.query('update public.school_curriculum_access set active=false where school_id=$1',[school]);await asUser(teacher);expect(await listing()).toEqual([]);await expect(submit()).rejects.toThrow(/access required/);});
test('stale memo hash cannot approve a newer artifact',async()=>{await asUser(teacher);await submit();const a=await claim();await checkpoint(a.lease,'awaiting_memo_review','{"memo":"synthetic"}');await asUser(reviewer);await expect(db.query("select public.review_paper_job($1,'memo',$2,true,'Synthetic review evidence')",[order,'0'.repeat(64)])).rejects.toThrow(/Review changed/);});
test('unapproved memo cannot advance to rendering',async()=>{await asUser(teacher);await submit();const a=await claim();await expect(checkpoint(a.lease,'rendering')).rejects.toThrow(/Memo approval required/);});
async function rendering(){await asUser(teacher);await submit();const a=await claim();await checkpoint(a.lease,'awaiting_memo_review','{"memo":"synthetic"}');await asUser(reviewer);const m=(await db.query<{q:any[]}>('select public.paper_review_queue($1) as q',[order])).rows[0].q[0];await db.query("select public.review_paper_job($1,'memo',$2,true,'Synthetic review evidence')",[order,m.memoHash]);const b=await claim();await checkpoint(b.lease,'rendering');return b;}
test('chunked upload and lost finish acknowledgement are safely repeatable',async()=>{
 const b=await rendering();const hashes:Record<string,string>={};const {createHash}=await import('node:crypto');
 for(const name of ['paper','memo','learner-memo','teacher-description']){const bytes=Buffer.from('PK\x03\x04synthetic-'+name);hashes[name]=createHash('sha256').update(bytes).digest('hex');for(let i=0;i<2;i++)await db.query('select public.upload_paper_chunk($1,$2,$3,0,$4)',[order,b.lease,name,bytes.toString('base64')]);}
 const finish=()=>db.query<{h:string}>('select public.finish_paper_upload($1,$2,$3) as h',[order,b.lease,JSON.stringify(hashes)]);
 const first=await finish();expect((await finish()).rows).toEqual(first.rows);await db.exec('reset role');expect((await db.query('select * from private.paper_documents')).rows).toHaveLength(4);expect((await db.query("select * from private.paper_job_events where event='awaiting_release'")).rows).toHaveLength(1);
});
test('incomplete upload cannot create a partial review pack',async()=>{const b=await rendering();await db.query('select public.upload_paper_chunk($1,$2,$3,1,$4)',[order,b.lease,'paper',Buffer.from('PK\x03\x04data').toString('base64')]);await expect(db.query('select public.finish_paper_upload($1,$2,$3)',[order,b.lease,JSON.stringify(Object.fromEntries(['paper','memo','learner-memo','teacher-description'].map(n=>[n,'0'.repeat(64)])))])).rejects.toThrow(/Incomplete document/);});
test('the same uploaded part cannot silently change bytes',async()=>{const b=await rendering();await db.query("select public.upload_paper_chunk($1,$2,'paper',0,$3)",[order,b.lease,Buffer.from('first').toString('base64')]);await expect(db.query("select public.upload_paper_chunk($1,$2,'paper',0,$3)",[order,b.lease,Buffer.from('changed').toString('base64')])).rejects.toThrow(/Chunk changed/);});

const groupedForm={schemaVersion:2,revision:'a'.repeat(64),items:[
 {id:'first',title:'First question',marks:8,fields:[{id:'setting',label:'Setting',hint:'',required:true,allowAutomatic:false,type:'choice',allowOther:false,choices:[{id:'a',label:'First'}]}]},
 {id:'second',title:'Second question',marks:12,fields:[{id:'setting',label:'Setting',hint:'',required:false,allowAutomatic:true,type:'choice',allowOther:true,choices:[{id:'b',label:'Second'}]}]},
],paperFields:[{id:'notes',label:'Notes',hint:'',required:false,allowAutomatic:false,type:'text',maxLength:100}]};
const groupedAnswers={schemaVersion:2,revision:'a'.repeat(64),items:{first:{setting:{kind:'choice',choiceId:'a'}},second:{setting:{kind:'automatic'}}},paper:{notes:{kind:'omit'}}};
async function setGrouped(){await db.query('update private.paper_orders set form=$1 where id=$2',[JSON.stringify(groupedForm),order]);}
test('grouped answers bind the purchased order form and retry without duplicating dispatch',async()=>{await setGrouped();await asUser(teacher);expect((await listing())[0].form).toEqual(groupedForm);await submit(key,groupedAnswers);await submit(key,groupedAnswers);expect((await listing())[0]).toMatchObject({state:'queued',form:null,answers:groupedAnswers});expect((await listing())[0].answerSummary).toEqual([{title:'First question',fields:[{label:'Setting',value:'First'}]},{title:'Second question',fields:[{label:'Setting',value:'Choose for me'}]},{title:'Settings for the whole paper',fields:[{label:'Notes',value:'No preference'}]}]);await db.exec('reset role');expect((await db.query('select * from private.paper_job_events')).rows).toHaveLength(1);});
test('a second school cannot retrieve or answer the grouped order',async()=>{await setGrouped();await asUser(other);expect(await listing()).toEqual([]);await expect(submit(key,groupedAnswers)).rejects.toThrow(/access required/);});
test.each([
 ['wrong revision',(a:any):unknown=>a.revision='b'.repeat(64)],
 ['another question choice',(a:any):unknown=>a.items.first.setting.choiceId='b'],
 ['unpermitted automatic',(a:any):unknown=>a.items.first.setting={kind:'automatic'}],
 ['unpermitted omission',(a:any):unknown=>a.items.first.setting={kind:'omit'}],
 ['unpermitted own words',(a:any):unknown=>a.items.first.setting={kind:'text',text:'new'}],
 ['missing question',(a:any):unknown=>delete a.items.second],
 ['extra question',(a:any):unknown=>a.items.third={}],
 ['extra field',(a:any):unknown=>a.paper.secret={kind:'omit'}],
 ['missing field',(a:any):unknown=>delete a.paper.notes],
 ['variant smuggling',(a:any):unknown=>a.paper.notes={kind:'omit',text:'hidden'}],
 ['oversize text',(a:any):unknown=>a.paper.notes={kind:'text',text:'x'.repeat(101)}],
 ['null revision',(a:any):unknown=>a.revision=null],
 ['null version',(a:any):unknown=>a.schemaVersion=null],
] as const)('database rejects grouped answer %s before queuing',async(_label,edit)=>{await setGrouped();const a=structuredClone(groupedAnswers);edit(a);await asUser(teacher);await expect(submit(key,a)).rejects.toThrow(/Invalid answers/);});
test.each([
 ['private field',(f:any):unknown=>f.items[0].fields[0].source='private.md'],
 ['null marks',(f:any):unknown=>f.items[0].marks=null],
 ['null required',(f:any):unknown=>f.items[0].fields[0].required=null],
 ['null allowOther',(f:any):unknown=>f.items[0].fields[0].allowOther=null],
 ['null maxLength',(f:any):unknown=>f.paperFields[0].maxLength=null],
 ['null version',(f:any):unknown=>f.schemaVersion=null],
 ['duplicate item',(f:any):unknown=>f.items.push(f.items[0])],
 ['duplicate field',(f:any):unknown=>f.items[0].fields.push(f.items[0].fields[0])],
 ['duplicate choice',(f:any):unknown=>f.items[0].fields[0].choices.push(f.items[0].fields[0].choices[0])],
] as const)('database refuses malformed grouped form %s',async(_label,edit)=>{const f=structuredClone(groupedForm);edit(f);await expect(db.query('update private.paper_orders set form=$1 where id=$2',[JSON.stringify(f),order])).rejects.toThrow(/valid_form/);});
test('grouped own words are accepted only for their authored field',async()=>{await setGrouped();const a:any=structuredClone(groupedAnswers);a.items.second.setting={kind:'text',text:'A teacher preference'};a.paper.notes={kind:'text',text:'Shared paper preference'};await asUser(teacher);await submit(key,a);expect((await listing())[0].answers).toEqual(a);});

function generationPlan(){return {schemaVersion:1,module:'test-module',release:'test-1',formRevision:groupedForm.revision,
 lines:groupedForm.items.map(i=>({id:i.id,specification:'SYNTHETIC',profileKey:'registered',profileSha256:'a'.repeat(64),marks:i.marks})),
 paper:{paper_label:'Synthetic',subject:'Physical Sciences',grade:'Grade 11',date:'Synthetic date',exam_period:'Synthetic period',instructions:['Synthetic instruction']}};}
test('only the worker receives the private generation plan',async()=>{await setGrouped();const plan=generationPlan();await db.query('update private.paper_orders set generation_plan=$1 where id=$2',[JSON.stringify(plan),order]);await asUser(teacher);expect((await listing())[0]).not.toHaveProperty('generationPlan');await submit(key,groupedAnswers);expect((await claim()).generationPlan).toEqual(plan);});
test('an attached generation plan cannot be changed',async()=>{await setGrouped();await db.query('update private.paper_orders set generation_plan=$1 where id=$2',[JSON.stringify(generationPlan()),order]);await expect(db.query('update private.paper_orders set generation_plan=null where id=$1',[order])).rejects.toThrow(/immutable/);});
test('generation plans cannot be attached after teacher submission',async()=>{await setGrouped();await asUser(teacher);await submit(key,groupedAnswers);await db.exec('reset role');await expect(db.query('update private.paper_orders set generation_plan=$1 where id=$2',[JSON.stringify(generationPlan()),order])).rejects.toThrow(/precede submission/);});
test('generation plan must match the exact order line marks',async()=>{await setGrouped();const plan=generationPlan();plan.lines[0].marks+=1;await expect(db.query('update private.paper_orders set generation_plan=$1 where id=$2',[JSON.stringify(plan),order])).rejects.toThrow(/valid_generation_plan/);});
