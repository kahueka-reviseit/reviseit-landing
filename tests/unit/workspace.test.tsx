import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {test,expect,vi,afterEach} from 'vitest';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {workspace} from '../fixtures/workspace';
import {paperWorkspace} from '../fixtures/paper-catalogue';
import {openBuilder,openReview,payButton} from './paper-journey';
afterEach(()=>vi.unstubAllGlobals());
const bar=()=>screen.getByRole('complementary',{name:'Your paper'});

// ---------------------------------------------------------------- preserved behaviour (C05: re-expressed through the Paper screens)
test('unavailable entries remain visible with disabled selection',()=>{render(<WorkspaceView initial={workspace}/>);expect(screen.getByLabelText('Select Comparing circuit measurements')).toBeDisabled();expect(screen.getAllByText('Not yet available to order.').length).toBeGreaterThan(0);});
test('selection totals reflect marks and saving sends only catalogue references',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({revision:1})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={{...workspace,entries:workspace.entries.map(e=>({...e,orderable:true}))}}/>);const user=userEvent.setup();await user.click(screen.getByLabelText('Select Reading a motion graph'));await user.click(screen.getByLabelText('Select Comparing circuit measurements'));
 expect(within(bar()).getByText('2 · 20–30 marks')).toBeVisible();
 await openBuilder(user);await user.click(screen.getByRole('button',{name:'Save selection'}));await screen.findByText('Your paper selection is saved. You can return to it later.');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({kind:'selection',moduleId:workspace.module!.id,revision:0,release:'demo-1',entryIds:['DEMO_01','DEMO_02']});
 expect(screen.queryByRole('button',{name:'Save selection'})).not.toBeInTheDocument();expect(screen.getByText('Selection saved')).toBeVisible();
 expect(screen.queryByText(/parameter_questions|generation_prompt/)).not.toBeInTheDocument();
});
test('saved selections are restored on load',async()=>{render(<WorkspaceView initial={{...workspace,selection:{revision:2,release:'demo-1',entryIds:['DEMO_02']}}}/>);expect(screen.getByLabelText('Select Comparing circuit measurements')).toBeChecked();await openBuilder(userEvent.setup());expect(screen.getByText('Selection saved')).toBeVisible();});
test('formatting save includes the last observed revision and updates the illustration',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({revision:3})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={{...workspace,formatting:{...workspace.formatting,revision:2}}}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'My curricula'}));await user.click(screen.getByRole('button',{name:/School formatting/}));
 await user.type(screen.getByLabelText('School heading'),'MY SCHOOL');await user.selectOptions(screen.getByLabelText('Font'),'Times New Roman');await user.click(screen.getByRole('button',{name:'Save school formatting'}));await screen.findByRole('status');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({revision:2,preferences:{header:'MY SCHOOL',font:'Times New Roman'}});expect(screen.getByText('MY SCHOOL',{selector:'strong'})).toBeVisible();
});
test('failed saves preserve the edits and never report success',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'This has changed. Reload before saving.'})}));render(<WorkspaceView initial={workspace}/>);const user=userEvent.setup();
 await user.click(screen.getByLabelText('Select Reading a motion graph'));await openBuilder(user);await user.click(screen.getByRole('button',{name:'Save selection'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');expect(screen.queryByText(/is saved/)).not.toBeInTheDocument();
 expect(screen.getByText('Unsaved changes')).toBeVisible();
 await user.click(screen.getAllByRole('button',{name:'Add from catalogue'})[0]);expect(screen.getByLabelText('Select Reading a motion graph')).toBeChecked();
});
test('curriculum changes load separate saved settings and selections',async()=>{
 const next={...workspace,module:workspace.curricula[1],formatting:{revision:4,preferences:{...workspace.formatting.preferences,header:'Grade 11 heading'}},selection:{revision:1,release:'demo-1',entryIds:['DEMO_03']}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>next}));render(<WorkspaceView initial={workspace}/>);const user=userEvent.setup();
 await user.selectOptions(screen.getByLabelText('Curriculum'),workspace.curricula[1].id);await waitFor(()=>expect(screen.getByLabelText('Select Explaining a change of state')).toBeChecked());
 await user.click(screen.getByRole('button',{name:'My curricula'}));await user.click(screen.getByRole('button',{name:/School formatting/}));expect(screen.getByLabelText('School heading')).toHaveValue('Grade 11 heading');
});
test('catalogue changes require review rather than silently reusing old selections',()=>{render(<WorkspaceView initial={{...workspace,selection:{revision:1,release:'old',entryIds:['DEMO_01']}}}/>);expect(screen.getByText(/catalogue has changed since you saved/)).toBeVisible();expect(screen.getByLabelText('Select Reading a motion graph')).not.toBeChecked();});
test('no assigned curriculum shows a useful empty state',()=>{render(<WorkspaceView initial={{...workspace,module:null,curricula:[],entries:[]}}/>);expect(screen.getByRole('heading',{name:'Your curricula will appear here'})).toBeVisible();expect(screen.queryByRole('button',{name:'Save selection'})).not.toBeInTheDocument();});

