import {beforeEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MaintenanceCheckView,CheckPreparation} from '../../app/(accounts)/admin/studio/maintenance-check';
import {maintenanceCheck as check} from '../fixtures/studio-check';
const actions=vi.hoisted(()=>({review:vi.fn(),request:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/check-actions',()=>({reviewCheckAction:actions.review,requestCheckAction:actions.request}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
test('approval requires all acknowledgements and an explicit rationale, and failed writes retain the reason',async()=>{
 actions.review.mockResolvedValue({ok:false,error:'A fresh check is required.'});render(<MaintenanceCheckView check={check} verified/>);
 fireEvent.change(screen.getByLabelText('Outcome'),{target:{value:'approved'}});fireEvent.change(screen.getByLabelText('Review reason'),{target:{value:'Synthetic content review reasoning'}});
 const button=screen.getByRole('button',{name:'Record content review'});expect(button).toBeDisabled();for(const box of screen.getAllByRole('checkbox'))fireEvent.click(box);expect(button).not.toBeDisabled();fireEvent.click(button);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('fresh check'));expect(screen.getByLabelText('Review reason')).toHaveValue('Synthetic content review reasoning');expect(actions.review.mock.calls[0][0]).toMatchObject({checkId:check.id,version:0,reportSha256:check.reportSha256,outcome:'approved'});
});
test('stale candidate, missing evidence and structural errors cannot present an eligible approval',()=>{
 const {rerender}=render(<MaintenanceCheckView check={{...check,current:false,reviews:[{id:'prior',version:1,outcome:'approved',rationale:'Previous judgement',selfReviewed:true,createdAt:check.createdAt}]}} verified/>);expect(screen.getByText(/Content review approved · superseded/)).toBeTruthy();expect(screen.getByLabelText('Outcome')).toBeDisabled();
 rerender(<MaintenanceCheckView check={check} verified={false}/>);expect(screen.getByRole('alert')).toHaveTextContent('could not be verified');expect(screen.getByLabelText('Outcome')).toBeDisabled();
 rerender(<MaintenanceCheckView check={{...check,report:{...check.report!,structuralOk:false,errors:[{kind:'broken_reference'}]}}} verified/>);expect(screen.getByRole('option',{name:'Approve content review'})).toBeDisabled();
});
test('candidate preparation requires explicit selection and sends exact saved revisions',async()=>{
 actions.request.mockResolvedValue({ok:false,error:'Draft changed.'});render(<CheckPreparation snapshotId={check.snapshotId} entries={check.entries} checks={[]}/>);const button=screen.getByRole('button',{name:'Check proposed bank'});expect(button).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);await waitFor(()=>expect(actions.request).toHaveBeenCalled());expect(actions.request.mock.calls[0][0].entries).toEqual([{draftId:check.entries[0].draftId,revision:2,sha256:check.entries[0].sha256}]);
});
