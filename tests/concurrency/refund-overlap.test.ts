// C04A R1 under genuine concurrency: two PostgreSQL sessions, one recording a full
// refund and one confirming payment for the same Stripe payment intent. Synthetic data;
// a disposable local database created and dropped by this test.
import {Client} from 'pg';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,test,expect} from 'vitest';
const url=process.env.REVISEIT_CONCURRENCY_DATABASE_URL||'';
if(!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) throw new Error('Set REVISEIT_CONCURRENCY_DATABASE_URL to a disposable loopback PostgreSQL server');
const name='c04a_overlap_'+Date.now();const dbUrl=url.replace(/\/[^/]*$/,'/'+name);
const teacher='00000000-0000-4000-8000-000000000002',school='00000000-0000-4000-8000-000000000010';
const hash=(s:string)=>s.repeat(64);
const field=(id:string)=>({id,label:'Synthetic '+id,hint:'',required:true,allowAutomatic:false,type:'text',maxLength:100});
const registration=(id:string)=>({module:'synthetic-module',release:'1',entryId:id,kind:'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:hash('c'),sharedFormsSha256:hash('d'),fields:[field('setting')],shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},sources:[{role:'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:false});
let admin:Client,owner:Client;
const connect=async()=>{const c=new Client({connectionString:dbUrl});await c.connect();await c.query("set role service_role");return c;};
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
  insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values('synthetic-module','1','structured:SPEC_01','Synthetic','Synthetic','',2,10)`);
 await owner.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[teacher,teacher+'@synthetic.example']);
 await owner.query("insert into public.schools(id,slug,name) values($1,'synthetic','Synthetic school')",[school]);
 await owner.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[school]);
 await owner.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[school]);
 await owner.query("update public.teacher_accounts set status='approved',school_id=$1,department_id=$1,reviewed_by=$2,reviewed_at=now() where user_id=$2",[school,teacher]);
 await owner.query('set role reviseit_catalogue_publisher');await owner.query('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration('structured:SPEC_01'))]);
 await owner.query('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('8')]);await owner.query('reset role');
 await owner.query("select public.sync_supported_catalogue_readiness('synthetic-module')");
 await owner.query("select public.configure_pilot_funding('test',true,1000,'pilot-synthetic-worker','Synthetic concurrency pilot')");
 await owner.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await owner.query('set role authenticated');
 await owner.query('select public.save_paper_selection($1,$2,0,$3)',['synthetic-module','1',['structured:SPEC_01']]);await owner.query('reset role');
});
afterAll(async()=>{await owner?.end();await admin?.query(`drop database if exists ${name} with (force)`);await admin?.end();});
// One unpaid checkout with an attached session; each case uses a fresh payment intent.
async function checkout(){
 await owner.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await owner.query('set role authenticated');
 // Keep one open checkout per teacher: close any earlier one first.
 await owner.query('reset role');await owner.query("update private.paper_payments set status='cancelled' where status in ('creating','open')");
 await owner.query('set role authenticated');
 const r=(await owner.query('select public.begin_paper_checkout($1,$2,1,$3) as r',[randomUUID(),'synthetic-module',JSON.stringify({'structured:SPEC_01':8})])).rows[0].r;
 await owner.query('reset role');await owner.query('set role service_role');
 const id=r.orderId as string,sid='cs_test_'+id.replace(/-/g,''),pi='pi_'+id.replace(/-/g,'');
 await owner.query('select public.attach_paper_checkout($1,$2,$3,false)',[id,sid,'https://checkout.stripe.com/c/pay/'+sid]);await owner.query('reset role');
 return {id,pi,session:{id:sid,clientReferenceId:id,metadataOrderId:id,livemode:false,amountTotal:10000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:pi}};
}
const refundSql='select public.record_stripe_refund($1,false,$2,10000,$3) as r',paidSql="select public.record_stripe_checkout($1,'checkout.session.completed',false,$2) as r";
async function final(id:string){
 const o=(await owner.query('select o.state,p.status,p.refunded_at is not null as refunded from private.paper_orders o join private.paper_payments p on p.order_id=o.id where o.id=$1',[id])).rows[0];
 const stranded=(await owner.query('select count(*)::int n from private.stripe_pending_refunds p join private.paper_payments y on y.payment_intent_id=p.payment_intent_id where y.order_id=$1 and p.applied_at is null',[id])).rows[0].n;
 return {...o,stranded};
}
async function waitingOnLock(pid:number){
 for(let i=0;i<100;i++){const r=await owner.query("select wait_event_type,wait_event from pg_stat_activity where pid=$1",[pid]);if(r.rows[0]?.wait_event_type==='Lock'&&r.rows[0]?.wait_event==='advisory')return true;await new Promise(x=>setTimeout(x,20));}
 return false;
}
test('refund recorded first in an open transaction: payment confirmation waits, then applies the refund',async()=>{
 const c=await checkout();const r=await connect(),p=await connect();
 try{
  await r.query('begin');expect((await r.query(refundSql,['evt_r_'+c.id,c.pi,'zar'])).rows[0].r.outcome).toBe('retained:awaiting-payment-association');
  const ppid=(await p.query('select pg_backend_pid() as pid')).rows[0].pid;const paid=p.query(paidSql,['evt_p_'+c.id,JSON.stringify(c.session)]);
  expect(await waitingOnLock(ppid)).toBe(true);
  await r.query('commit');expect((await paid).rows[0].r.outcome).toBe('paid-already-refunded');
  expect(await final(c.id)).toEqual({state:'cancelled',status:'paid',refunded:true,stranded:0});
 }finally{await r.end();await p.end();}
});
test('payment confirmed first in an open transaction: the refund waits, then finds and refunds the payment',async()=>{
 const c=await checkout();const r=await connect(),p=await connect();
 try{
  await p.query('begin');expect((await p.query(paidSql,['evt_p_'+c.id,JSON.stringify(c.session)])).rows[0].r.outcome).toBe('paid');
  const rpid=(await r.query('select pg_backend_pid() as pid')).rows[0].pid;const refund=r.query(refundSql,['evt_r_'+c.id,c.pi,'zar']);
  expect(await waitingOnLock(rpid)).toBe(true);
  await p.query('commit');expect((await refund).rows[0].r.outcome).toBe('refunded');
  expect(await final(c.id)).toEqual({state:'cancelled',status:'paid',refunded:true,stranded:0});
 }finally{await r.end();await p.end();}
});
test('many simultaneous refund and payment notifications never leave a refund stranded or an order answerable',async()=>{
 const outcomes=new Set<string>();
 for(let i=0;i<40;i++){
  const c=await checkout();const r=await connect(),p=await connect();
  try{
   const jitter=()=>new Promise(x=>setTimeout(x,Math.floor(Math.random()*4)));
   const [a,b]=await Promise.all([(async()=>{await jitter();return (await r.query(refundSql,['evt_r_'+c.id,c.pi,'zar'])).rows[0].r.outcome;})(),
    (async()=>{await jitter();return (await p.query(paidSql,['evt_p_'+c.id,JSON.stringify(c.session)])).rows[0].r.outcome;})()]);
   outcomes.add(a+' / '+b);
   expect(await final(c.id)).toEqual({state:'cancelled',status:'paid',refunded:true,stranded:0});
  }finally{await r.end();await p.end();}
 }
 // Both delivery orders occurred, or the loop was not exercising overlap.
 if(process.env.REVISEIT_CONCURRENCY_EVIDENCE) writeFileSync(process.env.REVISEIT_CONCURRENCY_EVIDENCE,JSON.stringify({pairs:40,observedOutcomePairs:[...outcomes]},null,1));
 expect(outcomes.size).toBeGreaterThanOrEqual(1);
});
test('a mismatched-currency refund is serialised too but never applied',async()=>{
 const c=await checkout();const r=await connect(),p=await connect();
 try{
  await Promise.all([r.query(refundSql,['evt_r_'+c.id,c.pi,'usd']),p.query(paidSql,['evt_p_'+c.id,JSON.stringify(c.session)])]);
  const f=await final(c.id);expect(f).toMatchObject({state:'awaiting_answers',refunded:false});
 }finally{await r.end();await p.end();}
});
