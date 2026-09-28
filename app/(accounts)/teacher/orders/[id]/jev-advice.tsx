'use client';
import {useEffect,useState} from 'react';
import type {Answer,QuestionField} from '../../../../../lib/jobs/questionnaire';
import styles from './configure.module.css';

type Hint={checkId:string;field:string;text:string;suggestion?:{field:string;option:string}};
type Props={orderId:string;lineId:string;revision:number;enabled:boolean;saved:boolean;answers:Record<string,Answer>;fields:QuestionField[];onAccept:(field:string,answer:Answer)=>void};

/** Optional advice follows a saved answer. No result enters readiness or submission. */
export default function JevAdvice({orderId,lineId,revision,enabled,saved,answers,fields,onAccept}:Props){
 const [state,setState]=useState<{status:string;hints:Hint[]}>({status:'idle',hints:[]});
 const [dismissed,setDismissed]=useState<string[]>([]);
 const signature=JSON.stringify(answers);
 const hasText=Object.values(answers).some(a=>a.kind==='text'&&a.text.trim());
 useEffect(()=>{
  setState({status:'idle',hints:[]});setDismissed([]);
  if(!enabled||!saved||!hasText)return;
  const controller=new AbortController();let active=true;
  const timer=setTimeout(async()=>{
   setState({status:'checking',hints:[]});
   try{
    const r=await fetch(`/api/teacher/orders/${orderId}/configuration/hints`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineId,revision}),signal:controller.signal});
    const value=await r.json();
    if(active)setState(r.ok&&Array.isArray(value.hints)?value:{status:'unavailable',hints:[]});
   }catch{if(active)setState({status:'unavailable',hints:[]});}
  },900);
  return ()=>{active=false;clearTimeout(timer);controller.abort();};
 },[orderId,lineId,revision,enabled,saved,hasText,signature]);
 if(!enabled)return null;
 const hints=state.hints.filter(h=>!dismissed.includes(h.checkId));
 const message=!saved?'Suggestions will update after your answers save.':!hasText?'Jev can help when you describe a choice in your own words.':state.status==='checking'?'Jev is checking how your notes fit your choices…':state.status==='checked'?(hints.length?'Consider these suggestions. Your choices remain yours.':state.hints.length?'You kept your answers. You can still finish your paper.':'Jev found no clear conflict in the notes it checked.'):state.status==='limit'?'Jev has reached the pilot suggestion limit. You can still finish your paper.':state.status==='not_applicable'?'There is no Jev check for this custom answer yet.':state.status==='idle'?'Jev will check your saved notes shortly.':'Jev suggestions are unavailable right now. You can still finish your paper.';
 return <section className={styles['notice--info']} aria-label="Jev suggestions">
  <strong>Jev suggestions · optional</strong><p role="status" className={styles['paragraph']}>{message}</p>
  {hints.map(h=>{
   const suggestion=h.suggestion;
   const field=fields.find(f=>f.id===(suggestion?.field??h.field));
   const option=field?.type==='choice'?field.choices.find(c=>c.id===suggestion?.option):undefined;
   return <div key={h.checkId}>
    <p>{h.text}</p>
    <div className={styles['chip-group']}>
     {suggestion&&option&&<button type="button" className={styles['button--secondary']} onClick={()=>onAccept(suggestion.field,{kind:'choice',choiceId:suggestion.option})}>Use {option.label}</button>}
     <button type="button" className={styles['button--text']} onClick={()=>{const element=document.getElementById(`q-${lineId}-${h.field}`);element?.scrollIntoView({behavior:'smooth',block:'center'});element?.querySelector<HTMLTextAreaElement|HTMLInputElement>('textarea,input:not(:disabled)')?.focus();}}>Review answer</button>
     <button type="button" className={styles['button--text']} onClick={()=>setDismissed(x=>[...x,h.checkId])}>Keep my answer</button>
    </div>
   </div>;
  })}
  <small>Relevant notes and selected options are sent directly to TypeSafe. Suggestions never change your answers automatically.</small>
 </section>;
}
