import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { InlineNotice, Notice } from '../../app/(accounts)/system/notice';
import { Status } from '../../app/(accounts)/system/status';
import { BloomTag, bloomTone } from '../../app/(accounts)/system/tag';
import QuestionContext, { type QuestionContextLine } from '../../app/(accounts)/system/question-context';
import * as linksModule from '../../scripts/paper/check-links.mjs';

/**
 * C15: the shared definitions behave as components, not as copied markup, and the
 * offline drift check notices when somebody goes around them.
 */
const { checkLinks } = linksModule as any;

describe('task feedback and status',()=>{
  it('renders the caller\'s tone, words, role and recovery action, and offers no dismissal',()=>{
    render(<Notice tone="problem" role="alert" prominent title="We could not load your papers" actions={<a href="/teacher">Try again</a>}>Nothing has been lost.</Notice>);
    const alert=screen.getByRole('alert');
    expect(alert).toHaveTextContent('We could not load your papers');expect(alert).toHaveTextContent('Nothing has been lost.');
    expect(within(alert).getByRole('link',{name:'Try again'})).toBeInTheDocument();
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(alert.className).toContain('notice--problem');
  });
  it('announces nothing unless the caller asks, and supports a single-line message',()=>{
    const {container}=render(<><Notice tone="progress" title="Shared with your school">Saving sets them for future papers.</Notice><Notice as="p" tone="success" role="status">Selection saved.</Notice></>);
    expect(container.firstElementChild).not.toHaveAttribute('role');
    expect(screen.getByRole('status').tagName).toBe('P');
  });
  it('keeps inline feedback attached to its control',()=>{
    render(<InlineNotice tone="problem" role="alert" id="q-1-marks-attention">Marks must be within 12 to 18.</InlineNotice>);
    expect(screen.getByRole('alert')).toHaveAttribute('id','q-1-marks-attention');
  });
  it('shows a status as a hidden dot plus a readable label',()=>{
    const {container}=render(<Status tone="attention" label="Needs you"/>);
    expect(screen.getByText('Needs you').className).toContain('status__label--attention');
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain('status__dot--attention');
  });
});

describe('Bloom\'s tag',()=>{
  it('uses one colour class per category whatever the letter case, and never invents one',()=>{
    expect(bloomTone('Remember')).toBe(bloomTone('remember'));
    expect(bloomTone('Remember')).not.toBe(bloomTone('Apply'));
    expect(bloomTone('Synthesis')).toBeUndefined();
    render(<><BloomTag bloom="Analyse"/><BloomTag bloom="Not yet classified" tone="unclassified"/><BloomTag bloom="Mystery"/></>);
    expect(screen.getByText('Analyse').className).toContain('tag--analyse');
    expect(screen.getByText('Not yet classified').className).toContain('tag--unclassified');
    expect(screen.getByText('Mystery').className).toContain('tag--unclassified');
  });
});

