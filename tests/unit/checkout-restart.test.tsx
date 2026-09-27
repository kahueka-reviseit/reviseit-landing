// C04A R3: the real workspace component, the real checkout and payment routes, and the real
// migrated database contract (PGlite). Only the Stripe transport and the signed-in session are
// synthetic. Proves: cancel or expiry, then an explicit restart, gives a new checkout; duplicate
// clicks and an uncertain (lost-response) retry still give exactly one order.
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeAll,beforeEach,afterAll,afterEach,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({db:null as any,sessions:0}));
const teacher='00000000-0000-4000-8000-000000000002',school='00000000-0000-4000-8000-000000000010';
const hash=(s:string)=>s.repeat(64);
async function as(role:'teacher'|'service',sql:string,args:unknown[]){
 const db=m.db as PGlite;await db.exec('reset role');
 if(role==='teacher'){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await db.exec('set role authenticated');}
 else await db.exec('set role service_role');
 try{return await db.query<any>(sql,args);}finally{await db.exec('reset role');}
}
// A Supabase-shaped rpc bound to one database role, returning {data,error} like the client.
const rpc=(role:'teacher'|'service')=>async(name:string,args:Record<string,unknown>={})=>{
 const keys=Object.keys(args);
 try{const r=await as(role,`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as r`,keys.map(k=>{const v=args[k];return v!==null&&typeof v==='object'?JSON.stringify(v):v;}));return {data:r.rows[0].r,error:null};}
 catch(e){return {data:null,error:{message:(e as Error).message}};}
};
vi.mock('../../lib/auth/access',()=>({accountContext:async()=>({kind:'authenticated',user:{id:teacher,email:teacher+'@synthetic.example',email_confirmed_at:'yes'},
 account:{status:'approved',email:teacher+'@synthetic.example',school_id:school,department_id:school},supabase:{rpc:rpc('teacher')}})}));
vi.mock('../../lib/supabase/service',()=>({serviceClient:()=>({rpc:rpc('service')})}));
vi.mock('../../lib/supabase/config',()=>({authConfig:()=>({siteUrl:'http://localhost',trustedOrigins:['http://localhost']}),trustedOrigin:(o:string|null)=>o==='http://localhost'}));
// Synthetic Stripe: one hosted session per order (the order is the idempotency key).
const sessionFor=(orderId:string,over:object={})=>({id:'cs_test_'+orderId.replace(/-/g,''),url:'https://checkout.stripe.com/c/pay/cs_test_'+orderId.replace(/-/g,''),livemode:false,status:'open',paymentStatus:'unpaid',
 amountTotal:10000,currency:'zar',clientReferenceId:orderId,metadataOrderId:orderId,paymentIntent:null,...over});
