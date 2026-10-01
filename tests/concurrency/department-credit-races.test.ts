// CFG01 under genuine concurrency: separate PostgreSQL sessions racing configuration
// saves, submission, payment confirmation and refunds for one configured order.
// Synthetic data; a disposable local database created and dropped by this test.
import {Client} from 'pg';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,test,expect} from 'vitest';
const url=process.env.REVISEIT_CONCURRENCY_DATABASE_URL||'';
if(!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) throw new Error('Set REVISEIT_CONCURRENCY_DATABASE_URL to a disposable loopback PostgreSQL server');
const name='credit_races_'+Date.now();const dbUrl=url.replace(/\/[^/]*$/,'/'+name);
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

const colleague='00000000-0000-4000-8000-000000000003';
async function actor(id:string){const c=await connect();await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await c.query('set role authenticated');return c;}
async function quoteFor(c:Client,id:string){await owner.query('set role service_role');const candidate=await one(owner,'select public.configured_checkout_candidate($1,$2,1,$3,$4) as r',[id,'synthetic-module',JSON.stringify(alloc),JSON.stringify(targets)]);await owner.query('reset role');return one(c,'select public.quote_department_paper($1,1,$2,$3,$4) as r',['synthetic-module',JSON.stringify(alloc),JSON.stringify(targets),candidate.definitionsSha256]);}
beforeAll(async()=>{
 await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,'colleague@synthetic.example',now())",[colleague]);
 await owner.query("update public.teacher_accounts set status='approved',school_id=$1,department_id=$1,reviewed_by=$2,reviewed_at=now() where user_id=$3",[school,teacher,colleague]);
 await owner.query('insert into private.credit_administrators values($1)',[teacher]);
 await owner.query("update private.credit_settings set enabled=true");
 const c=await actor(colleague);await c.query("select public.save_paper_selection('synthetic-module','1',0,$1)",[ids]);await c.end();
});
test('40 simultaneous creations cannot both spend the department’s last paper balance',async()=>{
 const a=await actor(teacher),b=await actor(colleague);let winsA=0,winsB=0;
 try{for(let i=0;i<40;i++){
 await a.query("select public.grant_department_credit($1,'test',15615,'staff_grant',null,null,'Synthetic race',$2)",[school,randomUUID()]);
 const qa=await quoteFor(a,teacher),qb=await quoteFor(b,colleague);
 const result=await Promise.allSettled([one(a,'select public.create_department_paper($1,$2) as r',[qa.quoteId,randomUUID()]),one(b,'select public.create_department_paper($1,$2) as r',[qb.quoteId,randomUUID()])]);
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const failed=result.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(String(failed.reason)).toMatch(/credit|balance/i);
 if(result[0].status==='fulfilled')winsA++;else winsB++;
 expect(Number(await one(owner,"select private.credit_balance($1,'test') as r",[school]))).toBe(0);
 }evidence.lastBalance={pairs:40,winsA,winsB};}finally{await a.end();await b.end();}
});
test('40 simultaneous refund and confirmation pairs never expose refunded top-up credit',async()=>{
 await owner.query("update public.teacher_accounts set department_role='head' where user_id=$1",[teacher]);
 await owner.query('insert into private.credit_topup_amounts values(50000,true)');
 const head=await actor(teacher),a=await connect(),b=await connect();
 try{for(let i=0;i<40;i++){
 const p=await one(head,"select public.begin_credit_purchase(50000,'Synthetic concurrency',$1) as r",[randomUUID()]);
 const compact=p.id.replaceAll('-',''),pi='pi_'+compact;
 const session={id:'cs_test_'+compact,clientReferenceId:p.id,metadataPurchaseId:p.id,livemode:false,amountTotal:50000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:pi};
 await Promise.all([
 a.query("select public.record_credit_checkout($1,'checkout.session.completed',false,$2)",['evt_paid_'+compact,JSON.stringify(session)]),
 b.query('select public.record_credit_payment_alert($1,false,$2,50000,false)',['evt_refund_'+compact,pi])]);
 expect(Number(await one(owner,"select private.credit_balance($1,'test') as r",[school]))).toBe(0);
 expect(await one(owner,'select status as r from private.credit_purchases where id=$1',[p.id])).toBe('attention');
 }evidence.refunds={pairs:40};}finally{await head.end();await a.end();await b.end();}
});