test('search hides cards without clearing the selected paper',async()=>{
 const entry=workspace.entries[1];vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({matches:[{module:workspace.module,entry}],hasMore:false})}));
 render(<WorkspaceView initial={{...workspace,selection:{revision:1,release:'demo-1',entryIds:['DEMO_01']}}}/>);
 const user=userEvent.setup();await user.type(screen.getByRole('combobox',{name:'Search this catalogue'}),'electricity');
 expect(screen.getByRole('heading',{name:'Results for “electricity”'})).toBeVisible();expect(screen.getByText('1 of 3 questions match')).toBeVisible();
 expect(screen.queryByLabelText('Select Reading a motion graph')).not.toBeInTheDocument();expect(within(bar()).getByText('1 question')).toBeVisible();
 expect(screen.getByText(/1 selected question is outside/)).toBeVisible();await user.click(screen.getByRole('button',{name:'Clear search'}));expect(screen.getByLabelText('Select Reading a motion graph')).toBeChecked();
});
test('module search shows other curricula without selecting into the wrong paper',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({matches:[{module:workspace.curricula[1],entry:workspace.entries[0]}],hasMore:false})}));render(<WorkspaceView initial={workspace}/>);
 await userEvent.type(screen.getByRole('combobox',{name:'Search this catalogue'}),'Grade 11');expect(await screen.findByRole('button',{name:`Browse ${workspace.curricula[1].name}`})).toBeVisible();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('no matches offers a clear way back to the catalogue',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({matches:[],hasMore:false})}));render(<WorkspaceView initial={workspace}/>);await userEvent.type(screen.getByRole('combobox',{name:'Search this catalogue'}),'unknown');await screen.findByText('No matching questions');await userEvent.click(screen.getByRole('button',{name:'Show all questions in this curriculum'}));expect(screen.getAllByRole('checkbox')).toHaveLength(3);
});
test('cards display descriptive diagram images and still support missing thumbnails',()=>{
 render(<WorkspaceView initial={{...workspace,entries:[workspace.entries[0],{...workspace.entries[1],thumbnail:undefined}]}}/>);expect(screen.getByRole('img',{name:workspace.entries[0].thumbnail!.alt})).toBeVisible();expect(screen.getAllByRole('img')).toHaveLength(1);expect(screen.getAllByRole('checkbox')).toHaveLength(2);expect(screen.getByText('No diagram preview')).toBeVisible();
});

test('fixed-mark questions display a single allocation alongside ranged items',()=>{
 const entries=[workspace.entries[0],{...workspace.entries[1],marks:{min:2,max:2}}];
 render(<WorkspaceView initial={{...workspace,entries,selection:{revision:1,release:'demo-1',entryIds:entries.map(e=>e.id)}}}/>);
 const ranged=screen.getByRole('article',{name:'Reading a motion graph'}),fixed=screen.getByRole('article',{name:'Comparing circuit measurements'});
 expect(within(ranged).getByText('8–12')).toBeVisible();expect(within(fixed).getByText('2',{selector:'strong'})).toBeVisible();expect(screen.queryByText('2–2')).not.toBeInTheDocument();
 expect(within(bar()).getByText('2 · 10–14 marks')).toBeVisible();
});

