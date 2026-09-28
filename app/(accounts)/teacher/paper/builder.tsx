'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CatalogueEntry } from '../../../../lib/workspace/contracts';
import { formatMarks } from '../../../../lib/workspace/catalogue';
import { codeOf, kindOf, outlineMix, topicGroups } from '../../../../lib/workspace/paper';
import styles from '../paper.module.css';
import { occurrenceName, type Occurrence, type PaperModel } from './model';
import { BloomBar, BloomTag, Icon, PageHeader, Stages, type Stage } from './ui';

// ---------------------------------------------------------------- shared
const stageLabels=['Paper shape','Choose questions','Set marks','Pay','Complete details'];
export function journey(paper:PaperModel,current:number):Stage[] {
  const done=[paper.paperTarget!==null||!paper.configured,paper.occurrences.length>0&&!paper.selectionDirty,paper.marksSet&&paper.balanced,false,false];
  return stageLabels.map((label,i)=>({label,state:i===current?'now':i<current&&done[i]?'done':'next'}));
}
const toNumber=(v:string)=>v.trim()===''?NaN:Number.isInteger(Number(v))?Number(v):NaN;
export function paperSummary(paper:PaperModel):string {
  const mc=paper.occurrences.filter(o=>o.kind==='multiple_choice').length, s=paper.occurrences.length-mc;
  const parts=[paper.paperTarget!==null?`${paper.paperTarget} marks`:null,mc?`${mc} multiple choice (${mc*2} marks)`:null,s?`${s} structured ${s===1?'question':'questions'}${paper.marksSet?` (${paper.sectionTotal('structured')} marks)`:''}`:null].filter(Boolean);
  return parts.length?parts.join(' · '):'No questions chosen yet';
}

/** Marks input for one structured item. The accessible name states the permitted range. */
function MarksInput({paper,entry,variant='row'}:{paper:PaperModel;entry:CatalogueEntry;variant?:'row'|'stepper'}) {
  const value=paper.allocation[entry.id], bad=paper.configured&&Number.isInteger(value)&&!paper.inRange(entry);
  const input=<input type="number" inputMode="numeric" min={entry.marks.min} max={entry.marks.max} step={1} disabled={paper.busy}
    aria-label={`${entry.title}: marks (${formatMarks(entry.marks)})`} aria-invalid={bad} placeholder={paper.configured?'Set':undefined}
    value={Number.isNaN(value)?'':value} onChange={e=>paper.setMark(entry.id,toNumber(e.target.value))}/>;
  if(variant==='row') return <label className={`${styles['question-table__cell--marks']} ${bad?styles['marks-control--invalid']:''}`}>{input}<span>of {formatMarks(entry.marks).replace('–',' to ')}</span></label>;
  const current=Number.isInteger(value)?value:null;
  return <div className={`${styles['stepper']} ${bad?styles['marks-control--invalid']:''}`}>
    <button type="button" aria-label={`One mark fewer for ${entry.title}`} disabled={paper.busy||current===null||current<=entry.marks.min} onClick={()=>paper.setMark(entry.id,current!-1)}>−</button>
    <label>{input}<span>marks</span></label>
    <button type="button" aria-label={`One mark more for ${entry.title}`} disabled={paper.busy||(current??0)>=entry.marks.max} onClick={()=>paper.setMark(entry.id,current===null?entry.marks.min:current+1)}>+</button>
  </div>;
}

function statusOf(paper:PaperModel,e:CatalogueEntry):{text:string;tone:'ok'|'todo'|'bad'} {
  if(!e.orderable) return {text:'Not yet available',tone:'bad'};
  const v=paper.allocation[e.id];
  if(!Number.isInteger(v)) return {text:'Marks needed',tone:'todo'};
  return paper.inRange(e)?{text:'Marks set',tone:'ok'}:{text:`Outside ${formatMarks(e.marks)}`,tone:'bad'};
}

