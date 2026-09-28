import Link from 'next/link';
import type { Order } from '../../../../lib/jobs/contracts';
import { detailsFact, documentsFact, groupOrders, paperTitle, paymentFact, shortDate, stages, type Fact, type Row } from '../../../../lib/jobs/presentation';
import ui from '../../experience.module.css';

/** M1 and M1p: every paper with payment, question details and documents as separate facts. */
export function Status({tone,label}:{tone:Fact['tone'];label:string}) {
  return <span className={ui['status']}><span className={ui[`status__dot--${tone}`]} aria-hidden="true"/><span className={ui[`status__label--${tone}`]}>{label}</span></span>;
}
function Next({order,row}:{order:Order;row:Row}) {
  const href=`/teacher/orders/${order.id}`,name=`${row.next.label.replace(' →','')}: ${paperTitle(order)}`;
  const cls=row.next.kind==='primary'?`${ui['button--primary']} ${ui['button--compact']}`:row.next.kind==='secondary'?ui['button--secondary']:ui['button--text'];
  return <Link className={cls} href={href} aria-label={name}>{row.next.label}</Link>;
}
function StageMeter({stage}:{stage:number}) {
  return <span className={ui['stage-meter']} role="img" aria-label={`Stage ${stage+1} of ${stages.length}`}>{stages.map((s,i)=><span key={s} className={i<=stage?ui['stage-meter__segment--done']:ui['stage-meter__segment']}/>)}</span>;
}
export default function PaperList({orders,curricula,school,failed=false}:{orders:Order[];curricula:Record<string,string>;school?:string;failed?:boolean}) {
  const rows=groupOrders(orders),open=rows.filter(r=>r.row.group!=='closed'),closed=rows.filter(r=>r.row.group==='closed');
  const row=({order,row}:{order:Order;row:Row})=>{
    const pay=paymentFact(order.payment,order.internalTest),details=detailsFact(order),docs=documentsFact(order),title=paperTitle(order,curricula[order.moduleId]);
    const cls=row.group==='closed'?ui['paper-list__row--closed']:row.status.tone==='attention'||row.status.tone==='problem'?ui['paper-list__row--attention']:ui['paper-list__row'];
    return <li key={order.id} className={cls}>
      <div className={ui['paper-list__cell--status']}><Status tone={row.status.tone} label={row.status.label}/></div>
      <div className={ui['paper-list__cell--paper']}>
        <h2 className={row.group==='closed'?ui['paper-list__title--closed']:ui['paper-list__title']}>{title}</h2>
        <p className={ui['paper-list__meta']}>{[title.startsWith(curricula[order.moduleId]??'\u0000')?null:curricula[order.moduleId],order.createdAt&&`Started ${shortDate(order.createdAt)}`,order.internalTest&&'Internal test order'].filter(Boolean).join(' · ')}</p>
        <dl className={ui['paper-list__facts']}>
          {[['Payment',pay.value],['Question details',details.value],['Documents',docs.value]].map(([k,v])=><div key={k} className={ui['paper-list__fact']}><dt>{k}</dt><dd className={ui['paper-list__fact-value']}>{v}</dd></div>)}
        </dl>
      </div>
      <div className={ui['paper-list__cell--payment']}><p className={ui['paper-list__value']}>{pay.value}</p>{pay.detail&&<p className={ui['paper-list__sub']}>{pay.detail}</p>}</div>
      <div className={ui['paper-list__cell--details']}><p className={details.tone==='closed'?ui['paper-list__text--subtle']:ui['paper-list__text']}>{details.value}</p></div>
      <div className={ui['paper-list__cell--documents']}>
        <p className={docs.tone==='closed'?(row.group==='closed'?ui['paper-list__text--subtle']:ui['paper-list__text--muted']):ui['paper-list__text']}>{docs.value}{docs.tone==='closed'&&docs.detail?`. ${docs.detail}.`:''}</p>
        {row.stage>=0&&row.stage<stages.length&&<StageMeter stage={row.stage}/>}
      </div>
      <div className={ui['paper-list__cell--action']}><Next order={order} row={row}/></div>
    </li>;
  };
  return <div className={ui['page']}>
    <header className={ui['page-header']}>
      <div className={ui['page-header__titles']}>
        {school&&<p className={ui['page-header__eyebrow']}>{school}</p>}
        <h1 className={ui['page-header__title']}>My papers</h1>
        <p className={ui['page-header__lede']}>Every paper you have started, paid for or received. The first column tells you what, if anything, is waiting for you.</p>
      </div>
      <div className={ui['page-header__actions']}><a className={ui['button--primary']} href="/teacher?view=home">Build a new paper →</a></div>
    </header>
    {failed?<div className={ui['notice--problem']} role="alert"><p className={ui['notice__title']}>We could not load your papers</p><p className={ui['notice__body']}>Refresh in a moment; nothing has been lost.</p></div>:
     !orders.length?<section className={ui['empty-state']}><h2 className={ui['empty-state__title']}>No papers yet</h2><p className={ui['empty-state__body']}>Choose questions in My curricula and continue to payment to start your first paper.</p><a className={ui['button--primary']} href="/teacher?view=home">Build a new paper →</a></section>:
     <section aria-label="Your papers">
      <div className={ui['paper-list']}>
        <div className={ui['paper-list__head']} aria-hidden="true">
          <span className={`${ui['paper-list__heading']} ${ui['paper-list__cell--status']}`}>Status</span><span className={`${ui['paper-list__heading']} ${ui['paper-list__cell--paper']}`}>Paper</span>
          <span className={`${ui['paper-list__heading']} ${ui['paper-list__cell--payment']}`}>Payment</span><span className={`${ui['paper-list__heading']} ${ui['paper-list__cell--details']}`}>Question details</span>
          <span className={`${ui['paper-list__heading']} ${ui['paper-list__cell--documents']}`}>Documents</span><span className={`${ui['paper-list__heading']} ${ui['paper-list__cell--action']}`}>Next step</span>
        </div>
        {open.length>0&&<ul className={ui['paper-list__group']}>{open.map(row)}</ul>}
        {closed.length>0&&<><h2 className={ui['paper-list__group-label']}>Closed · no further action</h2><ul className={ui['paper-list__group']}>{closed.map(row)}</ul></>}
      </div>
     </section>}
  </div>;
}
