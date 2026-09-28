import {useLayoutEffect,useRef,useState} from 'react';
import type {LineView} from '../../../../../lib/configurator/contracts';
import type {QuestionField} from '../../../../../lib/jobs/questionnaire';
import type {QuestionContext as Catalogue} from '../../../../../lib/workspace/contracts';
import styles from './configure.module.css';

/**
 * Paper D9–D11: a read-only reminder of the purchased question above the teacher's brief.
 * It shows only published catalogue metadata and the order's pinned outline. Nothing here
 * writes answers, changes requiredness or asks for an interpretation.
 */
const range=(r:{min:number;max:number})=>r.min===r.max?String(r.min):`${r.min}–${r.max}`;
const tagClass:Record<string,string>={remember:styles['tag--remember'],understand:styles['tag--understand'],apply:styles['tag--apply'],analyse:styles['tag--analyse'],evaluate:styles['tag--evaluate'],create:styles['tag--create']};

export default function QuestionContext({line,marks,catalogue,open,onToggle}:{line:LineView;marks:number|null;catalogue?:Catalogue;open:boolean;onToggle:()=>void}) {
  const [brokenImage,setBrokenImage]=useState<string|null>(null);
  // A long description is capped at four lines so the brief stays near; the full text is one click away.
  const summaryRef=useRef<HTMLParagraphElement>(null);
  const [fullSummary,setFullSummary]=useState(false),[clipped,setClipped]=useState(false);
  const description=catalogue?.description??'';
  useLayoutEffect(()=>{setFullSummary(false);},[line.id]);
  useLayoutEffect(()=>{
    const el=summaryRef.current;if(!el){setClipped(false);return;}
    // Re-measure once the dialog opens and whenever the panel width changes.
    const measure=()=>setClipped(el.scrollHeight>el.clientHeight+1);measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[description,fullSummary]);
  const thumbnail=catalogue?.thumbnail&&brokenImage!==catalogue.thumbnail.src?catalogue.thumbnail:null;
  const rows=line.outline?.rows??[];
  const outlineId=`question-context-outline-${line.id}`;
  return <section className={styles['question-context']} aria-labelledby="question-context-heading">
    <h3 id="question-context-heading" className={styles['question-context__heading']}>About the question you chose</h3>
    <div className={styles['question-context__overview']}>
      {thumbnail&&<img className={styles['question-context__diagram']} src={thumbnail.src} alt={thumbnail.alt} loading="lazy" onError={()=>setBrokenImage(thumbnail.src)}/>}
      <div className={styles['question-context__description']}>
        {catalogue?.topic&&<p className={styles['question-context__topic']}>{catalogue.topic}</p>}
        {description?<>
          <p ref={summaryRef} id={`question-context-summary-${line.id}`} className={styles[fullSummary?'question-context__summary':'question-context__summary--clamped']}>{description}</p>
          {(clipped||fullSummary)&&<button type="button" className={styles['question-context__more']} aria-expanded={fullSummary} aria-controls={`question-context-summary-${line.id}`}
            onClick={()=>setFullSummary(v=>!v)}>{fullSummary?'Show less':'Show full description'}</button>}</>:
          <p className={styles['question-context__summary--missing']}>A short description has not been published for this question.{rows.length?' The question outline below shows an example structure.':''}</p>}
      </div>
    </div>
    <div className={styles['question-context__metadata']}>
      {line.marks.fixed?<span className={styles['question-context__marks']}>{line.marks.min} marks · fixed</span>:<>
        <span className={styles['question-context__marks']}>{marks===null?'Marks not set yet':`${marks} marks selected`}</span>
        <span className={styles['question-context__range']}>Range: {range(line.marks)}</span></>}
      {line.kind==='multiple_choice'?<span className={styles['question-context__parts']}>One multiple-choice item</span>:
        <span className={styles['question-context__parts']}>{line.outline?`${range(line.outline.subquestions)} subquestions`:'Subquestion range not published'}</span>}
    </div>
    {rows.length>0&&<>
      <button type="button" className={styles['question-context__outline-trigger']} aria-expanded={open} aria-controls={outlineId} onClick={onToggle}>
        <span className={styles['question-context__outline-label']}>{open?'Hide question outline':'View question outline'}</span>
        <span className={styles['question-context__chevron']} aria-hidden="true">{open?'⌃':'⌄'}</span>
      </button>
      <div id={outlineId} className={styles['question-context__outline']} hidden={!open}>
        <p className={styles['question-context__outline-caption']}>Example structure from the published outline. Your final question can vary within its range.</p>
        <ol className={styles['question-context__outline-list']}>{rows.map((r,i)=><li key={i} className={styles['question-context__outline-row']}>
          <span className={styles['question-context__part-number']}>{line.number}.{i+1}</span>
          <span className={styles['question-context__part-summary']}>{r.summary}</span>
          <span className={`${styles['tag']} ${styles['question-context__tag']} ${tagClass[r.bloom.toLowerCase()]??styles['tag--unclassified']}`}>{r.bloom}</span>
        </li>)}</ol>
      </div></>}
    {line.kind==='structured'&&!rows.length&&<p className={styles['question-context__outline-missing']}>An example question outline has not been published for this question.</p>}
  </section>;
}

/**
 * Up to four of the item's own authored questions, required ones first, as starting
 * points for the brief. They are reminders only; the fields and their rules are unchanged.
 */
export function briefPrompts(fields:QuestionField[]):string[] {
  return [...fields.filter(f=>f.required),...fields.filter(f=>!f.required)].map(f=>f.label.trim()).filter(Boolean).slice(0,4);
}