function Rail({paper,children}:{paper:PaperModel;children?:ReactNode}) {
  const {configured,paperTarget,allocatedTotal,sectionTargets,sectionTotal,occurrences,limits,withinPilotSize,mcqCount,structuredCount}=paper;
  const n=occurrences.length;
  const statusText=!configured?'Marks set':paper.marksSet&&paper.balanced?'Ready for payment':'Marks needed';
  const structured=occurrences.filter(o=>o.kind==='structured');
  const [saving,setSaving]=useState(false);
  async function review(){if(paper.selectionDirty){setSaving(true);const ok=await paper.save();setSaving(false);if(!ok)return;}paper.go('review');}
  return <aside className={styles['page-body__aside']} aria-label="Paper status">
    <section className={styles['card']}>
      <p className={styles['eyebrow--positive']}>Paper status</p>
      <div role="status" className={styles['card__summary']}><strong>{statusText}</strong>
        <span>{configured?`Allocated ${allocatedTotal} of ${paperTarget ?? '—'} marks`:`Paper total: ${allocatedTotal} marks`}{configured&&paperTarget!==null&&paper.marksSet&&allocatedTotal<paperTarget?` · ${paperTarget-allocatedTotal} still to allocate`:''}{configured&&paperTarget!==null&&allocatedTotal>paperTarget?` · ${allocatedTotal-paperTarget} over the total`:''}</span></div>
      {configured&&<p className={styles['card__body']}>Set marks for every chosen question within its range, then match your totals. After payment you can still move marks between questions and change every other choice until you submit.</p>}
    </section>
    {n>0&&<section className={styles['card']} aria-labelledby="budget-heading">
      <p id="budget-heading" className={styles['eyebrow--neutral']}>Marks budget</p>
      {configured&&<label className={styles['totals__paper-target']}>Total marks for this paper<input type="number" min={1} max={3000} step={1} disabled={paper.busy} value={paperTarget ?? ''} placeholder="Set a total"
        onChange={e=>{const v=toNumber(e.target.value);paper.setPaperTarget(Number.isNaN(v)?null:v);}}/></label>}
      {(['multiple_choice','structured'] as const).filter(k=>occurrences.some(o=>o.kind===k)).map(k=>{
        const t=sectionTargets[k], total=sectionTotal(k), ok=t===undefined||t===total;
        return <div key={k} className={styles['budget-line']}>
          <div><span>{k==='multiple_choice'?'Multiple choice':'Structured'}</span><span>{total}{t!==undefined?` of ${t}`:''}{t!==undefined&&ok?' ✓':''}</span></div>
          {k==='multiple_choice' ? <span className={styles['budget-line__bar']} aria-hidden="true"><i className={styles['type-split__segment--multiple-choice']} style={{flexGrow:Math.max(total,t===undefined?1:0)}}/>{t!==undefined&&total<t&&<i className={styles['budget-line__gap']} style={{flexGrow:t-total}}/>}</span> :
            <span className={styles['budget-line__bar']} aria-hidden="true">{structured.map((o,i)=><i key={o.index} className={styles['type-split__segment--structured']} style={{flexGrow:Number.isInteger(paper.allocation[o.entry.id])?paper.allocation[o.entry.id]:o.entry.marks.min,opacity:1-i*0.12}}/>)}
              {t!==undefined&&total<t&&<i className={styles['budget-line__gap']} style={{flexGrow:t-total}}/>}</span>}
          {k==='structured'&&structured.length>1&&<small>{structured.map(o=>Number.isInteger(paper.allocation[o.entry.id])?paper.allocation[o.entry.id]:'?').join(' + ')}</small>}
          {configured&&<label className={styles['totals__section-target']}>{k==='multiple_choice'?'Multiple-choice section total (optional)':'Structured section total (optional)'}
            <input type="number" min={0} max={3000} step={1} placeholder="Any" disabled={paper.busy} value={t ?? ''} aria-invalid={!ok}
              onChange={e=>{const v=toNumber(e.target.value);paper.setSectionTarget(k,Number.isNaN(v)?undefined:v);}}/></label>}
          {!ok&&<p className={styles['notice__warning']}>{k==='multiple_choice'?'Multiple choice':'Structured'}: {total} of {t} marks.</p>}
        </div>;})}
      <div className={styles['totals']}><span>Paper total</span><strong>{allocatedTotal} marks</strong></div>
    </section>}
    <section className={styles['card']} aria-labelledby="limits-heading">
      <p id="limits-heading" className={styles['eyebrow--neutral']}>This pilot</p>
      <p className={styles['card__body']}>This pilot allows up to {limits.questions} questions per paper. Each repeated multiple-choice question counts separately.
        {(limits.structured<limits.questions||limits.multipleChoice<limits.questions)&&` Up to ${limits.structured} structured questions and ${limits.multipleChoice} multiple-choice questions.`}</p>
      <p className={styles['card__figures']}><span>{structuredCount} of {limits.structured} structured</span><span>{mcqCount} of {limits.multipleChoice} multiple choice</span></p>
      {!withinPilotSize&&n<=limits.questions&&<p role="alert" className={styles['notice__warning']}>Reduce the number of structured or multiple-choice questions to fit the pilot limits before paying.</p>}
      {n>limits.questions&&<p role="alert" className={styles['notice__warning']}>Remove {n-limits.questions} {n-limits.questions===1?'question':'questions'} before continuing to payment.</p>}
    </section>
    {children}
    <div className={styles['page-body__actions']}>
      <button type="button" className={styles['button--primary-wide']} disabled={paper.busy||saving||n===0} onClick={()=>void review()}>{saving?'Saving your selection…':'Review and pay'} {Icon.arrow()}</button>
      <button type="button" className={styles['button--secondary-wide']} onClick={()=>paper.go('catalogue')}>Add from catalogue</button>
      <p className={styles['save-status']}>{paper.selectionDirty?'Unsaved changes':paper.data.selection.revision?'Selection saved':'No saved selection yet'}
        {paper.selectionDirty&&<button type="button" className={styles['link']} disabled={paper.busy} onClick={()=>void paper.save()}>{paper.busy?'Please wait…':'Save selection'}</button>}</p>
      <p className={styles['card__note']}>Marks and totals are kept in this browser until you pay; your chosen questions are saved to your account.</p>
    </div>
  </aside>;
}

