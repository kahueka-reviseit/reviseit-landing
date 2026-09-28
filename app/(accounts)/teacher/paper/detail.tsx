'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CatalogueEntry } from '../../../../lib/workspace/contracts';
import { formatMarks } from '../../../../lib/workspace/catalogue';
import { bloomSpan, codeOf, kindLabels, kindOf, outlineMix } from '../../../../lib/workspace/paper';
import styles from '../paper.module.css';
import type { PaperModel } from './model';
import { AddControl, CatalogueCard } from './card';
import { BloomBar, BloomTag, Icon } from './ui';

/** Paper B4. Shows only the published catalogue projection; scenario options stay paid-only. */
export default function QuestionDetail({paper,entry,status,query}:{paper:PaperModel;entry:CatalogueEntry;status:ReactNode;query:string}) {
  const heading=useRef<HTMLHeadingElement>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{setFailed(false);heading.current?.focus();},[entry.id]);
  const {ids,data,busy,sectionTargets,occurrences}=paper;
  const kind=kindOf(entry), count=ids.filter(x=>x===entry.id).length, span=bloomSpan(entry), mix=outlineMix(entry);
  const outline=entry.preview?.outline;
  // Effect on the teacher's own targets, computed from what is already chosen.
  const sameKind=occurrences.filter(o=>o.kind===kind&&(o.entry.id!==entry.id||kind==='multiple_choice')).map(o=>o.entry);
  const usedMin=sameKind.reduce((t,e)=>t+(Number.isInteger(paper.allocation[e.id])?paper.allocation[e.id]:e.marks.min),0);
  const usedMax=sameKind.reduce((t,e)=>t+(Number.isInteger(paper.allocation[e.id])?paper.allocation[e.id]:e.marks.max),0);
  const target=sectionTargets[kind];
  const toggle=(checked:boolean)=>paper.toggle(entry,checked);
  const mcqSame=data.entries.filter(e=>e.id!==entry.id&&kindOf(e)==='multiple_choice'&&e.topic===entry.topic);
  const pairs=data.entries.filter(e=>e.id!==entry.id&&kindOf(e)==='structured'&&e.topic===entry.topic);
  const back=()=>paper.go('catalogue');
  return <>
    <nav className={styles['breadcrumb']} aria-label="Breadcrumb">
      <button type="button" className={styles['breadcrumb__back']} onClick={back}>{Icon.back(12)} {query?'Back to results':'Back to catalogue'}</button>
      <button type="button" onClick={back}>Catalogue</button><span aria-hidden="true">/</span>
      <button type="button" onClick={()=>{paper.setFilters({...paper.filters,topics:[entry.topic]});back();}}>{entry.topic}</button><span aria-hidden="true">/</span><span aria-current="page">{entry.title}</span>
    </nav>
    {status}
    <div className={styles['question-hero']}>
      <div className={styles['gallery']}>
        <div className={styles['gallery__main']}>
          <p className={styles['gallery__caption']}>{entry.thumbnail?'Reviewed preview · values change per paper':'Preview'}</p>
          {entry.thumbnail&&!failed ? <img src={entry.thumbnail.src} alt={entry.thumbnail.alt} onError={()=>setFailed(true)}/> : <p className={styles['gallery__empty']}>{entry.thumbnail?'Diagram preview unavailable':'No diagram preview is published for this question.'}</p>}
        </div>
        <div className={styles['gallery__scenario-header']}><span>Scenario choices</span><span>Detailed options unlock after payment.</span></div>
      </div>
      <section className={styles['buy-panel']} aria-labelledby="detail-title">
        <div className={styles['catalogue-card__header']}><span className={kind==='structured'?styles['catalogue-card__type--structured']:styles['catalogue-card__type--multiple-choice']}>{kindLabels[kind]} {kind==='structured'?'question':'type'}</span><span className={styles['catalogue-card__code']}>{codeOf(entry.id)}</span></div>
        <div><h1 id="detail-title" ref={heading} tabIndex={-1}>{entry.title}</h1><p className={styles['buy-panel__subtitle']}>{[entry.topic,entry.description].filter(Boolean).join(' · ')}</p></div>
        <p className={styles['buy-panel__marks']}><strong>{formatMarks(entry.marks)}</strong> <span>marks</span></p>
        <ul className={styles['buy-panel__facts']}>
          <li>{entry.preview?`${formatMarks(entry.preview.subquestions)} ${entry.preview.subquestions.max===1?(kind==='multiple_choice'?'item':'part'):'parts'}`:'Parts not yet published'}</li>
          <li>{span ?? 'Bloom’s not yet classified'}</li>
          <li>{entry.thumbnail?'Diagram preview':'No diagram preview'}</li>
          <li>{entry.orderable?'Ready to order':'Not yet available to order'}</li>
        </ul>
        <div className={styles['budget-impact']}>
          <p className={styles['budget-impact__eyebrow']}>What this does to your paper</p>
          {target!==undefined ? <>
            <span className={styles['budget-impact__track']} aria-hidden="true"><i className={styles['budget-impact__fill']} style={{width:`${Math.min(100,usedMin/Math.max(1,target)*100)}%`}}/><i className={styles['budget-impact__fill--range']} style={{width:`${Math.min(100,entry.marks.max/Math.max(1,target)*100)}%`}}/></span>
            <p className={styles['budget-impact__text']}><span>{kind==='multiple_choice'?`Adds ${entry.marks.min} of your ${target} multiple-choice marks`:`Uses ${formatMarks(entry.marks).replace('–',' to ')} of your ${target} structured marks`}</span>
              <strong>{(()=>{const lo=target-usedMax-entry.marks.max,hi=target-usedMin-entry.marks.min;return lo===hi?`${lo} left`:`${lo} to ${hi} left`;})()}</strong></p>
          </> : <p className={styles['budget-impact__text']}><span>Adds {formatMarks(entry.marks).replace('–',' to ')} marks. Set a paper shape to see how it fits your {kind==='structured'?'structured':'multiple-choice'} marks.</span></p>}
        </div>
        {entry.orderable ? <div className={styles['buy-panel__actions']}>
          {count ? <><AddControl entry={entry} count={count} disabled={busy} onToggle={toggle}/><span>In your paper{count>1?` ${count} times`:''}. {kind==='multiple_choice'?'Add another occurrence in the paper builder.':''}</span></> :
            <button type="button" className={styles['button--primary-wide']} disabled={busy||ids.length>=30} onClick={()=>toggle(true)}>{Icon.plus()} Add to your paper</button>}
        </div> : <p className={styles['notice--unavailable']}>This question is not yet available to order. It stays visible so you can see the whole catalogue.</p>}
        <p className={styles['buy-panel__note']}>You set the exact marks in the paper builder; difficulty, parts and scenario details follow after payment. Nothing is charged until you check out.</p>
      </section>
    </div>
    <section className={styles['question-structure']} aria-labelledby="structure-heading">
      <div className={styles['question-structure__intro']}>
        <p className={styles['eyebrow--positive']}>The structure</p>
        <h2 id="structure-heading">What learners would do</h2>
        {outline ? <p>One published example structure with {outline.length} parts. The final parts and marks can vary within the published ranges.</p> :
          <p>A reviewed outline has not been published for this question yet{entry.preview?`; it has ${formatMarks(entry.preview.subquestions)} ${entry.preview.subquestions.max===1?'part':'parts'}`:''}. Bloom’s levels are shown only where an outline is published.</p>}
        {mix.length>0 && <div className={styles['bloom-mix']}><p>Bloom’s mix at the full range</p><BloomBar rows={mix.map(m=>({bloom:m.bloom,weight:m.max}))}/>
          <p className={styles['bloom-mix__legend']}>{mix.map(m=><span key={m.bloom}>{m.bloom} {m.min===m.max?m.min:`${m.min} to ${m.max}`}</span>)}</p></div>}
      </div>
      {outline ? <table className={styles['parts-table']}>
        <thead><tr><th scope="col">Part</th><th scope="col">What learners do</th><th scope="col">Bloom’s</th><th scope="col">Marks</th></tr></thead>
        <tbody>{outline.map((r,i)=><tr key={i}><td>{i+1}</td><td>{r.summary}</td><td><BloomTag bloom={r.bloom}/></td><td>{r.marks?formatMarks(r.marks):'—'}</td></tr>)}</tbody>
      </table> : <div className={styles['parts-table__empty']}><p>Outline not yet published</p><span>The question is still orderable when marked ready; its parts are set by the generation skill within the published range.</span></div>}
    </section>
    {kind==='structured' && mcqSame.length>0 && <section className={styles['related-questions']} aria-labelledby="mcq-same">
      <div className={styles['related-questions__header']}><div><p className={styles['eyebrow--multiple-choice']}>Multiple choice on the same topic</p><h2 id="mcq-same">Warm learners up for this question</h2></div>
        {mcqSame.length>4&&<button type="button" className={styles['link']} onClick={()=>{paper.setFilters({...paper.filters,topics:[entry.topic],kinds:['multiple_choice']});back();}}>See all {mcqSame.length} in {entry.topic}</button>}</div>
      <ul className={styles['multiple-choice-grid']}>{mcqSame.slice(0,4).map(e=><li key={e.id} className={styles['multiple-choice-card--compact']}>
        <div className={styles['multiple-choice-card__header']}><span className={styles['catalogue-card__code']}>{codeOf(e.id)}</span><strong>{formatMarks(e.marks)}</strong></div>
        <button type="button" className={styles['multiple-choice-card__title']} onClick={()=>paper.go('question',e.id)}>{e.title}</button>
        <div className={styles['multiple-choice-card__footer']}><span>{e.orderable?e.topic:'Not yet available'}</span><AddControl entry={e} count={ids.filter(x=>x===e.id).length} disabled={busy||!e.orderable} onToggle={c=>paper.toggle(e,c)} small/></div>
      </li>)}</ul>
    </section>}
    {pairs.length>0 && <section className={styles['related-questions']} aria-labelledby="pairs">
      <div className={styles['related-questions__header']}><div><p className={styles['eyebrow--structured']}>Also in {entry.topic}</p><h2 id="pairs">Other questions on this topic</h2></div></div>
      <div className={styles['catalogue-grid']}>{pairs.slice(0,4).map(e=><CatalogueCard key={e.id} entry={e} count={ids.filter(x=>x===e.id).length} disabled={busy} onToggle={c=>paper.toggle(e,c)} onOpen={()=>paper.go('question',e.id)}/>)}</div>
    </section>}
  </>;
}