describe('question context',()=>{
  const outline={subquestions:{min:2,max:3},rows:[{summary:'State a synthetic definition',bloom:'Remember',marks:{min:2,max:2}},{summary:'Explain a synthetic change',bloom:'Analyse',marks:{min:2,max:4}}]};
  const line=(id:string,number:string):QuestionContextLine=>({id,number,kind:'structured',marks:{value:null,min:10,max:16,fixed:false},outline} as QuestionContextLine);
  const catalogue={topic:'Synthetic relationships',description:'Learners use a synthetic relationship.',thumbnail:null} as any;
  function TwoOccurrences(){
    const [open,setOpen]=useState<Record<string,boolean>>({});
    return <>{[['occurrence-a','2',12],['occurrence-b','3',15]].map(([id,number,marks])=><div key={id as string} data-testid={id as string}>
      <QuestionContext line={line(id as string,number as string)} marks={marks as number} catalogue={catalogue} open={!!open[id as string]} onToggle={()=>setOpen(o=>({...o,[id as string]:!o[id as string]}))}/></div>)}</>;
  }
  it('renders the same question type twice with separate marks, numbering and disclosure',async()=>{
    render(<TwoOccurrences/>);
    const a=within(screen.getByTestId('occurrence-a')),b=within(screen.getByTestId('occurrence-b'));
    expect(a.getByText('12 marks selected')).toBeInTheDocument();expect(b.getByText('15 marks selected')).toBeInTheDocument();
    await userEvent.click(a.getByRole('button',{name:'View question outline'}));
    expect(a.getByRole('button',{name:'Hide question outline'})).toHaveAttribute('aria-expanded','true');
    expect(b.getByRole('button',{name:'View question outline'})).toHaveAttribute('aria-expanded','false');
    expect(a.getByText('2.1')).toBeVisible();expect(b.getByText('3.1')).not.toBeVisible();
    // The outline tag is the shared tag, not a private copy.
    expect(a.getByText('Remember').className).toContain(bloomTone('remember'));
  });
  it('is read-only: it holds no answer control',()=>{
    render(<TwoOccurrences/>);
    for(const role of ['textbox','checkbox','radio','spinbutton','combobox'])expect(screen.queryAllByRole(role)).toHaveLength(0);
  });
  it('says so when published context is missing instead of filling it in',()=>{
    render(<QuestionContext line={{...line('c','4'),outline:null} as QuestionContextLine} marks={null} open={false} onToggle={()=>{}}/>);
    expect(screen.getByText(/A short description has not been published/)).toBeInTheDocument();
    expect(screen.getByText('Marks not set yet')).toBeInTheDocument();
    expect(screen.getByText(/example question outline has not been published/)).toBeInTheDocument();
  });
});

describe('drift check without Paper',()=>{
  const root=path.resolve(__dirname,'../..');let copy='';
  const stylesheet='app/(accounts)/teacher/orders/[id]/configure.module.css',generated='app/paper-components.css';
  const change=(file:string,edit:(text:string)=>string)=>{const target=path.join(copy,file),before=fs.readFileSync(target,'utf8');fs.writeFileSync(target,edit(before));return ()=>fs.writeFileSync(target,before);};
  beforeAll(()=>{copy=fs.mkdtempSync(path.join(os.tmpdir(),'c15-links-'));for(const dir of ['app','lib','design/paper'])fs.cpSync(path.join(root,dir),path.join(copy,dir),{recursive:true});});
  afterAll(()=>fs.rmSync(copy,{recursive:true,force:true}));

  it('passes on the repository as committed',()=>{expect(checkLinks(root).failures).toEqual([]);});

  it.each([
    ['a private restyle of a shared block',stylesheet,(t:string)=>t+'\n.tag--remember { background:#00FF00; }\n',/private style \.tag--remember redefines the shared K08 block "tag"/],
    ['a hand-edited generated value',generated,(t:string)=>t.replace('--pc-tag-padding-block: 3px','--pc-tag-padding-block: 5px'),/paper-components\.css: edited by hand/],
    ['a stylesheet reading a value no master exports','app/(accounts)/system/tag.module.css',(t:string)=>t.replace('var(--pc-tag-border-radius)','var(--pc-tag-corner)'),/reads --pc-tag-corner, which no Paper master exports/],
    ['an email colour that left the tokens','lib/email/templates.ts',(t:string)=>t.replace("canvas: '#F8F6F0'","canvas: '#FFFFFF'"),/colour block differs from the Paper tokens/],
    ['a use that the registry does not list','app/(accounts)/teacher/paper/paper-bar.tsx',(t:string)=>t.replace("import { Icon, Meter } from './ui';","import { Icon, Meter } from './ui';\nimport { Status } from '../../system/status';"),/paper-bar\.tsx imports .*status\.tsx but is not listed as a use/],
    ['an instance that was never synchronised','design/paper/link-lock.json',(t:string)=>{const lock=JSON.parse(t);delete lock.instances['website:A22-0'];return JSON.stringify(lock);},/website:A22-0: registered instance of question-context has never been synchronised/],
  ])('fails on %s and passes again once it is put back',(_name,file,edit,message)=>{
    const restore=change(file,edit);
    expect(checkLinks(copy).failures.join('\n')).toMatch(message);
    restore();
    expect(checkLinks(copy).failures).toEqual([]);
  });
});