test('the detail view shows the published outline without selecting a question or fetching protected forms',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<WorkspaceView initial={workspace}/>);
 const card=screen.getByRole('article',{name:'Reading a motion graph'});const user=userEvent.setup();
 expect(within(card).getByText('3–5 parts')).toBeVisible();expect(within(card).getByText('8–12')).toBeVisible();expect(within(card).getByText('Remember to Evaluate')).toBeVisible();
 expect(screen.queryByText('Recall a concept')).toBeNull();
 await user.click(within(card).getByRole('button',{name:'Reading a motion graph'}));
 const heading=screen.getByRole('heading',{level:1,name:'Reading a motion graph'});expect(heading).toHaveFocus();
 expect(screen.getByText('Recall a concept')).toBeVisible();expect(screen.getAllByText('Remember').length).toBeGreaterThan(0);expect(screen.getAllByText('Evaluate').length).toBeGreaterThan(0);
 expect(fetch).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Add to your paper'}));expect(screen.getByText(/In your paper/)).toBeVisible();
 await user.click(screen.getByRole('button',{name:/Back to catalogue/}));
 expect(screen.getByLabelText('Select Reading a motion graph')).toBeChecked();
 expect(within(screen.getByRole('article',{name:'Reading a motion graph'})).getByRole('button',{name:'Reading a motion graph'})).toHaveFocus();
});
test('missing metadata stays explicit without invented counts or Bloom categories',()=>{
 render(<WorkspaceView initial={workspace}/>);
 const partial=screen.getByRole('article',{name:'Comparing circuit measurements'});
 expect(within(partial).getByText('3–6 parts')).toBeVisible();expect(within(partial).getByText('Not yet classified')).toBeVisible();
 const missing=screen.getByRole('article',{name:'Explaining a change of state'});
 expect(within(missing).getByText('Parts not yet published')).toBeVisible();expect(within(missing).queryByText(/Remember/)).not.toBeInTheDocument();
});
test('payment stays unavailable until purchasing is open and the selection is saved; checkout sends only the revision and marks',async()=>{
 const saved={...workspace,selection:{revision:4,release:'demo-1',entryIds:['DEMO_01']}};
 const user=userEvent.setup();
 const {unmount}=render(<WorkspaceView initial={saved}/>);await openReview(user);
 expect(payButton()).toBeDisabled();expect(screen.getByText(/Purchasing is not open/)).toBeVisible();unmount();window.history.replaceState(null,'','/');
 const assign=vi.fn();vi.stubGlobal('location',{...window.location,assign});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({orderId:'00000000-0000-4000-8000-000000000100',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_x'})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={{...saved,purchase:{available:true,amountMinor:10000,currency:'zar'}}}/>);
 await openBuilder(user);const marks=screen.getByLabelText('Reading a motion graph: marks (8–12)');await user.clear(marks);await user.type(marks,'9');
 await openReview(user);await user.click(payButton());
 await waitFor(()=>expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_x'));
 const sent=JSON.parse(fetch.mock.calls[0][1].body);expect(Object.keys(sent).sort()).toEqual(['allocations','moduleId','requestKey','selectionRevision']);
 expect(sent).toMatchObject({moduleId:workspace.module!.id,selectionRevision:4,allocations:{DEMO_01:9}});
});
test('an unsaved selection is saved before review; a failed save keeps the teacher in the builder',async()=>{
 const put=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({error:'This has changed since you opened it. Reload the workspace before saving.'})}).mockResolvedValueOnce({ok:true,json:async()=>({revision:5})});vi.stubGlobal('fetch',put);
 render(<WorkspaceView initial={{...workspace,entries:workspace.entries.map(e=>({...e,orderable:true})),selection:{revision:4,release:'demo-1',entryIds:['DEMO_01']},purchase:{available:true,amountMinor:10000,currency:'zar'}}}/>);
 const user=userEvent.setup();await user.click(screen.getByLabelText('Select Comparing circuit measurements'));await openBuilder(user);
 expect(screen.getByText('Unsaved changes')).toBeVisible();
 await user.click(screen.getByRole('button',{name:/Review and pay/}));expect(await screen.findByRole('alert')).toHaveTextContent('Reload the workspace');
 expect(screen.queryByRole('heading',{name:'Review and pay'})).toBeNull();
 await openReview(user);expect(JSON.parse(put.mock.calls[1][1].body)).toMatchObject({kind:'selection',revision:4,entryIds:['DEMO_01','DEMO_02']});expect(payButton()).toBeEnabled();
});

test.each([10,11])('payment respects the pilot limit with %i repeated questions',async n=>{
 const entry={...workspace.entries[0],id:'mcq:SYNTHETIC',marks:{min:2,max:2},orderable:true};
 render(<WorkspaceView initial={{...workspace,entries:[entry],selection:{revision:1,release:'demo-1',entryIds:Array(n).fill(entry.id)},purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true,maxQuestions:10}}}/>);
 const user=userEvent.setup();await openBuilder(user);await user.type(screen.getByLabelText('Total marks for this paper'),String(n*2));
 expect(screen.getByText(/This pilot allows up to 10 questions/)).toBeVisible();
 await openReview(user);
 if(n===10)expect(payButton()).toBeEnabled();else{expect(payButton()).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Remove 1 question');}
});
test('a selection below the overall cap still respects the multiple-choice allowance',async()=>{
 const entry={...workspace.entries[0],id:'mcq:SYNTHETIC',marks:{min:2,max:2},orderable:true};
 render(<WorkspaceView initial={{...workspace,entries:[entry],selection:{revision:1,release:'demo-1',entryIds:Array(11).fill(entry.id)},purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true,maxQuestions:20,maxStructured:10,maxMultipleChoice:10}}}/>);
 const user=userEvent.setup();await openBuilder(user);await user.type(screen.getByLabelText('Total marks for this paper'),'22');
 await openReview(user);expect(payButton()).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Reduce the number');
});

