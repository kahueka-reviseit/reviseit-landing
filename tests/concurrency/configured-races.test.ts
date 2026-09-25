// CFG01 under genuine concurrency: separate PostgreSQL sessions racing configuration
// saves, submission, payment confirmation and refunds for one configured order.
// Synthetic data; a disposable local database created and dropped by this test.
import {Client} from 'pg';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,test,expect} from 'vitest';
const url=process.env.REVISEIT_CONCURRENCY_DATABASE_URL||'';
if(!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) throw new Error('Set REVISEIT_CONCURRENCY_DATABASE_URL to a disposable loopback PostgreSQL server');
const name='cfg01_races_'+Date.now();const dbUrl=url.replace(/\/[^/]*$/,'/'+name);
const teacher='00000000-0000-4000-8000-000000000002',school='00000000-0000-4000-8000-000000000010';
const hash=(s:string)=>s.repeat(64);
const field=(id:string)=>({id,label:'Synthetic '+id,hint:'',required:true,allowAutomatic:true,type:'text',maxLength:100});
const registration=(id:string)=>({module:'synthetic-module',release:'1',entryId:id,kind:'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:hash('c'),sharedFormsSha256:hash('d'),fields:[field('setting')],shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},sources:[{role:'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:false});
const ids=['structured:SPEC_01','structured:SPEC_02'];
let admin:Client,owner:Client;
const evidence:Record<string,unknown>={};
const connect=async()=>{const c=new Client({connectionString:dbUrl});await c.connect();await c.query('set role service_role');return c;};
beforeAll(async()=>{
 admin=new Client({connectionString:url});await admin.connect();await admin.query(`create database ${name}`);
 owner=new Client({connectionString:dbUrl});await owner.connect();
 await owner.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
  create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $f$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$f$;
  grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await owner.query(readFileSync('supabase/migrations/'+f,'utf8'));
 await owner.query(`insert into public.curriculum_modules(id,name,current_release) values('synthetic-module','Synthetic','1');
  insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values('synthetic-module','1','structured:SPEC_01','Synthetic one','Synthetic','',2,10),('synthetic-module','1','structured:SPEC_02','Synthetic two','Synthetic','',2,10)`);
 await owner.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[teacher,teacher+'@synthetic.example']);
 await owner.query("insert into public.schools(id,slug,name) values($1,'synthetic','Synthetic school')",[school]);
 await owner.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[school]);
 await owner.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[school]);
 await owner.query("update public.teacher_accounts set status='approved',school_id=$1,department_id=$1,reviewed_by=$2,reviewed_at=now() where user_id=$2",[school,teacher]);
 await owner.query('set role reviseit_catalogue_publisher');for(const id of ids) await owner.query('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration(id))]);
 await owner.query('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('8')]);await owner.query('reset role');
 await owner.query("select public.sync_supported_catalogue_readiness('synthetic-module')");
 await owner.query("select public.configure_pilot_funding('test',true,1000,'pilot-synthetic-worker','Synthetic concurrency pilot')");
 await owner.query("select public.configure_configurator(true,'Synthetic concurrency configurator')");
 await owner.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await owner.query('set role authenticated');
 await owner.query('select public.save_paper_selection($1,$2,0,$3)',['synthetic-module','1',ids]);await owner.query('reset role');
},120000);
afterAll(async()=>{
 if(process.env.REVISEIT_CONCURRENCY_EVIDENCE) writeFileSync(process.env.REVISEIT_CONCURRENCY_EVIDENCE,JSON.stringify(evidence,null,1));
 await owner?.end();await admin?.query(`drop database if exists ${name} with (force)`);await admin?.end();
});
const alloc={'structured:SPEC_01':8,'structured:SPEC_02':6},targets={paper:14};
const one=async(c:Client,sql:string,args:unknown[])=>(await c.query(sql,args)).rows[0].r;
async function order(paid=true){
 await owner.query('reset role');await owner.query("update private.paper_payments set status='cancelled' where status in ('creating','open')");
 await owner.query('set role service_role');
 const cand=await one(owner,'select public.configured_checkout_candidate($1,$2,1,$3,$4) as r',[teacher,'synthetic-module',JSON.stringify(alloc),JSON.stringify(targets)]);
 await owner.query('reset role');await owner.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await owner.query('set role authenticated');
 const r=await one(owner,'select public.begin_configured_checkout($1,$2,1,$3,$4,$5) as r',[randomUUID(),'synthetic-module',JSON.stringify(alloc),JSON.stringify(targets),cand.definitionsSha256]);
 await owner.query('reset role');await owner.query('set role service_role');
 const id=r.orderId as string,sid='cs_test_'+id.replace(/-/g,''),pi='pi_'+id.replace(/-/g,'');
 await owner.query('select public.attach_paper_checkout($1,$2,$3,false)',[id,sid,'https://checkout.stripe.com/c/pay/'+sid]);
 const session={id:sid,clientReferenceId:id,metadataOrderId:id,livemode:false,amountTotal:10000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:pi};
 if(paid){
  await owner.query("select public.record_stripe_checkout($1,'checkout.session.completed',false,$2)",['evt_p_'+id,JSON.stringify(session)]);
  // A saved, ready revision 2: every race below starts from a submittable state.
  await owner.query(saveSql,[id,teacher,1,JSON.stringify(cfg(8,6)),verdict(cand.definitionsSha256)]);
 }
 await owner.query('reset role');
 return {id,pi,session,definitions:cand.definitionsSha256 as string};
}
const answers={items:{q1:{setting:{kind:'automatic'}},q2:{setting:{kind:'automatic'}}},paper:{logistics:{kind:'automatic'}}};
const cfg=(a:number,b:number,paid=true)=>({schemaVersion:1,targets,lines:{q1:{marks:a,parts:null,facets:{}},q2:{marks:b,parts:null,facets:{}}},answers:paid?answers:{items:{},paper:{}}});
const verdict=(d:string,ready=true)=>JSON.stringify({engine:'synthetic-race',definitionsSha256:d,ready,status:ready?'ready_to_generate':'ready_for_payment'});
const saveSql='select public.save_paper_configuration($1,$2,$3,$4,$5) as r';
const submitSql='select public.submit_configured_paper($1,$2,$3,$4,$5,$6) as r';
async function submitArgs(o:{id:string;definitions:string},revision:number,a:number,b:number){
 const form=(await owner.query('select form,snapshot from private.paper_orders where id=$1',[o.id])).rows[0];
 const submitted={schemaVersion:2,revision:form.form.revision,items:answers.items,paper:answers.paper};
 const w=form.snapshot.execution.workflowManifestSha256;
 const plan={schema:'reviseit/configured-generation-plan@2',orderId:o.id,module:'synthetic-module',release:'1',formRevision:form.snapshot.formRevision,configurationRevision:revision,definitionsSha256:o.definitions,targets,
  order:form.snapshot.lines.map((l:any)=>l.id),
  lines:form.snapshot.lines.map((l:any,i:number)=>({id:l.id,entryId:l.entryId,identity:l.identity,kind:l.kind,marks:[a,b][i],parts:null,facets:{},answers:(answers.items as any)[l.id],classificationSha256:null,requirementsRef:null,diagram:null,
   sourceBinding:{schema:'reviseit/cfg-source-binding@1',moduleId:l.binding.module,release:l.binding.release,entryId:l.binding.entryId,privateManifestSha256:l.binding.manifestSha256,privateBundleDigest:l.binding.bundleDigest,formRevision:l.binding.formRevision,workflowManifestSha256:w,sources:l.binding.sources}}))};
 return [o.id,teacher,randomUUID(),revision,JSON.stringify(submitted),JSON.stringify(plan)];
}
async function state(id:string){
 return (await owner.query(`select o.state,o.submission_key is not null as submitted,c.revision,c.configuration->'lines'->'q1'->>'marks' as q1,p.revision as plan_revision,
  (select count(*)::int from private.paper_job_events e where e.order_id=o.id and e.event='submitted') as submitted_events,y.refunded_at is not null as refunded
  from private.paper_orders o join private.paper_configurations c on c.order_id=o.id left join private.paper_configuration_plans p on p.order_id=o.id join private.paper_payments y on y.order_id=o.id where o.id=$1`,[id])).rows[0];
}
async function waiting(pid:number){
 for(let i=0;i<150;i++){const r=await owner.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(r.rows[0]?.wait_event_type==='Lock')return true;await new Promise(x=>setTimeout(x,20));}
 return false;
}
const settle=async(p:Promise<unknown>)=>p.then(v=>({ok:true,v}),e=>({ok:false,v:(e as Error).message}));
const jitter=()=>new Promise(x=>setTimeout(x,Math.floor(Math.random()*4)));

