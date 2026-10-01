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


async function creditSetup(){await enable();await funding();await select();await owner();
 await db.query('insert into private.credit_administrators values($1)',[reviewer]);
 await db.exec('update private.credit_settings set enabled=true');await asUser(reviewer);
 await db.query("select public.grant_department_credit($1,'test',100000,'staff_grant',null,null,'Synthetic credit',$2)",[school,submission]);
}
async function quote(){const c=await candidate();await asUser(teacher);return one('select public.quote_department_paper($1,1,$2,$3,$4) as r',['synthetic-module',JSON.stringify(allocations),JSON.stringify(targets),c.definitionsSha256]);}
async function create(q:string,k=key){await asUser(teacher);return one<string>('select public.create_department_paper($1,$2) as r',[q,k]);}
test('quote uses actual selected quantities and creation spends once without a Stripe row',async()=>{
 await creditSetup();const q=await quote();expect(q.amountMinor).toBe(20615);
 const o=await create(q.quoteId);expect(await create(q.quoteId)).toBe(o);expect(await create(q.quoteId,key2)).toBe(o);
 const row=await orderRow(o);expect(row).toMatchObject({entitlement:'department_credit',state:'awaiting_answers'});
 expect((await db.query('select * from private.paper_payments')).rows).toHaveLength(0);
 expect(await one("select private.credit_balance($1,'test')::integer as r",[school])).toBe(79385);
 const current=await read(o);expect(current.paid).toBe(true);
 await asUser(teacher);const list=await one('select public.teacher_orders($1) as r',[o]);expect(list[0].payment).toMatchObject({source:'department_credit',status:'paid',amountMinor:20615});
});
test('expired and changed-price quotes preserve the draft and debit nothing',async()=>{
 await creditSetup();const q=await quote();await owner();await db.query("update private.paper_credit_quotes set expires_at=now()-interval '1 minute' where id=$1",[q.quoteId]);
 await asUser(teacher);await refuse(()=>create(q.quoteId),/Quote changed/);await owner();expect((await db.query('select * from private.paper_credit_funding')).rows).toHaveLength(0);
});
test('return closes access atomically and cannot leave the paper answerable',async()=>{
 await creditSetup();const q=await quote();const o=await create(q.quoteId);await owner();const op=await one('select operation_id as r from private.paper_credit_funding where order_id=$1',[o]);
 await asUser(reviewer);await db.query("select public.return_department_credit($1,'Cannot deliver',$2)",[op,key2]);
 const cur=await read(o);expect(cur.paid).toBe(false);expect(cur.state).toBe('cancelled');
 await refuse(()=>save(o,cur.configuration,cur.revision),/already submitted|cannot be configured/);
});
test('offer claim is department-bound, once only, and unavailable to ordinary members',async()=>{
 await creditSetup();await asUser(reviewer);
 const offer=await one("select public.create_department_offer('Synthetic offer','test',50000,now()-interval '1 day',now()+interval '1 day',now()+interval '30 days',1,$1) as r",[[school]]);
 await db.query('select public.set_department_offer_enabled($1,true)',[offer]);
 await asUser(teacher);await refuse(()=>one('select public.claim_department_offer($1,$2) as r',[offer,key]),/head access/);
 await owner();const rev=await one('select revision as r from public.teacher_accounts where user_id=$1',[teacher]);await asUser(reviewer);
 await db.query("select public.set_department_role($1,$2,'head','Founder appointed')",[teacher,rev]);
 await asUser(teacher);const claim=await one('select public.claim_department_offer($1,$2) as r',[offer,key]);
 expect(await one('select public.claim_department_offer($1,$2) as r',[offer,key2])).toBe(claim);
 await owner();expect(await one("select private.credit_balance($1,'test')::integer as r",[school])).toBe(150000);
});

