'use client';
import { useState } from 'react';
import type { Answer, QuestionField } from '../../../../../lib/jobs/questionnaire';
import type { ConfigurationView, FacetView, LineView } from '../../../../../lib/configurator/contracts';
import ui from '../../../experience.module.css';

/**
 * "What you asked for" (Paper M3/M4): a read-only list of each question's own brief and
 * choices, from the server's projection of the frozen configuration. There is no
 * whole-paper questionnaire. Repeated multiple-choice occurrences stay separate rows.
 */
type Chip = {text:string; delegated:boolean};
function choiceLabel(field:QuestionField, answer:Answer):Chip|null {
  if(answer.kind==='automatic') return {text:`${field.label}: Revise It chose`,delegated:true};
  if(answer.kind==='omit') return {text:`${field.label}: no preference`,delegated:false};
  if(answer.kind==='text') { const t=answer.text.trim(); return t?{text:`${field.label}: “${t.length>60?t.slice(0,60)+'…':t}”`,delegated:false}:null; }
  const label=field.type==='choice'?field.choices.find(c=>c.id===answer.choiceId)?.label:null;
  return label?{text:`${field.label}: ${label}`,delegated:false}:null;
}
function facetLabel(facet:FacetView):Chip|null {
  const v=facet.value;if(!v) return null;
  if(v.kind==='automatic') return {text:`${facet.label}: Revise It chose`,delegated:true};
  if(v.kind==='choice') { const o=facet.options.find(x=>x.id===v.choiceId); return o?{text:`${facet.label}: ${o.label}`,delegated:false}:null; }
  if(v.kind==='text') return v.text.trim()?{text:`${facet.label}: “${v.text.trim().slice(0,60)}”`,delegated:false}:null;
  return null;
}
export function chips(line:LineView):Chip[] {
  // A classified facet and its form field can share an identifier; show each decision once.
  const facetIds=new Set(line.facets.filter(f=>f.value).map(f=>f.id));
  return [...line.facets.map(facetLabel),...line.fields.filter(f=>!facetIds.has(f.id)).map(f=>line.answers[f.id]?choiceLabel(f,line.answers[f.id]):null)].filter((c):c is Chip=>!!c);
}
const ordinal=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'];
export function occurrence(lines:LineView[], index:number):string|null {
  const id=lines[index].entryId;if(!id||lines.filter(l=>l.entryId===id).length<2) return null;
  const n=lines.slice(0,index+1).filter(l=>l.entryId===id).length;
  return `${ordinal[n-1]??`number ${n}`} occurrence`;
}
export function paperMeta(view:ConfigurationView):string {
  const mcq=view.lines.filter(l=>l.kind==='multiple_choice'),structured=view.lines.filter(l=>l.kind!=='multiple_choice');
  const sum=(ls:LineView[])=>ls.reduce((t,l)=>t+(l.marks.value??0),0);
  return [`${view.totals.allocated} marks`,mcq.length?`${mcq.length} multiple choice (${sum(mcq)} marks)`:null,structured.length?`${structured.length} structured question${structured.length===1?'':'s'} (${sum(structured)} marks)`:null].filter(Boolean).join(' · ');
}

export default function SubmittedSummary({view,state,limit=4}:{view:ConfigurationView|null;state:'loading'|'ready'|'failed';limit?:number}) {
  const [all,setAll]=useState(false);
  const lines=view?.lines??[],shown=all?lines:lines.slice(0,limit);
  return <section className={ui['submitted-summary']} aria-labelledby="submitted-summary-title">
    <div className={ui['submitted-summary__header']}>
      <div className={ui['submitted-summary__titles']}><h2 id="submitted-summary-title" className={ui['submitted-summary__title']}>What you asked for</h2>
        <p className={ui['submitted-summary__lede']}>The details you submitted for each question.</p></div>
      {lines.length>limit&&<button type="button" className={ui['submitted-summary__toggle']} aria-expanded={all} aria-controls="submitted-summary-list" onClick={()=>setAll(!all)}>{all?'Show fewer':`Show all ${lines.length} questions`}</button>}
    </div>
    {state==='loading'&&<p className={ui['submitted-summary__status']} role="status">Loading the details you submitted…</p>}
    {state==='failed'&&<p className={ui['submitted-summary__status']} role="status">Your submitted details could not be loaded just now. They are saved; refresh to try again.</p>}
    {state==='ready'&&<>
      <div className={ui['submitted-summary__head']} aria-hidden="true"><span className={ui['submitted-summary__heading--number']}>No.</span><span className={ui['submitted-summary__heading--question']}>Question</span><span className={ui['submitted-summary__heading--marks']}>Marks</span><span className={ui['submitted-summary__heading']}>Your brief and choices</span></div>
      <ol id="submitted-summary-list" className={ui['submitted-summary__list']}>{shown.map(line=>{
        const i=lines.indexOf(line),brief=view!.configuration.briefs?.[line.id]?.text?.trim(),list=chips(line),again=occurrence(lines,i);
        const local=line.entryId?line.entryId.split(':').slice(1).join(':'):null;
        return <li key={line.id} className={ui['submitted-summary__row']}>
          <p className={line.kind==='multiple_choice'?ui['submitted-summary__number--mcq']:ui['submitted-summary__number']}><span className="visually-hidden">Question </span>{line.number}</p>
          <div className={ui['submitted-summary__question']}><p className={ui['submitted-summary__question-title']}>{line.title}</p>
            <p className={ui['submitted-summary__question-meta']}>{[local,again??(line.kind==='multiple_choice'?'Multiple choice':'Structured')].filter(Boolean).join(' · ')}</p></div>
          <div className={ui['submitted-summary__marks']}><p className={ui['submitted-summary__marks-value']}>{line.marks.value??'—'}<span className="visually-hidden"> marks</span></p>{line.marks.fixed&&<p className={ui['submitted-summary__marks-note']}>fixed</p>}</div>
          <div className={ui['submitted-summary__brief']}>
            {brief?<p className={ui['submitted-summary__text']}>“{brief.length>220?brief.slice(0,220)+'…':brief}”</p>:<p className={ui['submitted-summary__text']}>No brief written.{again?' This occurrence is created independently.':''}</p>}
            {list.length>0&&<ul className={ui['submitted-summary__chips']}>{list.map(c=><li key={c.text} className={c.delegated?ui['submitted-summary__chip--delegated']:ui['submitted-summary__chip']}>{c.text}</li>)}</ul>}
          </div>
        </li>;})}</ol></>}
  </section>;
}
