// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,test,expect} from 'vitest';
// CFG01 configured orders. Synthetic identities and content only. PGlite is one
// connection, so these tests establish rules and sequential races; the separate
// concurrency suite runs the simultaneous cases against real PostgreSQL.
let db:PGlite;
const teacher='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000005',reviewer='00000000-0000-4000-8000-000000000004';
const school='00000000-0000-4000-8000-000000000010',second='00000000-0000-4000-8000-000000000020';
const key='00000000-0000-4000-8000-0000000000a1',key2='00000000-0000-4000-8000-0000000000a2',submission='00000000-0000-4000-8000-0000000000b1',submission2='00000000-0000-4000-8000-0000000000b2';
const hash=(s:string)=>s.repeat(64);
const field=(id:string,required=true)=>({id,label:'Synthetic '+id,hint:'',required,allowAutomatic:true,type:'choice',allowOther:false,choices:[{id:'one',label:'One'},{id:'two',label:'Two'}]});
const registration=(id:string,module='synthetic-module')=>({module,release:'1',entryId:id,kind:id.startsWith('mcq:')?'multiple-choice':'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:hash('c'),sharedFormsSha256:hash('d'),
 fields:id.startsWith('mcq:')?[]:[field('setting'),field('note',false)],shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},
 sources:[{role:id.startsWith('mcq:')?'task-type':'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:id.startsWith('mcq:')});
const allocations={'structured:SPEC_01':8,'structured:SPEC_02':6,'mcq:MCQ_01':2};
const targets={paper:16};
async function refuse(run:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint refusal');await expect(run()).rejects.toThrow(pattern);await db.exec('rollback to savepoint refusal');}
async function owner(){await db.exec('reset role');}
async function asUser(id:string){await owner();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function service(){await owner();await db.exec('set role service_role');}
async function publisher(sql:string,args:unknown[]){await owner();await db.exec('set role reviseit_catalogue_publisher');const r=await db.query<any>(sql,args);await owner();return r;}
async function one<T=any>(sql:string,args:unknown[]=[]){return (await db.query<{r:T}>(sql,args)).rows[0].r;}
async function enable(on=true){await owner();await db.query('select public.configure_configurator($1,$2)',[on,'Synthetic configurator switch']);}
async function funding(){await owner();await db.query('select public.configure_pilot_funding($1,$2,$3,$4,$5)',['test',true,5,'pilot-synthetic-worker','Synthetic pilot configuration']);}
async function select(id=teacher,ids=['structured:SPEC_01','structured:SPEC_02','mcq:MCQ_01']){await asUser(id);const r=await one<number>('select public.save_paper_selection($1,$2,0,$3) as r',['synthetic-module','1',ids]);await owner();return r;}
async function candidate(id=teacher,alloc:object=allocations,t:object=targets){await service();return one('select public.configured_checkout_candidate($1,$2,1,$3,$4) as r',[id,'synthetic-module',JSON.stringify(alloc),JSON.stringify(t)]);}
async function begin(id=teacher,k=key,alloc:object=allocations,t:object=targets){const c=await candidate(id,alloc,t);await asUser(id);return one('select public.begin_configured_checkout($1,$2,1,$3,$4,$5) as r',[k,'synthetic-module',JSON.stringify(alloc),JSON.stringify(t),c.definitionsSha256]);}
const session=(order:string,over:object={})=>({id:'cs_test_Synthetic1',clientReferenceId:order,metadataOrderId:order,livemode:false,amountTotal:10000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:'pi_Synthetic1',...over});
async function attach(order:string){await service();await db.query('select public.attach_paper_checkout($1,$2,$3,$4)',[order,'cs_test_Synthetic1','https://checkout.stripe.com/c/pay/cs_test_Synthetic1',false]);}
async function paid(order:string,event='evt_paid_1'){await service();return one('select public.record_stripe_checkout($1,$2,false,$3) as r',[event,'checkout.session.completed',JSON.stringify(session(order))]);}
async function read(order:string,id=teacher){await service();return one('select public.paper_configuration_for_teacher($1,$2) as r',[order,id]);}
function evaluation(cur:any,ready:boolean){return {engine:'synthetic-test',definitionsSha256:cur.definitionsSha256,ready,status:ready?'ready_to_generate':'details_to_complete',outstanding:ready?0:1};}
async function save(order:string,cfg:object,expected:number,ready=false,id=teacher){const cur=await read(order);await service();return one<number>('select public.save_paper_configuration($1,$2,$3,$4,$5) as r',[order,id,expected,JSON.stringify(cfg),JSON.stringify(evaluation(cur,ready))]);}
const chosen={kind:'choice',choiceId:'one'};
function configured(marks:[number,number,number]=[8,6,2],t:object=targets){return {schemaVersion:1,targets:t,lines:{q1:{marks:marks[0],parts:null,facets:{}},q2:{marks:marks[1],parts:null,facets:{}},q3:{marks:marks[2],parts:null,facets:{}}},
 answers:{items:{q1:{setting:chosen},q2:{setting:{kind:'automatic'}},q3:{}},paper:{logistics:chosen,block:chosen}}};}
function unpaidConfig(marks:[number,number,number],t:object=targets){return {...configured(marks,t),answers:{items:{},paper:{}}};}
function answersFor(cur:any){return {schemaVersion:2,revision:cur.form.revision,items:{q1:{setting:chosen,note:{kind:'omit'}},q2:{setting:{kind:'automatic'},note:{kind:'omit'}},q3:{}},paper:{logistics:chosen,block:chosen}};}
// The exact generation inputs of a line, as the database derives them.
const sourceBinding=(b:any,workflow:string)=>({schema:'reviseit/cfg-source-binding@1',moduleId:b.module,release:b.release,entryId:b.entryId,privateManifestSha256:b.manifestSha256,privateBundleDigest:b.bundleDigest,formRevision:b.formRevision,workflowManifestSha256:workflow,sources:b.sources});
function planFor(cur:any,order:string){
 const cfg=cur.configuration;
 return {schema:'reviseit/configured-generation-plan@2',orderId:order,module:'synthetic-module',release:'1',formRevision:cur.form.revision,configurationRevision:cur.revision,definitionsSha256:cur.definitionsSha256,targets:cfg.targets,
  order:cfg.order??cur.snapshot.lines.map((l:any)=>l.id),
  lines:cur.snapshot.lines.map((l:any)=>({id:l.id,entryId:l.entryId,identity:l.identity,kind:l.kind,marks:cfg.lines[l.id].marks,parts:null,facets:cfg.lines[l.id].facets,answers:answersFor(cur).items[l.id as 'q1'],classificationSha256:l.classification?.sha256??null,requirementsRef:null,diagram:null,
   sourceBinding:sourceBinding(l.binding,cur.snapshot.execution.workflowManifestSha256)}))};
}
async function submit(order:string,k=submission,override?:{answers?:object;plan?:object;revision?:number}){const cur=await read(order);await service();
 return one('select public.submit_configured_paper($1,$2,$3,$4,$5,$6) as r',[order,teacher,k,override?.revision??cur.revision,JSON.stringify(override?.answers??answersFor(cur)),JSON.stringify(override?.plan??planFor(cur,order))]);}
async function orderRow(id:string){await owner();return (await db.query<any>('select o.*,p.status as payment_status,p.refunded_at from private.paper_orders o left join private.paper_payments p on p.order_id=o.id where o.id=$1',[id])).rows[0];}
async function paidOrder(){await enable();await funding();await select();const r=await begin();await attach(r.orderId);await paid(r.orderId);return r.orderId as string;}
async function claim(capabilities?:string[]){await service();return capabilities?one("select public.claim_paper_job('pilot-synthetic-worker',$1) as r",[JSON.stringify(capabilities)]):one("select public.claim_paper_job('pilot-synthetic-worker') as r");}

beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into public.curriculum_modules(id,name,current_release) values('synthetic-module','Synthetic','1');
 insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values
 ('synthetic-module','1','structured:SPEC_01','Synthetic structured one','Synthetic','',4,10),('synthetic-module','1','structured:SPEC_02','Synthetic structured two','Synthetic','',4,10),
 ('synthetic-module','1','mcq:MCQ_01','Synthetic MCQ','Synthetic','',1,2);`);
 for(const id of [teacher,outsider,reviewer]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@synthetic.example']);
 for(const [id,slug] of [[school,'synthetic-first'],[second,'synthetic-second']]){
  await db.query("insert into public.schools(id,slug,name) values($1,$2,$2)",[id,slug]);
  await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[id]);
  await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[id]);
 }
 for(const [id,s] of [[teacher,school],[outsider,second]]) await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$3,reviewed_at=now() where user_id=$1",[id,s,reviewer]);
 await db.query('insert into private.account_reviewers values($1)',[reviewer]);
 for(const id of ['structured:SPEC_01','structured:SPEC_02','mcq:MCQ_01']) await publisher('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration(id))]);
 await publisher('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('8')]);
 await owner();await db.query("select public.sync_supported_catalogue_readiness('synthetic-module')");
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});

test('the configurator is off by default: configured checkout is refused and the existing checkout is unchanged',async()=>{
 await funding();await select();
 await refuse(()=>candidate(),/Configurator unavailable/);
 await asUser(teacher);await refuse(()=>db.query('select public.begin_configured_checkout($1,$2,1,$3,$4,$5)',[key,'synthetic-module',JSON.stringify(allocations),JSON.stringify(targets),hash('0')]),/Configurator unavailable/);
 expect(await one('select public.configurator_status() as r')).toEqual({enabled:false});
 const legacy=await one('select public.begin_paper_checkout($1,$2,1,$3) as r',[key2,'synthetic-module',JSON.stringify(allocations)]);
 expect(await orderRow(legacy.orderId)).toMatchObject({adapter_key:'authored-bundle-v1',state:'awaiting_payment'});
 expect((await orderRow(legacy.orderId)).snapshot.schema).toBe('reviseit/frozen-authored-inputs@1');
});

test('configured checkout pins definitions, stores marks as revision 1 and exposes nothing private',async()=>{
 await enable();await funding();await select();
 await asUser(teacher);expect(await one('select public.configurator_status() as r')).toEqual({enabled:true});
 const r=await begin();expect(r).toMatchObject({status:'creating',amountMinor:10000,currency:'zar',existing:false,terminal:false});
 const o=await orderRow(r.orderId);
 expect(o).toMatchObject({adapter_key:'configured-bundle-v1',entitlement:'paid',state:'awaiting_payment',generation_plan:null});
 expect(o.snapshot.schema).toBe('reviseit/configured-authored-inputs@1');expect(o.snapshot.execution.workflowManifestSha256).toBe(hash('8'));
 expect(o.snapshot.lines.map((l:any)=>[l.id,l.identity.kind,l.range,l.fixedMarks])).toEqual([['q1','structured',{min:4,max:10},null],['q2','structured',{min:4,max:10},null],['q3','multiple_choice',{min:2,max:2},2]]);
 const cur=await read(r.orderId);
 expect(cur).toMatchObject({revision:1,paid:false,state:'awaiting_payment',submitted:false,configuration:{targets,lines:{q1:{marks:8,parts:null,facets:{}}}}});
 const [listed]=await (async()=>{await asUser(teacher);return one('select public.teacher_orders($1) as r',[r.orderId]);})();
 expect(listed).toMatchObject({configurable:true,form:null,state:'awaiting_payment'});
 expect(JSON.stringify(listed)).not.toMatch(/snapshot|binding|sources|configuration|manifestSha256/);
 // Browser roles cannot read or call the private configuration surface.
 await asUser(teacher);
 for(const sql of ['select * from private.paper_configurations','select * from private.catalogue_classifications','select * from private.paper_configuration_plans'])await refuse(()=>db.query(sql),/permission denied/);
 await refuse(()=>db.query('select public.paper_configuration_for_teacher($1,$2)',[r.orderId,teacher]),/permission denied/);
 await refuse(()=>db.query('select public.save_paper_configuration($1,$2,1,$3,$4)',[r.orderId,teacher,'{}','{}']),/permission denied/);
 await refuse(()=>db.query("select public.configured_checkout_candidate($1,'synthetic-module',1,'{}','{}')",[teacher]),/permission denied/);
});

test('checkout refuses totals that do not match, fixed-mark changes, out-of-range marks and changed definitions',async()=>{
 await enable();await funding();await select();
 await refuse(()=>candidate(teacher,allocations,{paper:17}),/Invalid mark allocations/);
 await refuse(()=>candidate(teacher,{...allocations,'mcq:MCQ_01':1},{paper:15}),/Invalid mark allocations/);
 await refuse(()=>candidate(teacher,{...allocations,'structured:SPEC_01':11},{paper:19}),/Invalid mark allocations/);
 await refuse(()=>candidate(teacher,allocations,{paper:16,sections:{structured:13}}),/Invalid mark allocations/);
 expect((await candidate(teacher,allocations,{paper:16,sections:{structured:14,multiple_choice:2}})).definitionsSha256).toMatch(/^[a-f0-9]{64}$/);
 await asUser(teacher);await refuse(()=>db.query('select public.begin_configured_checkout($1,$2,1,$3,$4,$5)',[key,'synthetic-module',JSON.stringify(allocations),JSON.stringify(targets),hash('0')]),/Saved selection changed/);
});

test('before payment only marks and targets can change; private choices are refused; stale tabs conflict',async()=>{
 await enable();await funding();await select();const {orderId}=await begin();
 expect(await save(orderId,unpaidConfig([6,8,2]),1)).toBe(2);
 await refuse(()=>save(orderId,configured([6,8,2]),2),/Invalid configuration/);
 await refuse(()=>save(orderId,{...unpaidConfig([6,8,2]),lines:{...unpaidConfig([6,8,2]).lines,q1:{marks:6,parts:['p1'],facets:{}}}},2),/Invalid configuration/);
 await refuse(()=>save(orderId,unpaidConfig([10,4,1]),2),/Invalid configuration/);
 await refuse(()=>save(orderId,unpaidConfig([11,4,2]),2),/Invalid configuration/);
 await refuse(()=>save(orderId,unpaidConfig([5,9,2]),1),/Configuration changed/);
 // An intermediate imbalance is a valid draft; it cannot pass submission.
 expect(await save(orderId,unpaidConfig([7,8,2]),2)).toBe(3);
 await owner();expect((await db.query<any>('select revision,configuration->$2 as l from private.paper_configuration_revisions where order_id=$1 order by revision',[orderId,'lines'])).rows.map(x=>[x.revision,x.l.q1.marks])).toEqual([[1,8],[2,6],[3,7]]);
});

test('a payment callback confirms entitlement without rolling back a later draft',async()=>{
 await enable();await funding();await select();const {orderId}=await begin();await attach(orderId);
 expect(await save(orderId,unpaidConfig([6,8,2]),1)).toBe(2);
 expect((await paid(orderId)).outcome).toBe('paid');
 expect((await paid(orderId,'evt_paid_1')).duplicate).toBe(true);
 const cur=await read(orderId);
 expect(cur).toMatchObject({state:'awaiting_answers',paid:true,revision:2});expect(cur.configuration.lines.q1.marks).toBe(6);
});

test('after payment every choice stays editable until submission and each accepted revision is kept',async()=>{
 const orderId=await paidOrder();
 expect(await save(orderId,configured([8,6,2]),1)).toBe(2);
 // Redistribute marks across purchased questions and change an answer.
 const next=configured([5,9,2]);next.answers.items.q1.setting={kind:'choice',choiceId:'two'};
 expect(await save(orderId,next,2,true)).toBe(3);
 await refuse(()=>save(orderId,configured([8,6,2]),2),/Configuration changed/);
 const cur=await read(orderId);expect(cur.configuration.lines.q2.marks).toBe(9);expect(cur.configuration.answers.items.q1.setting).toEqual({kind:'choice',choiceId:'two'});
 await owner();expect((await db.query<any>('select count(*)::int as n from private.paper_configuration_revisions where order_id=$1',[orderId])).rows[0].n).toBe(3);
 await refuse(()=>db.query('update private.paper_configuration_revisions set actor=$2 where order_id=$1',[orderId,'x']),/immutable/);
});

test('submission atomically checks payment, revision, totals and the ready verdict, then queues once',async()=>{
 const orderId=await paidOrder();
 await save(orderId,configured([8,6,2]),1,false);
 await refuse(()=>submit(orderId),/not ready/);
 await save(orderId,configured([9,6,2]),2,true);
 // A forged ready verdict still cannot pass unmatched totals.
 await refuse(()=>submit(orderId),/not ready/);
 await save(orderId,configured([5,9,2]),3,true);
 await refuse(()=>submit(orderId,submission,{revision:3}),/Configuration changed/);
 const cur=await read(orderId);
 await refuse(()=>submit(orderId,submission,{plan:{...planFor(cur,orderId),lines:planFor(cur,orderId).lines.map((l:any,i:number)=>i===0?{...l,marks:8}:l)}}),/Invalid generation plan/);
 await refuse(()=>submit(orderId,submission,{answers:{...answersFor(cur),items:{...answersFor(cur).items,q1:{setting:{kind:'choice',choiceId:'two'},note:{kind:'omit'}}}}}),/Invalid/);
 expect(await submit(orderId)).toBe(orderId);
 const o=await orderRow(orderId);
 expect(o).toMatchObject({state:'queued',submission_key:submission});expect(o.answers.items.q1.note).toEqual({kind:'omit'});
 expect(await submit(orderId)).toBe(orderId);
 await refuse(()=>submit(orderId,submission2),/already submitted/);
 await refuse(()=>save(orderId,configured([5,9,2]),4,true),/already submitted/);
 await owner();expect((await db.query<any>("select count(*)::int as n from private.paper_job_events where order_id=$1 and event='submitted'",[orderId])).rows[0].n).toBe(1);
 await refuse(()=>db.query("update private.paper_configuration_plans set revision=1 where order_id=$1",[orderId]),/immutable/);
 await refuse(()=>db.query("update private.paper_orders set snapshot=snapshot||'{\"x\":1}' where id=$1",[orderId]),/immutable/);
});

test('a refund before submission cancels the draft; neither edits nor submission can proceed',async()=>{
 const orderId=await paidOrder();await save(orderId,configured([8,6,2]),1,true);
 await service();expect((await one("select public.record_stripe_refund('evt_refund',false,'pi_Synthetic1',10000,'zar') as r")).outcome).toBe('refunded');
 await refuse(()=>submit(orderId),/cannot be submitted/);
 await refuse(()=>save(orderId,configured([8,6,2]),2,true),/already submitted|cannot be configured/);
 expect(await orderRow(orderId)).toMatchObject({state:'cancelled',submission_key:null});
});

test('a refund after submission leaves the frozen plan but the worker never claims it',async()=>{
 const orderId=await paidOrder();await save(orderId,configured([8,6,2]),1,true);expect(await submit(orderId)).toBe(orderId);
 await service();await one("select public.record_stripe_refund('evt_refund',false,'pi_Synthetic1',10000,'zar') as r");
 expect(await claim(['configured-plan@2'])).toBeNull();
});

test('the legacy answer path, other schools and unapproved teachers are refused for configured orders',async()=>{
 const orderId=await paidOrder();await save(orderId,configured([8,6,2]),1,true);const cur=await read(orderId);
 await asUser(teacher);await refuse(()=>db.query('select public.submit_paper_answers($1,$2,$3)',[orderId,submission,JSON.stringify(answersFor(cur))]),/cannot be submitted/);
 expect(await read(orderId,outsider)).toBeNull();
 await refuse(()=>save(orderId,configured([8,6,2]),2,true,outsider),/Order access required/);
 await service();await refuse(()=>db.query('select public.submit_configured_paper($1,$2,$3,2,$4,$5)',[orderId,outsider,submission,JSON.stringify(answersFor(cur)),JSON.stringify(planFor(cur,orderId))]),/Order access required/);
 await asUser(outsider);expect(await one('select public.teacher_orders($1) as r',[orderId])).toEqual([]);
 await owner();await db.query("update public.teacher_accounts set status='suspended' where user_id=$1",[teacher]);
 expect(await read(orderId)).toBeNull();
 await service();await refuse(()=>db.query('select public.save_paper_configuration($1,$2,2,$3,$4)',[orderId,teacher,JSON.stringify(configured([8,6,2])),JSON.stringify(evaluation(cur,true))]),/Order access required/);
});

test('workers claim configured orders only when they declare the capability, with the frozen plan',async()=>{
 const orderId=await paidOrder();await save(orderId,configured([5,9,2]),1,true);
 expect(await claim()).toBeNull();expect(await claim([])).toBeNull();
 await refuse(()=>claim(['configured-plan@3']),/Invalid worker capabilities/);
 expect(await submit(orderId)).toBe(orderId);
 expect(await claim()).toBeNull();
 // A version-1-only worker never receives a version 2 plan.
 expect(await claim(['configured-plan@1'])).toBeNull();
 const job=await claim(['configured-plan@1','configured-plan@2']);
 expect(job).toMatchObject({id:orderId,adapterKey:'configured-bundle-v1',entitlement:'paid',paymentMode:'test'});
 expect(job.configurationPlan).toMatchObject({schema:'reviseit/configured-generation-plan@2',configurationRevision:2,targets:{paper:16}});
 expect(job.configurationPlan.lines.map((l:any)=>[l.id,l.marks])).toEqual([['q1',5],['q2',9],['q3',2]]);
 expect(job.snapshot.lines[0].checkoutMarks).toBe(8);
 expect(job.answers.items.q2.setting).toEqual({kind:'automatic'});
});

test('an existing authored order keeps its claim payload for workers with or without the capability',async()=>{
 await enable();await funding();await select(teacher,['structured:SPEC_01','mcq:MCQ_01']);
 await asUser(teacher);const r=await one('select public.begin_paper_checkout($1,$2,1,$3) as r',[key,'synthetic-module',JSON.stringify({'structured:SPEC_01':8,'mcq:MCQ_01':2})]);
 await attach(r.orderId);await paid(r.orderId);
 const form=(await orderRow(r.orderId)).form;
 await asUser(teacher);await db.query('select public.submit_paper_answers($1,$2,$3)',[r.orderId,submission,JSON.stringify({schemaVersion:2,revision:form.revision,items:{q1:{setting:chosen,note:{kind:'omit'}},q2:{}},paper:{logistics:chosen,block:chosen}})]);
 await db.exec('savepoint legacy');const plain=await claim();await db.exec('rollback to savepoint legacy');const declared=await claim(['configured-plan@1','configured-plan@2']);
 for(const job of [plain,declared]){expect(job).toMatchObject({id:r.orderId,adapterKey:'authored-bundle-v1'});expect(job).not.toHaveProperty('configurationPlan');}
 expect(Object.keys(plain).sort()).toEqual(Object.keys(declared).sort());
});

const binding=async(entry='structured:SPEC_01')=>{await owner();const f=(await db.query<any>('select payload from private.catalogue_authored_forms where entry_id=$1',[entry])).rows[0].payload;return sourceBinding(f,hash('8'));};
const bundleSources=(b:any)=>b.sources.map((s:any)=>({...s,originalPath:'our content/synthetic-module/data/'+s.path}));
const envelope=(tag:string,sources?:any[])=>({schemaVersion:2,moduleId:'synthetic-module',kind:'structured',itemId:'SPEC_01',release:'1',curriculumId:'synthetic',curriculumRequirementsRef:{profileId:'synthetic-profile',version:1},
 formBinding:{itemForm:{formRevision:hash('a')}},provenance:{sources:sources??[{role:'specification',path:'our content/synthetic-module/data/sources/synthetic.md',sha256:hash('b')}]},tag});
const registerBound=(env:object,sha:string,b:object,bs:object,digest='synthetic-digest')=>publisher('select public.register_catalogue_classification_bound($1,$2,$3,$4,$5,$6,$7,$8,$9)',['synthetic-module','1','structured:SPEC_01',sha,JSON.stringify(env),hash('7'),JSON.stringify(b),JSON.stringify(bs),digest]);
async function publishedRelease(){await owner();await db.query("insert into private.catalogue_published_releases(module_id,release,payload) values('synthetic-module','1','{\"contentDigest\":\"synthetic-digest\"}') on conflict do nothing");}
test('classifications register only with their exact source binding; mismatches fail and issued orders never change',async()=>{
 await publishedRelease();await publisher('select public.register_curriculum_requirements($1,$2,$3)',['synthetic-profile@1',hash('7'),JSON.stringify({profileId:'synthetic-profile',version:1})]);
 const b=await binding();
 // The unbound version-1 registration is withdrawn from the publisher.
 await refuse(()=>publisher('select public.register_catalogue_classification($1,$2,$3,$4,$5,$6)',['synthetic-module','1','structured:SPEC_01',hash('1'),JSON.stringify(envelope('a')),hash('7')]),/permission denied/);
 await service();await refuse(()=>db.query('select public.register_catalogue_classification_bound($1,$2,$3,$4,$5,$6,$7,$8,$9)',['synthetic-module','1','structured:SPEC_01',hash('1'),'{}',hash('7'),'{}','[]','x']),/permission denied/);
 // Changed source bytes with an unchanged form revision: refused.
 await refuse(()=>registerBound(envelope('a',[{role:'specification',path:'our content/synthetic-module/data/sources/synthetic.md',sha256:hash('6')}]),hash('1'),b,bundleSources(b)),/source version mismatch/);
 // A missing task dependency, an extra one, a cross-module path, another bundle, another workflow, another catalogue release: all refused.
 await refuse(()=>registerBound(envelope('a',[...envelope('a').provenance.sources,{role:'task-dependency',path:'our content/synthetic-module/data/sources/extra.md',sha256:hash('5')}]),hash('1'),b,bundleSources(b)),/source version mismatch/);
 await refuse(()=>registerBound(envelope('a'),hash('1'),b,bundleSources(b).map((x:any)=>({...x,originalPath:'our content/other-module/data/'+x.path}))),/source version mismatch/);
 await refuse(()=>registerBound(envelope('a'),hash('1'),{...b,privateManifestSha256:hash('9')},bundleSources(b)),/source version mismatch/);
 await refuse(()=>registerBound(envelope('a'),hash('1'),{...b,privateBundleDigest:hash('9')},bundleSources(b)),/source version mismatch/);
 await refuse(()=>registerBound(envelope('a'),hash('1'),{...b,workflowManifestSha256:hash('9')},bundleSources(b)),/source version mismatch/);
 await refuse(()=>registerBound(envelope('a'),hash('1'),b,bundleSources(b),'other-digest'),/catalogue release mismatch/);
 await refuse(()=>registerBound({...envelope('a'),formBinding:{itemForm:{formRevision:hash('9')}}},hash('1'),b,bundleSources(b)),/source version mismatch/);
 await refuse(()=>registerBound({...envelope('a'),itemId:'SPEC_02'},hash('1'),b,bundleSources(b)),/identity mismatch/);
 // Aligned: accepted, immutable, and readiness is unchanged.
 await registerBound(envelope('a'),hash('1'),b,bundleSources(b));
 await refuse(()=>registerBound(envelope('changed'),hash('1'),b,bundleSources(b)),/immutable/);
 await asUser(teacher);expect((await db.query<any>("select orderable from public.teacher_catalogue_summaries where entry_id='structured:SPEC_01'")).rows[0].orderable).toBe(true);
 const orderId=await paidOrder();const o=await orderRow(orderId);
 expect(o.snapshot.lines[0].classification).toMatchObject({sha256:hash('1'),requirementsRef:'synthetic-profile@1',sourceBinding:b});
 await registerBound(envelope('b'),hash('2'),b,bundleSources(b));
 expect((await orderRow(orderId)).snapshot.lines[0].classification.sha256).toBe(hash('1'));
});
test('a classification bound to a superseded bundle fails checkout loudly instead of silently dropping the item',async()=>{
 await publishedRelease();await publisher('select public.register_curriculum_requirements($1,$2,$3)',['synthetic-profile@1',hash('7'),JSON.stringify({profileId:'synthetic-profile',version:1})]);
 const b=await binding();await registerBound(envelope('a'),hash('1'),b,bundleSources(b));
 // Simulate a later bundle for this entry: the current form binding moves, the classification still describes the old bytes.
 await owner();await db.exec("alter table private.catalogue_form_bindings disable trigger all");
 await db.query("update private.catalogue_form_bindings set manifest_sha256=$1 where entry_id='structured:SPEC_01'",[hash('3')]);
 await db.query("insert into private.catalogue_authored_forms(module_id,release,entry_id,manifest_sha256,payload) select module_id,release,entry_id,$1,payload||jsonb_build_object('manifestSha256',$1::text) from private.catalogue_authored_forms where entry_id='structured:SPEC_01' and manifest_sha256=$2",[hash('3'),hash('c')]);
 await enable();await funding();await select();
 await refuse(()=>candidate(),/source version mismatch|not available/);
});
test('repeated multiple-choice occurrences are separate lines; repeats of structured items and repeats on the legacy path are refused',async()=>{
 await enable();await funding();
 await select(teacher,['mcq:MCQ_01','structured:SPEC_01','mcq:MCQ_01','structured:SPEC_02']);
 const r=await begin(teacher,key,allocations,{paper:18});const o=await orderRow(r.orderId);
 expect(o.snapshot.lines.map((l:any)=>[l.id,l.entryId])).toEqual([['q1','mcq:MCQ_01'],['q2','structured:SPEC_01'],['q3','mcq:MCQ_01'],['q4','structured:SPEC_02']]);
 await asUser(teacher);await refuse(()=>db.query('select public.save_paper_selection($1,$2,1,$3)',['synthetic-module','1',['structured:SPEC_01','structured:SPEC_01']]),/Invalid question selection/);
 await enable(false);
 await asUser(teacher);await refuse(()=>db.query('select public.save_paper_selection($1,$2,1,$3)',['synthetic-module','1',['mcq:MCQ_01','mcq:MCQ_01']]),/Invalid question selection/);
 // With the earlier checkout closed, the legacy path refuses the saved repeats rather than compiling them.
 await owner();await db.query("update private.paper_payments set status='cancelled' where order_id=$1",[r.orderId]);
 await asUser(teacher);await refuse(()=>db.query('select public.begin_paper_checkout($1,$2,1,$3)',[key2,'synthetic-module',JSON.stringify(allocations)]),/Saved selection changed/);
});
test('presentation order is a revisioned choice after payment and is frozen into the plan',async()=>{
 const orderId=await paidOrder();
 await refuse(()=>save(orderId,{...configured(),order:['q1','q1','q3']},1,true),/Invalid configuration/);
 expect(await save(orderId,{...configured(),order:['q3','q2','q1']},1,true)).toBe(2);
 const cur=await read(orderId);
 await refuse(()=>submit(orderId,submission,{plan:{...planFor(cur,orderId),order:['q1','q2','q3']}}),/Invalid generation plan/);
 expect(await submit(orderId)).toBe(orderId);
 expect((await claim(['configured-plan@2'])).configurationPlan.order).toEqual(['q3','q2','q1']);
});


test.each([10,11])('pilot question limit counts every repeated occurrence: %i lines',async n=>{
 await enable();await funding();await owner();await db.query("select public.configure_pilot_paper_size('test',10,'Synthetic ten-question pilot')");
 await select(teacher,Array(n).fill('mcq:MCQ_01'));
 const run=()=>begin(teacher,key,{'mcq:MCQ_01':2},{paper:n*2});
 if(n===10){expect(await run()).toMatchObject({status:'creating'});}
 else{await refuse(run,/allows up to 10 questions/);await owner();expect(await one('select count(*)::int as r from private.paper_orders')).toBe(0);expect(await one('select count(*)::int as r from private.paper_payments')).toBe(0);}
});
test('only the owner can change the paper limit; public status exposes the limit and no funding internals',async()=>{
 await funding();await asUser(teacher);
 await refuse(()=>db.query("select public.configure_pilot_paper_size('test',30,'Unauthorised increase')"),/permission denied/);
 await owner();await db.query("select public.configure_pilot_paper_size('test',10,'Synthetic limit')");
 await asUser(teacher);expect(await one('select public.pilot_checkout_status() as r')).toEqual({available:true,amountMinor:10000,currency:'zar',maxQuestions:10,maxStructured:30,maxMultipleChoice:30});
 await owner();await refuse(()=>db.query("select public.configure_pilot_paper_size('test',31,'Invalid size')"),/Valid paper size/);
});
test('reducing the paper limit preserves an existing checkout and its retry',async()=>{
 await enable();await funding();await select();const r=await begin();const before=await orderRow(r.orderId);
 await db.query("select public.configure_pilot_paper_size('test',1,'Future checkouts only')");
 expect((await begin()).orderId).toBe(r.orderId);expect(await orderRow(r.orderId)).toEqual(before);
});
test('a refunded live purchase keeps its pilot seat because generation allowance is not recycled',async()=>{
 const id=await paidOrder();await owner();await db.query("update private.paper_payments set mode='live',refunded_at=now() where order_id=$1",[id]);
 expect(await one("select private.pilot_seats_used('live') as r")).toBe(1);
});

test.each([[1,10,false],[2,1,true]])('pilot per-kind bounds structured=%i and multiple choice=%i',async(structured,mcq,accepted)=>{
 await enable();await funding();await owner();await db.query("select public.configure_pilot_paper_size('test',20,'Synthetic kind limits',$1,$2)",[structured,mcq]);await select();
 if(accepted)expect(await begin()).toMatchObject({status:'creating'});
 else{await refuse(()=>begin(),/structured and 10 multiple-choice/);await owner();expect(await one('select count(*)::int as r from private.paper_payments')).toBe(0);}
});
test('eleven multiple-choice occurrences are refused even below the overall twenty-question cap',async()=>{
 await enable();await funding();await owner();await db.query("select public.configure_pilot_paper_size('test',20,'Synthetic funded mix',10,10)");await select(teacher,Array(11).fill('mcq:MCQ_01'));
 await refuse(()=>begin(teacher,key,{'mcq:MCQ_01':2},{paper:22}),/10 structured and 10 multiple-choice/);
});