test('controlled: an edit holding the order makes a simultaneous submission of the older revision wait, then refuse',async()=>{
 const o=await order();const a=await connect(),b=await connect();
 try{
  await a.query('begin');expect(await one(a,saveSql,[o.id,teacher,2,JSON.stringify(cfg(7,7)),verdict(o.definitions)])).toBe(3);
  const pid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;const sub=settle(b.query(submitSql,await submitArgs(o,2,8,6)));
  expect(await waiting(pid)).toBe(true);await a.query('commit');
  expect(await sub).toMatchObject({ok:false,v:expect.stringMatching(/Configuration changed/)});
  expect(await state(o.id)).toMatchObject({state:'awaiting_answers',submitted:false,revision:3});
 }finally{await a.end();await b.end();}
});
test('controlled: a submission holding the order makes a simultaneous edit wait, then refuse',async()=>{
 const o=await order();await owner.query('set role service_role');await owner.query(saveSql,[o.id,teacher,2,JSON.stringify(cfg(7,7)),verdict(o.definitions)]);await owner.query('reset role');
 const a=await connect(),b=await connect();
 try{
  await a.query('begin');expect(await one(a,submitSql,await submitArgs(o,3,7,7))).toBe(o.id);
  const pid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;const save=settle(b.query(saveSql,[o.id,teacher,3,JSON.stringify(cfg(5,9)),verdict(o.definitions)]));
  expect(await waiting(pid)).toBe(true);await a.query('commit');
  expect(await save).toMatchObject({ok:false,v:expect.stringMatching(/already submitted/)});
  expect(await state(o.id)).toMatchObject({state:'queued',revision:3,plan_revision:3,q1:'7',submitted_events:1});
 }finally{await a.end();await b.end();}
});
test('40 simultaneous edit and submit pairs: exactly one wins and the frozen plan is always the current revision',async()=>{
 const outcomes=new Set<string>();
 for(let i=0;i<40;i++){
  const o=await order();const a=await connect(),b=await connect();
  try{
   const args=await submitArgs(o,2,8,6);
   const [save,sub]=await Promise.all([(async()=>{await jitter();return settle(a.query(saveSql,[o.id,teacher,2,JSON.stringify(cfg(5,9)),verdict(o.definitions)]));})(),(async()=>{await jitter();return settle(b.query(submitSql,args));})()]);
   const s=await state(o.id);outcomes.add(`${save.ok?'edit':'edit-refused'} / ${sub.ok?'submit':'submit-refused'}`);
   expect(save.ok!==sub.ok).toBe(true);
   if(sub.ok) expect(s).toMatchObject({state:'queued',revision:2,plan_revision:2,q1:'8',submitted_events:1});
   else expect([s,sub.v]).toMatchObject([{state:'awaiting_answers',revision:3,plan_revision:null,q1:'5'},expect.stringMatching(/Configuration changed/)]);
   if(!save.ok) expect(save.v).toMatch(/already submitted/);
  }finally{await a.end();await b.end();}
 }
 evidence.editVersusSubmit={pairs:40,observed:[...outcomes]};
},120000);
test('40 simultaneous refund and submit pairs: a refunded order never queues without its refund recorded, and never generates',async()=>{
 const outcomes=new Set<string>();
 for(let i=0;i<40;i++){
  const o=await order();
  const a=await connect(),b=await connect();
  try{
   const args=await submitArgs(o,2,8,6);
   const [refund,sub]=await Promise.all([(async()=>{await jitter();return settle(a.query('select public.record_stripe_refund($1,false,$2,10000,$3) as r',['evt_r_'+o.id,o.pi,'zar']));})(),(async()=>{await jitter();return settle(b.query(submitSql,args));})()]);
   expect(refund.ok).toBe(true);const s=await state(o.id);outcomes.add(sub.ok?'submitted then refunded':'refunded then refused');
   expect(s.refunded).toBe(true);
   if(sub.ok) expect(s).toMatchObject({state:'queued',plan_revision:2});else expect([s,sub.v]).toMatchObject([{state:'cancelled',submitted:false,plan_revision:null},expect.stringMatching(/cannot be submitted/)]);
   // Drain the queue: other tests' queued orders may be claimed, this refunded one never is.
   await b.query('reset role');await b.query('set role service_role');
   for(let job;(job=(await b.query("select public.claim_paper_job('pilot-synthetic-worker','[\"configured-plan@1\",\"configured-plan@2\"]') as r")).rows[0].r);) expect(job.id).not.toBe(o.id);
  }finally{await a.end();await b.end();}
 }
 evidence.refundVersusSubmit={pairs:40,observed:[...outcomes]};
},120000);
test('40 simultaneous payment confirmations and pre-payment edits: the callback never rolls the draft back',async()=>{
 for(let i=0;i<40;i++){
  const o=await order(false);const a=await connect(),b=await connect();
  try{
   const [save,paid]=await Promise.all([(async()=>{await jitter();return settle(a.query(saveSql,[o.id,teacher,1,JSON.stringify(cfg(4,10,false)),verdict(o.definitions,false)]));})(),
    (async()=>{await jitter();return settle(b.query("select public.record_stripe_checkout($1,'checkout.session.completed',false,$2) as r",['evt_p_'+o.id,JSON.stringify(o.session)]));})()]);
   expect(paid.ok).toBe(true);
   const s=await state(o.id);expect(s.state).toBe('awaiting_answers');
   // Paid first: the unpaid-shape draft is refused as a paid configuration only if it carried paid content; it does not.
   if(save.ok) expect(s).toMatchObject({revision:2,q1:'4'});else expect(s).toMatchObject({revision:1,q1:'8'});
  }finally{await a.end();await b.end();}
 }
 evidence.callbackVersusEdit={pairs:40};
},120000);
test('duplicate simultaneous submissions with one key queue once; two stale tabs saving the same revision produce one winner',async()=>{
 const o=await order();const a=await connect(),b=await connect();
 try{
  const args=await submitArgs(o,2,8,6);
  const [x,y]=await Promise.all([settle(a.query(submitSql,args)),settle(b.query(submitSql,args))]);
  expect([x,y]).toEqual([{ok:true,v:expect.anything()},{ok:true,v:expect.anything()}]);expect(await state(o.id)).toMatchObject({state:'queued',submitted_events:1});
  const p=await order();
  const [s1,s2]=await Promise.all([settle(a.query(saveSql,[p.id,teacher,2,JSON.stringify(cfg(5,9)),verdict(p.definitions)])),settle(b.query(saveSql,[p.id,teacher,2,JSON.stringify(cfg(9,5)),verdict(p.definitions)]))]);
  expect([s1.ok,s2.ok].filter(Boolean)).toHaveLength(1);expect([s1,s2].find(x=>!x.ok)!.v).toMatch(/Configuration changed/);expect((await state(p.id)).revision).toBe(3);
 }finally{await a.end();await b.end();}
});
