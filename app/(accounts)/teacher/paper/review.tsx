'use client';
import type { ReactNode } from 'react';
import styles from '../paper.module.css';
import type { PaperModel } from './model';
import { journey } from './builder';
import { Icon, PageHeader, Stages } from './ui';

const documents=[
  {name:'Question paper',detail:'In your school’s formatting',tone:styles.docSage},
  {name:'First-draft marking memorandum',detail:'Mark by mark, for moderation',tone:styles.docTerracotta},
  {name:'Learner memorandum',detail:'Worked answers for feedback',tone:styles.docGold},
  {name:'Teacher description',detail:'Bloom’s level for every subquestion',tone:styles.docNavy},
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
    <div className={styles.twoCol}>
      <div className={styles.mainCol}>
        <section className={styles.panelCard} aria-labelledby="review-paper">
          <p id="review-paper" className={styles.eyebrowMid}>Your paper</p>
          {n===0?<p className={styles.panelLead}>No questions yet. <button type="button" className={styles.textLink} onClick={()=>paper.go('catalogue')}>Browse the catalogue</button></p>:
          <ol className={styles.reviewList}>
            {mcq.length>0&&<li><span className={styles.qNumberGold}>1</span><span>Multiple choice, {mcq.length} {mcq.length===1?'question':'questions'}</span><span className={styles.reviewState}>{mcq.every(o=>o.entry.orderable)?'Marks set':'Not yet available'}</span><strong>{mcq.length*2}</strong></li>}
            {structured.map(o=><li key={o.index}><span className={styles.qNumber}>{o.number}</span><span>{o.entry.title}</span><span className={styles.reviewState}>{o.entry.orderable?lineStatus(paper.inRange(o.entry)):'Not yet available'}</span><strong>{Number.isInteger(paper.allocation[o.entry.id])?paper.allocation[o.entry.id]:'—'}</strong></li>)}
            <li className={styles.reviewTotal}><span>Total</span><strong>{allocatedTotal} marks</strong></li>
          </ol>}
        </section>
        <section className={styles.panelCard} aria-labelledby="documents">
          <p id="documents" className={styles.eyebrowMid}>You will receive four documents</p>
          <ul className={styles.docs}>{documents.map(d=><li key={d.name} className={d.tone}><strong>{d.name}</strong><span>{d.detail}</span></li>)}</ul>
        </section>
        <section className={styles.panelCard} aria-labelledby="next-steps">
          <p id="next-steps" className={styles.eyebrowMid}>What happens next</p>
          <ol className={styles.nextSteps}>{next.map((s,i)=><li key={s.title}><span>{i+1}</span><strong>{s.title}</strong><p>{s.text}</p></li>)}</ol>
        </section>
      </div>
      <aside className={styles.rail} aria-label="Order summary">
        <section className={`${styles.railCard} ${styles.topSage}`}>
          <p className={styles.eyebrowSage}>Order summary</p>
          <p className={styles.orderLine}><span>Revise It assessment paper (pilot)</span><span>{price}</span></p>
          <p className={styles.orderTotal}><span>Total</span><strong>{price}</strong></p>
          <div className={`${styles.readiness} ${ready?'':styles.readinessTodo}`} role="status">
            <p><span>{ready?'Ready for payment':'Marks needed'}</span><strong>{ready?'Ready':'Not yet'}</strong></p>
            {ready?<span>Your marks balance. Payment unlocks the detailed choices. You can still change marks, parts and every other choice until you submit.</span>:
              <ul>{problems.map(p=><li key={p}>{p}</li>)}</ul>}
          </div>
          <p className={styles.railFine}>This pilot allows up to {limits.questions} questions per paper{limits.structured<limits.questions||limits.multipleChoice<limits.questions?`, including up to ${limits.structured} structured and ${limits.multipleChoice} multiple-choice questions`:''}.</p>
          {!withinPilotSize&&n<=limits.questions&&<p role="alert" className={styles.warnText}>Reduce the number of structured or multiple-choice questions to fit the pilot limits before paying.</p>}
          {n>limits.questions&&<p role="alert" className={styles.warnText}>Remove {n-limits.questions} {n-limits.questions===1?'question':'questions'} before continuing to payment.</p>}
          {!data.purchase?.available ? <p className={styles.railText}>Purchasing is not open for your account yet. Your saved selection stays here.</p> :
            paper.selectionDirty || !data.selection.revision ? <p className={styles.railText}>Save your selection before continuing to payment. <button type="button" className={styles.textLink} disabled={busy} onClick={()=>void paper.save()}>Save selection</button></p> :
            occurrences.some(o=>!o.entry.orderable) ? <p className={styles.railText}>Remove questions that are not yet available before paying.</p> : null}
          <button type="button" className={styles.payButton} disabled={busy||!paper.canPay} onClick={()=>void paper.checkout()}>{busy?'Please wait…':`Pay with Stripe · ${price}`}</button>
          <p className={styles.payNote}>You will be taken to Stripe’s secure page. Your questions stay saved if you come back without paying. After payment is confirmed you answer the detailed questions for the questions you bought.</p>
        </section>
        <button type="button" className={styles.secondaryWide} onClick={()=>paper.go('builder')}>{Icon.back()} Back to paper builder</button>
      </aside>
    </div>
  </>;
}
