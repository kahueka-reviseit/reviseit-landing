import type {CreditSummary} from '../../../lib/credits/contracts';
import {formatRand} from '../../../lib/credits/pricing';
import s from './credits.module.css';
const sources={purchase:'Purchased credit',offer:'Free offer',staff_grant:'Staff grant',paid_invoice:'Paid invoice'};
const activity={grant:'Credit added',purchase:'Top-up confirmed',claim:'Offer claimed',spend:'Paper created',return:'Credit returned',void:'Credit removed'};
export function CreditSummaryView({summary}:{summary:CreditSummary}){
 return <div className={s['department__stack']}><section className={s['credit-card']} aria-label="Department balance">
 <div className={s['credit-card__body']}><div className={s['credit-card__label']}>AVAILABLE TO THE DEPARTMENT{summary.mode==='test'?' · TEST MODE':''}</div>
 <div className={s['credit-card__balance']}>{formatRand(summary.balanceMinor)}</div>
 <p>Credit belongs to the department. Each paper’s price is shown before you create it.</p></div>
 {summary.canManage&&summary.sources.map(source=><div className={s['credit-card__row']} key={source.id}>
 <div className={s['credit-card__primary']}>{sources[source.kind]}<span className={s['credit-card__secondary']}>{source.voidedAt?'Removed':source.expiresAt?`Use by ${new Date(source.expiresAt).toLocaleDateString('en-ZA')}`:'No use-by date'}</span></div>
 <strong className={s['credit-card__amount']}>{formatRand(source.remainingMinor)}</strong></div>)}
 </section><section className={s['credit-card']}><div className={s['credit-card__body']}><h2 className={s['credit-card__title']}>{summary.canManage?'Recent activity':'Your activity'}</h2></div>
 {!summary.activity.length&&<p className={s['credit-card__empty']}>No credit activity yet.</p>}
 {summary.activity.map(a=><div key={a.id} className={s['credit-card__row']}><div className={s['credit-card__primary']}>{activity[a.kind]}<span className={s['credit-card__secondary']}>{new Date(a.createdAt).toLocaleDateString('en-ZA')}</span></div><span className={s['credit-card__amount']}>{a.kind==='spend'||a.kind==='void'?'−':'+'}{formatRand(a.amountMinor)}</span></div>)}
 </section></div>;
}
