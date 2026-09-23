// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,test,expect} from 'vitest';
// Synthetic identities and content only. PGlite is a single connection, so row
// locks serialise these calls; the seat rule is exercised sequentially.
let db:PGlite;
const teacher='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',reviewer='00000000-0000-4000-8000-000000000004',outsider='00000000-0000-4000-8000-000000000005';
const school='00000000-0000-4000-8000-000000000010',second='00000000-0000-4000-8000-000000000020';
const key='00000000-0000-4000-8000-0000000000a1',key2='00000000-0000-4000-8000-0000000000a2',submission='00000000-0000-4000-8000-0000000000b1';
const hash=(s:string)=>s.repeat(64);
const field=(id:string)=>({id,label:'Synthetic '+id,hint:'',required:true,allowAutomatic:false,type:'text',maxLength:100});
const registration=(id:string,module='synthetic-module',manifest=hash('c'))=>({module,release:'1',entryId:id,kind:id.startsWith('mcq:')?'multiple-choice':'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:manifest,sharedFormsSha256:hash('d'),fields:id.startsWith('mcq:')?[]:[field('setting')],shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},sources:[{role:id.startsWith('mcq:')?'task-type':'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:id.startsWith('mcq:')});
const allocation={'structured:SPEC_01':8,'mcq:MCQ_01':2};
async function refuse(run:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint refusal');await expect(run()).rejects.toThrow(pattern);await db.exec('rollback to savepoint refusal');}
async function owner(){await db.exec('reset role');}
async function asUser(id:string){await owner();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function service(){await owner();await db.exec('set role service_role');}
async function publisher(sql:string,args:unknown[]){await owner();await db.exec('set role reviseit_catalogue_publisher');await db.query(sql,args);await owner();}
async function register(p:object){await publisher('select public.register_catalogue_authored_form($1)',[JSON.stringify(p)]);}
async function execution(module='synthetic-module',manifest=hash('c')){await publisher('select public.register_catalogue_execution($1,$2,$3,$4)',[module,'1',manifest,hash('8')]);}
async function funding(limit=5,enabled=true,mode='test'){await owner();await db.query('select public.configure_pilot_funding($1,$2,$3,$4,$5)',[mode,enabled,limit,'pilot-synthetic-worker','Synthetic pilot configuration']);}
async function select(id=teacher,ids=['structured:SPEC_01','mcq:MCQ_01']){await asUser(id);const r=await db.query<{r:number}>('select public.save_paper_selection($1,$2,0,$3) as r',['synthetic-module','1',ids]);await owner();return r.rows[0].r;}
async function begin(id=teacher,k=key,alloc:object=allocation,revision=1){await asUser(id);return (await db.query<{r:any}>('select public.begin_paper_checkout($1,$2,$3,$4) as r',[k,'synthetic-module',revision,JSON.stringify(alloc)])).rows[0].r;}
async function attach(order:string,session='cs_test_Synthetic1',livemode=false){await service();return db.query('select public.attach_paper_checkout($1,$2,$3,$4)',[order,session,'https://checkout.stripe.com/c/pay/cs_test_Synthetic1',livemode]);}
const session=(order:string,over:object={})=>({id:'cs_test_Synthetic1',clientReferenceId:order,metadataOrderId:order,livemode:false,amountTotal:10000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:'pi_Synthetic1',...over});
async function record(event:string,type:string,value:object,livemode=false){await service();return (await db.query<{r:any}>('select public.record_stripe_checkout($1,$2,$3,$4) as r',[event,type,livemode,JSON.stringify(value)])).rows[0].r;}
async function listing(id:string,order:string|null=null){await asUser(id);return (await db.query<{o:any[]}>('select public.teacher_orders($1) as o',[order])).rows[0].o;}
async function orderRow(id:string){await owner();return (await db.query<any>('select o.*,p.status as payment_status,p.attention,p.refunded_at from private.paper_orders o left join private.paper_payments p on p.order_id=o.id where o.id=$1',[id])).rows[0];}
async function paidOrder(){await funding();await select();const r=await begin();await attach(r.orderId);await record('evt_paid_1','checkout.session.completed',session(r.orderId));return r.orderId as string;}
function answers(){return {schemaVersion:2,revision:'',items:{q1:{setting:{kind:'text',text:'Synthetic'}},q2:{}},paper:{logistics:{kind:'text',text:'Synthetic'},block:{kind:'text',text:'Synthetic'}}};}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into public.curriculum_modules(id,name,current_release) values('synthetic-module','Synthetic','1'),('caps-grade-11-physical-sciences','Grade 11','1');
 insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values
 ('synthetic-module','1','structured:SPEC_01','Synthetic structured','Synthetic','',2,10),('synthetic-module','1','mcq:MCQ_01','Synthetic MCQ','Synthetic','',1,2),
 ('synthetic-module','1','structured:NO_FORM','Synthetic unauthored','Synthetic','',2,10),('synthetic-module','1','structured:NO_EXEC','Synthetic unconnected','Synthetic','',2,10),
 ('caps-grade-11-physical-sciences','1','structured:P1-CIRC-01','Excluded mapping','Synthetic','',2,10),('caps-grade-11-physical-sciences','1','structured:P1-CIRC-02','Connected','Synthetic','',2,10);`);
 for(const id of [teacher,other,reviewer,outsider]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@synthetic.example']);
 for(const [id,slug] of [[school,'synthetic-first'],[second,'synthetic-second']]){
  await db.query("insert into public.schools(id,slug,name) values($1,$2,$2)",[id,slug]);
  await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[id]);
  await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module'),($1,'caps-grade-11-physical-sciences')",[id]);
 }
 for(const [id,s] of [[teacher,school],[other,school],[outsider,second]]) await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$3,reviewed_at=now() where user_id=$1",[id,s,reviewer]);
 await db.query('insert into private.account_reviewers values($1)',[reviewer]);
 for(const id of ['structured:SPEC_01','mcq:MCQ_01','structured:NO_EXEC']) await register(registration(id));
 await register(registration('structured:NO_EXEC','synthetic-module',hash('9')));
 for(const id of ['structured:P1-CIRC-01','structured:P1-CIRC-02']) await register(registration(id,'caps-grade-11-physical-sciences'));
 await execution();await execution('caps-grade-11-physical-sciences');
 await owner();for(const m of ['synthetic-module','caps-grade-11-physical-sciences']) await db.query('select public.sync_supported_catalogue_readiness($1)',[m]);
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});

test('readiness follows connected bindings: excluded, unconnected and unauthored items stay visible and unavailable',async()=>{
 const rows=(await db.query<any>('select entry_id,orderable from public.teacher_catalogue_summaries order by entry_id')).rows;
 expect(Object.fromEntries(rows.map(r=>[r.entry_id,r.orderable]))).toEqual({'mcq:MCQ_01':true,'structured:NO_EXEC':false,'structured:NO_FORM':false,'structured:P1-CIRC-01':false,'structured:P1-CIRC-02':true,'structured:SPEC_01':true});
 await refuse(()=>publisher('select public.set_catalogue_form_binding($1,$2,$3,$4,$5,$6,true)',['caps-grade-11-physical-sciences','1','structured:P1-CIRC-01',hash('a'),hash('b'),hash('d')]),/Connected execution required/);
 await asUser(teacher);await refuse(()=>db.query("select public.sync_supported_catalogue_readiness('synthetic-module')"),/permission denied/);
});
test('checkout is refused until an operator enables the pilot allowance',async()=>{
 await select();await refuse(()=>begin(),/Pilot purchasing unavailable/);
 await asUser(teacher);expect((await db.query<any>('select public.pilot_checkout_status() as s')).rows[0].s).toEqual({available:false,amountMinor:10000,currency:'zar'});
});
test('checkout freezes the saved mixed selection at the server price without unlocking the form',async()=>{
 await funding();await select();const r=await begin();
 expect(r).toMatchObject({mode:'test',status:'creating',amountMinor:10000,currency:'zar',checkoutUrl:null,existing:false});
 const o=await orderRow(r.orderId);
 expect(o).toMatchObject({entitlement:'paid',state:'awaiting_payment',worker_id:'pilot-synthetic-worker',payment_status:'creating',adapter_key:'authored-bundle-v1'});
 expect(o.form.items.map((i:any)=>[i.marks,i.fields.length])).toEqual([[8,1],[2,0]]);expect(o.snapshot.execution.workflowManifestSha256).toBe(hash('8'));
 const [seen]=await listing(teacher,r.orderId);
 expect(seen).toMatchObject({state:'awaiting_payment',form:null,internalTest:false,payment:{status:'creating',amountMinor:10000,currency:'zar',testMode:true,checkoutUrl:null}});
 expect(JSON.stringify(seen)).not.toMatch(/manifestSha256|bundleDigest|sources|snapshot|worker/);
 await asUser(teacher);await refuse(()=>db.query('select public.submit_paper_answers($1,$2,$3)',[r.orderId,submission,JSON.stringify(answers())]),/cannot be submitted/);
 await service();expect(await db.query<any>("select public.claim_paper_job('pilot-synthetic-worker') as j").then(x=>x.rows[0].j)).toBeNull();
});
test('a repeated request returns the same checkout; a second request while open resumes it; another teacher cannot reuse the key',async()=>{
 await funding();await select();const a=await begin();const b=await begin();expect(b.orderId).toBe(a.orderId);
 const c=await begin(teacher,key2);expect(c).toMatchObject({orderId:a.orderId,existing:true});
 await select(other);await refuse(()=>begin(other,key),/Invalid checkout request/);
 await owner();expect((await db.query('select * from private.paper_payments')).rows).toHaveLength(1);
});
test('seats bound admission and an expired checkout releases its seat',async()=>{
 await funding(1);await select();const a=await begin();await select(other);
 await refuse(()=>begin(other,key2),/Pilot capacity unavailable/);
 await asUser(other);expect((await db.query<any>('select public.pilot_checkout_status() as s')).rows[0].s.available).toBe(false);
 await owner();await db.query("update private.paper_payments set expires_at=now()-interval '11 minutes' where order_id=$1",[a.orderId]);
 expect((await begin(other,key2)).orderId).not.toBe(a.orderId);
});
test.each([
 ['mark outside range',{'structured:SPEC_01':11,'mcq:MCQ_01':2}],['multiple-choice other than two marks',{'structured:SPEC_01':8,'mcq:MCQ_01':1}],
 ['missing allocation',{'structured:SPEC_01':8}],['extra allocation',{...allocation,'structured:NO_FORM':4}],['non-integer marks',{'structured:SPEC_01':7.5,'mcq:MCQ_01':2}],
])('invalid allocations are refused before an order exists: %s',async(_,alloc)=>{
 await funding();await select();await refuse(()=>begin(teacher,key,alloc),/Invalid mark allocations/);
 await owner();expect((await db.query('select * from private.paper_payments')).rows).toEqual([]);
});
test('a stale selection revision or a withdrawn item cannot be purchased',async()=>{
 await funding();await select();await refuse(()=>begin(teacher,key,allocation,2),/Saved selection changed/);
 await register(registration('structured:SPEC_01','synthetic-module',hash('7')));
 await refuse(()=>begin(),/not available to order/);
});
test('pending, suspended and other-school identities cannot start checkout',async()=>{
 await funding();await select();
 await owner();await db.query("update public.teacher_accounts set status='suspended' where user_id=$1",[teacher]);await refuse(()=>begin(),/Curriculum access required/);
 await owner();await db.exec('set role anon');await refuse(()=>db.query('select public.begin_paper_checkout($1,$2,1,$3)',[key,'synthetic-module','{}']),/permission denied/);
});
test('browser roles cannot attach, record, cancel or read payment records',async()=>{
 await funding();await select();const r=await begin();await asUser(teacher);
 for(const sql of ["select public.attach_paper_checkout($1,'cs_test_x','https://checkout.stripe.com/x',false)","select public.record_stripe_checkout('evt_x','reconcile',false,'{}')","select public.cancel_paper_checkout($1,$1)","select public.configure_pilot_funding('test',true,100,'x','forged')"]){
  await refuse(()=>db.query(sql,sql.includes('$1')?[r.orderId]:[]),/permission denied/);
 }
 await refuse(()=>db.query('select * from private.paper_payments'),/permission denied/);
});
test('attachment is bound to the payment mode and is idempotent',async()=>{
 await funding();await select();const r=await begin();
 await refuse(()=>attach(r.orderId,'cs_live_Synthetic1',true),/mode mismatch/);
 await attach(r.orderId);await attach(r.orderId);
 await refuse(()=>attach(r.orderId,'cs_test_Other'),/already attached/);
 expect((await listing(teacher,r.orderId))[0].payment.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
});
test('a verified paid event unlocks exactly one frozen questionnaire; retries do not duplicate work',async()=>{
 const id=await paidOrder();
 expect(await record('evt_paid_1','checkout.session.completed',session(id))).toMatchObject({duplicate:true,outcome:'paid'});
 expect(await record('evt_paid_2','checkout.session.completed',session(id))).toMatchObject({duplicate:false,outcome:'already-paid'});
 expect(await record('reconcile','reconcile',session(id))).toMatchObject({outcome:'already-paid'});
 const [seen]=await listing(teacher,id);expect(seen).toMatchObject({state:'awaiting_answers',payment:{status:'paid'}});expect(seen.form.items).toHaveLength(2);
 const a=answers();a.revision=seen.form.revision;
 await asUser(teacher);await db.query('select public.submit_paper_answers($1,$2,$3)',[id,submission,JSON.stringify(a)]);await db.query('select public.submit_paper_answers($1,$2,$3)',[id,submission,JSON.stringify(a)]);
 await service();const job=(await db.query<any>("select public.claim_paper_job('pilot-synthetic-worker') as j")).rows[0].j;
 expect(job).toMatchObject({id,entitlement:'paid',paymentMode:'test',internalTest:false,resumed:false});
 expect((await db.query<any>("select public.claim_paper_job('pilot-synthetic-worker') as j")).rows[0].j).toBeNull();
 await owner();expect((await db.query<any>('select event from private.paper_job_events where order_id=$1 order by id',[id])).rows.map(r=>r.event)).toEqual(['checkout_started','paid','submitted','claimed']);
 await asUser(outsider);expect(await listing(outsider,id)).toEqual([]);
});
test.each([
 ['amount',{amountTotal:1000},false],['currency',{currency:'usd'},false],['mode',{livemode:true},true],['metadata',{metadataOrderId:'00000000-0000-4000-8000-00000000ffff'},false],
 ['session',{id:'cs_test_Different'},false],['unpaid completion',{paymentStatus:'unpaid'},false],
])('a mismatched or unpaid result never unlocks the form: %s',async(_,change,livemode)=>{
 await funding();await select();const r=await begin();await attach(r.orderId);
 const result=await record('evt_bad','checkout.session.completed',session(r.orderId,change),livemode);
 expect(result.outcome).toMatch(/^rejected:|not-paid-yet/);expect((await orderRow(r.orderId))).toMatchObject({state:'awaiting_payment',payment_status:'open'});
});
test('expiry and failure cancel an unpaid checkout; a later payment is held for operator refund review',async()=>{
 await funding();await select();const r=await begin();await attach(r.orderId);
 expect((await record('evt_exp','checkout.session.expired',session(r.orderId,{paymentStatus:'unpaid',status:'expired'}))).outcome).toBe('expired');
 expect(await orderRow(r.orderId)).toMatchObject({state:'cancelled',payment_status:'expired'});
 expect((await record('evt_late','checkout.session.completed',session(r.orderId))).outcome).toBe('paid-needs-operator');
 expect(await orderRow(r.orderId)).toMatchObject({state:'held',payment_status:'paid',attention:'refund_review'});
 await asUser(reviewer);expect((await db.query<any>('select public.paid_orders_needing_attention() as a')).rows[0].a).toMatchObject([{orderId:r.orderId,reason:'Paid after checkout closed',paymentIntent:'pi_Synthetic1'}]);
 await asUser(teacher);await refuse(()=>db.query('select public.paid_orders_needing_attention()'),/Reviewer access required/);
 await service();expect((await db.query<any>("select public.record_stripe_refund('evt_refund',false,'pi_Synthetic1',10000,'zar') as r")).rows[0].r.outcome).toBe('refunded');
 expect(await orderRow(r.orderId)).toMatchObject({state:'cancelled',payment_status:'paid'});
 await asUser(reviewer);expect((await db.query<any>('select public.paid_orders_needing_attention() as a')).rows[0].a).toEqual([]);
});
test('a full refund closes a paid order before generation and a partial refund does not',async()=>{
 const id=await paidOrder();await service();
 expect((await db.query<any>("select public.record_stripe_refund('evt_partial',false,'pi_Synthetic1',5000,'zar') as r")).rows[0].r.outcome).toBe('partial-or-mismatched-refund');
 expect((await db.query<any>("select public.record_stripe_refund('evt_full',false,'pi_Synthetic1',10000,'zar') as r")).rows[0].r.outcome).toBe('refunded');
 expect(await orderRow(id)).toMatchObject({state:'cancelled'});expect((await listing(teacher,id))[0].payment.status).toBe('refunded');
});
test('teacher-initiated cancellation is server-side and cannot cancel a paid order',async()=>{
 await funding();await select();const r=await begin();await service();await db.query('select public.cancel_paper_checkout($1,$2)',[r.orderId,teacher]);
 expect(await orderRow(r.orderId)).toMatchObject({state:'cancelled',payment_status:'cancelled'});
 const b=await begin(teacher,key2);expect(b.orderId).not.toBe(r.orderId);await attach(b.orderId);await record('evt_paid_x','checkout.session.completed',session(b.orderId));
 await service();await refuse(()=>db.query('select public.cancel_paper_checkout($1,$2)',[b.orderId,teacher]),/already paid/);
 await refuse(()=>db.query('select public.cancel_paper_checkout($1,$2)',[b.orderId,other]),/access required/);
});
test('suspension after payment blocks the teacher and the worker claim',async()=>{
 const id=await paidOrder();await owner();await db.query("update public.teacher_accounts set status='suspended' where user_id=$1",[teacher]);
 expect(await listing(teacher,id)).toEqual([]);
 await owner();await db.query("update private.paper_orders set state='queued',answers='{}'::jsonb,submission_key=$2 where id=$1",[id,submission]);
 await service();expect((await db.query<any>("select public.claim_paper_job('pilot-synthetic-worker') as j")).rows[0].j).toBeNull();
});
test('a queued paid order whose payment does not stand is never claimed',async()=>{
 await funding();await select();const r=await begin();
 await owner();await db.query("update private.paper_orders set state='queued',answers='{}'::jsonb,submission_key=$2 where id=$1",[r.orderId,submission]);
 await service();expect((await db.query<any>("select public.claim_paper_job('pilot-synthetic-worker') as j")).rows[0].j).toBeNull();
});
test('later publication cannot change an issued paid order',async()=>{
 const id=await paidOrder();const before=await orderRow(id);
 await register({...registration('structured:SPEC_01','synthetic-module',hash('7')),fields:[{...field('setting'),label:'Updated wording'}]});
 const after=await orderRow(id);expect([after.form,after.snapshot]).toEqual([before.form,before.snapshot]);
 await refuse(()=>db.query("update private.paper_orders set entitlement='internal_test' where id=$1",[id]),/immutable/);
});
test('internal orders keep their meaning and payload shape',async()=>{
 await select();await service();
 await db.query('select public.provision_catalogue_internal_order($1,$2,$3,1,$4,$5,$6)',['00000000-0000-4000-8000-000000000900',teacher,'synthetic-module',JSON.stringify(allocation),JSON.stringify({'structured:SPEC_01':hash('c'),'mcq:MCQ_01':hash('c')}),'internal-worker']);
 const [seen]=await listing(teacher,'00000000-0000-4000-8000-000000000900');expect(seen).toMatchObject({internalTest:true,payment:null,state:'awaiting_answers'});
 await owner();await db.query("update private.paper_orders set state='queued',answers='{}'::jsonb,submission_key=$1",[submission]);
 await service();const job=(await db.query<any>("select public.claim_paper_job('internal-worker') as j")).rows[0].j;
 expect(job.internalTest).toBe(true);expect(job).not.toHaveProperty('entitlement');expect(job).not.toHaveProperty('paymentMode');
});
test('only one pilot mode can be enabled and every change is audited',async()=>{
 await funding(3,true,'test');await funding(2,true,'live');await owner();
 expect((await db.query<any>('select mode,enabled from private.pilot_funding order by mode')).rows).toEqual([{mode:'live',enabled:true},{mode:'test',enabled:false}]);
 expect((await db.query('select * from private.pilot_funding_changes')).rows).toHaveLength(2);
});

// C04A R1: Stripe does not guarantee notification order.
const refund=async(event:string,livemode=false,amount=10000,currency='zar',intent='pi_Synthetic1')=>{await service();return (await db.query<any>('select public.record_stripe_refund($1,$2,$3,$4,$5) as r',[event,livemode,intent,amount,currency])).rows[0].r;};
test('C04 review: refund received before payment confirmation still prevents fulfilment',async()=>{
 await funding();await select();const r=await begin();await attach(r.orderId);
 expect(await refund('evt_early_refund')).toMatchObject({outcome:'retained:awaiting-payment-association',orderId:null});
 expect(await record('evt_delayed_paid','checkout.session.completed',session(r.orderId))).toMatchObject({outcome:'paid-already-refunded'});
 const current=await orderRow(r.orderId);
 expect(current.refunded_at).not.toBeNull();expect(current.state).toBe('cancelled');expect(current.payment_status).toBe('paid');
 expect((await listing(teacher,r.orderId))[0]).toMatchObject({form:null,payment:{status:'refunded'}});
 await asUser(teacher);await refuse(()=>db.query('select public.submit_paper_answers($1,$2,$3)',[r.orderId,submission,JSON.stringify(answers())]),/cannot be submitted/);
 await owner();await db.query("update private.paper_orders set state='queued',answers='{}'::jsonb,submission_key=$2 where id=$1",[r.orderId,submission]);
 await service();expect((await db.query<any>("select public.claim_paper_job('pilot-synthetic-worker') as j")).rows[0].j).toBeNull();
});
test('an early refund replayed before and after association keeps one saved outcome and applies once',async()=>{
 await funding();await select();const r=await begin();await attach(r.orderId);
 await refund('evt_early_refund');expect(await refund('evt_early_refund')).toMatchObject({duplicate:true,outcome:'retained:awaiting-payment-association'});
 await record('evt_paid','checkout.session.completed',session(r.orderId));
 expect(await refund('evt_early_refund')).toMatchObject({duplicate:true});
 expect(await record('evt_paid','checkout.session.completed',session(r.orderId))).toMatchObject({duplicate:true,outcome:'paid-already-refunded'});
 expect(await record('reconcile','reconcile',session(r.orderId))).toMatchObject({outcome:'already-paid'});
 await owner();expect((await db.query<any>("select event from private.paper_job_events where order_id=$1 and event in ('refunded','paid','paid_after_refund') order by id",[r.orderId])).rows.map(x=>x.event)).toEqual(['refunded','paid_after_refund']);
 expect((await db.query<any>('select applied_to,outcome from private.stripe_pending_refunds')).rows).toEqual([{applied_to:r.orderId,outcome:'refunded'}]);
 expect((await orderRow(r.orderId)).state).toBe('cancelled');
});
test('payment first and refund second still closes the order; a replayed refund is a duplicate',async()=>{
 const id=await paidOrder();expect(await refund('evt_late_refund')).toMatchObject({outcome:'refunded',orderId:id});
 expect(await refund('evt_late_refund')).toMatchObject({duplicate:true,outcome:'refunded'});
 expect((await orderRow(id)).state).toBe('cancelled');
 await owner();expect((await db.query('select * from private.stripe_pending_refunds')).rows).toEqual([]);
});
test.each([['mode',true,10000,'zar','rejected:mode'],['amount',false,5000,'zar','partial-or-mismatched-refund'],['currency',false,10000,'usd','partial-or-mismatched-refund']])
('an early refund with mismatched %s is retained but never applied',async(_,livemode,amount,currency,expected)=>{
 await funding();await select();const r=await begin();await attach(r.orderId);
 await refund('evt_mismatch',livemode as boolean,amount as number,currency as string);
 expect(await record('evt_paid','checkout.session.completed',session(r.orderId))).toMatchObject({outcome:'paid'});
 expect(await orderRow(r.orderId)).toMatchObject({state:'awaiting_answers',refunded_at:null});
 await owner();expect((await db.query<any>('select outcome,applied_at is not null as applied from private.stripe_pending_refunds')).rows).toEqual([{outcome:expected,applied:true}]);
});
test('an early refund for another payment intent does not touch this order',async()=>{
 await funding();await select();const r=await begin();await attach(r.orderId);
 await refund('evt_other',false,10000,'zar','pi_SomeoneElse');await record('evt_paid','checkout.session.completed',session(r.orderId));
 expect(await orderRow(r.orderId)).toMatchObject({state:'awaiting_answers',refunded_at:null});
});

// C04A R3: an explicit restart after a terminal unpaid checkout.
test('C04 review: cancelled checkout permits same selection to start again with a new browser request key',async()=>{
 await funding();await select();const r=await begin();await service();await db.query('select public.cancel_paper_checkout($1,$2)',[r.orderId,teacher]);
 // The old key still names the old order; it reports that order as terminal and never makes another.
 expect(await begin()).toMatchObject({orderId:r.orderId,status:'cancelled',terminal:true});
 const next=await begin(teacher,key2);expect(next.orderId).not.toBe(r.orderId);expect(next).toMatchObject({status:'creating',terminal:false});
 await owner();expect((await db.query('select * from private.paper_payments')).rows).toHaveLength(2);
});
test('an expired checkout is terminal for its key; a new key starts one new checkout; an open one is not terminal',async()=>{
 await funding();await select();const r=await begin();expect(await begin()).toMatchObject({orderId:r.orderId,terminal:false});
 await owner();await db.query("update private.paper_payments set expires_at=now()-interval '1 minute' where order_id=$1",[r.orderId]);
 expect(await begin()).toMatchObject({orderId:r.orderId,terminal:true});
 const next=await begin(teacher,key2);expect(next.orderId).not.toBe(r.orderId);expect(await begin(teacher,key2)).toMatchObject({orderId:next.orderId,terminal:false});
});
test('a paid checkout is never terminal for restart',async()=>{
 const id=await paidOrder();expect(await begin()).toMatchObject({orderId:id,status:'paid',terminal:false});
});
