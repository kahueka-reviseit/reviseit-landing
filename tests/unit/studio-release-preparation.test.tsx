import {beforeEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {ReleasePreparations} from '../../app/(accounts)/admin/studio/release-preparation';
import {releasePreparations} from '../fixtures/studio-release-preparation';
import {requestReleasePreparation} from '../../app/(accounts)/admin/studio/release-actions';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/release-actions',()=>({requestReleasePreparation:vi.fn(),cancelReleasePreparation:vi.fn()}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
test('build evidence distinguishes missing and no-input forms and never presents a publication action',()=>{
 render(<ReleasePreparations data={releasePreparations}/>);expect(screen.getByText(/1 explicit no-input forms · 1 missing forms/)).toBeTruthy();expect(screen.getByText('Review needed')).toBeTruthy();expect(screen.getByText('Not published.')).toBeTruthy();expect(screen.queryByRole('button',{name:/publish|approve/i})).toBeNull();expect(screen.getByText('No authored questionnaire',{exact:false})).toBeTruthy();
});
test('lost response keeps the idempotency key and retry never claims publication',async()=>{
 vi.mocked(requestReleasePreparation).mockResolvedValueOnce({ok:false,error:'Uncertain response'}).mockResolvedValueOnce({ok:true,preparationId:'synthetic'});
 render(<ReleasePreparations data={releasePreparations}/>);fireEvent.click(screen.getByRole('button',{name:'Prepare release files'}));await screen.findByText('Uncertain response');fireEvent.click(screen.getByRole('button',{name:'Prepare release files'}));await waitFor(()=>expect(requestReleasePreparation).toHaveBeenCalledTimes(2));expect(vi.mocked(requestReleasePreparation).mock.calls[0][0]).toEqual(vi.mocked(requestReleasePreparation).mock.calls[1][0]);expect(await screen.findByRole('status')).toHaveTextContent('Build requested');
});
test('stale inputs are visible and running preparations cannot be requested twice',()=>{
 const data=structuredClone(releasePreparations);data.preparations[0].current=false;render(<ReleasePreparations data={data}/>);expect(screen.getByText(/Superseded inputs/)).toBeTruthy();cleanup();data.preparations[0].current=true;data.preparations[0].state='building';render(<ReleasePreparations data={data}/>);expect(screen.getByRole('button',{name:'Prepare release files'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel preparation'})).toBeTruthy();
});
