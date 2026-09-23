import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {it,expect,vi} from 'vitest';
import OrderView from '../../app/(accounts)/teacher/orders/[id]/view';
import {type Order,isSubmission} from '../../lib/jobs/contracts';
import {type Questionnaire} from '../../lib/jobs/questionnaire';
const form:Questionnaire={schemaVersion:2,revision:'a'.repeat(64),items:[{id:'line',title:'Selected question',marks:8,fields:[{id:'setting',label:'Choose the setting',hint:'',required:true,allowAutomatic:false,type:'choice',allowOther:false,choices:[{id:'a',label:'Setting A'}]}]}],paperFields:[]};
const order:Order={id:'00000000-0000-4000-8000-000000000001',title:'My paper',moduleId:'test',release:'1',internalTest:true,state:'awaiting_answers',createdAt:'',updatedAt:'',form,answers:null,documents:[]};
it('posts the bound grouped answers and retains an idempotency key across a refused submission',async()=>{
 const user=userEvent.setup();const requests:string[]=[];
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{requests.push(String(init?.body));return new Response(JSON.stringify({error:'Check the submitted information.'}),{status:422});});
 render(<OrderView initial={order}/>);await user.selectOptions(screen.getByRole('combobox'),'choice:a');await user.click(screen.getByRole('button',{name:'Submit answers'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Check the submitted information.');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Submit answers'})).toBeEnabled());await user.click(screen.getByRole('button',{name:'Submit answers'}));
 expect(fetcher).toHaveBeenCalledTimes(2);expect(requests[0]).toBe(requests[1]);const body=JSON.parse(requests[0]);expect(isSubmission(body)).toBe(true);expect(body.answers).toEqual({schemaVersion:2,revision:form.revision,items:{line:{setting:{kind:'choice',choiceId:'a'}}},paper:{}});
});
it('shows the labelled receipt after reload without requiring the private form',()=>{
 render(<OrderView initial={{...order,state:'held',form:null,answers:{schemaVersion:2,revision:form.revision,items:{line:{setting:{kind:'choice',choiceId:'a'}}},paper:{}},answerSummary:[{title:'Selected question',fields:[{label:'Choose the setting',value:'Setting A'}]}]}}/>);
 expect(screen.getByText('Setting A')).toBeInTheDocument();expect(screen.queryByRole('combobox')).toBeNull();
});

it('focuses the rejected field, describes the error and preserves the selected answer',async()=>{
 const user=userEvent.setup();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({error:'Choose a compatible setting.',fieldError:{itemId:'line',fieldId:'setting'}}),{status:422}));
 render(<OrderView initial={order}/>);const field=screen.getByRole('combobox');await user.selectOptions(field,'choice:a');await user.click(screen.getByRole('button',{name:'Submit answers'}));
 await waitFor(()=>expect(field).toHaveFocus());expect(field).toHaveValue('choice:a');expect(field).toHaveAttribute('aria-invalid','true');expect(field).toHaveAccessibleDescription('Choose a compatible setting.');
 await user.selectOptions(field,'choice:a');expect(field).toHaveAttribute('aria-invalid','false');expect(screen.queryByRole('alert')).toBeNull();
});
it('does not target a field outside the issued questionnaire',async()=>{
 const user=userEvent.setup();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({error:'Check your answers.',fieldError:{itemId:'other',fieldId:'setting'}}),{status:422}));
 render(<OrderView initial={order}/>);const field=screen.getByRole('combobox');await user.selectOptions(field,'choice:a');await user.click(screen.getByRole('button',{name:'Submit answers'}));await screen.findByRole('alert');expect(field).toHaveAttribute('aria-invalid','false');expect(field).toHaveValue('choice:a');
});

// C04A R2: the form first arrives on the unpaid-to-paid transition, without a page reload.
const unpaid:Order={...order,internalTest:false,state:'awaiting_payment',form:null,payment:{status:'open',amountMinor:10000,currency:'zar',testMode:true,checkoutUrl:null,needsAttention:false}};
const paid:Order={...order,internalTest:false,payment:{status:'paid',amountMinor:10000,currency:'zar',testMode:true,checkoutUrl:null,needsAttention:false}};
it('C04 review: payment confirmation displays the newly unlocked fields without reloading',async()=>{
 const user=userEvent.setup();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(paid)));
 render(<OrderView initial={unpaid}/>);expect(screen.queryByRole('combobox')).toBeNull();
 await user.click(screen.getByRole('button',{name:'I have paid: check again'}));
 expect(await screen.findByRole('combobox')).toBeInTheDocument();
});
it('keeps answers entered for the same form revision across a refresh and submits them',async()=>{
 const user=userEvent.setup();const posted:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  const u=String(url);
  if(u.endsWith('/payment')||(!init?.method||init.method==='GET'))return new Response(JSON.stringify(paid));
  posted.push(String(init?.body));return new Response(JSON.stringify({id:order.id}),{status:202});
 });
 render(<OrderView initial={unpaid}/>);await user.click(screen.getByRole('button',{name:'I have paid: check again'}));
 const field=await screen.findByRole('combobox');await user.selectOptions(field,'choice:a');
 await user.click(screen.getByRole('button',{name:'Refresh status'}));
 await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('choice:a'));
 await user.click(screen.getByRole('button',{name:'Submit answers'}));
 await waitFor(()=>expect(posted).toHaveLength(1));
 const body=JSON.parse(posted[0]);expect(isSubmission(body)).toBe(true);
 expect(body.answers).toEqual({schemaVersion:2,revision:form.revision,items:{line:{setting:{kind:'choice',choiceId:'a'}}},paper:{}});
});
it('a changed form revision starts fresh answers for the new form',async()=>{
 const user=userEvent.setup();const revised={...form,revision:'b'.repeat(64)};
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(paid))).mockResolvedValueOnce(new Response(JSON.stringify({...paid,form:revised})));
 render(<OrderView initial={unpaid}/>);await user.click(screen.getByRole('button',{name:'I have paid: check again'}));
 await user.selectOptions(await screen.findByRole('combobox'),'choice:a');
 await user.click(screen.getByRole('button',{name:'Refresh status'}));
 await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue(''));
});
