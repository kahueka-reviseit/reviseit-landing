'use client';
import type { ReactNode } from 'react';
import styles from '../paper.module.css';
import type { PaperModel } from './model';
import { journey } from './builder';
import { Icon, PageHeader, Stages } from './ui';

const documents=[
  {name:'Question paper',detail:'In your school’s formatting',tone:styles['download-list__item--question-paper']},
  {name:'Teacher marking memorandum',detail:'Mark by mark, for moderation',tone:styles['download-list__item--marking-memo']},
  {name:'Learner memorandum',detail:'Worked answers for feedback',tone:styles['download-list__item--learner-memo']},
  {name:'Teacher description',detail:'Bloom’s level for every subquestion',tone:styles['download-list__item--teacher-description']},
];
const next=[
  {title:'Pay securely',text:'On Stripe’s page, then straight back here'},
  {title:'Complete the details',text:'Scenario questions for each question, or Choose for me'},
  {title:'We build the paper',text:'Follow its progress on your paper requests'},
  {title:'Download all four',text:'Released together as one pack'},
];

/** Paper C4. Payment uses the existing checkout route and its guards unchanged. */
export default function ReviewView({paper,status}:{paper:PaperModel;status:ReactNode}) {
  const {occurrences,data,configured,allocatedTotal,paperTarget,price,limits,withinPilotSize,busy}=paper;
  const mcq=occurrences.filter(o=>o.kind==='multiple_choice'), structured=occurrences.filter(o=>o.kind==='structured');
  const n=occurrences.length, ready=paper.marksSet&&paper.balanced;
  const problems:string[]=[];
  if(configured&&paperTarget===null) problems.push('Set a total for the paper.');
  if(!paper.marksSet) problems.push('Set marks for every question within its range.');
  if(configured&&paperTarget!==null&&paper.marksSet&&allocatedTotal!==paperTarget) problems.push(allocatedTotal<paperTarget?`${paperTarget-allocatedTotal} marks still to allocate.`:`${allocatedTotal-paperTarget} marks over the total.`);
  (['multiple_choice','structured'] as const).forEach(k=>{const t=paper.sectionTargets[k];if(t!==undefined&&t!==paper.sectionTotal(k))problems.push(`${k==='multiple_choice'?'Multiple choice':'Structured'} section: ${paper.sectionTotal(k)} of ${t} marks.`);});
  const lineStatus=(ok:boolean)=>ok?'Marks set':'Marks needed';
  return <>
    <PageHeader back={{label:`Back to paper builder · ${data.module!.name}`,onClick:()=>paper.go('builder')}} title="Review and pay"
      subtitle={`${data.module!.name} · ${configured?(paperTarget!==null?`${paperTarget} marks`:'total not set'):`${allocatedTotal} marks`} · ${n} ${n===1?'question':'questions'}`} aside={<Stages stages={journey(paper,3)}/>}/>
    {status}
    <div className={styles['page-body']}>
      <div className={styles['page-body__main']}>
        <section className={styles['card--panel']} aria-labelledby="review-paper">
          <p id="review-paper" className={styles['eyebrow--neutral']}>Your paper</p>
          {n===0?<p className={styles['card__lead']}>No questions yet. <button type="button" className={styles['link']} onClick={()=>paper.go('catalogue')}>Browse the catalogue</button></p>:
          <ol className={styles['question-list']}>
            {mcq.length>0&&<li><span className={styles['question-table__number--multiple-choice']}>1</span><span>Multiple choice, {mcq.length} {mcq.length===1?'question':'questions'}</span><span className={styles['question-list__status']}>{mcq.every(o=>o.entry.orderable)?'Marks set':'Not yet available'}</span><strong>{mcq.length*2}</strong></li>}
            {structured.map(o=><li key={o.index}><span className={styles['question-table__cell--number']}>{o.number}</span><span>{o.entry.title}</span><span className={styles['question-list__status']}>{o.entry.orderable?lineStatus(paper.inRange(o.entry)):'Not yet available'}</span><strong>{Number.isInteger(paper.allocation[o.entry.id])?paper.allocation[o.entry.id]:'—'}</strong></li>)}
            <li className={styles['question-list__total']}><span>Total</span><strong>{allocatedTotal} marks</strong></li>
          </ol>}
        </section>
        <section className={styles['card--panel']} aria-labelledby="documents">
          <p id="documents" className={styles['eyebrow--neutral']}>You will receive four documents</p>
          <ul className={styles['download-list']}>{documents.map(d=><li key={d.name} className={d.tone}><strong>{d.name}</strong><span>{d.detail}</span></li>)}</ul>
        </section>
        <section className={styles['card--panel']} aria-labelledby="next-steps">
          <p id="next-steps" className={styles['eyebrow--neutral']}>What happens next</p>
          <ol className={styles['steps']}>{next.map((s,i)=><li key={s.title}><span>{i+1}</span><strong>{s.title}</strong><p>{s.text}</p></li>)}</ol>
        </section>
      </div>
      <aside className={styles['page-body__aside']} aria-label="Order summary">
        <section className={`${styles['card']} ${styles['section--order']}`}>
          <p className={styles['eyebrow--positive']}>Order summary</p>
          <p className={styles['order-summary__line']}><span>Revise It assessment paper (pilot)</span><span>{price}</span></p>
          <p className={styles['order-summary__total']}><span>Total</span><strong>{price}</strong></p>
          <div className={`${styles['notice--ready']} ${ready?'':styles['notice--not-ready']}`} role="status">
            <p><span>{ready?'Ready for payment':'Marks needed'}</span><strong>{ready?'Ready':'Not yet'}</strong></p>
            {ready?<span>Your marks balance. Payment unlocks the detailed choices. You can still change marks, parts and every other choice until you submit.</span>:
              <ul>{problems.map(p=><li key={p}>{p}</li>)}</ul>}
          </div>
          <p className={styles['card__note']}>This pilot allows up to {limits.questions} questions per paper{limits.structured<limits.questions||limits.multipleChoice<limits.questions?`, including up to ${limits.structured} structured and ${limits.multipleChoice} multiple-choice questions`:''}.</p>
          {!withinPilotSize&&n<=limits.questions&&<p role="alert" className={styles['notice__warning']}>Reduce the number of structured or multiple-choice questions to fit the pilot limits before paying.</p>}
          {n>limits.questions&&<p role="alert" className={styles['notice__warning']}>Remove {n-limits.questions} {n-limits.questions===1?'question':'questions'} before continuing to payment.</p>}
          {!data.purchase?.available ? <p className={styles['card__body']}>Purchasing is not open for your account yet. Your saved selection stays here.</p> :
            paper.selectionDirty || !data.selection.revision ? <p className={styles['card__body']}>Save your selection before continuing to payment. <button type="button" className={styles['link']} disabled={busy} onClick={()=>void paper.save()}>Save selection</button></p> :
            occurrences.some(o=>!o.entry.orderable) ? <p className={styles['card__body']}>Remove questions that are not yet available before paying.</p> : null}
          <button type="button" className={styles['button--pay']} disabled={busy||!paper.canPay} onClick={()=>void paper.checkout()}>{busy?'Please wait…':`Pay with Stripe · ${price}`}</button>
          <p className={styles['order-summary__note']}>You will be taken to Stripe’s secure page. Your questions stay saved if you come back without paying. After payment is confirmed you answer the detailed questions for the questions you bought.</p>
        </section>
        <button type="button" className={styles['button--secondary-wide']} onClick={()=>paper.go('builder')}>{Icon.back()} Back to paper builder</button>
      </aside>
    </div>
  </>;
}
