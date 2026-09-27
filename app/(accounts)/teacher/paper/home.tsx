'use client';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { kindOf, topicGroups } from '../../../../lib/workspace/paper';
import styles from '../paper.module.css';
import type { PaperModel } from './model';
import { journey } from './builder';
import { Icon, Stages } from './ui';

function counts(paper:PaperModel) {
  const e=paper.data.entries, structured=e.filter(x=>kindOf(x)==='structured');
  return {total:e.length,structured:structured.length,mcq:e.length-structured.length,ready:e.filter(x=>x.orderable).length,topics:topicGroups(e).length,structuredEntries:structured};
}

/** Paper A1 + A2: the curriculum home, with the school's other curricula alongside. */
export function HomeView({paper,status,switchCurriculum}:{paper:PaperModel;status:ReactNode;switchCurriculum:(id:string)=>void}) {
  const {data,occurrences,configured,paperTarget,allocatedTotal}=paper;
  const c=counts(paper), n=occurrences.length;
  const start=()=>paper.go(configured&&paperTarget===null?'shape':n?'builder':'catalogue');
  return <>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><span>My curricula</span><span aria-hidden="true">/</span><span aria-current="page">{data.module!.name}</span></nav>
    {status}
    <div className={styles.homeHero}>
      <div>
        <p className={styles.eyebrowSlate}>{data.schoolName}</p>
        <h1 className={styles.homeTitle}>{data.module!.name}</h1>
        <p className={styles.homeLead}>Curriculum · {c.total} catalogue questions: {c.structured} structured and {c.mcq} multiple choice, across {c.topics} topics. {c.ready} are ready to order now.</p>
        <button type="button" className={styles.textLink} onClick={()=>paper.go('catalogue')}>Just browse the catalogue</button>
      </div>
      <section className={styles.startPanel} aria-labelledby="start-heading">
        <p>Start here</p><h2 id="start-heading">Build a paper</h2>
        <span>Set the shape of the paper, choose questions from the catalogue and set their marks. You pay only when it is ready.</span>
        <button type="button" onClick={start}><span>{n?'Continue your paper':'Start a new paper'}</span><i>{Icon.arrow()}</i></button>
      </section>
    </div>
    <div className={styles.homeRow}>
      <section aria-labelledby="draft-heading"><h2 id="draft-heading" className={styles.homeH2}>Paper in progress</h2>
        {n ? <div className={styles.draftCard}>
          <div className={styles.draftHead}><strong>{data.module!.name}</strong><span className={styles.tagWarm}>Not paid yet</span></div>
          <p className={styles.draftSub}>{paperTarget!==null?`${paperTarget} marks planned`:'Total not set yet'}</p>
          <div className={styles.draftStats}><p><strong>{allocatedTotal}{paperTarget!==null?` of ${paperTarget}`:''}</strong><span>marks allocated</span></p><p><strong>{n}</strong><span>{n===1?'question':'questions'} added</span></p></div>
          <p className={styles.draftState}><span>{paper.selectionDirty?'Unsaved changes':'Saved to your account'}</span><span>{paper.marksSet&&paper.balanced?'Ready for payment':'Marks needed'}</span></p>
          <button type="button" className={styles.textLink} onClick={()=>paper.go('builder')}>Continue building</button>
        </div> : <div className={styles.draftCard}><p className={styles.draftSub}>No paper in progress. Start a new paper or browse the catalogue.</p></div>}
      </section>
      <section aria-labelledby="past-heading"><h2 id="past-heading" className={styles.homeH2}>Papers and formatting</h2>
        <ul className={styles.linkList}>
          <li><a href="/teacher/orders"><strong>Your paper requests</strong><span>Follow paid papers and download released documents.</span></a></li>
          <li><button type="button" onClick={()=>paper.go('formatting')}><strong>School formatting</strong><span>Font, spacing and heading used for this curriculum’s papers.</span></button></li>
        </ul>
      </section>
    </div>
    {data.curricula.length>1 && <section className={styles.curricula} aria-labelledby="curricula-heading"><h2 id="curricula-heading" className={styles.homeH2}>Your curricula</h2>
      <ul>{data.curricula.map(m=>{const current=m.id===data.module!.id;
        return <li key={m.id} className={current?styles.curriculumCurrent:''}>
          <p className={styles.eyebrowSage}>Curriculum · {m.isDemo?'demonstration':'access active'}</p>
          <h3>{m.name}</h3>
          {current ? <><p className={styles.curriculumCount}><strong>{c.total}</strong><span>catalogue questions</span></p>
            <span className={styles.splitBar} aria-hidden="true"><i className={styles.slate} style={{flexGrow:c.structured}}/><i className={styles.gold} style={{flexGrow:c.mcq}}/></span>
            <p className={styles.splitLabels}><span>{c.structured} structured</span><span>{c.mcq} multiple choice</span></p>
            <button type="button" className={styles.primaryWide} onClick={()=>paper.go('catalogue')}>Open catalogue {Icon.arrow()}</button></> :
            <button type="button" className={styles.secondaryWide} disabled={paper.busy} onClick={()=>switchCurriculum(m.id)}>Open curriculum {Icon.arrow()}</button>}
        </li>;})}</ul></section>}
  </>;
}

