'use client';
import {useState} from 'react';
import {answersMatchQuestionnaire,type QuestionField,type Answer} from '../../../../lib/jobs/questionnaire';
import type {AuthoredForm,FormSource} from '../../../../lib/studio/form-authoring';
import s from './studio.module.css';

export function FormFields({form,fields,onChange,disabled}:{form:AuthoredForm;fields:QuestionField[];onChange:(fields:QuestionField[])=>void;disabled:boolean}) {
 const [index,setIndex]=useState(0),field=fields[index];
 if(!field)return <><h2>No input needed</h2><p>This item has no teacher questions. Adding questions requires source and dependency review.</p></>;
 const update=(patch:Partial<QuestionField>)=>onChange(fields.map((f,i)=>i===index?{...f,...patch} as QuestionField:f));
 const previous=form.fields[index];
 return <><h2>Fields & answer settings</h2><label className={s['studio-draft-label']}>Choose field<select aria-label="Choose field" value={index} onChange={e=>setIndex(Number(e.target.value))}>{fields.map((f,i)=><option key={f.id} value={i}>{i+1}. {f.id}</option>)}</select></label>
 <p className={s.note}>Field {index+1} of {fields.length} · <code>{field.id}</code> · {field.type==='choice'?'Choice':'Free text'}</p>
 <label className={s['studio-draft-label']}>Teacher-facing question<input disabled={disabled} value={field.label} maxLength={300} onChange={e=>update({label:e.target.value})}/></label>
 {previous.label!==field.label&&<p className={s.note}>Previous: {previous.label}</p>}
 <label className={s['studio-draft-label']}>Hint<textarea disabled={disabled} value={field.hint} maxLength={1500} onChange={e=>update({hint:e.target.value})}/></label>
 {field.type==='choice'?<><h3>Answer choices</h3>{field.choices.map((c,i)=><label className={s['studio-draft-label']} key={c.id}>Choice label · {c.id}<input disabled={disabled} value={c.label} maxLength={300} onChange={e=>update({choices:field.choices.map((v,j)=>i===j?{...v,label:e.target.value}:v)})}/></label>)}</>:<label className={s['studio-draft-label']}>Maximum answer length<input disabled={disabled} type="number" min={1} max={2000} value={field.maxLength} onChange={e=>update({maxLength:Number(e.target.value)})}/></label>}
 <fieldset className={s['studio-form-settings']} disabled={disabled}><legend>Answer settings</legend>
 <label><input type="checkbox" checked={field.required} onChange={e=>update({required:e.target.checked})}/> Required</label>
 <label><input type="checkbox" checked={field.allowAutomatic} onChange={e=>update({allowAutomatic:e.target.checked})}/> Allow automatic selection</label>
 {field.type==='choice'&&<label><input type="checkbox" checked={field.allowOther} onChange={e=>update({allowOther:e.target.checked})}/> Allow an answer in the teacher’s own words</label>}
 </fieldset><p className={s.note}>Identifiers, field types and option order stay fixed. Adding or removing fields or choices needs source and dependency review.</p>
 </>;
}

function answerValid(field:QuestionField,answer:Answer) {
 const revision='0'.repeat(64);
 return answersMatchQuestionnaire({schemaVersion:2,revision,items:[{id:'preview',title:'Preview',marks:1,fields:[field]}],paperFields:[]},
  {schemaVersion:2,revision,items:{preview:{[field.id]:answer}},paper:{}});
}
export function FormPreview({fields}:{fields:QuestionField[]}) {
 const [answers,setAnswers]=useState<Record<string,Answer>>({}),[checked,setChecked]=useState(false);
 const set=(id:string,answer:Answer)=>{setAnswers(a=>({...a,[id]:answer}));setChecked(false);};
 return <><h2>Teacher preview</h2><p className={s.note}>Try example answers against the teacher platform’s field validator. Cross-field rules, source consistency and generation are not evaluated in this preview.</p>
 {!fields.length?<p>No input needed for this item.</p>:fields.map(f=>{const a=answers[f.id]||{kind:'omit'},mode=a.kind==='choice'?`choice:${a.choiceId}`:a.kind;
  return <section className={s['studio-revision']} key={f.id}><h3>{f.label}{f.required?' *':''}</h3><p>{f.hint}</p><label className={s['studio-draft-label']}>Answer · {f.id}<select aria-label={`Answer · ${f.id}`} value={mode} onChange={e=>{const v=e.target.value;set(f.id,v.startsWith('choice:')?{kind:'choice',choiceId:v.slice(7)}:v==='text'?{kind:'text',text:''}:{kind:v as 'omit'|'automatic'});}}><option value="omit">{f.required?'Choose an answer':'Leave unanswered'}</option>{f.type==='choice'&&f.choices.map(c=><option key={c.id} value={`choice:${c.id}`}>{c.label}</option>)}{f.allowAutomatic&&<option value="automatic">Let Revise It choose</option>}{(f.type==='text'||f.allowOther)&&<option value="text">Write an answer</option>}</select></label>
  {a.kind==='text'&&<label className={s['studio-draft-label']}>Written answer · {f.id}<textarea maxLength={f.type==='text'?f.maxLength:2000} value={a.text} onChange={e=>set(f.id,{kind:'text',text:e.target.value})}/></label>}
  {checked&&<p className={answerValid(f,a)?s['state--done']:s['state--attention']}>{answerValid(f,a)?'Accepted by field rules':'This field needs a valid answer'}</p>}</section>;
 })}
 {!!fields.length&&<button className={s['studio-button']} onClick={()=>setChecked(true)}>Check example answers</button>}
 {checked&&<p role="status">{fields.filter(f=>answerValid(f,answers[f.id]||{kind:'omit'})).length} of {fields.length} example answers pass the field rules. This is not a release approval.</p>}</>;
}
export function FormEvidence({form,sources}:{form:AuthoredForm;sources:FormSource[]}) {
 return <><h2>Source evidence</h2><p>The original evidence and unresolved findings stay attached to this form. Changed wording and settings still need human review.</p>
 <h3>Bound source files</h3>{sources.length?sources.map(x=><article className={s['studio-revision']} key={x.path}><strong>{x.path}</strong><code className={s['studio-path']}>{x.sha256}</code><p>{x.verified?'Fingerprint matches the selected snapshot':'Not verified against the selected snapshot'}</p>{x.url&&<a href={x.url} target="_blank" rel="noopener noreferrer">Inspect source ↗</a>}</article>):<p>No current source-file bindings were recorded in this document.</p>}
 <h3>Evidence for each field</h3>{form.fields.map(f=><details className={s['studio-revision']} key={f.id}><summary>{f.id} · {f.label}</summary><pre className={s['studio-source-code']}>{JSON.stringify(form.field_provenance[f.id],null,2)}</pre></details>)}
 <details className={s['studio-revision']}><summary>Recorded findings and dispositions</summary><pre className={s['studio-source-code']}>{JSON.stringify(form.unresolved??[],null,2)}</pre></details></>;
}
