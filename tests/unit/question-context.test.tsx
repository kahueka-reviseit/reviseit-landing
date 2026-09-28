// C06: catalogue context in the question editor. Synthetic definitions, the real
// ConfigureOrder and a local configuration endpoint; TypeSafe is never reached.
import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {test,expect,vi,afterEach} from 'vitest';
import {isValidElement} from 'react';
vi.mock('server-only',()=>({}));
const auth=vi.hoisted(()=>({supabase:null as any}));
vi.mock('../../lib/auth/access',()=>({requireTeacher:async()=>({supabase:auth.supabase})}));
import ConfigureOrder from '../../app/(accounts)/teacher/orders/[id]/configure';
import OrderPage from '../../app/(accounts)/teacher/orders/[id]/page';
import {briefPrompts} from '../../app/(accounts)/teacher/orders/[id]/question-context';
import {evaluate,project} from '../../lib/configurator/engine';
import {questionContexts} from '../../lib/workspace/catalogue';
import {previewCatalogue,previewConfiguration,previewDefinitions} from '../fixtures/configurator';
import type {Configuration} from '../../lib/configurator/contracts';

const orderId='00000000-0000-4000-8000-0000000000c6';
afterEach(()=>{vi.unstubAllGlobals();});

/** In-memory server: the same engine the application runs, with every request recorded. */
function server(){
 const defs=previewDefinitions();let cfg:Configuration=structuredClone(previewConfiguration);let revision=1;
 const calls:{url:string;method:string;body?:any}[]=[];
 const view=()=>({...project(defs,cfg,evaluate(defs,cfg,{paid:true}),{orderId,state:'awaiting_answers',paymentStatus:'paid',revision,submitted:false}),briefEnabled:true});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=String(input),method=options?.method??'GET',body=options?.body?JSON.parse(String(options.body)):undefined;calls.push({url,method,body});
  if(url.endsWith('/configuration')&&method==='PUT'){if(body.revision!==revision)return new Response(JSON.stringify({error:'changed'}),{status:409});cfg=body.configuration;revision++;}
  else if(!url.endsWith('/configuration'))return new Response(JSON.stringify({error:'unexpected'}),{status:500});
  return new Response(JSON.stringify(view()));
 }));
 return {calls,saved:()=>cfg};
}
const panel=()=>within(screen.getByRole('dialog'));
const context=()=>within(screen.getByRole('region',{name:'About the question you chose'}));
async function open(user:ReturnType<typeof userEvent.setup>,n:string){
 if(screen.queryByRole('dialog'))await user.click(screen.getByRole('button',{name:'Close editor'}));
 await user.click(await screen.findByRole('button',{name:`Edit question ${n}`}));
}

test('the reminder shows the selected occurrence and its pinned, published outline',async()=>{
 server();render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}} catalogue={previewCatalogue}/>);const user=userEvent.setup();
 await open(user,'3');
 expect(context().getByText('Synthetic relationships')).toBeVisible();
 expect(context().getByText('Learners use a synthetic relationship and compare two synthetic cases.')).toBeVisible();
 expect(context().getByRole('img',{name:'Synthetic diagram for the authored question'})).toHaveAttribute('src','/sample-diagrams/forces.png');
 expect(context().getByText('12 marks selected')).toBeVisible();expect(context().getByText('Range: 8–14')).toBeVisible();expect(context().getByText('3–4 subquestions')).toBeVisible();
 const toggle=context().getByRole('button',{name:'View question outline'});expect(toggle).toHaveAttribute('aria-expanded','false');
 expect(screen.queryByText('Recall a synthetic idea')).not.toBeVisible();
 await user.click(toggle);expect(toggle).toHaveAttribute('aria-expanded','true');expect(toggle).toHaveAccessibleName('Hide question outline');
 const outline=document.getElementById(toggle.getAttribute('aria-controls')!)!;
 expect(within(outline).getByText(/Your final question can vary within its range/)).toBeVisible();
 expect(within(outline).getAllByRole('listitem').map(r=>r.textContent)).toEqual(['3.1Recall a synthetic ideaRemember','3.2Use a synthetic relationshipApply','3.3Compare two synthetic casesAnalyse']);
 // Context rows are not controls: no new checkbox or radio for parts appears in the reminder.
 expect(within(outline).queryAllByRole('checkbox')).toHaveLength(0);expect(within(outline).queryAllByRole('radio')).toHaveLength(0);
});

test('missing catalogue information stays explicit and no outline is fabricated',async()=>{
 server();render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}} catalogue={previewCatalogue}/>);const user=userEvent.setup();
 await open(user,'2');
 expect(context().getByText('A short description has not been published for this question.')).toBeVisible();
 expect(context().getByText('Subquestion range not published')).toBeVisible();
 expect(context().getByText('An example question outline has not been published for this question.')).toBeVisible();
 expect(context().queryByRole('img')).toBeNull();expect(context().queryByRole('button')).toBeNull();
 // Multiple choice: fixed marks, one item, no outline and no invented description.
 await open(user,'1.2');
 expect(context().getByText('Synthetic options')).toBeVisible();expect(context().getByText('2 marks · fixed')).toBeVisible();
 expect(context().getByText('One multiple-choice item')).toBeVisible();expect(context().queryByText(/Range:/)).toBeNull();
 expect(context().getByText('A short description has not been published for this question.')).toBeVisible();
 expect(context().queryByRole('button')).toBeNull();
});

