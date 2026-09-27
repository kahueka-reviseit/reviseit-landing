// C05A R3: the pilot's real catalogue shape (89 entries, 81 topic labels, 73 used once).
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {test,expect} from 'vitest';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {denseWorkspace,denseEntries} from '../fixtures/dense-catalogue';
import {topicGroups} from '../../lib/workspace/paper';

test('the synthetic fixture has the real Grade 11 density',()=>{
 const g=topicGroups(denseEntries);
 expect([denseEntries.length,g.length,g.filter(x=>x.total===1).length,denseEntries.filter(e=>e.orderable).length]).toEqual([89,81,73,43]);
 expect(denseEntries.filter(e=>!e.preview?.outline).length).toBeGreaterThan(50);
 expect(Math.max(...g.map(x=>x.topic.length))).toBeGreaterThan(100);
});
test('the overview is bounded and discloses every published topic label on request',async()=>{
 render(<WorkspaceView initial={denseWorkspace}/>);const user=userEvent.setup();
 const overview=screen.getByRole('region',{name:'Catalogue overview'});
 expect(within(overview).getAllByRole('button',{pressed:false}).length).toBe(8);
 expect(within(overview).getByText('Topics · 81 · largest first')).toBeVisible();
 const show=within(overview).getByRole('button',{name:'Show all 81 topics'});expect(show).toHaveAttribute('aria-expanded','false');
 await user.click(show);
 const expanded=within(overview).getByRole('button',{name:'Show the largest topics only'});expect(expanded).toHaveAttribute('aria-expanded','true');
 const list=document.getElementById(expanded.getAttribute('aria-controls')!)!;
 expect(within(list).getAllByRole('button')).toHaveLength(81);
 // Labels are shown exactly as published: no invented grouping or rewording.
 for(const g of topicGroups(denseEntries)) expect(within(list).getByText(g.topic)).toBeInTheDocument();
 await user.click(within(list).getByRole('button',{name:new RegExp(topicGroups(denseEntries)[40].topic)}));
 expect(screen.getByText('1 of 89 questions match')).toBeVisible();
});
test('granular topics flow in one grid sorted by topic instead of one section per label',()=>{
 render(<WorkspaceView initial={denseWorkspace}/>);
 expect(screen.getByText('89 questions · sorted by topic')).toBeVisible();
 expect(document.querySelectorAll('[class*="groupLabel"]')).toHaveLength(0);
 const topics=screen.getAllByRole('article').map(a=>within(a).getByRole('button',{name:/^Show only /}).textContent!);
 expect(topics).toEqual([...topics].sort((a,b)=>a.localeCompare(b)));
});
test('a few real topics still get their own labelled groups',async()=>{
 render(<WorkspaceView initial={denseWorkspace}/>);const user=userEvent.setup();
 const [a,b]=topicGroups(denseEntries);
 await user.click(screen.getByRole('button',{name:'Topic'}));
 const menu=screen.getByRole('group',{name:'Topic filter'});
 const find=within(menu).getByRole('searchbox',{name:'Find a topic'});expect(find).toHaveFocus();
 await user.type(find,a.topic.slice(10,40));
 await user.click(within(menu).getByRole('checkbox',{name:new RegExp(a.topic)}));
 await user.clear(find);await user.type(find,b.topic.slice(10,40));
 expect(within(menu).getByRole('checkbox',{name:new RegExp(a.topic)})).toBeChecked();
 await user.click(within(menu).getByRole('checkbox',{name:new RegExp(b.topic)}));
 await user.keyboard('{Escape}');
 expect(screen.getByRole('region',{name:`${a.topic}, 2 questions`})).toBeInTheDocument();
 expect(screen.getByText('4 of 89 questions match')).toBeVisible();
});