test('a purchased total is fixed while redistribution preserves the accepted price',async()=>{
 await creditSetup();const q=await quote();const o=await create(q.quoteId);
 const original=await read(o);expect(original.purchasedTotal).toBe(16);
 const revision=await save(o,configured([7,7,2]),original.revision,true);
 const redistributed=await read(o);expect(redistributed.configuration.lines.q1.marks).toBe(7);expect(redistributed.configuration.lines.q2.marks).toBe(7);
 await refuse(()=>save(o,configured([7,8,2],{paper:17}),revision,true),/Purchased total is fixed/);
 await refuse(()=>save(o,configured([6,7,2],{paper:15}),revision,true),/Purchased total is fixed/);
 await refuse(()=>save(o,configured([7,7,2],{}),revision,true),/Purchased total is fixed/);
 const unchanged=await read(o);expect(unchanged.revision).toBe(revision);expect(unchanged.configuration.targets.paper).toBe(16);
 await owner();expect(await one("select private.credit_balance($1,'test')::integer as r",[school])).toBe(79385);
 expect((await db.query("select * from private.credit_operations where kind='spend'")).rows).toHaveLength(1);
});

async function headPurchase(){
 await creditSetup();await owner();const rev=await one('select revision as r from public.teacher_accounts where user_id=$1',[teacher]);
 await asUser(reviewer);await db.query("select public.set_department_role($1,$2,'head','Founder appointed')",[teacher,rev]);
 await owner();await db.exec('insert into private.credit_topup_amounts values(50000,true)');await asUser(teacher);
 return one("select public.begin_credit_purchase(50000,'Synthetic reference',$1) as r",[key]);
}
async function fundPurchase(p:any,event='evt_credit_1',override:object={}){await service();return one('select public.record_credit_checkout($1,$2,false,$3) as r',[event,'checkout.session.completed',JSON.stringify({...session(p.id),metadataOrderId:null,metadataPurchaseId:p.id,amountTotal:50000,...override})]);}
test('top-up requires confirmed matching payment and credits the department once',async()=>{
 const p=await headPurchase();await service();
 await refuse(()=>fundPurchase(p,'evt_wrong',{amountTotal:1}),/mismatch/);
 await refuse(()=>fundPurchase(p,'evt_wrong_mode',{livemode:true}),/mismatch/);
 await refuse(()=>fundPurchase(p,'evt_no_session',{id:null}),/mismatch/);
 expect(await fundPurchase(p)).toMatchObject({outcome:'funded'});
 expect(await fundPurchase(p)).toMatchObject({outcome:'duplicate'});
 await fundPurchase(p,'evt_credit_2');await owner();
 expect(await one("select private.credit_balance($1,'test')::integer as r",[school])).toBe(150000);
 expect((await db.query("select * from private.credit_operations where kind='purchase'")).rows).toHaveLength(1);
});
test('refund before top-up confirmation cannot create spendable credit',async()=>{
 const p=await headPurchase();await service();
 await db.query("select public.record_credit_payment_alert('evt_refund_first',false,'pi_Synthetic1',50000,false)");
 expect(await fundPurchase(p)).toMatchObject({outcome:'needs_review'});
 await owner();expect(await one("select private.credit_balance($1,'test')::integer as r",[school])).toBe(100000);
});
test('refund after top-up confirmation freezes the source, including after switch-off',async()=>{
 const p=await headPurchase();await fundPurchase(p);await owner();await db.exec('update private.credit_settings set enabled=false');await service();
 await db.query("select public.record_credit_payment_alert('evt_refund_after',false,'pi_Synthetic1',1000,false)");
 await owner();expect(await one("select private.credit_balance($1,'test')::integer as r",[school])).toBe(100000);
 expect(await one('select status as r from private.credit_purchases where id=$1',[p.id])).toBe('attention');
});

test('switch refuses new legacy-priced checkouts while preserving existing paid papers',async()=>{
 const legacy=await paidOrder();await owner();await db.exec('update private.credit_settings set enabled=true');
 const c=await candidate();await asUser(teacher);
 await refuse(()=>one('select public.begin_configured_checkout($1,$2,1,$3,$4,$5) as r',[key2,'synthetic-module',JSON.stringify(allocations),JSON.stringify(targets),c.definitionsSha256]),/Use department credit/);
 const old=await read(legacy);expect(old.paid).toBe(true);expect(old.purchasedTotal).toBeNull();
 await save(legacy,configured([7,7,2]),old.revision,true);
});