/** Paper A3/A4: the paper's shape. Only the totals are stored (they are the checkout targets). */
export function ShapeView({paper,status}:{paper:PaperModel;status:ReactNode}) {
  const {data,limits,sectionTargets}=paper;
  const c=counts(paper);
  const [total,setTotal]=useState<string>(paper.paperTarget!==null?String(paper.paperTarget):'');
  const [mc,setMc]=useState<string>(sectionTargets.multiple_choice!==undefined?String(sectionTargets.multiple_choice):'');
  const t=Number(total), m=mc===''?0:Number(mc);
  const validTotal=Number.isInteger(t)&&t>=1&&t<=3000, validMc=Number.isInteger(m)&&m>=0&&(!validTotal||m<=t);
  const questions=validMc?Math.floor(m/2):0, structuredMarks=validTotal&&validMc?t-m:null;
  const ready=c.structuredEntries.filter(e=>e.orderable), pool=ready.length?ready:c.structuredEntries;
  const average=pool.length?pool.reduce((a,e)=>a+(e.marks.min+e.marks.max)/2,0)/pool.length:null;
  const about=structuredMarks&&average?Math.max(1,Math.round(structuredMarks/average)):null;
  const min=pool.length?Math.min(...pool.map(e=>e.marks.min)):null, max=pool.length?Math.max(...pool.map(e=>e.marks.max)):null;
  const problems=[validTotal||total===''?null:'Enter a whole number of marks for the paper.', validMc?null:'Multiple-choice marks must be a whole number no larger than the paper total.',
    validMc&&m%2?'Multiple-choice marks must be even, because each question is worth 2 marks.':null,
    questions>limits.multipleChoice?`This pilot allows up to ${limits.multipleChoice} multiple-choice questions (${limits.multipleChoice*2} marks).`:null].filter(Boolean) as string[];
  const canApply=validTotal&&validMc&&m%2===0;
  const sliderMax=validTotal?Math.min(t-(t%2),limits.multipleChoice*2):0;
  const apply=()=>{paper.setPaperTarget(t);paper.setSectionTarget('multiple_choice',m||undefined);paper.setSectionTarget('structured',m?t-m:undefined);paper.go(paper.occurrences.length?'builder':'catalogue');};
  return <>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><button type="button" onClick={()=>paper.go('home')}>{data.module!.name}</button><span aria-hidden="true">/</span><span aria-current="page">Paper shape</span></nav>
    <div className={styles.shapeTop}><Stages stages={journey(paper,0)}/></div>
    {status}
    <div className={styles.twoCol}>
      <form className={styles.shapeCard} onSubmit={e=>{e.preventDefault();if(canApply)apply();}}>
        <p className={styles.eyebrowSage}>Step 1 of 5</p>
        <h1>What shape is this paper?</h1>
        <p className={styles.panelLead}>Set the totals first. The catalogue and the paper builder then show how each question fits. You can change them at any time before you submit.</p>
        <label className={styles.field}>Total marks<span className={styles.unitInput}><input type="number" inputMode="numeric" min={1} max={3000} value={total} onChange={e=>setTotal(e.target.value)} placeholder="For example 150"/><span>marks</span></span></label>
        <fieldset className={styles.field}><legend>Split between question types</legend>
          <p className={styles.fieldHint}>Multiple-choice questions are worth 2 marks each. Leave multiple choice at 0 for a structured-only paper.</p>
          {validTotal&&<input className={styles.split} type="range" min={0} max={sliderMax} step={2} value={Math.min(m,sliderMax)} aria-label="Multiple-choice marks slider" style={{'--pct':`${sliderMax?Math.min(100,m/sliderMax*100):0}%`} as CSSProperties} onChange={e=>setMc(e.target.value)}/>}
          <div className={styles.splitLabelsRow}><span className={styles.eyebrowGoldText}>Multiple choice</span><span className={styles.eyebrowSlate}>Structured</span></div>
          <div className={styles.threeFields}>
            <label className={styles.goldEdge}>Multiple-choice marks<input type="number" inputMode="numeric" min={0} step={2} value={mc} onChange={e=>setMc(e.target.value)} placeholder="0"/></label>
            <p className={styles.readonly}><span>Multiple-choice questions</span><output>{questions} {questions===1?'question':'questions'}</output></p>
            <label className={styles.slateEdge}>Structured marks<input type="number" inputMode="numeric" min={0} value={structuredMarks ?? ''} disabled={!validTotal} onChange={e=>{const s=Number(e.target.value);if(Number.isInteger(s)&&validTotal)setMc(String(Math.max(0,t-s)));}}/></label>
          </div>
        </fieldset>
        {problems.map(p=><p key={p} role="alert" className={styles.noteWarm}>{p}</p>)}
        <div className={styles.formActions}>
          <button type="button" className={styles.textLink} onClick={()=>paper.go('home')}>Cancel</button>
          {(paper.paperTarget!==null||Object.keys(sectionTargets).length>0)&&<button type="button" className={styles.textLink} onClick={()=>{paper.setPaperTarget(null);paper.setSectionTarget('multiple_choice',undefined);paper.setSectionTarget('structured',undefined);setTotal('');setMc('');}}>Clear the shape</button>}
          <button type="submit" className={styles.primaryPill} disabled={!canApply}>{paper.occurrences.length?'Save and open the builder':'Continue to catalogue'} {Icon.arrow()}</button>
        </div>
      </form>
      <aside className={styles.rail} aria-label="Your paper’s shape">
        <section className={`${styles.railCard} ${styles.topNavy}`}>
          <p className={styles.eyebrowMid}>Your paper’s shape</p>
          <h2 className={styles.shapeHeadline}>{validTotal?`${t} marks: ${questions?`${questions} multiple-choice ${questions===1?'question':'questions'} (${m} marks)`:'no multiple choice'}${structuredMarks?`, ${about?`about ${about} `:''}structured ${about===1?'question':'questions'} (${structuredMarks} marks)`:''}`:'Set a total to see the shape'}</h2>
          {validTotal&&<div className={styles.shapeBlocks} aria-hidden="true">{m>0&&<i className={styles.gold} style={{flexGrow:m}}>{m}</i>}{about&&structuredMarks?Array.from({length:Math.min(about,12)},(_,i)=><i key={i} className={styles.slate} style={{flexGrow:structuredMarks/Math.min(about,12)}}>~{Math.round(structuredMarks/about)}</i>):null}</div>}
          <ul className={styles.legend}><li><i className={styles.gold}/>Multiple choice<strong>{questions} × 2 = {questions*2} marks</strong></li><li><i className={styles.slate}/>Structured<strong>{structuredMarks ?? 0} marks</strong></li></ul>
          {min!==null&&<div className={styles.fits}><strong>Fits the catalogue</strong><span>{ready.length?'Ready':'Published'} structured questions range from {min} to {max} marks; {c.mcq} multiple-choice types are published and {data.entries.filter(e=>kindOf(e)==='multiple_choice'&&e.orderable).length} are ready to order.</span></div>}
        </section>
        <div className={styles.whyNote}><strong>Why we ask first</strong><p>These totals become the targets your marks must match before payment. The estimate of structured questions uses the published mark ranges and is only a guide.</p></div>
      </aside>
    </div>
  </>;
}
