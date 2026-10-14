import {beforeEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {DraftEditor} from '../../app/(accounts)/admin/studio/draft-editor';
import {FormPreview} from '../../app/(accounts)/admin/studio/form-fields';
import {parseAuthoredForm,formEditProblem} from '../../lib/studio/form-authoring';
import {authoredForm,formFile,formText} from '../fixtures/studio-form';
const mocks=vi.hoisted(()=>({save:vi.fn(),push:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,refresh:mocks.refresh})}));
vi.mock('../../app/(accounts)/admin/studio/draft-actions',()=>({saveFormDraftAction:mocks.save,saveDraftAction:vi.fn(),discardDraftAction:vi.fn()}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
const props={file:formFile,draft:null,baseText:formText,currentText:formText,selectedText:formText,selectedRevision:0,viewerId:'test-editor',asOf:'2026-10-14'};
test('only supported item form identities get the structured editor',()=>{
 expect(parseAuthoredForm(formFile,formText)).not.toBeNull();expect(parseAuthoredForm({...formFile,moduleId:'another-module'},formText)).toBeNull();expect(parseAuthoredForm({...formFile,path:'data/forms/authored/manifest.json'},formText)).toBeNull();
 expect(formEditProblem(authoredForm,authoredForm.fields.map((f,i)=>i?f:{...f,id:'renamed'}))).toMatch(/identifiers/);
});
test('structured edits preserve input on rejected saves and send fields without editable evidence',async()=>{
 mocks.save.mockResolvedValue({ok:false,error:'Another editor saved a newer revision.'});render(<DraftEditor {...props}/>);
 expect(screen.getByRole('heading',{name:'Edit teacher form'})).toBeTruthy();fireEvent.change(screen.getByLabelText('Teacher-facing question'),{target:{value:'What quantity should learners find?'}});fireEvent.click(screen.getByLabelText('Allow automatic selection'));fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Clarify this teacher-facing question.'}});fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());expect(mocks.save.mock.calls[0][0]).toMatchObject({fields:[{...authoredForm.fields[0],label:'What quantity should learners find?',allowAutomatic:true},authoredForm.fields[1]],expectedRevision:0});expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('field_provenance');expect(screen.getByLabelText('Teacher-facing question')).toHaveValue('What quantity should learners find?');
});
test('preview uses teacher field rules, including automatic answers and required fields',()=>{
 const fields=structuredClone(authoredForm.fields);fields[0].allowAutomatic=true;render(<FormPreview fields={fields}/>);fireEvent.click(screen.getByRole('button',{name:'Check example answers'}));expect(screen.getByRole('status')).toHaveTextContent('1 of 2');fireEvent.change(screen.getByLabelText('Answer · quantity'),{target:{value:'automatic'}});fireEvent.click(screen.getByRole('button',{name:'Check example answers'}));expect(screen.getByRole('status')).toHaveTextContent('2 of 2');
});
test('source evidence is visible and cannot be edited through the form controls',()=>{
 render(<DraftEditor {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Source evidence'}));expect(screen.getByText(/Ask for speed or distance/)).toBeTruthy();expect(screen.getByText(/Retain this observation/)).toBeTruthy();expect(screen.queryByLabelText('Source text')).toBeNull();expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
});
