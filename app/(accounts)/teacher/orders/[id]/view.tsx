'use client';
import Link from 'next/link';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type Order,stateLabels,documentLabels } from '../../../../../lib/jobs/contracts';
import QuestionnaireFields,{emptyQuestionnaireAnswers,questionFieldId,type QuestionnaireFieldError} from '../../../../../lib/jobs/questionnaire-fields';
import {isQuestionnaire,isQuestionnaireAnswers,answersMatchQuestionnaire,type QuestionnaireAnswers} from '../../../../../lib/jobs/questionnaire';
import {shortDate,detailsFact,documentDescriptions,documentsFact,isClosed,journeySteps,paperTitle,paymentFact,paymentNotice,stageIndex,stages,submitted,type Fact,type PaymentNotice} from '../../../../../lib/jobs/presentation';
import type {ConfigurationView} from '../../../../../lib/configurator/contracts';
import type {QuestionContext} from '../../../../../lib/workspace/contracts';
import ui from '../../../experience.module.css';
import ConfigureOrder from './configure';
import paper from './configure.module.css';
import SubmittedSummary,{paperMeta} from './submitted-summary';

/**
 * One paper's page (Paper M2 to M4). Before submission a configured paper opens the
 * question table (page 7); afterwards, and for closed or older questionnaire orders,
 * this status page shows payment, question details and documents as separate facts.
 * Returning from Stripe proves nothing: the server confirms every payment.
 */
function Notice({notice,children}:{notice:PaymentNotice;children?:ReactNode}){
 return <div className={ui[`notice--${notice.tone}`]} role={notice.tone==='problem'?'alert':'status'}><p className={ui['notice__title']}>{notice.title}</p><p className={ui['notice__body']}>{notice.body}</p>{children&&<div className={ui['notice__actions']}>{children}</div>}</div>;
}
function FactView({label,fact}:{label:string;fact:Fact}){
 return <div className={ui['paper-facts__fact']}><dt className={ui['paper-facts__label']}>{label}</dt>
  <dd className={ui['paper-facts__value']}><span className={ui[`status__dot--${fact.tone}`]} aria-hidden="true"/>{fact.value}</dd>
  {fact.detail&&<dd className={ui['paper-facts__detail']}>{fact.detail}</dd>}</div>;
}
const DocumentIcon=()=><svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true"><path d="M3 1h11l5 5v18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M6 11h10M6 15h10M6 19h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
const DownloadIcon=()=><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v8M3.5 6.5 7 10l3.5-3.5M2 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Check=()=><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;

