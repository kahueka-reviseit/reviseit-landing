import {beforeEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {DraftEditor} from '../../app/(accounts)/admin/studio/draft-editor';
import {draftTextProblem,changedSpan} from '../../lib/studio/maintenance-drafts';
import {draft,baseText,currentText} from '../fixtures/studio-draft';
const mocks=vi.hoisted(()=>({save:vi.fn(),discard:vi.fn(),push:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,refresh:mocks.refresh})}));
vi.mock('../../app/(accounts)/admin/studio/draft-actions',()=>({saveDraftAction:mocks.save,discardDraftAction:mocks.discard}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
const props={file:draft.file,draft,baseText,currentText,selectedText:baseText,selectedRevision:0,viewerId:'synthetic-editor'};
test('format checks reject invalid JSON, invalid characters and excessive UTF-8 bytes',()=>{
 expect(draftTextProblem('data/a.json','{"a":}')).toMatch(/JSON/);expect(draftTextProblem('data/a.md','\ud800')).toMatch(/invalid/);expect(draftTextProblem('data/a.md','😀'.repeat(70000))).toMatch(/256/);expect(draftTextProblem('data/a.json','{"a":"ok"}')).toBeNull();
 expect(changedSpan('one\ntwo\nthree','one\nchanged\nthree')).toEqual({startLine:2,before:'two',after:'changed',changed:true});
});
test('a stale save retains entered text and reason; retry sends the same command, edited input uses a new one',async()=>{
 mocks.save.mockResolvedValue({ok:false,error:'Another editor saved a newer revision.'});render(<DraftEditor {...props}/>);
 const text=screen.getByLabelText('Source text'),reason=screen.getByLabelText('Reason for change'),button=screen.getByRole('button',{name:'Save draft'});
 expect(button).toBeDisabled();fireEvent.change(text,{target:{value:currentText+'\nMy unsaved work.'}});fireEvent.change(reason,{target:{value:'Clarify the work being assessed.'}});fireEvent.click(button);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('newer revision'));
 expect(text).toHaveValue(currentText+'\nMy unsaved work.');expect(reason).toHaveValue('Clarify the work being assessed.');expect(mocks.save.mock.calls[0][0]).toMatchObject({expectedRevision:1,expectedSha256:'b'.repeat(64),draftId:draft.id});
 fireEvent.click(button);await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));expect(mocks.save.mock.calls[1][0].command).toBe(mocks.save.mock.calls[0][0].command);
 await waitFor(()=>expect(button).toBeEnabled());fireEvent.change(reason,{target:{value:'A different change rationale.'}});fireEvent.click(button);await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(3));expect(mocks.save.mock.calls[2][0].command).not.toBe(mocks.save.mock.calls[1][0].command);
});
test('restore requires an explicit save and reason; changing restored text removes the restore claim',async()=>{
 mocks.save.mockResolvedValue({ok:true,draftId:draft.id,revision:2});render(<DraftEditor {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Restore this text as a new revision'}));expect(mocks.save).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Source'}));expect(screen.getByLabelText('Source text')).toHaveValue(baseText);
 fireEvent.change(screen.getByLabelText('Source text'),{target:{value:baseText+'\nAn additional change.'}});fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Restore with a new clarification.'}});fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));expect(mocks.save.mock.calls[0][0].restoredFrom).toBeNull();
});
test('discarded history cannot be edited, restored or implicitly approved',()=>{
 render(<DraftEditor {...props} draft={{...draft,state:'discarded',discardedReason:'The experiment is complete.'}}/>);expect(screen.getByLabelText('Source text')).toHaveAttribute('readonly');expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();expect(screen.queryByRole('button',{name:'Restore this text as a new revision'})).toBeNull();expect(screen.queryByRole('button',{name:/approve/i})).toBeNull();
});