function RowActions({paper,o,same}:{paper:PaperModel;o:Occurrence;same:Occurrence[]}) {
  const at=same.indexOf(o), name=occurrenceName(o);
  return <span className={styles['question-table__actions']}>
    <button type="button" className={styles['button--icon']} disabled={paper.busy||at===0} aria-label={`Move ${name} earlier`} onClick={()=>paper.move(o.index,-1)}>{Icon.up()}</button>
    <button type="button" className={styles['button--icon']} disabled={paper.busy||at===same.length-1} aria-label={`Move ${name} later`} onClick={()=>paper.move(o.index,1)}>{Icon.down()}</button>
    <button type="button" className={styles['button--remove']} disabled={paper.busy} aria-label={`Remove ${name}`} onClick={()=>paper.remove(o.index)}>Remove</button>
  </span>;
}

// ---------------------------------------------------------------- C1
export function BuilderView({paper,status}:{paper:PaperModel;status:ReactNode}) {
  const {occurrences,data,sectionTargets}=paper;
  const mcq=occurrences.filter(o=>o.kind==='multiple_choice'), structured=occurrences.filter(o=>o.kind==='structured');
  const mcTarget=sectionTargets.multiple_choice;
  return <>
    <PageHeader eyebrow={`${data.module!.name} · paper builder`} title="Your paper" subtitle={paperSummary(paper)} aside={<Stages stages={journey(paper,2)}/>}/>
    {status}
    {paper.stale && <p className={styles['notice--error']}>The catalogue has changed since you saved. Review the current entries and save a new selection. Your previous selection stays saved until then.</p>}
    <div className={styles['page-body']}>
      <div className={styles['page-body__main']}>
        {occurrences.length===0 && <section className={styles['section']}><div className={styles['section__header']}><div><p className={styles['eyebrow--neutral']}>Your paper</p><h2>No questions yet</h2></div></div>
          <p className={styles['section__body']}>Choose questions from the catalogue. They appear here so you can set marks and order them.</p>
          <div className={styles['section__footer']}><button type="button" className={styles['button--secondary-compact']} onClick={()=>paper.go('catalogue')}>Browse the catalogue</button>{paper.configured&&paper.paperTarget===null&&<button type="button" className={styles['link']} onClick={()=>paper.go('shape')}>Set the paper’s shape first</button>}</div></section>}
        {mcq.length>0 && <section className={`${styles['section']} ${styles['section--multiple-choice']}`} aria-labelledby="section-a">
          <div className={styles['section__header']}>
            <div><p className={styles['eyebrow--multiple-choice']}>Section A · Question 1 · Multiple choice</p>
              <h2 id="section-a">{mcq.length} {mcTarget!==undefined?`of ${Math.floor(mcTarget/2)} `:''}chosen · {mcq.length*2}{mcTarget!==undefined?` of ${mcTarget}`:''} marks</h2></div>
            <div className={styles['section__meta']}><span>{mcq.every(o=>o.entry.orderable)?'Marks set · 2 each':'Includes unavailable items'}</span>
              <button type="button" className={styles['button--text']} onClick={()=>paper.go('builder-mcq')}>Arrange</button></div>
          </div>
          <ol className={styles['multiple-choice-chips']}>{mcq.map(o=><li key={o.index} className={o.entry.orderable?'':styles['multiple-choice-chips__item--invalid']}>{o.number} {o.entry.title}{o.repeat?` · occurrence ${o.repeat+1}`:''}</li>)}</ol>
          <p className={styles['section__body']}>A multiple-choice type can be added more than once; each occurrence becomes its own question with its own details.</p>
        </section>}
        {structured.length>0 && <section className={`${styles['section']} ${styles['section--structured']} ${styles['section--flush']}`} aria-labelledby="section-b">
          <div className={styles['section__header']}>
            <div><p className={styles['eyebrow--structured']}>Section {mcq.length?'B':'A'} · Structured</p>
              <h2 id="section-b">{structured.length} {structured.length===1?'question':'questions'} · {paper.sectionTotal('structured')}{sectionTargets.structured!==undefined?` of ${sectionTargets.structured}`:''} marks</h2></div>
            <button type="button" className={styles['button--secondary-compact']} onClick={()=>{paper.setFilters({...paper.filters,kinds:['structured']});paper.go('catalogue');}}>{Icon.plus(12)} Add from catalogue</button>
          </div>
          <div className={styles['question-table']} role="table" aria-label="Structured questions">
            <div role="row" className={styles['question-table__head']}><span role="columnheader">Q</span><span role="columnheader">Question</span><span role="columnheader">Marks</span><span role="columnheader">Bloom’s mix</span><span role="columnheader">Status</span><span role="columnheader"><span className={styles['visually-hidden']}>Actions</span></span></div>
            {structured.map(o=>{const e=o.entry,mix=outlineMix(e),s=statusOf(paper,e);
              return <div role="row" key={o.index} className={styles['question-table__row']}>
                <span role="cell" className={styles['question-table__cell--number']}>{o.number}</span>
                <span role="cell" className={styles['question-table__cell--question']}><button type="button" className={styles['question-table__title']} onClick={()=>paper.go('builder-question',e.id)}>{e.title}</button>
                  <small>{codeOf(e.id)} · {e.topic}{e.preview?` · ${formatMarks(e.preview.subquestions)} subquestions`:''}</small><RowActions paper={paper} o={o} same={structured}/></span>
                <span role="cell"><MarksInput paper={paper} entry={e}/></span>
                <span role="cell" className={styles['question-table__cell--bloom']}>{mix.length?<><BloomBar rows={mix.map(m=>({bloom:m.bloom,weight:m.min}))}/><small>{mix.map(m=>`${m.bloom} ${m.min===m.max?m.min:`${m.min}–${m.max}`}`).join(' · ')}</small></>:<small>{e.preview?.outline?'Outline without part marks':'Not yet classified'}</small>}</span>
                <span role="cell" className={`${styles['question-table__cell--status']} ${styles[({ok:'status--ready',todo:'status--to-complete',bad:'status--invalid'} as const)[s.tone]]}`}>{s.text}</span>
                <span role="cell" className={styles['question-table__cell--actions']}><button type="button" className={styles['button--text']} onClick={()=>paper.go('builder-question',e.id)}>Configure</button></span>
              </div>;})}
          </div>
        </section>}
      </div>
      <Rail paper={paper}/>
    </div>
  </>;
}