export default function OrderView({initial,catalogue={},curriculum}:{initial:Order;catalogue?:Record<string,QuestionContext>;curriculum?:string}){
 const [order,setOrder]=useState(initial),[answers,setAnswers]=useState<Record<string,string>>(initial.answers&&!isQuestionnaireAnswers(initial.answers)?initial.answers:{}),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [checking,setChecking]=useState(false);
 const [fieldError,setFieldError]=useState<QuestionnaireFieldError|null>(null);
 const [summary,setSummary]=useState<{state:'loading'|'ready'|'failed';view:ConfigurationView|null}>({state:'loading',view:null});
 useEffect(()=>{if(fieldError&&!busy)document.getElementById(questionFieldId(fieldError.itemId,fieldError.fieldId))?.focus();},[fieldError,busy]);
 const [grouped,setGrouped]=useState<QuestionnaireAnswers|null>(()=>isQuestionnaire(initial.form)?emptyQuestionnaireAnswers(initial.form):null);
 // A paid order's form can first arrive through reconciliation or refresh. Start its answers then;
 // keep answers already entered for the same form revision.
 useEffect(()=>{if(isQuestionnaire(order.form)&&grouped?.revision!==order.form.revision)setGrouped(emptyQuestionnaireAnswers(order.form));},[order.form]);
 useEffect(()=>{const storageKey='paper-submit:'+initial.id;let value=sessionStorage.getItem(storageKey);if(!value){value=crypto.randomUUID();sessionStorage.setItem(storageKey,value);}setKey(value);},[initial.id]);
 async function refresh(){try{const r=await fetch(`/api/teacher/orders/${initial.id}`,{cache:'no-store'});if(r.status===401){window.location.assign('/login');return;}if(!r.ok){setError('We could not refresh this paper. Check your account access or try again.');return;}setOrder(await r.json());setError('');}catch{setError(submitted(order.state)?'Connection lost. Your paper is still being created; refresh in a moment.':'Connection lost. Your saved work is safe; refresh in a moment.');}}
 useEffect(()=>{if(['released','held','cancelled','awaiting_answers'].includes(order.state))return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);return()=>clearInterval(timer);},[order.state,initial.id]);
 async function payment(action:'reconcile'|'cancel'){setBusy(true);setChecking(action==='reconcile');setError('');try{const r=await fetch(`/api/teacher/orders/${initial.id}/payment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const data=await r.json();if(!r.ok)setError(data.error||'We could not confirm your payment yet. Refresh in a moment.');else setOrder(data);}catch{setError('Connection lost. If you paid, your payment is safe; refresh in a moment.');}finally{setBusy(false);setChecking(false);}}
 useEffect(()=>{if(initial.state==='awaiting_payment'&&new URLSearchParams(window.location.search).get('checkout')==='returned')void payment('reconcile');},[initial.id]);
 async function submit(e:React.FormEvent){e.preventDefault();const sent=isQuestionnaire(order.form)?grouped:answers;if(isQuestionnaire(order.form)&&!answersMatchQuestionnaire(order.form,sent)){setError('Please answer each question and the shared paper settings.');return;}setBusy(true);setError('');setFieldError(null);try{const r=await fetch(`/api/teacher/orders/${order.id}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey:key,answers:sent})});if(!r.ok){const data=await r.json();setError(data.error||'Submission could not be confirmed. Retry with the same answers.');const target=data.fieldError;if(r.status===422&&isQuestionnaire(order.form)&&typeof data.error==='string'&&target&&order.form.items.some(item=>item.id===target.itemId&&item.fields.some(field=>field.id===target.fieldId)))setFieldError({...target,message:data.error});}else{await refresh();}}catch{setError('Submission could not be confirmed. Retry with the same answers; this will not create a second request.');}finally{setBusy(false);}}
 const configuring=!!order.configurable&&['awaiting_payment','awaiting_answers'].includes(order.state)&&!(order.payment&&['expired','failed','cancelled','refunded'].includes(order.payment.status));
 // The submitted per-question summary is read from the server's projection of the frozen configuration.
 const showSummary=!!order.configurable&&!configuring;
 const summaryKey=showSummary?`${order.id}:${submitted(order.state)}`:'';
 const loaded=useRef('');
 useEffect(()=>{if(!summaryKey||loaded.current===summaryKey)return;loaded.current=summaryKey;setSummary({state:'loading',view:null});
  fetch(`/api/teacher/orders/${order.id}/configuration`,{cache:'no-store'}).then(async r=>r.ok?setSummary({state:'ready',view:await r.json()}):setSummary({state:'failed',view:null})).catch(()=>setSummary({state:'failed',view:null}));},[summaryKey]);

 const notice=paymentNotice(order,checking||(busy&&order.state==='awaiting_payment'));
 const noticeView=notice&&<Notice notice={notice}>{
  notice.tone==='progress'?<button type="button" className={ui['button--secondary']} disabled={busy} onClick={()=>void payment('reconcile')}>Check again</button>:
  order.state==='awaiting_payment'&&order.payment&&['creating','open'].includes(order.payment.status)?<>
   {order.payment.checkoutUrl&&<a className={`${ui['button--primary']} ${ui['button--compact']}`} href={order.payment.checkoutUrl}>Continue to secure payment</a>}
   <button type="button" className={ui['button--secondary']} disabled={busy} onClick={()=>void payment('reconcile')}>I have paid: check again</button>
   <button type="button" className={ui['button--danger-text']} disabled={busy} onClick={()=>void payment('cancel')}>Cancel this checkout</button></>:
  notice.tone==='neutral'&&order.payment?.status!=='refunded'?<><a className={ui['button--secondary']} href="/teacher?view=home">Go to My curricula</a><Link className={ui['button--text']} href="/teacher/orders">Back to My papers</Link></>:
  notice.tone==='neutral'?<Link className={ui['button--text']} href="/teacher/orders">Back to My papers</Link>:
  notice.tone==='caution'||notice.tone==='problem'?<a className={ui['button--text']} href={`mailto:kahueka@reviseit.io?subject=${encodeURIComponent('Paper '+order.id.slice(0,8))}`}>Email kahueka@reviseit.io</a>:null}</Notice>;
 const errorView=error&&<p role="alert" className={ui['notice--problem']}><span className={ui['notice__body']}>{error}</span></p>;
 const live=<p className="visually-hidden" aria-live="polite">{stateLabels[order.state]||'Status unavailable'}</p>;
 const title=paperTitle(order,curriculum);

 if(configuring) return <div className={paper['order-page']}><ConfigureOrder key={order.state} orderId={order.id} catalogue={catalogue} title={title}
   notice={<div className={ui['notice-stack']}>{live}{errorView}{noticeView}</div>} onSubmitted={()=>void refresh()}>
   <p className={ui['paper-facts__detail']}>{stateLabels[order.state]||'Status unavailable'} · Paper reference <code>{order.id}</code>{order.payment?.testMode?' · Stripe test mode, no real charge':''}</p></ConfigureOrder></div>;

 const i=stageIndex(order.state),view=summary.view;
 const counts=view?{ready:view.lines.filter(l=>l.ready).length,total:view.lines.length}:undefined;
 const legacyForm=!order.configurable&&order.state==='awaiting_answers'&&order.form;
 return <div className={ui['page']}>
  <header className={ui['page-header--paper']}>
   <nav aria-label="Breadcrumb" className={`${ui['breadcrumb']} ${ui['breadcrumb--collapsible']}`}><Link className={ui['breadcrumb__back']} href="/teacher/orders">← My papers</Link><Link className={ui['breadcrumb__link']} href="/teacher/orders">My papers</Link><span aria-hidden="true">/</span><span className={ui['breadcrumb__current']} aria-current="page">{title}</span></nav>
   <div className={ui['page-header__row']}>
    <div className={ui['page-header__titles']}>{curriculum&&<p className={ui['page-header__eyebrow']}>{curriculum}</p>}<h1 className={ui['page-header__title--paper']}>{title}</h1>
     <p className={ui['page-header__meta']}>{[view&&paperMeta(view),order.createdAt&&`Started ${shortDate(order.createdAt)}`].filter(Boolean).join(' · ')}</p>{order.internalTest&&<p className={ui['page-header__meta']}>Internal test order. No payment has been taken.</p>}</div>
    {!isClosed(order)&&<ol className={ui['journey-steps']} aria-label="Paper progress">{journeySteps(order).map(s=><li key={s.label} className={ui[`journey-steps__step--${s.state}`]} aria-current={s.state==='current'||s.state==='stopped'?'step':undefined}>{s.state==='done'?'✓ ':''}{s.label}</li>)}</ol>}
   </div>
  </header>
  <div className={ui['page-stack']}>
   <dl className={ui['paper-facts']} aria-label="Paper status">
    <FactView label="Payment" fact={paymentFact(order.payment,order.internalTest)}/>
    <FactView label="Question details" fact={detailsFact(order,counts)}/>
    <FactView label="Documents" fact={documentsFact(order)}/>
   </dl>
   {live}{errorView}{noticeView}
   <div className={ui['page-columns']}>
    <div className={ui['page-columns__main']}>
     {order.state==='released'&&<section aria-labelledby="documents-title" className={ui['page-stack--tight']}>
      <div className={ui['section-heading']}><h2 id="documents-title" className={ui['section-heading__title']}>Your four documents</h2><p className={ui['section-heading__note']}>Word documents (.docx) · download each one</p></div>
      <ul className={ui['document-list']}>{order.documents.map(n=>{const d=documentDescriptions[n];return <li key={n} className={ui['document-card']}>
       <span className={ui[`document-card__icon--${d.icon}`]}><DocumentIcon/></span>
       <div className={ui['document-card__body']}><div><h3 className={ui['document-card__title']}>{documentLabels[n]}</h3><p className={ui['document-card__description']}>{d.description}</p></div>
        <div className={ui['document-card__footer']}><span className={ui['document-card__file']}>{d.file}</span>
         <a className={ui['document-card__download']} href={`/api/teacher/orders/${order.id}/documents/${n}`} download><DownloadIcon/><span className={ui['document-card__download-label']}>Download <span className="visually-hidden">{documentLabels[n]}</span></span></a></div></div>
      </li>;})}</ul></section>}
     {i>=0&&<section aria-labelledby="stages-title" className={ui['page-stack--tight']}>
      <div className={ui['section-heading']}><h2 id="stages-title" className={ui['section-heading__title']}>Creating your documents</h2><p className={ui['section-heading__note']}>Checked automatically every few seconds while this page is open</p></div>
      <ol className={ui['stage-list']}>{stages.map((s,n)=>{const st=n<i?'done':n===i?'current':'next';return <li key={s} className={ui['stage-list__stage']} aria-current={st==='current'?'step':undefined}>
       <span className={ui[`stage-list__marker--${st}`]} aria-hidden="true">{st==='done'&&<Check/>}</span>
       <p className={ui[`stage-list__label--${st}`]}>{stateLabels[s]}</p>
       <p className={st==='current'?ui['stage-list__state--current']:ui['stage-list__state']}>{st==='done'?'Done':st==='current'?'In progress':'Next'}</p>
       {st==='current'&&<p className={ui['stage-list__note']}>Your answers are saved. You can close this page and come back to My papers at any time.</p>}
      </li>;})}</ol></section>}
     {legacyForm&&<form onSubmit={submit} className={ui['form-card--inline']}>
      <h2 className={ui['form-card__title']}>Your answers</h2>
      {isQuestionnaire(order.form)&&grouped?<QuestionnaireFields form={order.form} answers={grouped} onChange={value=>{setGrouped(value);setFieldError(null);setError('');}} fieldError={fieldError} disabled={busy}/>:Array.isArray(order.form)?order.form.map(q=><div key={q.id} className={ui['field']}><label className={ui['field__label']} htmlFor={'answer-'+q.id}>{q.label}</label><select className={ui['field__select']} id={'answer-'+q.id} required value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}><option value="" disabled>Choose an answer</option>{q.options.map(o=><option key={o}>{o}</option>)}</select></div>):null}
      <p className={ui['form-card__note']}>Check your answers before submitting. They are fixed for this request once submitted.</p>
      <div><button className={ui['button--primary']} disabled={busy||!key}>{busy?'Submitting…':'Submit answers'}</button></div></form>}
     {showSummary&&<SubmittedSummary view={view} state={summary.state}/>}
     {!order.configurable&&order.answerSummary?<section className={ui['submitted-summary']} aria-labelledby="receipt-title"><div className={ui['submitted-summary__header']}><h2 id="receipt-title" className={ui['submitted-summary__title']}>What you asked for</h2></div>
      {order.answerSummary.map((section,n)=><div key={n} className={ui['submitted-summary__row']}><div className={ui['submitted-summary__brief']}><h3 className={ui['submitted-summary__question-title']}>{section.title}</h3><dl className={ui['submitted-summary__chips']}>{section.fields.map((field,j)=><div key={j} className={ui['submitted-summary__chip']}><dt className={ui['submitted-summary__term']}>{field.label}:</dt> <dd className={ui['submitted-summary__definition']}>{field.value}</dd></div>)}</dl></div></div>)}</section>
      :!order.configurable&&order.answers&&!isQuestionnaireAnswers(order.answers)&&<section className={ui['submitted-summary']} aria-labelledby="receipt-title"><div className={ui['submitted-summary__header']}><h2 id="receipt-title" className={ui['submitted-summary__title']}>What you asked for</h2></div>
      <dl className={ui['submitted-summary__status']}>{Object.entries(order.answers).map(([k,v])=><div key={k}><dt className={ui['submitted-summary__term']}>{k.replaceAll('_',' ')}:</dt> <dd className={ui['submitted-summary__definition']}>{v}</dd></div>)}</dl></section>}
    </div>
    <aside className={ui['page-columns__aside']}>
     <section className={ui['key-value-list']} aria-labelledby="this-paper-title"><h2 id="this-paper-title" className={ui['key-value-list__title']}>This paper</h2><dl className={ui['key-value-list__rows']}>
      {curriculum&&<div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>Curriculum</dt><dd className={ui['key-value-list__value']}>{curriculum}</dd></div>}
      {view&&<div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>Paper total</dt><dd className={ui['key-value-list__value']}>{view.totals.allocated} marks</dd></div>}
      {view&&<div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>Questions</dt><dd className={ui['key-value-list__value']}>{view.lines.length}</dd></div>}
      <div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>Paper reference</dt><dd className={ui['key-value-list__value--subtle']} title={order.id}>{order.id.slice(0,8)}</dd></div></dl></section>
     <div className={ui['help-card']}><p className={ui['help-card__title']}>{order.state==='released'?'Something not right in a document?':'Need to reach us?'}</p>
      <p className={ui['help-card__body']}>Email <a href="mailto:kahueka@reviseit.io">kahueka@reviseit.io</a> {order.state==='released'?'and include the paper reference. Your documents stay available here.':'with the paper reference.'}{i>=0?' You do not need to submit again.':''}</p></div>
     <button type="button" className={ui['button--secondary']} onClick={()=>void refresh()}>Refresh status</button>
    </aside>
   </div>
  </div>
 </div>;
}
