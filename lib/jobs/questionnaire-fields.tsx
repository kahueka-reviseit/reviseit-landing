'use client';
import { type Answer, type QuestionField, type Questionnaire, type QuestionnaireAnswers } from './questionnaire';

/** No answers are chosen on the teacher's behalf. Optional omissions are explicit. */
export function emptyQuestionnaireAnswers(form: Questionnaire): QuestionnaireAnswers {
 return {schemaVersion:2, revision:form.revision, items:Object.fromEntries(form.items.map(item=>[item.id,{}])), paper:{}};
}
function Field({field,value,onChange,prefix,disabled}:{field:QuestionField;value?:Answer;onChange:(answer:Answer)=>void;prefix:string;disabled:boolean}) {
 const id=`${prefix}-${field.id}`;
 const selected=value?.kind==='choice'?`choice:${value.choiceId}`:value?.kind||'';
 const selection=(mode:string)=>{
  if(mode.startsWith('choice:'))onChange({kind:'choice',choiceId:mode.slice(7)});
  else if(mode==='text')onChange({kind:'text',text:''});
  else if(mode==='automatic'||mode==='omit')onChange({kind:mode});
 };
 return <div style={{marginBottom:24}}>
  <label htmlFor={id}>{field.label}{!field.required?' (optional)':''}</label>
  {field.hint&&<p id={`${id}-hint`}>{field.hint}</p>}
  <select id={id} value={selected} required disabled={disabled} aria-describedby={field.hint?`${id}-hint`:undefined} onChange={event=>selection(event.target.value)} style={{display:'block',width:'100%',padding:12}}>
   <option value="" disabled>Choose an answer</option>
   {field.type==='choice'&&field.choices.map(choice=><option key={choice.id} value={`choice:${choice.id}`}>{choice.label}</option>)}
   {(field.type==='text'||field.allowOther)&&<option value="text">Write my answer</option>}
   {field.allowAutomatic&&<option value="automatic">Choose for me</option>}
   {!field.required&&<option value="omit">No preference</option>}
  </select>
  {value?.kind==='text'&&<><label htmlFor={`${id}-text`}>Your answer for {field.label}</label><textarea id={`${id}-text`} value={value.text} disabled={disabled} required={field.type==='choice'||field.required} maxLength={field.type==='text'?field.maxLength:2000} onChange={event=>onChange({kind:'text',text:event.target.value})} style={{display:'block',width:'100%',minHeight:100}}/></>}
 </div>;
}
/** Render only the closed, purchased form supplied by the order endpoint. */
export default function QuestionnaireFields({form,answers,onChange,disabled=false}:{form:Questionnaire;answers:QuestionnaireAnswers;onChange:(answers:QuestionnaireAnswers)=>void;disabled?:boolean}) {
 return <>
  {form.items.map((item,index)=><fieldset key={item.id} disabled={disabled} style={{marginBottom:24}}><legend>Question {index+1}: {item.title} ({item.marks} marks)</legend>
   {item.fields.map(field=><Field key={field.id} field={field} prefix={`question-${item.id}`} value={answers.items[item.id]?.[field.id]} disabled={disabled} onChange={answer=>onChange({...answers,items:{...answers.items,[item.id]:{...answers.items[item.id],[field.id]:answer}}})}/>)}
  </fieldset>)}
  {form.paperFields.length>0&&<fieldset disabled={disabled}><legend>Settings for the whole paper</legend>{form.paperFields.map(field=><Field key={field.id} field={field} prefix="paper" value={answers.paper[field.id]} disabled={disabled} onChange={answer=>onChange({...answers,paper:{...answers.paper,[field.id]:answer}})}/>)}</fieldset>}
 </>;
}
