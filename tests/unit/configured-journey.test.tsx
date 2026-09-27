// CFG01: the real workspace and order components, the real checkout, configuration and
// submission routes, and the real migrated database contract (PGlite). Only Stripe and the
// signed-in session are synthetic. Proves the edited configuration, not checkout-time
// values, is what submission freezes.
import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeAll,beforeEach,afterAll,afterEach,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({db:null as any}));
const teacher='00000000-0000-4000-8000-000000000002',school='00000000-0000-4000-8000-000000000010';
const hash=(s:string)=>s.repeat(64);
async function as(role:'teacher'|'service'|'owner',sql:string,args:unknown[]=[]){
 const db=m.db as PGlite;await db.exec('reset role');
 if(role==='teacher'){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[teacher]);await db.exec('set role authenticated');}
 else if(role==='service') await db.exec('set role service_role');
 try{return await db.query<any>(sql,args);}finally{await db.exec('reset role');}
}
const rpc=(role:'teacher'|'service')=>async(name:string,args:Record<string,unknown>={})=>{
 const keys=Object.keys(args);
 try{const r=await as(role,`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as r`,keys.map(k=>{const v=args[k];return k.endsWith('_ids')?v:v!==null&&typeof v==='object'?JSON.stringify(v):v;}));return {data:r.rows[0].r,error:null};}
 catch(e){return {data:null,error:{message:(e as Error).message}};}
};
vi.mock('../../lib/auth/access',()=>({accountContext:async()=>({kind:'authenticated',user:{id:teacher,email:teacher+'@synthetic.example',email_confirmed_at:'yes'},
 account:{status:'approved',email:teacher+'@synthetic.example',school_id:school,department_id:school},supabase:{rpc:rpc('teacher')}})}));
vi.mock('../../lib/supabase/service',()=>({serviceClient:()=>({rpc:rpc('service')})}));
vi.mock('../../lib/supabase/config',()=>({authConfig:()=>({siteUrl:'http://localhost',trustedOrigins:['http://localhost']}),trustedOrigin:(o:string|null)=>o==='http://localhost'}));
vi.mock('../../lib/payments/stripe',async original=>({...(await original<typeof import('../../lib/payments/stripe')>()),
 createCheckoutSession:async(_c:unknown,input:{orderId:string})=>({id:'cs_test_'+input.orderId.replace(/-/g,''),url:'https://checkout.stripe.com/c/pay/cs_test_x',livemode:false,status:'open',paymentStatus:'unpaid',
  amountTotal:10000,currency:'zar',clientReferenceId:input.orderId,metadataOrderId:input.orderId,paymentIntent:null})}));
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {openBuilder,openReview,payButton} from './paper-journey';
import ConfigureOrder from '../../app/(accounts)/teacher/orders/[id]/configure';
import {POST as checkoutRoute} from '../../app/api/teacher/checkout/route';
import {GET as readRoute,PUT as saveRoute} from '../../app/api/teacher/orders/[id]/configuration/route';
import {POST as submitRoute} from '../../app/api/teacher/orders/[id]/configuration/submit/route';
import {PUT as workspaceRoute} from '../../app/api/teacher/workspace/route';
import {defaultFormatting,type Workspace} from '../../lib/workspace/contracts';

