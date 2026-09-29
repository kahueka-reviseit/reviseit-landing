// C10: the teacher sees supported cognitive ranges that narrow as linked choices are made.
// Synthetic definitions, the real ConfigureOrder and an in-memory configuration endpoint.
import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {test,expect,vi,afterEach} from 'vitest';
import ConfigureOrder from '../../app/(accounts)/teacher/orders/[id]/configure';
import {evaluate,project} from '../../lib/configurator/engine';
import {config,definitions,example,mcq,variant} from '../fixtures/composition';
import type {Configuration} from '../../lib/configurator/contracts';

const orderId='00000000-0000-4000-8000-0000000000c10';
afterEach(()=>{vi.unstubAllGlobals();});
function server(items=[mcq,example],marks=[2,10]){
 const defs=definitions(items);let cfg:Configuration=config(marks);let revision=1;
 const view=()=>project(defs,cfg,evaluate(defs,cfg,{paid:true}),{orderId,state:'awaiting_answers',paymentStatus:'paid',revision,submitted:false});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/configuration')&&options?.method==='PUT'){const body=JSON.parse(String(options.body));if(body.revision!==revision)return new Response('{}',{status:409});cfg=body.configuration;revision++;}
  else if(!url.endsWith('/configuration'))return new Response('{}',{status:500});
  return new Response(JSON.stringify(view()));
 }));
}
const rowText=(list:HTMLElement,label:string)=>within(list).getAllByRole('listitem').find(li=>li.textContent!.startsWith(label))!.textContent;

test('the review shows settled and open marks per category, never the whole question as unclassified',async()=>{
 server();render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Review paper →'}));
 const mix=screen.getByRole('list',{name:'Cognitive mix for the paper'});
 expect(rowText(mix,'Understand')).toBe('Understand2');expect(rowText(mix,'Remember')).toBe('Remember0–9');expect(rowText(mix,'Not yet classified')).toBe('Not yet classified0');
 expect(screen.getByText('2 marks settled in a category · 10 still open between categories')).toBeVisible();
 expect(screen.getByText(/highest values of different categories cannot all happen together/)).toBeVisible();
});

test('a linked choice narrows the question’s range and explains the included subquestions',async()=>{
 server();render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Edit question 2'}));
 const dialog=within(screen.getByRole('dialog'));
 const line=()=>dialog.getByRole('list',{name:'Cognitive mix for question 2'});
 expect(rowText(line(),'Remember')).toBe('Remember0–9');
 expect(dialog.getByText(/Source example \(5 subquestions, 10 marks\): Remember 4 · Apply 3 · Analyse 1 · Apply or Analyse 2/)).toBeInTheDocument();
 await user.click(dialog.getByRole('radio',{name:'both'}));
 await waitFor(()=>expect(rowText(line(),'Remember')).toBe('Remember2–9'),{timeout:3000});
 expect(dialog.getAllByText('Synthetic: set by your statement choice.')).toHaveLength(2);
 expect(dialog.getByText('3 in the source example')).toBeInTheDocument();
});

test('an unresolved variant shows each alternative’s own example; choosing one narrows to its example and tasks',async()=>{
 server([variant],[12]);render(<ConfigureOrder orderId={orderId} onSubmitted={()=>{}}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Edit question 1'}));
 const dialog=within(screen.getByRole('dialog'));
 expect(dialog.getByText(/Source example · Full \(4 subquestions, 14 marks\)/)).toBeInTheDocument();
 expect(dialog.getByText(/Source example · Compressed \(3 subquestions, 9 marks\)/)).toBeInTheDocument();
 expect(dialog.getByText(/have not yet settled which of its 2 structures \(Full, Compressed\)/)).toBeInTheDocument();
 await user.click(dialog.getByRole('radio',{name:'compressed'}));
 await waitFor(()=>expect(dialog.queryByText(/Source example · Full/)).toBeNull(),{timeout:3000});
 expect(dialog.getByText(/Source example · Compressed \(3 subquestions, 9 marks\)/)).toBeInTheDocument();
 expect(dialog.getAllByText('Part of the Compressed structure.')).toHaveLength(3);
});