vi.mock('../../lib/payments/stripe',async original=>({...(await original<typeof import('../../lib/payments/stripe')>()),
 createCheckoutSession:async(_c:unknown,input:{orderId:string})=>{m.sessions++;return sessionFor(input.orderId);},
 retrieveCheckoutSession:async(_c:unknown,id:string)=>sessionFor(id.replace('cs_test_','').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5')),
 expireCheckoutSession:async(_c:unknown,id:string)=>sessionFor(id.replace('cs_test_','').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'),{status:'expired'})}));
import {toPayment} from './paper-journey';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {POST as checkoutRoute} from '../../app/api/teacher/checkout/route';
import {POST as paymentRoute} from '../../app/api/teacher/orders/[id]/payment/route';
import {defaultFormatting,type Workspace} from '../../lib/workspace/contracts';

const field=(id:string)=>({id,label:'Synthetic '+id,hint:'',required:true,allowAutomatic:false,type:'text',maxLength:100});
const registration=(id:string)=>({module:'synthetic-module',release:'1',entryId:id,kind:id.startsWith('mcq:')?'multiple-choice':'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:hash('c'),sharedFormsSha256:hash('d'),fields:id.startsWith('mcq:')?[]:[field('setting')],shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},sources:[{role:id.startsWith('mcq:')?'task-type':'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:id.startsWith('mcq:')});
const workspace:Workspace={schoolName:'Synthetic school',curricula:[{id:'synthetic-module',name:'Synthetic',release:'1',isDemo:false}],module:{id:'synthetic-module',name:'Synthetic',release:'1',isDemo:false},
 entries:[{id:'structured:SPEC_01',title:'Synthetic structured',topic:'Synthetic',description:'',marks:{min:2,max:10},orderable:true},{id:'mcq:MCQ_01',title:'Synthetic MCQ',topic:'Synthetic',description:'',marks:{min:2,max:2},orderable:true}],
 formatting:{revision:0,preferences:defaultFormatting},selection:{revision:1,release:'1',entryIds:['structured:SPEC_01','mcq:MCQ_01']},purchase:{available:true,amountMinor:10000,currency:'zar'}};
let lose=0;const assign=vi.fn();
beforeAll(async()=>{
 const db=new PGlite();m.db=db;await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into public.curriculum_modules(id,name,current_release) values('synthetic-module','Synthetic','1');
 insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values
 ('synthetic-module','1','structured:SPEC_01','Synthetic structured','Synthetic','',2,10),('synthetic-module','1','mcq:MCQ_01','Synthetic MCQ','Synthetic','',2,2);`);
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[teacher,teacher+'@synthetic.example']);
 await db.query("insert into public.schools(id,slug,name) values($1,'synthetic','Synthetic school')",[school]);
 await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[school]);
 await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[school]);
 await db.query("update public.teacher_accounts set status='approved',school_id=$1,department_id=$1,reviewed_by=$2,reviewed_at=now() where user_id=$2",[school,teacher]);
 await db.exec('set role reviseit_catalogue_publisher');
 for(const id of ['structured:SPEC_01','mcq:MCQ_01']) await db.query('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration(id))]);
 await db.query('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('8')]);
 await db.exec('reset role');await db.query("select public.sync_supported_catalogue_readiness('synthetic-module')");
 await db.query("select public.configure_pilot_funding('test',true,5,'pilot-synthetic-worker','Synthetic pilot')");
 await as('teacher','select public.save_paper_selection($1,$2,0,$3)',['synthetic-module','1',['structured:SPEC_01','mcq:MCQ_01']]);
},60000);
afterAll(async()=>{await m.db.close();});
beforeEach(async()=>{
 process.env.STRIPE_MODE='test';process.env.STRIPE_SECRET_KEY='sk_test_synthetic';process.env.STRIPE_WEBHOOK_SECRET='whsec_syntheticSecretForTests';
 await m.db.exec('delete from private.paper_job_events;delete from private.paper_payments;delete from private.paper_orders;');
 sessionStorage.clear();lose=0;m.sessions=0;assign.mockReset();
 vi.stubGlobal('location',{...window.location,assign});
 // The browser's fetch goes to the real route handlers. `lose` drops the response after the server handled it.
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  const request=new Request('http://localhost'+url,{...init,headers:{...(init.headers as object),origin:'http://localhost'}});
  const id=url.match(/orders\/([^/]+)\/payment/)?.[1];
  const response=id?await paymentRoute(request,{params:Promise.resolve({id})}):await checkoutRoute(request);
  if(lose>0){lose--;throw new TypeError('Network response lost');}
  return response;
 }));
});
afterEach(()=>vi.unstubAllGlobals());
const orders=async()=>(await (m.db as PGlite).query<any>('select o.id,o.state,p.status from private.paper_orders o join private.paper_payments p on p.order_id=o.id order by o.created_at')).rows;
// The pay button now lives on the review screen (Paper C4); the checkout request is unchanged.
async function pay(user:ReturnType<typeof userEvent.setup>){await user.click(await toPayment(user));await waitFor(()=>expect(assign).toHaveBeenCalled());return assign.mock.calls.at(-1)![0] as string;}
async function cancelViaOrderPage(orderId:string){
 const r=await fetch(`/api/teacher/orders/${orderId}/payment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel'})} as RequestInit);
 expect(r.status).toBe(200);
}

test('after cancelling, returning to the same selection starts a new checkout; the old order stays cancelled',async()=>{
 const user=userEvent.setup();const {unmount}=render(<WorkspaceView initial={workspace}/>);
 const first=await pay(user);const [a]=await orders();expect(first).toContain('cs_test_');expect(a.status).toBe('open');
 await cancelViaOrderPage(a.id);expect((await orders())[0]).toMatchObject({state:'cancelled',status:'cancelled'});
 unmount();assign.mockReset();render(<WorkspaceView initial={workspace}/>);
 const second=await pay(user);const rows=await orders();
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({id:a.id,state:'cancelled'});expect(rows[1]).toMatchObject({state:'awaiting_payment',status:'open'});
 expect(second).not.toBe(first);expect(second).toContain(rows[1].id.replace(/-/g,''));
});
test('after expiry, the same selection starts a new checkout',async()=>{
 const user=userEvent.setup();const {unmount}=render(<WorkspaceView initial={workspace}/>);await pay(user);
 const [a]=await orders();await m.db.query("update private.paper_payments set expires_at=now()-interval '1 minute' where order_id=$1",[a.id]);
 unmount();assign.mockReset();render(<WorkspaceView initial={workspace}/>);await pay(user);const rows=await orders();expect(rows).toHaveLength(2);expect(rows[1].id).not.toBe(a.id);
});
test('a lost response keeps the key: the retry returns the same single order and session',async()=>{
 const user=userEvent.setup();render(<WorkspaceView initial={workspace}/>);
 lose=1;await user.click(await toPayment(user));
 expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing has been charged|Network/);expect(assign).not.toHaveBeenCalled();
 expect(await orders()).toHaveLength(1);
 const url=await pay(user);const rows=await orders();expect(rows).toHaveLength(1);expect(url).toContain(rows[0].id.replace(/-/g,''));expect(m.sessions).toBe(1);
});
test('a double click produces one order and one hosted session',async()=>{
 const user=userEvent.setup();const {unmount}=render(<WorkspaceView initial={workspace}/>);
 const button=await toPayment(user);await user.dblClick(button);
 await waitFor(()=>expect(assign).toHaveBeenCalled());expect(await orders()).toHaveLength(1);expect(m.sessions).toBe(1);
 // Returning (for example with the browser's back button) and clicking again resumes the same open checkout.
 unmount();assign.mockReset();render(<WorkspaceView initial={workspace}/>);await pay(user);expect(await orders()).toHaveLength(1);expect(m.sessions).toBe(1);
});
