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
