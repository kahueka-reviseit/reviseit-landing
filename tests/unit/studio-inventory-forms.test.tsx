import { beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InventoryDecisionForm, MarkCorrectionForm, CognitiveCorrectionForm } from '../../app/(accounts)/admin/studio/inventory-forms';
import { correctInventoryMarkAction, correctInventoryCognitionAction, reviewInventoryAction } from '../../app/(accounts)/admin/studio/actions';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/actions',()=>({correctInventoryMarkAction:vi.fn(),correctInventoryCognitionAction:vi.fn(),reviewInventoryAction:vi.fn()}));
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

test('cognitive controls preserve separate curriculum and named values and save the exact binding',async()=>{
 vi.mocked(correctInventoryCognitionAction).mockResolvedValue({ok:true});
 render(<CognitiveCorrectionForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" level={null} category={null} reason="" moduleId="caps-grade-11-physical-sciences" command="command" asOf="2026-10-13"/>);
 expect(screen.getByLabelText('Curriculum cognitive level for 1.3')).toHaveValue('');expect(screen.getByLabelText('Named cognitive category for 1.3')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('Curriculum cognitive level for 1.3'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('Named cognitive category for 1.3'),{target:{value:'Analyse'}});
 fireEvent.change(screen.getByLabelText('Reason for cognitive classification of 1.3'),{target:{value:'The learner must distinguish and relate the forces.'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save cognitive correction'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Cognitive correction saved'));
 const form=vi.mocked(correctInventoryCognitionAction).mock.calls[0][0];expect(form.get('level')).toBe('3');expect(form.get('category')).toBe('Analyse');expect(form.get('artifactId')).toBe('revision');
 expect(reviewInventoryAction).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Save cognitive correction'})).toBeDisabled();
});
test('cognitive save shows validation errors without retrying or changing marks',async()=>{
 vi.mocked(correctInventoryCognitionAction).mockResolvedValue({ok:false,error:'The curriculum level and named category do not agree.'});
 render(<CognitiveCorrectionForm runId="run" artifactId="revision" expectedSha256="digest" partId="1.3" level={3} category="Apply" reason="Earlier reason preserved for editing." moduleId="caps-grade-11-physical-sciences" command="command" asOf="2026-10-13"/>);
 fireEvent.submit(screen.getByRole('button',{name:'Save cognitive correction'}).closest('form')!);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/do not agree/));expect(correctInventoryCognitionAction).toHaveBeenCalledTimes(1);expect(correctInventoryMarkAction).not.toHaveBeenCalled();
});