// ---------------------------------------------------------------- C05: the Paper journey
const dense={...paperWorkspace,curricula:[paperWorkspace.curricula[0]],selection:{...paperWorkspace.selection}};
test('the catalogue shows breadth first: computed totals, topic tiles and a card per entry',()=>{
 render(<WorkspaceView initial={dense}/>);
 const overview=screen.getByRole('region',{name:'Catalogue overview'});
 const structured=dense.entries.filter(e=>e.id.startsWith('structured:')).length,ready=dense.entries.filter(e=>e.orderable).length;
 expect(within(overview).getByText(String(dense.entries.length))).toBeVisible();
 expect(within(overview).getByText('Structured').nextSibling).toHaveTextContent(String(structured));
 expect(within(overview).getByText('Ready to order').nextSibling).toHaveTextContent(String(ready));
 expect(screen.getAllByRole('article')).toHaveLength(dense.entries.length);
 // C05A: 11 topic labels exceed the grouping limit, so cards flow in one grid sorted by topic.
 expect(screen.getByText(`${dense.entries.length} questions · sorted by topic`)).toBeVisible();
 expect(screen.queryByText(/Select up to 30/)).toBeNull();
});
test('filters combine within (or) and across (and) groups, show counts first, and reset without losing the selection',async()=>{
 render(<WorkspaceView initial={dense}/>);const user=userEvent.setup();
 await user.click(screen.getByLabelText('Select Block on a rough slope'));
 await user.click(screen.getByRole('button',{name:'Topic'}));
 const menu=screen.getByRole('group',{name:'Topic filter'});
 const mechanics=within(menu).getByRole('checkbox',{name:/Vectors and mechanics/});
 expect(mechanics.closest('label')).toHaveTextContent('Vectors and mechanics12');
 await user.click(mechanics);await user.click(within(menu).getByRole('checkbox',{name:/Electric circuits/}));
 await user.click(within(menu).getByRole('button',{name:'Show 16 questions'}));
 expect(screen.getByRole('button',{name:/^Topic ?2 selected/})).toHaveFocus();
 expect(screen.getByText('16 of 40 questions match')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Question type'}));await user.click(within(screen.getByRole('group',{name:'Question type filter'})).getByRole('checkbox',{name:/Structured/}));
 await user.keyboard('{Escape}');expect(screen.getByRole('button',{name:/^Question type ?1 selected/})).toHaveFocus();
 expect(screen.getByText('8 of 40 questions match')).toBeVisible();
 expect(screen.getAllByRole('article').every(a=>/STRUCTURED|Structured/.test(a.textContent||''))).toBe(true);
 await user.click(screen.getByRole('button',{name:'Remove filter Electric circuits'}));expect(screen.getByText('6 of 40 questions match')).toBeVisible();
 expect(screen.getByLabelText('Select Block on a rough slope')).toBeChecked();
 await user.click(screen.getByRole('button',{name:'Clear all'}));expect(screen.getAllByRole('article')).toHaveLength(40);
 expect(within(bar()).getByText('1 question · unsaved')).toBeVisible();
});
test('Bloom’s filtering uses published outlines only and says so',async()=>{
 render(<WorkspaceView initial={dense}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'Bloom’s level'}));await user.click(within(screen.getByRole('group',{name:'Bloom’s level filter'})).getByRole('checkbox',{name:/Analyse/}));
 expect(screen.getByText(/questions without a published outline are not shown by this filter/)).toBeVisible();
 for(const a of screen.getAllByRole('article')) expect(a).toHaveTextContent(/to Analyse/);
});
test('typing shows topic and question suggestions; Enter on a question opens its detail',async()=>{
 render(<WorkspaceView initial={dense}/>);const user=userEvent.setup();
 const box=screen.getByRole('combobox',{name:'Search this catalogue'});await user.type(box,'slope');
 const list=screen.getByRole('listbox');expect(within(list).getByRole('option',{name:/Block on a rough slope/})).toBeVisible();
 await user.keyboard('{ArrowDown}{Enter}');
 expect(screen.getByRole('heading',{level:1,name:'Block on a rough slope'})).toHaveFocus();
});
test('repeated multiple-choice occurrences stay separate; reorder, swap and remove act on one occurrence',async()=>{
 const ids=['mcq:SMCQ_01','structured:S-MECH-02','mcq:SMCQ_02'];
 render(<WorkspaceView initial={{...dense,selection:{revision:1,release:'demo-2',entryIds:ids}}}/>);const user=userEvent.setup();
 await openBuilder(user);expect(screen.getByText('1.1 Choosing the correct force diagram')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Arrange'}));
 await user.click(screen.getByRole('button',{name:'Add another Choosing the correct force diagram'}));
 const rows=()=>screen.getAllByRole('row').slice(1).map(r=>r.textContent);
 expect(rows()[0]).toContain('1.1');expect(rows()[1]).toContain('Choosing the correct force diagram · occurrence 2');
 await user.click(screen.getByRole('button',{name:'Move Mass compared with weight earlier'}));
 expect(rows()[1]).toContain('Mass compared with weight');expect(rows()[2]).toContain('occurrence 2');
 await user.click(screen.getAllByRole('button',{name:'Swap'})[2]);await user.click(screen.getByRole('button',{name:/Action and reaction pairs/}));
 expect(rows()[2]).toContain('Action and reaction pairs');expect(rows()[0]).toContain('Choosing the correct force diagram');
 await user.click(screen.getByRole('button',{name:'Remove Action and reaction pairs'}));
 expect(screen.getAllByRole('row')).toHaveLength(3);
 await user.click(screen.getByRole('button',{name:'Back to paper builder'}));
 // The structured question keeps its own place after the multiple-choice section.
 expect(screen.getByRole('table',{name:'Structured questions'})).toHaveTextContent('Block on a rough slope');
 expect(screen.getByText('Unsaved changes')).toBeVisible();
});
test('marks redistribute within each range and totals report remaining, excess and section balance',async()=>{
 render(<WorkspaceView initial={{...dense,selection:{revision:1,release:'demo-2',entryIds:['structured:S-MECH-01','structured:S-MECH-02','mcq:SMCQ_01']}}}/>);const user=userEvent.setup();
 await openBuilder(user);
 await user.type(screen.getByLabelText('Total marks for this paper'),'32');
 const a=screen.getByLabelText('Forces in equilibrium on a hanging mass: marks (9–18)'),b=screen.getByLabelText('Block on a rough slope: marks (12–18)');
 await user.type(a,'14');await user.type(b,'12');
 expect(screen.getByText(/Allocated 28 of 32 marks · 4 still to allocate/)).toBeVisible();
 await user.clear(b);await user.type(b,'19');expect(screen.getByText('Outside 12–18')).toBeVisible();
 await user.clear(b);await user.type(b,'16');expect(screen.getByText('Ready for payment')).toBeVisible();
 await user.type(screen.getByLabelText('Structured section total (optional)'),'28');expect(screen.getByText('Marks needed')).toBeVisible();expect(screen.getByText('Structured: 30 of 28 marks.')).toBeVisible();
 await user.clear(a);await user.type(a,'12');await user.clear(screen.getByLabelText('Total marks for this paper'));await user.type(screen.getByLabelText('Total marks for this paper'),'30');
 expect(screen.getByText('Ready for payment')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Block on a rough slope'}));
 expect(screen.getByRole('heading',{level:1,name:'Block on a rough slope'})).toHaveFocus();
 await user.click(screen.getByRole('button',{name:'One mark more for Block on a rough slope'}));expect(screen.getByLabelText('Block on a rough slope: marks (12–18)')).toHaveValue(17);
});
test('the paper shape sets the checkout targets from teacher-entered totals',async()=>{
 const assign=vi.fn();vi.stubGlobal('location',{...window.location,assign});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({orderId:'00000000-0000-4000-8000-000000000101',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_y'})});vi.stubGlobal('fetch',fetch);
 render(<WorkspaceView initial={{...dense,selection:{revision:3,release:'demo-2',entryIds:['mcq:SMCQ_01','mcq:SMCQ_02','structured:S-MECH-02']}}}/>);const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'My curricula'}));await user.click(screen.getByRole('button',{name:/Continue your paper/}));
 expect(screen.getByRole('heading',{name:'What shape is this paper?'})).toBeVisible();
 await user.type(screen.getByRole('spinbutton',{name:/^Total marks/}),'19');await user.type(screen.getByLabelText('Multiple-choice marks'),'3');
 expect(screen.getByText(/must be even/)).toBeVisible();expect(screen.getByRole('button',{name:/Save and open the builder/})).toBeDisabled();
 await user.clear(screen.getByLabelText('Multiple-choice marks'));await user.type(screen.getByLabelText('Multiple-choice marks'),'4');
 expect(screen.getByLabelText('Structured marks')).toHaveValue(15);
 await user.click(screen.getByRole('button',{name:/Save and open the builder/}));
 expect(screen.getByLabelText('Total marks for this paper')).toHaveValue(19);expect(screen.getByLabelText('Multiple-choice section total (optional)')).toHaveValue(4);
 await user.type(screen.getByLabelText('Block on a rough slope: marks (12–18)'),'15');
 await openReview(user);await user.click(payButton());await waitFor(()=>expect(assign).toHaveBeenCalled());
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({targets:{paper:19,sections:{multiple_choice:4,structured:15}},allocations:{'structured:S-MECH-02':15,'mcq:SMCQ_01':2}});
});
