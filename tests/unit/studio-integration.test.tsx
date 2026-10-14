import {beforeEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {IntegrationReview,IntegrationPreparation} from '../../app/(accounts)/admin/studio/integration-review';
import {integration as v,integrationEvidence as evidence} from '../fixtures/studio-integration';
import {maintenanceCheck} from '../fixtures/studio-check';
const actions=vi.hoisted(()=>({authorise:vi.fn(),prepare:vi.fn(),cancel:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/integration-actions',()=>({authoriseIntegrationAction:actions.authorise,prepareIntegrationAction:actions.prepare,cancelIntegrationAction:actions.cancel}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
test('explicit integration approval binds the manifest; failed writes preserve reason and command',async()=>{
 actions.authorise.mockResolvedValue({ok:false,error:'Review changed.'});render(<IntegrationReview integration={v} evidence={evidence} reportVerified/>);const button=screen.getByRole('button',{name:'Authorise bank integration'});expect(button).toBeDisabled();fireEvent.change(screen.getByLabelText('Decision reason'),{target:{value:'I reviewed the proposed synthetic changes.'}});for(const box of screen.getAllByRole('checkbox'))fireEvent.click(box);fireEvent.click(button);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Review changed'));expect(screen.getByLabelText('Decision reason')).toHaveValue('I reviewed the proposed synthetic changes.');fireEvent.click(button);await waitFor(()=>expect(actions.authorise).toHaveBeenCalledTimes(2));expect(actions.authorise.mock.calls[0][0]).toEqual(actions.authorise.mock.calls[1][0]);expect(actions.authorise.mock.calls[0][0].manifestSha256).toBe(v.manifestSha256);
});
test('stale authority or unavailable evidence blocks authorisation; accepted view does not offer approval',()=>{
 const {rerender}=render(<IntegrationReview integration={{...v,current:false}} evidence={evidence} reportVerified/>);expect(screen.getByRole('button',{name:'Authorise bank integration'})).toBeDisabled();rerender(<IntegrationReview integration={v} evidence={[{...evidence[0],verified:false}]} reportVerified/>);expect(screen.getByRole('alert')).toHaveTextContent('could not be verified');expect(screen.getByRole('button',{name:'Authorise bank integration'})).toBeDisabled();rerender(<IntegrationReview integration={{...v,state:'accepted',acceptedSnapshotId:'new-snapshot'}} evidence={evidence} reportVerified/>);expect(screen.queryByRole('button',{name:'Authorise bank integration'})).toBeNull();expect(screen.getByText('new-snapshot')).toBeTruthy();
});
test('rehearsals cannot prepare integration even after content approval',()=>{render(<IntegrationPreparation check={{...maintenanceCheck,reviewVersion:1,reviews:[{id:'r',version:1,outcome:'approved',rationale:'Synthetic review',selfReviewed:true,createdAt:'2099-01-01'}]}}/>);expect(screen.queryByRole('button',{name:'Prepare integration review'})).toBeNull();expect(screen.getByText(/This rehearsal cannot be integrated/)).toBeTruthy();});