test('prompts come from the authored form and never answer, require or interpret anything',async()=>{
 const s=server();render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}} catalogue={previewCatalogue}/>);const user=userEvent.setup();
 await open(user,'2');
 const prompts=panel().getByRole('list',{name:'For this question, you could describe'});
 expect(within(prompts).getAllByRole('listitem').map(li=>li.textContent)).toEqual(['Synthetic setting','Synthetic shade','Anything else']);
 expect(panel().getByLabelText('Your brief',{exact:true})).toHaveAccessibleDescription('Synthetic setting Synthetic shade Anything else');
 expect(panel().getByLabelText('Your brief',{exact:true})).toHaveValue('');
 await user.click(panel().getByRole('button',{name:'Or choose the options yourself →'}));
 expect(panel().getAllByRole('radio').filter(r=>(r as HTMLInputElement).checked)).toHaveLength(0);
 expect(s.calls.filter(c=>c.method!=='GET')).toEqual([]);
 expect(briefPrompts([{id:'a',label:'Optional first',hint:'',required:false,allowAutomatic:true,type:'text',maxLength:10},{id:'b',label:'Required second',hint:'',required:true,allowAutomatic:false,type:'text',maxLength:10}])).toEqual(['Required second','Optional first']);
});

test('outline toggling, question switching and reordering keep the right draft and send no interpretation',async()=>{
 const s=server();render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}} catalogue={previewCatalogue}/>);const user=userEvent.setup();
 await open(user,'3');
 const words='Two familiar synthetic cases, then explain the difference.';
 await user.type(panel().getByLabelText('Your brief',{exact:true}),words);
 const toggle=context().getByRole('button',{name:'View question outline'});
 await user.click(toggle);await user.click(toggle);await user.click(toggle);
 expect(panel().getByLabelText('Your brief',{exact:true})).toHaveValue(words);
 await open(user,'2');expect(panel().getByLabelText('Your brief',{exact:true})).toHaveValue('');
 await user.type(panel().getByLabelText('Your brief',{exact:true}),'Keep this for question two.');
 await open(user,'3');
 expect(panel().getByLabelText('Your brief',{exact:true})).toHaveValue(words);
 expect(context().getByRole('button',{name:'Hide question outline'})).toHaveAttribute('aria-expanded','true');
 // Reorder the occurrence: identity, words and disclosure follow it to its new number.
 await user.click(panel().getByText('Marks and question outline',{exact:false}));
 await user.click(panel().getByRole('button',{name:'Move earlier'}));
 await waitFor(()=>expect(panel().getByText(/^Question 2 · Structured · SYN-02$/)).toBeVisible(),{timeout:3000});
 expect(panel().getByLabelText('Your brief',{exact:true})).toHaveValue(words);
 expect(within(document.getElementById(context().getByRole('button',{name:'Hide question outline'}).getAttribute('aria-controls')!)!).getAllByRole('listitem')[0]).toHaveTextContent('2.1');
 await waitFor(()=>expect(s.saved().order).toEqual(['q2','q1','q3','q4']),{timeout:3000});
 await waitFor(()=>expect(s.saved().briefs?.q2?.text).toBe(words),{timeout:3000});
 expect(s.saved().briefs?.q1?.text).toBe('Keep this for question two.');
 // Only the teacher's own words and order were saved; no answer was chosen for them.
 expect(s.saved().answers).toEqual({items:{},paper:{}});
 expect(s.calls.some(c=>/interpret|hints/.test(c.url))).toBe(false);
});

test('the order page reads safe context from the order release only',async()=>{
 const order={id:orderId,configurable:true,moduleId:'synthetic-module',release:'2026-09-a'};
 const chain:{method:string;args:unknown[]}[]=[];
 const query:any={select:(...a:unknown[])=>(chain.push({method:'select',args:a}),query),eq:(...a:unknown[])=>(chain.push({method:'eq',args:a}),query),
  then:(resolve:(v:unknown)=>void)=>resolve({data:[{entry_id:'structured:SYN-02',topic:' Topic ',description:'',thumbnail_alt:'A diagram',thumbnail_png:'secret',preview:{private:true}}]})};
 auth.supabase={rpc:async()=>({data:[order],error:null}),from:(table:string)=>(chain.push({method:'from',args:[table]}),query)};
 const element=await OrderPage({params:Promise.resolve({id:orderId})});
 expect(isValidElement(element)).toBe(true);
 expect(chain).toEqual([{method:'from',args:['teacher_catalogue_summaries']},{method:'select',args:['entry_id,topic,description,thumbnail_alt']},
  {method:'eq',args:['module_id','synthetic-module']},{method:'eq',args:['release','2026-09-a']}]);
 expect((element as any).props.catalogue).toEqual({'structured:SYN-02':{topic:'Topic',description:'',
  thumbnail:{src:'/api/teacher/catalogue/thumbnail?curriculum=synthetic-module&release=2026-09-a&entry=structured%3ASYN-02',alt:'A diagram'}}});
 // Legacy orders make no catalogue read at all.
 chain.length=0;auth.supabase.rpc=async()=>({data:[{...order,configurable:false}],error:null});
 expect((await OrderPage({params:Promise.resolve({id:orderId})}) as any).props.catalogue).toEqual({});expect(chain).toEqual([]);
});

test('context projection keeps only public fields and skips malformed rows',()=>{
 expect(questionContexts('m','r1',[null,{topic:'no id'},{entry_id:'x',topic:3,description:'  Short.  ',thumbnail_alt:'',source_sha256:'private'}])).toEqual({x:{topic:'',description:'Short.'}});
 expect(questionContexts('m','r1',undefined)).toEqual({});
});
