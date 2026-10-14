import { beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SourceReviewForm, InventoryDecisionForm, MarkCorrectionForm, CognitiveCorrectionForm } from '../../app/(accounts)/admin/studio/inventory-forms';
import { addInventorySourceReviewAction, correctInventoryMarkAction, correctInventoryCognitionAction, reviewInventoryAction } from '../../app/(accounts)/admin/studio/actions';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/actions',()=>({addInventorySourceReviewAction:vi.fn(),correctInventoryMarkAction:vi.fn(),correctInventoryCognitionAction:vi.fn(),reviewInventoryAction:vi.fn()}));
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

test('Bloom’s-only controls save the exact binding and save the exact binding',async()=>{
 vi.mocked(correctInventoryCognitionAction).mockResolvedValue({ok:true});
 render(<CognitiveCorrectionForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" category={null} reason="" command="command" asOf="2026-10-13"/>);
 expect(screen.queryByLabelText('Curriculum cognitive level for 1.3')).toBeNull();expect(screen.getAllByRole('combobox')).toHaveLength(1);expect(screen.getByLabelText('Bloom’s level for 1.3')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('Bloom’s level for 1.3'),{target:{value:'Analyse'}});
 fireEvent.change(screen.getByLabelText('Reason for Bloom’s classification of 1.3'),{target:{value:'The learner must distinguish and relate the forces.'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save Bloom’s correction'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Bloom’s correction saved'));
 const form=vi.mocked(correctInventoryCognitionAction).mock.calls[0][0];expect(form.has('level')).toBe(false);expect(form.get('category')).toBe('Analyse');expect(form.get('artifactId')).toBe('revision');
 expect(reviewInventoryAction).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Save Bloom’s correction'})).toBeDisabled();
});
test('cognitive save shows validation errors without retrying or changing marks',async()=>{
 vi.mocked(correctInventoryCognitionAction).mockResolvedValue({ok:false,error:'Choose a valid Bloom’s level.'});
 render(<CognitiveCorrectionForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" category="Apply" reason="Earlier reason preserved for editing." command="command" asOf="2026-10-13"/>);
 fireEvent.submit(screen.getByRole('button',{name:'Save Bloom’s correction'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/valid Bloom’s level/));expect(correctInventoryCognitionAction).toHaveBeenCalledTimes(1);expect(correctInventoryMarkAction).not.toHaveBeenCalled();
});

test('source findings save the bound inventory without granting checkpoint approval',async()=>{
 vi.mocked(addInventorySourceReviewAction).mockResolvedValue({ok:true});
 render(<SourceReviewForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" command="command" asOf="2026-10-14"/>);
 fireEvent.change(screen.getByLabelText('Source finding for 1.3'),{target:{value:'Paper page 2 and memorandum page 1 disagree.'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save source finding'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Approval is still required'));
 const form=vi.mocked(addInventorySourceReviewAction).mock.calls[0][0];expect(form.get('artifactId')).toBe('revision');expect(form.get('expectedSha256')).toBe('digest');
 expect(reviewInventoryAction).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Save source finding'})).toBeDisabled();
});