// ---------------------------------------------------------------- C2
export function BuilderQuestion({paper,entry,status}:{paper:PaperModel;entry:CatalogueEntry;status:ReactNode}) {
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>heading.current?.focus(),[entry.id]);
  const structured=paper.occurrences.filter(o=>o.kind==='structured');
  const o=structured.find(x=>x.entry.id===entry.id);
  if(!o) return <section className={styles['empty-state']}><h2>This question is no longer in your paper</h2><button type="button" className={styles['button--secondary-compact']} onClick={()=>paper.go('builder')}>Back to paper builder</button></section>;
  const next=structured[structured.indexOf(o)+1];
  const value=paper.allocation[entry.id], set=Number.isInteger(value), range=entry.marks.max-entry.marks.min;
  const outline=entry.preview?.outline, mix=outlineMix(entry);
  return <>
    <header className={styles['page-header']}><div className={styles['page-header__titles']}>
      <button type="button" className={styles['page-header__back']} onClick={()=>paper.go('builder')}>{Icon.back(12)} Your paper · Question {o.number} · Structured · {codeOf(entry.id)}</button>
      <h1 ref={heading} tabIndex={-1}>{entry.title}</h1>
      <p className={styles['page-header__subtitle']}>{[entry.topic,entry.description,`${formatMarks(entry.marks).replace('–',' to ')} marks`].filter(Boolean).join(' · ')}</p></div>
      <Stages stages={journey(paper,2)}/></header>
    {status}
    <div className={styles['page-body']}>
      <div className={styles['page-body__main']}>
        <section className={styles['card--panel']} aria-labelledby="marks-step">
          <div className={styles['card__header']}><div><p id="marks-step" className={styles['eyebrow--structured']}>1 · Marks</p><p className={styles['card__lead']}>This question can carry {formatMarks(entry.marks).replace('–',' to ')} marks.</p></div><MarksInput paper={paper} entry={entry} variant="stepper"/></div>
          {range>0&&range<=40&&<div className={styles['range-ruler']} aria-hidden="true">
            <span>{Array.from({length:range+1},(_,i)=><i key={i} className={set&&value===entry.marks.min+i?styles['range-ruler__segment--current']:''}/>)}</span>
            <span>{Array.from({length:range+1},(_,i)=><small key={i} className={set&&value===entry.marks.min+i?styles['range-ruler__segment--current']:''}>{entry.marks.min+i}</small>)}</span></div>}
          <p className={styles['notice--info']}>Change the allocation within {formatMarks(entry.marks)} marks. The paper total updates with it, before or after payment.</p>
        </section>
        <section className={styles['card--panel']} aria-labelledby="outline-step">
          <p id="outline-step" className={styles['eyebrow--structured']}>2 · What the question covers</p>
          {outline ? <><p className={styles['card__lead']}>One published example structure. After payment you choose which parts to include; marks rebalance across what remains.</p>
            <ol className={styles['subquestion-list']}>{outline.map((r,i)=><li key={i}><span className={styles['subquestion-toggle__number']}>{o.number}.{i+1}</span><span>{r.summary}</span><BloomTag bloom={r.bloom}/><strong>{r.marks?formatMarks(r.marks):'—'}</strong></li>)}</ol></> :
            <p className={styles['card__lead']}>A reviewed outline has not been published for this question{entry.preview?` (${formatMarks(entry.preview.subquestions)} parts)`:''}. Its parts are set within the published range; they can be chosen after payment where the question supports it.</p>}
        </section>
        <section className={styles['card--panel']}><p className={styles['eyebrow--structured']}>3 · Difficulty, parts and scenario</p>
          <p className={styles['card__lead']}>Detailed choices unlock after payment. You can then revise marks, parts and difficulty as well, until you submit.</p></section>
      </div>
      <aside className={styles['page-body__aside']} aria-label="Question summary">
        <section className={styles['card']}><p className={styles['eyebrow--neutral']}>Question allocation</p>
          <p className={styles['marks-fixed__value']}>{set?`${value} marks`:'Marks needed'}</p>
          <ul className={styles['list']}><li className={set&&paper.inRange(entry)?styles['status--ready']:''}>{set?(paper.inRange(entry)?`Marks set to ${value}`:`${value} is outside ${formatMarks(entry.marks)}`):'Set marks within the range'}</li>
            <li>Parts, difficulty and scenario: after payment</li></ul></section>
        <section className={styles['card']}><div className={styles['card__heading']}><p className={styles['eyebrow--neutral']}>Question outline</p><span className={styles['status-tag']}>{outline?'Published example':'Not yet published'}</span></div>
          <div className={styles['paper-preview']}><p><strong>QUESTION {o.number}</strong><span>({set?value:formatMarks(entry.marks)})</span></p>
            <p className={styles['paper-preview__intro']}>{entry.title} · scenario and values follow your paid choices.</p>
            {outline?outline.map((r,i)=><p key={i}><span>{o.number}.{i+1}  {r.summary}</span><span>{r.marks?`(${formatMarks(r.marks)})`:''}</span></p>):<p className={styles['paper-preview__intro']}>Parts appear here when an outline is published.</p>}</div>
          <p className={styles['card__body']}>Preview of the question’s shape. The final wording and values are generated after submission.</p>
          {mix.length>0&&<><BloomBar rows={mix.map(m=>({bloom:m.bloom,weight:m.min}))}/><p className={styles['card__note']}>{mix.map(m=>`${m.bloom} ${m.min===m.max?m.min:`${m.min} to ${m.max}`}`).join(' · ')}</p></>}
        </section>
        <div className={styles['page-body__actions']}>
          {next?<button type="button" className={styles['button--primary-wide']} onClick={()=>paper.go('builder-question',next.entry.id)}>Next: Question {next.number} {Icon.arrow()}</button>:
            <button type="button" className={styles['button--primary-wide']} onClick={()=>paper.go('builder')}>Back to paper builder {Icon.arrow()}</button>}
          {next&&<button type="button" className={styles['button--secondary-wide']} onClick={()=>paper.go('builder')}>Back to paper builder</button>}
        </div>
      </aside>
    </div>
  </>;
}

