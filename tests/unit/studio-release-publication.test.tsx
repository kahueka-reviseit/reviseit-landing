import {beforeEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {ReleasePublication} from '../../app/(accounts)/admin/studio/release-publication';
import {releasePublication} from '../fixtures/studio-release-publication';
import {releasePreparations} from '../fixtures/studio-release-preparation';
import {reviewRelease,activateRelease} from '../../app/(accounts)/admin/studio/publication-actions';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../../app/(accounts)/admin/studio/publication-actions',()=>({stageRelease:vi.fn(),reviewRelease:vi.fn(),activateRelease:vi.fn()}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
const consent=()=>{fireEvent.change(screen.getByRole('textbox'),{target:{value:'I reviewed the exact package.'}});fireEvent.click(screen.getByRole('checkbox'));};
test('requires a reason and explicit human confirmation, preserving command on uncertain response',async()=>{
 vi.mocked(reviewRelease).mockResolvedValue({ok:false,error:'Uncertain response'});
 render(<ReleasePublication data={releasePublication} preparations={releasePreparations}/>);const button=screen.getByRole('button',{name:'Approve this package'});expect(button).toBeDisabled();consent();fireEvent.click(button);await screen.findByText('Uncertain response');fireEvent.click(button);await waitFor(()=>expect(reviewRelease).toHaveBeenCalledTimes(2));expect(vi.mocked(reviewRelease).mock.calls[0][0]).toEqual(vi.mocked(reviewRelease).mock.calls[1][0]);expect(activateRelease).not.toHaveBeenCalled();
});
test('approval alone cannot publish; fresh worker confirmation enables a separate deliberate action',()=>{
 const d=structuredClone(releasePublication);d.candidates[0].approvalId='approved';render(<ReleasePublication data={d} preparations={releasePreparations}/>);consent();expect(screen.getByRole('button',{name:'Publish and activate'})).toBeDisabled();cleanup();
 d.candidates[0].worker={name:'teacher-worker',checkedAt:new Date().toISOString(),fresh:true};render(<ReleasePublication data={d} preparations={releasePreparations}/>);consent();expect(screen.getByRole('button',{name:'Publish and activate'})).not.toBeDisabled();
});
test('stale or corrupt package remains blocked and historical releases explicitly say rollback',()=>{
 const d=structuredClone(releasePublication);d.candidates[0].intact=false;render(<ReleasePublication data={d} preparations={releasePreparations}/>);consent();expect(screen.getByRole('button',{name:'Approve this package'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('integrity');cleanup();
 d.candidates[0].intact=true;d.candidates[0].approvalId='approved';d.candidates[0].previouslyActivated=true;render(<ReleasePublication data={d} preparations={releasePreparations}/>);expect(screen.getByRole('button',{name:'Roll back to this release'})).toBeDisabled();
});
