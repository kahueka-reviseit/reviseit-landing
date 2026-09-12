import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {test,expect,vi,afterEach} from 'vitest';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {workspace} from '../fixtures/workspace';
afterEach(()=>vi.unstubAllGlobals());
test('selection totals reflect marks and saving sends only catalogue references',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({revision:1})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={workspace}/>);const user=userEvent.setup();await user.click(screen.getByLabelText('Select Reading a motion graph'));await user.click(screen.getByLabelText('Select Comparing circuit measurements'));
 const summary=screen.getByRole('complementary');expect(within(summary).getByText('20–30')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Save selection'}));await screen.findByRole('status');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({kind:'selection',moduleId:workspace.module!.id,revision:0,release:'demo-1',entryIds:['DEMO_01','DEMO_02']});expect(screen.getByRole('button',{name:'Save selection'})).toBeDisabled();
 expect(screen.queryByText(/parameter_questions|generation_prompt/)).not.toBeInTheDocument();
});
test('saved selections are restored on load',()=>{render(<WorkspaceView initial={{...workspace,selection:{revision:2,release:'demo-1',entryIds:['DEMO_02']}}}/>);expect(screen.getByLabelText('Select Comparing circuit measurements')).toBeChecked();expect(screen.getByText('Selection saved')).toBeVisible();});
test('formatting save includes the last observed revision and updates the illustration',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({revision:3})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={{...workspace,formatting:{...workspace.formatting,revision:2}}}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'School formatting'}));await user.type(screen.getByLabelText('School heading'),'MY SCHOOL');await user.selectOptions(screen.getByLabelText('Font'),'Times New Roman');await user.click(screen.getByRole('button',{name:'Save school formatting'}));await screen.findByRole('status');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({revision:2,preferences:{header:'MY SCHOOL',font:'Times New Roman'}});expect(screen.getByText('MY SCHOOL',{selector:'strong'})).toBeVisible();
});
test('failed saves preserve the edits and never report success',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'This has changed. Reload before saving.'})}));render(<WorkspaceView initial={workspace}/>);const user=userEvent.setup();await user.click(screen.getByLabelText('Select Reading a motion graph'));await user.click(screen.getByRole('button',{name:'Save selection'}));expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');expect(screen.getByLabelText('Select Reading a motion graph')).toBeChecked();expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
test('curriculum changes load separate saved settings and selections',async()=>{
 const next={...workspace,module:workspace.curricula[1],formatting:{revision:4,preferences:{...workspace.formatting.preferences,header:'Grade 11 heading'}},selection:{revision:1,release:'demo-1',entryIds:['DEMO_03']}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>next}));render(<WorkspaceView initial={workspace}/>);const user=userEvent.setup();await user.selectOptions(screen.getByLabelText('Curriculum'),workspace.curricula[1].id);await waitFor(()=>expect(screen.getByLabelText('Select Explaining a change of state')).toBeChecked());await user.click(screen.getByRole('button',{name:'School formatting'}));expect(screen.getByLabelText('School heading')).toHaveValue('Grade 11 heading');
});
test('catalogue changes require review rather than silently reusing old selections',()=>{render(<WorkspaceView initial={{...workspace,selection:{revision:1,release:'old',entryIds:['DEMO_01']}}}/>);expect(screen.getByText(/catalogue has changed since you saved/)).toBeVisible();expect(screen.getByLabelText('Select Reading a motion graph')).not.toBeChecked();});
test('no assigned curriculum shows a useful empty state',()=>{render(<WorkspaceView initial={{...workspace,module:null,curricula:[],entries:[]}}/>);expect(screen.getByRole('heading',{name:'Your curricula will appear here'})).toBeVisible();expect(screen.queryByRole('button',{name:'Save selection'})).not.toBeInTheDocument();});

test('search hides cards without clearing the selected paper',async()=>{
 const entry=workspace.entries[1];vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({matches:[{module:workspace.module,entry}],hasMore:false})}));
 render(<WorkspaceView initial={{...workspace,selection:{revision:1,release:'demo-1',entryIds:['DEMO_01']}}}/>);
 const user=userEvent.setup();await user.type(screen.getByRole('searchbox'),'electricity');await screen.findByText('1 matching question.');
 expect(screen.queryByLabelText('Select Reading a motion graph')).not.toBeInTheDocument();expect(within(screen.getByRole('complementary')).getByText('Reading a motion graph')).toBeVisible();
 expect(screen.getByText(/1 selected question is outside/)).toBeVisible();await user.click(screen.getByRole('button',{name:'Clear search'}));expect(screen.getByLabelText('Select Reading a motion graph')).toBeChecked();
});
test('module search shows other curricula without selecting into the wrong paper',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({matches:[{module:workspace.curricula[1],entry:workspace.entries[0]}],hasMore:false})}));render(<WorkspaceView initial={workspace}/>);
 await userEvent.type(screen.getByRole('searchbox'),'Grade 11');await screen.findByText('1 matching question.');expect(screen.getByRole('button',{name:`Browse ${workspace.curricula[1].name}`})).toBeVisible();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('no matches offers a clear way back to the catalogue',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({matches:[],hasMore:false})}));render(<WorkspaceView initial={workspace}/>);await userEvent.type(screen.getByRole('searchbox'),'unknown');await screen.findByText('No matching questions');await userEvent.click(screen.getByRole('button',{name:'Show all questions in this curriculum'}));expect(screen.getAllByRole('checkbox')).toHaveLength(3);
});
test('cards display descriptive diagram images and still support missing thumbnails',()=>{
 render(<WorkspaceView initial={{...workspace,entries:[workspace.entries[0],{...workspace.entries[1],thumbnail:undefined}]}}/>);expect(screen.getByRole('img',{name:workspace.entries[0].thumbnail!.alt})).toBeVisible();expect(screen.getAllByRole('img')).toHaveLength(1);expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

test('fixed-mark questions display a single allocation alongside ranged items',()=>{
 const entries=[workspace.entries[0],{...workspace.entries[1],marks:{min:2,max:2}}];
 render(<WorkspaceView initial={{...workspace,entries,selection:{revision:1,release:'demo-1',entryIds:entries.map(e=>e.id)}}}/>);
 expect(screen.getByText('8–12 marks')).toBeVisible();expect(screen.getByText('2 marks',{exact:true})).toBeVisible();expect(screen.queryByText('2–2 marks')).not.toBeInTheDocument();
 expect(within(screen.getByRole('complementary')).getByText('10–14')).toBeVisible();expect(screen.getByText(/possible marks/)).toBeVisible();
});
