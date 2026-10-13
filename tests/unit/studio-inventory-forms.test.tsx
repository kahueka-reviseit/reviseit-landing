import { beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InventoryDecisionForm, MarkCorrectionForm } from '../../app/(accounts)/admin/studio/inventory-forms';
import { correctInventoryMarkAction, reviewInventoryAction } from '../../app/(accounts)/admin/studio/actions';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/actions',()=>({correctInventoryMarkAction:vi.fn(),reviewInventoryAction:vi.fn()}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
test('mark correction sends the exact revision and displays stale-edit errors without retry or approval',async()=>{
 vi.mocked(correctInventoryMarkAction).mockResolvedValue({ok:false,error:'Inventory revision changed. Refresh before correcting it.'});
 render(<MarkCorrectionForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" marks={null} command="command" asOf="2026-10-13"/>);
 fireEvent.change(screen.getByLabelText(/Marks for 1.3/),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Reason for correcting 1.3'),{target:{value:'Confirmed by the reviewer.'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save mark correction'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/revision changed/));
 const form=vi.mocked(correctInventoryMarkAction).mock.calls[0][0];expect(form.get('artifactId')).toBe('revision');expect(form.get('marks')).toBe('2');expect(form.get('expectedSha256')).toBe('digest');
 expect(correctInventoryMarkAction).toHaveBeenCalledTimes(1);expect(reviewInventoryAction).not.toHaveBeenCalled();
});
test('successful correction confirms no approval and disables resubmission',async()=>{
 vi.mocked(correctInventoryMarkAction).mockResolvedValue({ok:true});
 render(<MarkCorrectionForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" marks={null} command="command" asOf="2026-10-13"/>);
 fireEvent.submit(screen.getByRole('button',{name:'Save mark correction'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Inventory approval is still required'));
 expect(screen.getByRole('button',{name:'Save mark correction'})).toBeDisabled();expect(reviewInventoryAction).not.toHaveBeenCalled();
});
test('inventory decision starts unselected and requires an explicit review acknowledgement',()=>{
 render(<InventoryDecisionForm runId="run" version={2} bound={['a','b']} command="command"/>);
 expect(screen.getByLabelText('Decision')).toHaveValue('');expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('checkbox')).toBeRequired();
 expect(reviewInventoryAction).not.toHaveBeenCalled();
});
