import {beforeEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {InventoryWorkspace} from '../../app/(accounts)/admin/studio/inventory-workspace';
import {QueueView} from '../../app/(accounts)/admin/studio/queue-view';
import {ExecutionSummary} from '../../app/(accounts)/admin/studio/execution-summary';
import {workspace,run,runId,runView,execution} from '../fixtures/studio-ui';
import {checkpointStatus,queueStatus} from '../../lib/studio/presentation';
import {reviewInventoryAction} from '../../app/(accounts)/admin/studio/actions';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/actions',()=>({correctInventoryMarkAction:vi.fn(),correctInventoryCognitionAction:vi.fn(),reviewInventoryAction:vi.fn()}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
test('question and attention navigation select the correct source part without changing or approving data',()=>{
 render(<InventoryWorkspace {...workspace}/>);
 fireEvent.click(screen.getByRole('button',{name:'Needs attention · 2'}));
 expect(screen.queryByRole('button',{name:'Review part 1.1'})).toBeNull();expect(screen.getByRole('heading',{name:'Review part 1.2'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getByRole('heading',{name:'Review part 2.1'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Bloom’s overview'}));expect(screen.getByText('Counts of assessed parts in this revision, not percentages of marks.')).toBeTruthy();
 expect(reviewInventoryAction).not.toHaveBeenCalled();
});
test('approval stays disabled until an outcome, rationale and acknowledgement are explicit',()=>{
 render(<InventoryWorkspace {...workspace}/>);const submit=screen.getByRole('button',{name:'Record inventory decision'});expect(submit).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Decision'),{target:{value:'approved'}});fireEvent.change(screen.getByLabelText('Review rationale'),{target:{value:'All synthetic evidence reviewed.'}});expect(submit).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));expect(submit).toBeEnabled();expect(reviewInventoryAction).not.toHaveBeenCalled();
});
test('completed run cannot edit or approve, and stale reviews never appear as current approvals',()=>{
 render(<InventoryWorkspace {...workspace} editable={false}/>);expect(screen.queryByText('Correct marks')).toBeNull();expect(screen.queryByRole('button',{name:'Record inventory decision'})).toBeNull();
 expect(checkpointStatus({live:null,binding:{},previousApproved:true},[{gate:'G1_inventory',outcome:'approved',invalidated_at:'yesterday'}],'G1_inventory')).toBe('Review out of date');
 expect(queueStatus({S1_extract:'succeeded'},[])).toBe('Waiting');
});
test('queue filters use checkpoint readiness, not extraction success alone',()=>{
 render(<QueueView runs={[run]}/>);fireEvent.click(screen.getByRole('button',{name:'Running · 0'}));expect(screen.getByText('No runs in this view')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Needs review · 1'}));expect(screen.getByRole('link',{name:'Review →'})).toHaveAttribute('href',`/admin/studio/runs/${runId}/inventory`);
});
test('uncertain provider result requires reconciliation without a silent retry action',()=>{
 render(<ExecutionSummary runId={runId} execution={{...execution,budget:{...execution.budget,heldMicro:500000}}} view={{...runView,providerOperations:[{attempts:[{dispatch_state:'uncertain'}]}]}}/>);
 expect(screen.getByRole('heading',{name:'Reconcile outstanding execution before retrying'})).toBeTruthy();expect(screen.queryByRole('button',{name:/retry/i})).toBeNull();expect(screen.getByText(/never silently sent again/)).toBeTruthy();
});