const choice=(id:string,required=true)=>({id,label:'Synthetic '+id,hint:'',required,allowAutomatic:true,type:'choice',allowOther:false,choices:[{id:'red',label:'Red'},{id:'blue',label:'Blue'}]});
const registration=(id:string)=>({module:'synthetic-module',release:'1',entryId:id,kind:id.startsWith('mcq:')?'multiple-choice':'specification',canonicalId:id.split(':')[1],formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:hash('c'),sharedFormsSha256:hash('d'),
 fields:id.startsWith('mcq:')?[]:[choice('setting'),{id:'note',label:'Synthetic note',hint:'',required:false,allowAutomatic:false,type:'text',maxLength:100}],
 shared:{'paper-logistics':{revision:hash('e'),fields:[choice('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[choice('block')]}},sources:[{role:id.startsWith('mcq:')?'task-type':'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:id.startsWith('mcq:')});
const ids=['structured:SPEC_01','structured:SPEC_02','mcq:MCQ_01'];
const workspace:Workspace={schoolName:'Synthetic school',curricula:[{id:'synthetic-module',name:'Synthetic',release:'1',isDemo:false}],module:{id:'synthetic-module',name:'Synthetic',release:'1',isDemo:false},
 entries:[{id:'structured:SPEC_01',title:'Synthetic one',topic:'Synthetic',description:'',marks:{min:4,max:10},orderable:true},{id:'structured:SPEC_02',title:'Synthetic two',topic:'Synthetic',description:'',marks:{min:4,max:10},orderable:true},
  {id:'mcq:MCQ_01',title:'Synthetic MCQ',topic:'Synthetic',description:'',marks:{min:2,max:2},orderable:true}],
 formatting:{revision:0,preferences:defaultFormatting},selection:{revision:1,release:'1',entryIds:ids},purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true}};
const assign=vi.fn();
beforeAll(async()=>{
 const db=new PGlite();m.db=db;await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into public.curriculum_modules(id,name,current_release) values('synthetic-module','Synthetic','1');
 insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values
 ('synthetic-module','1','structured:SPEC_01','Synthetic one','Synthetic','',4,10),('synthetic-module','1','structured:SPEC_02','Synthetic two','Synthetic','',4,10),('synthetic-module','1','mcq:MCQ_01','Synthetic MCQ','Synthetic','',2,2);`);
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[teacher,teacher+'@synthetic.example']);
 await db.query("insert into public.schools(id,slug,name) values($1,'synthetic','Synthetic school')",[school]);
 await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[school]);
 await db.query("insert into public.school_curriculum_access(school_id,module_id) values($1,'synthetic-module')",[school]);
 await db.query("update public.teacher_accounts set status='approved',school_id=$1,department_id=$1,reviewed_by=$2,reviewed_at=now() where user_id=$2",[school,teacher]);
 await db.exec('set role reviseit_catalogue_publisher');
 for(const id of ids) await db.query('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration(id))]);
 await db.query('select public.register_catalogue_execution($1,$2,$3,$4)',['synthetic-module','1',hash('c'),hash('8')]);
 await db.exec('reset role');await db.query("select public.sync_supported_catalogue_readiness('synthetic-module')");
 await db.query("select public.configure_pilot_funding('test',true,5,'pilot-synthetic-worker','Synthetic pilot')");
 await db.query("select public.configure_configurator(true,'Synthetic configurator on')");
 await as('teacher','select public.save_paper_selection($1,$2,0,$3)',['synthetic-module','1',ids]);
},60000);
afterAll(async()=>{await m.db.close();});
beforeEach(()=>{
 process.env.STRIPE_MODE='test';process.env.STRIPE_SECRET_KEY='sk_test_synthetic';process.env.STRIPE_WEBHOOK_SECRET='whsec_syntheticSecretForTests';
 sessionStorage.clear();assign.mockReset();vi.stubGlobal('location',{...window.location,assign});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{
  const request=new Request('http://localhost'+url,{...init,headers:{...(init.headers as object),origin:'http://localhost'}});
  const id=url.match(/orders\/([^/]+)\/configuration/)?.[1];
  if(id&&url.endsWith('/submit'))return submitRoute(request,{params:Promise.resolve({id})});
  if(id)return (init.method==='PUT'?saveRoute:readRoute)(request,{params:Promise.resolve({id})});
  if(url.startsWith('/api/teacher/workspace'))return workspaceRoute(request as any);
  return checkoutRoute(request);
 }));
});
afterEach(()=>vi.unstubAllGlobals());
const row=async(id:string)=>(await as('owner','select o.state,o.answers,c.revision,c.configuration,p.plan from private.paper_orders o join private.paper_configurations c on c.order_id=o.id left join private.paper_configuration_plans p on p.order_id=o.id where o.id=$1',[id])).rows[0];

test('marks are explicit before payment, every choice stays editable after payment, and submission freezes the final edit',async()=>{
 // C05: marks are set in the paper builder (Paper C1); payment happens on the review screen (C4).
 const user=userEvent.setup();const {unmount}=render(<WorkspaceView initial={workspace}/>);
 await openReview(user);expect(payButton()).toBeDisabled();expect(screen.getAllByText('Marks needed').length).toBeGreaterThan(0);
 await user.click(screen.getAllByRole('button',{name:/Back to paper builder/})[0]);
 await user.type(screen.getByLabelText('Total marks for this paper'),'16');
 await user.type(screen.getByLabelText('Synthetic one: marks (4–10)'),'8');
 await user.type(screen.getByLabelText('Synthetic two: marks (4–10)'),'5');
 expect(screen.getByText('Marks needed')).toBeInTheDocument();expect(screen.getByText(/1 still to allocate/)).toBeInTheDocument();
 await user.clear(screen.getByLabelText('Synthetic two: marks (4–10)'));await user.type(screen.getByLabelText('Synthetic two: marks (4–10)'),'6');
 expect(screen.getByText('Ready for payment')).toBeInTheDocument();
 await openReview(user);await user.click(payButton());await waitFor(()=>expect(assign).toHaveBeenCalled());unmount();
 const orderId=(await as('owner','select id from private.paper_orders')).rows[0].id as string;
 expect((await row(orderId)).configuration.lines).toMatchObject({q1:{marks:8},q2:{marks:6},q3:{marks:2}});
 // Stripe confirms payment by its server path; the draft is untouched.
 await as('service','select public.attach_paper_checkout($1,$2,$3,false)',[orderId,'cs_test_'+orderId.replace(/-/g,''),'https://checkout.stripe.com/c/pay/cs_test_x']);
 await as('service',"select public.record_stripe_checkout('evt_paid','checkout.session.completed',false,$1)",[JSON.stringify({id:'cs_test_'+orderId.replace(/-/g,''),clientReferenceId:orderId,metadataOrderId:orderId,livemode:false,amountTotal:10000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:'pi_Synthetic1'})]);

 const submitted=vi.fn();render(<ConfigureOrder orderId={orderId} onSubmitted={submitted}/>);
 await user.click(await screen.findByRole('button',{name:/Q2 ·/}));
 expect(await screen.findByText('Details to complete',{selector:'p'})).toBeInTheDocument();
 // Rebalance after payment: question 1 down, question 2 up.
 await user.click(screen.getByRole('button',{name:'One mark fewer for question 2'}));
 expect(await screen.findByText('1 marks still to allocate',{selector:'p'},{timeout:4000})).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:/Q3 ·/}));
 await user.click(screen.getByRole('button',{name:'One mark more for question 3'}));
 await waitFor(async()=>expect((await row(orderId)).configuration.lines).toMatchObject({q1:{marks:7},q2:{marks:7}}),{timeout:4000});
 // Authored details, including an explicit delegation. The optional note stays blank.
 await user.click(within(screen.getByRole('group',{name:'Synthetic setting'})).getByLabelText(/Choose for me/));
 await user.click(screen.getByRole('button',{name:/Q2 ·/}));
 await user.click(within(screen.getByRole('group',{name:'Synthetic setting'})).getByLabelText('Blue'));
 for(const name of ['Synthetic logistics','Synthetic block']) await user.click(within(screen.getByRole('group',{name})).getByLabelText('Red'));
 await waitFor(()=>expect(screen.getByText('Ready to generate')).toBeInTheDocument(),{timeout:4000});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Submit for generation →'})).toBeEnabled(),{timeout:4000});
 await user.click(screen.getByRole('button',{name:'Submit for generation →'}));
 await waitFor(()=>expect(submitted).toHaveBeenCalled());
 const done=await row(orderId);
 expect(done.state).toBe('queued');
 expect(done.plan.lines.map((l:any)=>[l.id,l.marks])).toEqual([['q1',7],['q2',7],['q3',2]]);
 expect(done.answers.items.q1).toEqual({setting:{kind:'choice',choiceId:'blue'},note:{kind:'omit'}});
 expect(done.answers.items.q2.setting).toEqual({kind:'automatic'});
},30000);

test('a stale tab cannot overwrite a newer saved revision and keeps its own edits on the page',async()=>{
 await (m.db as PGlite).exec('reset role;alter table private.paper_configuration_revisions disable trigger freeze_configuration_revision;alter table private.paper_configuration_plans disable trigger freeze_configuration_plan;delete from private.paper_job_events;delete from private.paper_configuration_plans;delete from private.paper_configuration_revisions;delete from private.paper_configurations;delete from private.paper_payments;delete from private.paper_orders;alter table private.paper_configuration_revisions enable trigger freeze_configuration_revision;alter table private.paper_configuration_plans enable trigger freeze_configuration_plan;');
 const user=userEvent.setup();const {unmount}=render(<WorkspaceView initial={workspace}/>);
 await openBuilder(user);
 await user.type(screen.getByLabelText('Total marks for this paper'),'16');await user.type(screen.getByLabelText('Synthetic one: marks (4–10)'),'8');await user.type(screen.getByLabelText('Synthetic two: marks (4–10)'),'6');
 await openReview(user);await user.click(payButton());await waitFor(()=>expect(assign).toHaveBeenCalled());unmount();
 const orderId=(await as('owner','select id from private.paper_orders')).rows[0].id as string;
 render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}}/>);
 await screen.findByText('Ready for payment');
 await user.click(screen.getByRole('button',{name:/Q2 ·/}));
 // Another tab saves first.
 const current=(await row(orderId)).configuration;current.lines.q1.marks=9;current.lines.q2.marks=5;
 const other=await fetch(`/api/teacher/orders/${orderId}/configuration`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:1,configuration:current})});
 expect(other.status).toBe(200);
 await user.click(screen.getByRole('button',{name:'One mark fewer for question 2'}));
 expect(await screen.findByText('Not saved: this paper changed elsewhere',{},{timeout:4000})).toBeInTheDocument();
 expect(screen.getByLabelText('Marks for question 2')).toHaveValue('7');
 expect((await row(orderId)).configuration.lines.q1.marks).toBe(9);
 expect(screen.queryByText('Set the details')).toBeNull();
});

test('a repeated multiple-choice type and reordering survive checkout, payment, edits and submission as separate occurrences',async()=>{
 await (m.db as PGlite).exec('reset role;alter table private.paper_configuration_revisions disable trigger freeze_configuration_revision;alter table private.paper_configuration_plans disable trigger freeze_configuration_plan;delete from private.paper_job_events;delete from private.paper_configuration_plans;delete from private.paper_configuration_revisions;delete from private.paper_configurations;delete from private.paper_payments;delete from private.paper_orders;alter table private.paper_configuration_revisions enable trigger freeze_configuration_revision;alter table private.paper_configuration_plans enable trigger freeze_configuration_plan;');
 const saved=(await as('owner','select revision from public.paper_selections')).rows[0].revision;
 const user=userEvent.setup();
 const initial={...workspace,selection:{...workspace.selection,revision:saved}};
 const {unmount}=render(<WorkspaceView initial={initial}/>);
 // C05: add a second occurrence of the multiple-choice type (Paper C3), and reorder the
 // structured questions within their section, which is how the paper numbers them.
 await openBuilder(user);await user.click(screen.getByRole('button',{name:'Arrange'}));
 await user.click(screen.getByRole('button',{name:'Add another Synthetic MCQ'}));
 await user.click(screen.getByRole('button',{name:'Back to paper builder'}));
 // [one, two, MCQ, MCQ] -> [two, one, MCQ, MCQ]
 await user.click(screen.getByRole('button',{name:'Move Synthetic two earlier'}));
 await user.click(screen.getByRole('button',{name:'Save selection'}));
 await screen.findByText('Your paper selection is saved. You can return to it later.');
 expect((await as('owner','select entry_ids from public.paper_selections')).rows[0].entry_ids).toEqual(['structured:SPEC_02','structured:SPEC_01','mcq:MCQ_01','mcq:MCQ_01']);
 await user.type(screen.getByLabelText('Total marks for this paper'),'18');
 await user.type(screen.getByLabelText('Multiple-choice section total (optional)'),'4');
 await user.type(screen.getByLabelText('Synthetic one: marks (4–10)'),'8');await user.type(screen.getByLabelText('Synthetic two: marks (4–10)'),'6');
 expect(screen.getByText('Ready for payment')).toBeInTheDocument();
 await openReview(user);await user.click(payButton());await waitFor(()=>expect(assign).toHaveBeenCalled());unmount();
 const orderId=(await as('owner','select id from private.paper_orders')).rows[0].id as string;
 const snap=(await as('owner','select snapshot from private.paper_orders where id=$1',[orderId])).rows[0].snapshot;
 expect(snap.lines.map((l:any)=>[l.id,l.entryId])).toEqual([['q1','structured:SPEC_02'],['q2','structured:SPEC_01'],['q3','mcq:MCQ_01'],['q4','mcq:MCQ_01']]);
 await as('service','select public.attach_paper_checkout($1,$2,$3,false)',[orderId,'cs_test_'+orderId.replace(/-/g,''),'https://checkout.stripe.com/c/pay/cs_test_x']);
 await as('service',"select public.record_stripe_checkout('evt_paid_repeat','checkout.session.completed',false,$1)",[JSON.stringify({id:'cs_test_'+orderId.replace(/-/g,''),clientReferenceId:orderId,metadataOrderId:orderId,livemode:false,amountTotal:10000,currency:'zar',paymentStatus:'paid',status:'complete',paymentIntent:'pi_Synthetic2'})]);
 const submitted=vi.fn();render(<ConfigureOrder orderId={orderId} onSubmitted={submitted}/>);
 // After payment: the two occurrences are 1.1 and 1.2; move the second one earlier.
 expect(await screen.findByRole('button',{name:/Q1.1 ·/})).toBeInTheDocument();expect(screen.getByRole('button',{name:/Q1.2 ·/})).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:/Q1.2 ·/}));
 await user.click(screen.getByRole('button',{name:'Move earlier'}));
 await waitFor(async()=>expect((await row(orderId)).configuration.order).toEqual(['q1','q2','q4','q3']),{timeout:4000});
 // Answer each structured question differently; the multiple-choice occurrences need nothing.
 await user.click(screen.getByRole('button',{name:/Q2 ·/}));
 await user.click(within(screen.getByRole('group',{name:'Synthetic setting'})).getByLabelText('Blue'));
 await user.click(screen.getByRole('button',{name:/Q3 ·/}));
 await user.click(within(screen.getByRole('group',{name:'Synthetic setting'})).getByLabelText('Red'));
 for(const name of ['Synthetic logistics','Synthetic block']) await user.click(within(screen.getByRole('group',{name})).getByLabelText('Red'));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Submit for generation →'})).toBeEnabled(),{timeout:5000});
 await user.click(screen.getByRole('button',{name:'Submit for generation →'}));await waitFor(()=>expect(submitted).toHaveBeenCalled());
 const done=await row(orderId);
 expect(done.state).toBe('queued');
 expect(done.plan.schema).toBe('reviseit/configured-generation-plan@2');expect(done.plan.order).toEqual(['q1','q2','q4','q3']);
 expect(done.plan.lines.map((l:any)=>[l.id,l.entryId,l.marks])).toEqual([['q1','structured:SPEC_02',6],['q2','structured:SPEC_01',8],['q3','mcq:MCQ_01',2],['q4','mcq:MCQ_01',2]]);
 expect(done.answers.items.q1.setting).toEqual({kind:'choice',choiceId:'blue'});expect(done.answers.items.q2.setting).toEqual({kind:'choice',choiceId:'red'});
 expect(done.plan.lines.every((l:any)=>l.sourceBinding?.privateManifestSha256===hash('c'))).toBe(true);
 expect(done.plan.targets).toEqual({paper:18,sections:{multiple_choice:4}});
},40000);
