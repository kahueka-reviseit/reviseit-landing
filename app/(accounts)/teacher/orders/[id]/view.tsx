'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { type Order,stateLabels,documentLabels } from '../../../../../lib/jobs/contracts';
import QuestionnaireFields,{emptyQuestionnaireAnswers,questionFieldId,type QuestionnaireFieldError} from '../../../../../lib/jobs/questionnaire-fields';
import {isQuestionnaire,isQuestionnaireAnswers,answersMatchQuestionnaire,type QuestionnaireAnswers} from '../../../../../lib/jobs/questionnaire';
import {formatRand} from '../../../../../lib/payments/contracts';
import styles from '../../../accounts.module.css';
import ConfigureOrder from './configure';
import paper from './configure.module.css';
export default function OrderView({initial,topics={}}:{initial:Order;topics?:Record<string,string>}){
 const [order,setOrder]=useState(initial),[answers,setAnswers]=useState<Record<string,string>>(initial.answers&&!isQuestionnaireAnswers(initial.answers)?initial.answers:{}),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [fieldError,setFieldError]=useState<QuestionnaireFieldError|null>(null);
 useEffect(()=>{if(fieldError&&!busy)document.getElementById(questionFieldId(fieldError.itemId,fieldError.fieldId))?.focus();},[fieldError,busy]);
 const [grouped,setGrouped]=useState<QuestionnaireAnswers|null>(()=>isQuestionnaire(initial.form)?emptyQuestionnaireAnswers(initial.form):null);
 // A paid order's form can first arrive through reconciliation or refresh. Start its answers then;
 // keep answers already entered for the same form revision.
 useEffect(()=>{if(isQuestionnaire(order.form)&&grouped?.revision!==order.form.revision)setGrouped(emptyQuestionnaireAnswers(order.form));},[order.form]);
 useEffect(()=>{const storageKey='paper-submit:'+initial.id;let value=sessionStorage.getItem(storageKey);if(!value){value=crypto.randomUUID();sessionStorage.setItem(storageKey,value);}setKey(value);},[initial.id]);
 async function refresh(){try{const r=await fetch(`/api/teacher/orders/${initial.id}`,{cache:'no-store'});if(r.status===401){window.location.assign('/login');return;}if(!r.ok){setError('We could not refresh this request. Check your account access or try again.');return;}setOrder(await r.json());setError('');}catch{setError('Connection lost. Your submitted request remains saved.');}}
 useEffect(()=>{if(['released','held','cancelled','awaiting_answers'].includes(order.state))return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);return()=>clearInterval(timer);},[order.state,initial.id]);
 // Returning from Stripe proves nothing by itself: ask the server to confirm with Stripe.
 async function payment(action:'reconcile'|'cancel'){setBusy(true);setError('');try{const r=await fetch(`/api/teacher/orders/${initial.id}/payment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const data=await r.json();if(!r.ok)setError(data.error||'We could not confirm your payment yet. Refresh in a moment.');else setOrder(data);}catch{setError('Connection lost. If you paid, your payment is safe; refresh in a moment.');}finally{setBusy(false);}}
 useEffect(()=>{if(initial.state==='awaiting_payment'&&new URLSearchParams(window.location.search).get('checkout')==='returned')void payment('reconcile');},[initial.id]);
 async function submit(e:React.FormEvent){e.preventDefault();const submitted=isQuestionnaire(order.form)?grouped:answers;if(isQuestionnaire(order.form)&&!answersMatchQuestionnaire(order.form,submitted)){setError('Please answer each question and the shared paper settings.');return;}setBusy(true);setError('');setFieldError(null);try{const r=await fetch(`/api/teacher/orders/${order.id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey:key,answers:submitted})});if(!r.ok){const data=await r.json();setError(data.error||'Submission could not be confirmed. Retry with the same answers.');const target=data.fieldError;if(r.status===422&&isQuestionnaire(order.form)&&typeof data.error==='string'&&target&&order.form.items.some(item=>item.id===target.itemId&&item.fields.some(field=>field.id===target.fieldId)))setFieldError({...target,message:data.error});}else{await refresh();}}catch{setError('Submission could not be confirmed. Retry with the same answers; this will not create a second request.');}finally{setBusy(false);}}
 const configuring=!!order.configurable&&['awaiting_payment','awaiting_answers'].includes(order.state)&&!(order.payment&&['expired','failed','cancelled','refunded'].includes(order.payment.status));
 const notices=<>
 {error&&<p role="alert">{error}</p>}
 {order.payment&&<p>Payment: {formatRand(order.payment.amountMinor)} · {({creating:'not started',open:'awaiting payment',paid:'paid',expired:'checkout expired',failed:'payment failed',cancelled:'checkout cancelled',refunded:'refunded'} as Record<string,string>)[order.payment.status]}{order.payment.testMode?' (Stripe test mode, no real charge)':''}</p>}
 {order.state==='awaiting_payment'&&order.payment&&['creating','open'].includes(order.payment.status)&&<><p>{order.configurable?'Your questions and marks are saved with this checkout. You can still adjust marks below. The detailed questions open as soon as Stripe confirms your payment; this can take a moment after you return.':'Your questions and marks are reserved for this checkout. The parameter questions open as soon as Stripe confirms your payment. This can take a moment after you return.'}</p>
  {order.payment.checkoutUrl&&<p><a href={order.payment.checkoutUrl}>Continue to secure payment</a></p>}
  <button type="button" disabled={busy} onClick={()=>void payment('reconcile')}>I have paid: check again</button> <button type="button" disabled={busy} onClick={()=>void payment('cancel')}>Cancel this checkout</button></>}
 {order.payment&&['expired','failed','cancelled'].includes(order.payment.status)&&<p>No payment was taken for this checkout. <Link href="/teacher">Return to your workspace</Link> to start again.</p>}
 {order.payment?.needsAttention&&<p>Your payment was received after this checkout had closed. Revise It will contact you to refund it or complete your paper.</p>}
 </>;
 const progress=<>
 {!['awaiting_answers','released','held','cancelled'].includes(order.state)&&<p>Your answers are saved. You can close this page and return to Your paper requests to track progress.</p>}
 {order.state==='held'&&<p>Your request has stopped for internal attention. No partial pack has been released. You do not need to submit again.{order.payment?.status==='paid'?' Your payment is recorded; Revise It will contact you to complete the paper or refund you.':''}</p>}
 {order.state==='released'&&<><p>Your complete four-document pack is available.</p><ul>{order.documents.map(n=><li key={n}><a href={`/api/teacher/orders/${order.id}/documents/${n}`}>{documentLabels[n]}</a></li>)}</ul></>}
 {order.answerSummary?<details><summary>Your submitted answers</summary>{order.answerSummary.map((section,i)=><section key={i}><h3>{section.title}</h3><dl>{section.fields.map((field,j)=><div key={j}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>)}</details>:order.answers&&!isQuestionnaireAnswers(order.answers)&&<details><summary>Your submitted answers</summary><dl>{Object.entries(order.answers).map(([k,v])=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{v}</dd></div>)}</dl></details>}
 </>;
 // Configured orders use the paper journey's layout (Paper C5/C6); earlier questionnaire orders keep their card.
 if(order.configurable) return <div className={paper['order-page']}>{!configuring&&<Link className={paper['breadcrumb__back']} href="/teacher/orders">← My papers</Link>}
  {configuring?<ConfigureOrder key={order.state} orderId={order.id} topics={topics} title={order.title} onSubmitted={()=>void refresh()}>
    <div className={paper['order-page__notices']}><p className={paper['order-page__meta']}><span aria-live="polite">{stateLabels[order.state]||'Status unavailable'}</span> · Request reference <code>{order.id}</code></p>{notices}</div></ConfigureOrder>:
   <section className={paper['card--order']}><p className={paper['order-page__eyebrow']}>{order.title}</p><h1>{stateLabels[order.state]||'Status unavailable'}</h1><p className={paper['order-page__meta']}>Request reference <code>{order.id}</code></p>{notices}{progress}</section>}
  <button type="button" className={paper['button--refresh']} onClick={()=>void refresh()}>Refresh status</button></div>;
 return <section className={`${styles['card']} ${styles['card--wide']}`}><Link href="/teacher/orders">All paper requests</Link><h1>{order.title}</h1>{order.internalTest&&<p>Internal test order. No payment has been taken.</p>}<p>Request reference: <code>{order.id}</code></p><h2 aria-live="polite">{stateLabels[order.state]||'Status unavailable'}</h2>
 {notices}
 {!order.configurable&&order.state==='awaiting_answers'&&order.form?<form onSubmit={submit}>{isQuestionnaire(order.form)&&grouped?<QuestionnaireFields form={order.form} answers={grouped} onChange={value=>{setGrouped(value);setFieldError(null);setError('');}} fieldError={fieldError} disabled={busy}/>:Array.isArray(order.form)?order.form.map(q=><div key={q.id} style={{marginBottom:20}}><label htmlFor={'answer-'+q.id}>{q.label}</label><select id={'answer-'+q.id} required value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} style={{display:'block',width:'100%',padding:12}}><option value="" disabled>Choose an answer</option>{q.options.map(o=><option key={o}>{o}</option>)}</select></div>):null}<p>Check your answers before submitting. They are fixed for this request once submitted.</p><button disabled={busy||!key}>{busy?'Submitting…':'Submit answers'}</button></form>:null}
 {progress}
 <button type="button" onClick={()=>void refresh()} style={{marginTop:20}}>Refresh status</button></section>;
}
