// C05A: Codex's review regressions (R1, R2), adapted. R1 is checked through the screen
// because targets and marks are no longer written to browser storage at all.
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {test,expect,vi} from 'vitest';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {workspace} from '../fixtures/workspace';
import type {Workspace} from '../../lib/workspace/contracts';
const base:Workspace={...workspace,curricula:[workspace.module!],purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true,maxQuestions:20,maxStructured:10,maxMultipleChoice:10},entries:[workspace.entries[0],{id:'mcq:REVIEW',title:'Synthetic review MCQ',topic:'Mechanics',description:'',marks:{min:2,max:2},orderable:true}],selection:{revision:1,release:'demo-1',entryIds:['DEMO_01','mcq:REVIEW']}};
test('an explicit zero MCQ shape remains a zero target and prevents a mixed checkout',async()=>{
 window.history.replaceState(null,'','/?view=shape');
 render(<WorkspaceView initial={base}/>);const user=userEvent.setup();
 await user.type(screen.getByPlaceholderText('For example 150'),'10');
 await user.type(screen.getByLabelText('Multiple-choice marks'),'0');
 await user.click(screen.getByRole('button',{name:'Save and open the builder'}));
 await user.type(screen.getByRole('spinbutton',{name:'Reading a motion graph: marks (8–12)'}),'8');
 await user.click(screen.getByRole('button',{name:/Review and pay/}));
 expect(screen.getByRole('button',{name:'Pay with Stripe · R100'})).toBeDisabled();
 // The teacher's zero is kept and explained; the selection is not changed for them.
 expect(screen.getByText('Multiple choice section: 2 of 0 marks.')).toBeVisible();
 expect(screen.getByText('Structured section: 8 of 10 marks.')).toBeVisible();
 expect(screen.getByText('Multiple choice, 1 question')).toBeVisible();
});
test('a blank multiple-choice field sets only the paper total',async()=>{
 window.history.replaceState(null,'','/?view=shape');
 render(<WorkspaceView initial={{...base,selection:{revision:1,release:'demo-1',entryIds:['DEMO_01']}}}/>);const user=userEvent.setup();
 await user.type(screen.getByPlaceholderText('For example 150'),'8');
 await user.click(screen.getByRole('button',{name:'Save and open the builder'}));
 expect(screen.getByLabelText('Total marks for this paper')).toHaveValue(8);
 expect(screen.getByLabelText('Structured section total (optional)')).toHaveValue(null);
 await user.type(screen.getByRole('spinbutton',{name:'Reading a motion graph: marks (8–12)'}),'8');
 await user.click(screen.getByRole('button',{name:/Review and pay/}));
 expect(screen.getByRole('button',{name:'Pay with Stripe · R100'})).toBeEnabled();
});
test('correcting the selection after a zero multiple-choice shape unblocks payment without changing the targets',async()=>{
 window.history.replaceState(null,'','/?view=shape');
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({revision:2})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={base}/>);const user=userEvent.setup();
 await user.type(screen.getByPlaceholderText('For example 150'),'10');await user.type(screen.getByLabelText('Multiple-choice marks'),'0');
 await user.click(screen.getByRole('button',{name:'Save and open the builder'}));
 await user.type(screen.getByRole('spinbutton',{name:'Reading a motion graph: marks (8–12)'}),'10');
 await user.click(screen.getByRole('button',{name:'Arrange'}));await user.click(screen.getByRole('button',{name:'Remove Synthetic review MCQ'}));
 await user.click(screen.getAllByRole('button',{name:'Back to paper builder'})[0]);
 expect(screen.getByLabelText('Structured section total (optional)')).toHaveValue(10);
 await user.click(screen.getByRole('button',{name:/Review and pay/}));
 expect(await screen.findByRole('heading',{name:'Review and pay'})).toBeVisible();
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({kind:'selection',entryIds:['DEMO_01']});
 expect(screen.getByRole('button',{name:'Pay with Stripe · R100'})).toBeEnabled();
 const assign=vi.fn();vi.stubGlobal('location',{...window.location,assign});
 fetch.mockResolvedValueOnce({ok:true,json:async()=>({orderId:'00000000-0000-4000-8000-000000000105',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_z'})});
 await user.click(screen.getByRole('button',{name:'Pay with Stripe · R100'}));
 const sent=JSON.parse(fetch.mock.calls[1][1].body);
 expect(sent.targets).toEqual({paper:10,sections:{multiple_choice:0,structured:10}});expect(sent.allocations).toEqual({DEMO_01:10});
 const {isConfiguredCheckoutRequest}=await import('../../lib/payments/contracts');expect(isConfiguredCheckoutRequest(sent)).toBe(true);
 vi.unstubAllGlobals();
});
test('a second account on the same browser must not inherit another schools mark targets',async()=>{
 window.history.replaceState(null,'','/?view=shape');
 const first=render(<WorkspaceView initial={{...base,schoolName:'Synthetic School A'}}/>);const user=userEvent.setup();
 await user.type(screen.getByPlaceholderText('For example 150'),'150');await user.type(screen.getByLabelText('Multiple-choice marks'),'20');
 await user.click(screen.getByRole('button',{name:'Save and open the builder'}));
 expect(screen.getByLabelText('Total marks for this paper')).toHaveValue(150);
 expect(Object.keys(localStorage).filter(k=>k.startsWith('reviseit-paper'))).toEqual([]);
 first.unmount();window.history.replaceState(null,'','/?view=builder');
 render(<WorkspaceView initial={{...base,schoolName:'Synthetic School B'}}/>);
 expect(screen.getByLabelText('Total marks for this paper')).toHaveValue(null);
 expect(screen.getByLabelText('Multiple-choice section total (optional)')).toHaveValue(null);
});