// ---------------------------------------------------------------- C3
export function BuilderMultipleChoice({paper,status}:{paper:PaperModel;status:ReactNode}) {
  const [swapping,setSwapping]=useState<number|null>(null);
  const {occurrences,data,ids,busy}=paper;
  const mcq=occurrences.filter(o=>o.kind==='multiple_choice');
  const types=data.entries.filter(e=>kindOf(e)==='multiple_choice');
  const balance=topicGroups(mcq.map(o=>o.entry));
  const target=paper.sectionTargets.multiple_choice;
  const sortByTopic=()=>{const slots=mcq.map(o=>o.index).sort((a,b)=>a-b);const sorted=[...mcq].sort((a,b)=>a.entry.topic.localeCompare(b.entry.topic)||a.index-b.index);
    const next=[...ids];slots.forEach((slot,i)=>{next[slot]=sorted[i].entry.id;});paper.arrange(next);};
  return <>
    <header className={styles['page-header']}><div className={styles['page-header__titles']}>
      <button type="button" className={styles['page-header__back']} onClick={()=>paper.go('builder')}>{Icon.back(12)} Your paper · Question 1 · Multiple choice</button>
      <h1>Multiple choice, {mcq.length} {mcq.length===1?'question':'questions'}</h1>
      <p className={styles['page-header__subtitle']}>2 marks each · {mcq.length*2} marks · chosen from {types.length} multiple-choice types in this catalogue</p></div>
      <Stages stages={journey(paper,2)}/></header>
    {status}
    <div className={styles['page-body']}>
      <div className={styles['page-body__main']}>
        <section className={`${styles['section']} ${styles['section--multiple-choice']} ${styles['section--flush']}`} aria-labelledby="mc-order">
          <div className={styles['section__header']}><div><p id="mc-order" className={styles['eyebrow--multiple-choice']}>Order on the paper</p>
            <p className={styles['section__body']}>Use the arrows to reorder. Swap a type here; configure each item’s detailed choices after payment.</p></div>
            <button type="button" className={styles['button--secondary-compact']} disabled={busy||mcq.length<2} onClick={sortByTopic}>Sort by topic</button></div>
          {mcq.length===0?<p className={styles['section__body']}>No multiple-choice questions yet. <button type="button" className={styles['link']} onClick={()=>{paper.setFilters({...paper.filters,kinds:['multiple_choice']});paper.go('catalogue');}}>Browse multiple-choice types</button></p>:
          <div className={styles['question-table']} role="table" aria-label="Multiple-choice order">
            <div role="row" className={`${styles['question-table__head']} ${styles['question-table--multiple-choice']}`}><span role="columnheader">No.</span><span role="columnheader">Question type</span><span role="columnheader">Topic</span><span role="columnheader"><span className={styles['visually-hidden']}>Actions</span></span></div>
            {mcq.map(o=>{const alternatives=types.filter(t=>t.id!==o.entry.id&&t.orderable&&t.topic===o.entry.topic);const open=swapping===o.index;
              return <div key={o.index} className={open?styles['question-table__row--selected']:''}>
                <div role="row" className={`${styles['question-table__row']} ${styles['question-table--multiple-choice']}`}>
                  <span role="cell" className={styles['question-table__number--multiple-choice']}>{o.number}</span>
                  <span role="cell" className={styles['question-table__cell--question']}><strong>{o.entry.title}{o.repeat?` · occurrence ${o.repeat+1}`:''}</strong><small>{codeOf(o.entry.id)}{o.entry.orderable?'':' · not yet available'}</small></span>
                  <span role="cell" className={styles['question-table__cell--topic']}>{o.entry.topic}</span>
                  <span role="cell" className={styles['question-table__cell--actions']}>
                    <button type="button" className={styles['button--text']} aria-expanded={open} onClick={()=>setSwapping(open?null:o.index)}>{open?'Close':'Swap'}</button>
                    <button type="button" className={styles['button--text']} disabled={busy||ids.length>=30} aria-label={`Add another ${o.entry.title}`} onClick={()=>paper.addAfter(o.index)}>+ another</button>
                    <RowActions paper={paper} o={o} same={mcq}/></span>
                </div>
                {open&&<div className={styles['swap-panel']}><p>Swap {o.number} for another {o.entry.topic} type</p>
                  {alternatives.length?<ul>{alternatives.slice(0,6).map(t=><li key={t.id}><button type="button" onClick={()=>{paper.swap(o.index,t.id);setSwapping(null);}}><strong>{t.title}</strong><small>{codeOf(t.id)} · {t.topic}</small></button></li>)}</ul>:
                    <p className={styles['section__body']}>No other ready types in this topic. Browse the catalogue to add a different topic.</p>}</div>}
              </div>;})}
          </div>}
        </section>
      </div>
      <aside className={styles['page-body__aside']} aria-label="Multiple-choice summary">
        <section className={styles['card']}><p className={styles['eyebrow--positive']}>Multiple choice</p>
          <p className={styles['marks-fixed__value']}>{mcq.length*2} marks <small>{mcq.length} {mcq.length===1?'item':'items'} × 2 marks</small></p>
          {target!==undefined&&<p className={mcq.length*2===target?styles['notice__success']:styles['notice__warning']}>{mcq.length*2} of {target} multiple-choice marks{mcq.length*2===target?' ✓':''}</p>}
          <p className={styles['card__body']}>After payment, configure each item’s details, or choose for me where offered. Choices stay editable until submission.</p></section>
        {balance.length>0&&<section className={styles['card']}><p className={styles['eyebrow--neutral']}>Topic balance</p>
          <ul className={styles['topic-balance']}>{balance.map(g=><li key={g.topic}><span>{g.topic}</span><span aria-hidden="true" className={styles['card__blocks']}>{Array.from({length:g.total},(_,i)=><i key={i}/>)}</span><strong>{g.total}</strong></li>)}</ul></section>}
        <div className={styles['page-body__actions']}>
          <button type="button" className={styles['button--primary-wide']} onClick={()=>paper.go('builder')}>Back to paper builder</button>
          <button type="button" className={styles['button--secondary-wide']} onClick={()=>{paper.setFilters({...paper.filters,kinds:['multiple_choice']});paper.go('catalogue');}}>Add from catalogue</button>
        </div>
      </aside>
    </div>
  </>;
}
