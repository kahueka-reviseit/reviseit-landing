import { beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { requestRevision } from '../../app/(accounts)/admin/studio/actions';
import StudioRun from '../../app/(accounts)/admin/studio/runs/[id]/page';
const fixture=vi.hoisted(()=>({state:'active',allowance:false,mode:'recorded'}));
vi.mock('../../lib/credits/server',()=>({creditsEnabled:()=>false}));
vi.mock('../../app/(accounts)/staff-header',()=>({StaffHeader:()=>null}));
vi.mock('../../app/(accounts)/admin/studio/actions',()=>({cancelStage:vi.fn(),recordDecision:vi.fn(),retryStage:vi.fn(),requestRevision:vi.fn()}));
vi.mock('../../lib/studio/server',()=>({requireStudioEditor:async()=>({account:{full_name:'Reviewer'},rpc:async(name:string,args:any)=>{
 if(name==='studio_run_view')return {error:null,data:{run:{purpose:'rehearsal',state:fixture.state,current_input_revision:1},inputs:[{input_revision:1}],stages:[],artifacts:[],providerOperations:[],events:[],decisions:[{id:'old',gate:'G3_records',outcome:'approved',invalidated_at:'2026-10-12',rationale:'Replaced by the requested revision'}]}};
 if(name==='studio_execution_view')return {error:null,data:{budget:fixture.allowance?{mode:fixture.mode,trialState:'open',contractId:'test-contract',bundleSha256:'a'.repeat(64),heldMicro:1000000,settledMicro:500000,runLimitMicro:90000000}:null,currentStages:[],revisionRequests:[]}};
 return {error:null,data:{version:2,live:null,previousApproved:args.p_gate==='G3_records',binding:['G3_records','G4_content'].includes(args.p_gate)?{artifacts:[{id:'revision-2',logicalKey:'record:task_type:PHYS_01',sha256:'b'.repeat(64)}]}:null}};
}})}));
beforeEach(()=>{cleanup();fixture.state='active';fixture.allowance=false;fixture.mode='recorded';});
const show=async()=>render(await StudioRun({params:Promise.resolve({id:'00000000-0000-4000-8000-000000000001'})}));
test('reviewer sees operator allowance hold, invalidated approval and two distinct request-change controls',async()=>{
 await show();expect(screen.getByText(/Waiting for the operator to bind/)).toBeTruthy();
 expect(screen.getByText(/approved · invalidated/)).toBeTruthy();
 expect(screen.getAllByRole('button',{name:'Request changes and redraft',hidden:true})).toHaveLength(2);
 expect(screen.getByText('waiting for earlier checkpoint')).toBeTruthy();
});
test('completed run shows recorded status and history without allowing another approval or correction',async()=>{
 fixture.state='completed';fixture.allowance=true;await show();
 expect(screen.getByText(/Recorded replies only/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Request changes and redraft',hidden:true})).toBeNull();
 expect(screen.queryByRole('button',{name:'Record decision'})).toBeNull();
});

test('live budget is identified as OpenRouter analysis with actual dollar amounts and human checkpoints',async()=>{
 fixture.allowance=true;fixture.mode='openrouter';await show();
 expect(screen.getByText(/Live model analysis through OpenRouter/)).toBeTruthy();
 expect(screen.getByText(/Reserved: \$1.00 · Settled: \$0.50 · Run limit: \$90.00 USD/)).toBeTruthy();
 expect(screen.getByText(/Spending limits do not approve content/)).toBeTruthy();
 expect(screen.queryByText(/Recorded replies only|recorded simulation|Live model calls are disabled/)).toBeNull();
});

test('feedback submits the reviewed binding and shows a stale-review refusal without automatic retry',async()=>{
 vi.mocked(requestRevision).mockResolvedValue({ok:false,error:'Review binding changed'});
 await show();const fields=screen.getAllByLabelText('Changes needed');
 fireEvent.change(fields[0],{target:{value:'Correct the source evidence in PHYS_01.'}});
 fireEvent.submit(fields[0].closest('form')!);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Review binding changed'));
 expect(requestRevision).toHaveBeenCalledTimes(1);
 const form=vi.mocked(requestRevision).mock.calls[0][1];
 expect(form.get('gate')).toBe('G3_records');expect(form.get('bound')).toBe('revision-2');expect(form.get('version')).toBe('2');
});
