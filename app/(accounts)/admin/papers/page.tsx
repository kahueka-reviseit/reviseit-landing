import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAccount } from '../../../../lib/auth/access';
import { StaffHeader } from '../../staff-header';
import { accountCounts, papersNeedingAttention, reasonTone, searchTerm, type Attention } from '../data';
import { CopyReference, FocusRow, RecordKeys } from './record';
import ui from '../../experience.module.css';
export const dynamic='force-dynamic';

/**
 * Papers needing attention (Paper S5). One queue with the reason first, then a record
 * panel. There is deliberately no retry, approve or refund control: refunds happen in
 * Stripe and are closed by the existing webhook. Paper reviewers who are not account
 * reviewers still see held and checking requests, as before.
 */
type Item = { id:string; reason:string; tone:'attention'|'problem'|'progress'; title:string; teacher:string; school:string; email:string; payment:string; mode:string; paymentIntent:string|null; state:string };
type Params = { reason?:string; q?:string; record?:string; focus?:string };
export default async function ReviewPapers({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { supabase, user, account } = await requireAccount();
  const [{ paid, queue }, reviewer] = await Promise.all([papersNeedingAttention(supabase), supabase.rpc('is_account_reviewer')]);
  if (!paid && !queue) redirect('/account');
  const isReviewer = reviewer.data === true;
  const counts = isReviewer ? await accountCounts(supabase, user.id) : null;
  const emails = [...new Set((paid || []).map(p => p.teacherEmail))];
  const names = emails.length && isReviewer ? await supabase.from('teacher_accounts').select('email,full_name').in('email', emails) : null;
  const nameOf = new Map((names?.data || []).map(n => [String(n.email).toLowerCase(), n.full_name as string]));
  const titles = new Map((queue || []).map(q => [q.id, q.title]));
  const items: Item[] = [
    ...(paid || []).map((p: Attention) => ({ id: p.orderId, reason: p.reason, tone: reasonTone(p.reason), title: titles.get(p.orderId) || `Paper ${p.orderId.slice(0, 8)}`, teacher: nameOf.get(p.teacherEmail.toLowerCase()) || p.teacherEmail, school: p.school, email: p.teacherEmail,
      payment: 'Paid', mode: p.mode === 'test' ? 'Test' : 'Live', paymentIntent: p.paymentIntent, state: p.state })),
    ...(queue || []).filter(q => !(paid || []).some(p => p.orderId === q.id)).map(q => ({ id: q.id, reason: q.state === 'held' ? 'Generation held' : 'Being checked', tone: q.state === 'held' ? 'problem' as const : 'progress' as const, title: q.title || `Paper ${q.id.slice(0, 8)}`,
      teacher: '', school: '', email: '', payment: 'Not recorded here', mode: '', paymentIntent: null, state: q.state })),
  ];
  const reasons = [...new Set(items.map(i => i.reason))];
  const reason = params.reason && reasons.includes(params.reason) ? params.reason : 'all';
  const q = searchTerm(params.q).toLowerCase();
  const shown = items.filter(i => (reason === 'all' || i.reason === reason) && (!q || [i.title, i.teacher, i.school, i.email, i.id].join(' ').toLowerCase().includes(q)));
  const current = items.find(i => i.id === params.record);
  const href = (next: Partial<Params>) => { const u = new URLSearchParams(); const merged = { reason: reason === 'all' ? undefined : reason, q: q || undefined, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v); const s = u.toString(); return `/admin/papers${s ? `?${s}` : ''}`; };
  const firstName = (account.full_name || '').split(/\s+/)[0] || undefined;
  return <><StaffHeader current="papers" signedIn name={firstName} counts={{ accounts: counts?.pending ?? null, papers: items.length }} record={current ? { back: href({ focus: current.id }), label: 'Papers' } : undefined}/>
    <main className={ui['site-shell__main']}><div className={ui['page--staff']}>
    <FocusRow id={params.focus}/>
    <header className={ui['page-header--staff']}><div className={ui['page-header__titles--staff']}><h1 className={ui['page-header__title--staff']}>Papers needing attention</h1>
      <p className={ui['page-header__lede--staff']}>Paid papers that stopped or cannot continue. There is no retry or refund button here: refund in Stripe with the payment reference, or contact the teacher.</p></div></header>
    {!paid && <div className={ui['notice--caution']} role="status"><p className={ui['notice__body']}>Paid orders needing attention could not be loaded for this account. Held requests are still listed.</p></div>}
    <div className={ui['filter-bar']} role="navigation" aria-label="Filter papers">
      <Link href={href({ reason: undefined })} className={reason === 'all' ? ui['filter-chip--current'] : ui['filter-chip']} aria-current={reason === 'all' ? 'page' : undefined}>Needs attention · {items.length}</Link>
      {reasons.length > 1 && reasons.map(r => <Link key={r} href={href({ reason: r })} className={reason === r ? ui['filter-chip--current'] : ui['filter-chip']} aria-current={reason === r ? 'page' : undefined}>{r} · {items.filter(i => i.reason === r).length}</Link>)}
      <span className={ui['filter-bar__spacer']}/>
      <form className={ui['search-field']} action="/admin/papers" role="search">{reason !== 'all' && <input type="hidden" name="reason" value={reason}/>}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5"/><path d="m11 11 3.5 3.5" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round"/></svg>
        <input className={ui['search-field__input']} type="search" name="q" defaultValue={q} placeholder="Search paper, teacher or school" aria-label="Search paper, teacher or school" maxLength={80}/><button className={ui['search-field__submit']} type="submit">Search</button></form>
    </div>
    <div className={`${ui['record-layout']} ${current ? ui['record-layout--reviewing'] : ''}`}>
      <div className={ui['record-layout__list']}>
        {shown.length === 0 ? <section className={ui['empty-state']}><h2 className={ui['empty-state__title']}>{q ? 'No papers match this search' : 'No papers need attention'}</h2><p className={ui['empty-state__body']}>Paid papers that stop or cannot continue appear here.</p></section> :
        <div className={ui['record-table']} role="table" aria-label="Papers needing attention">
          <div className={ui['record-table__head']} role="row"><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--reason']}`}>Reason</span><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--primary']}`}>Paper and teacher</span><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--payment']}`}>Payment</span><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--mode']}`}>Mode</span></div>
          {shown.map(i => <Link id={`row-${i.id}`} key={i.id} role="row" href={href({ record: i.id })} scroll={false} aria-current={i.id === current?.id ? 'true' : undefined} className={i.id === current?.id ? ui['record-table__row--selected'] : ui['record-table__row']}>
            <span role="cell" className={ui['record-table__cell--reason']}><span className={ui['status']}><span className={ui[`status__dot--${i.tone}`]} aria-hidden="true"/><span className={ui[`status__label--${i.tone}`]}>{i.reason}</span></span></span>
            <span role="cell" className={ui['record-table__cell--primary']}><span className={ui['record-table__name']}>{i.title}</span><span className={ui['record-table__sub']}>{[i.teacher, i.school].filter(Boolean).join(' · ') || i.state}</span>
              <span className={ui['record-table__mobile-status']}><span className={ui['status']}><span className={ui[`status__dot--${i.tone}`]} aria-hidden="true"/><span className={ui[`status__label--${i.tone}`]}>{i.reason}</span></span></span></span>
            <span role="cell" className={`${ui['record-table__cell--payment']} ${ui['record-table__text']}`}>{i.payment}</span>
            <span role="cell" className={`${ui['record-table__cell--mode']} ${ui['record-table__text']}`}>{i.mode}</span>
            <span className={ui['record-table__cell--chevron']} aria-hidden="true">›</span>
          </Link>)}
        </div>}
      </div>
      {current && <aside className={ui['record-panel']} aria-labelledby="paper-record-title"><RecordKeys closeHref={href({ focus: current.id })}/>
        <div className={ui['record-panel__header']}><div className={ui['record-panel__titles']}><p className={ui['record-panel__eyebrow']}>Paper record</p><h2 id="paper-record-title" tabIndex={-1} className={ui['record-panel__title']}>{current.title}</h2>
          <p className={ui['status']}><span className={ui[`status__dot--${current.tone}`]} aria-hidden="true"/><span className={ui[`status__label--${current.tone}`]}>{current.reason}{current.state === 'held' ? ' · no partial documents released' : ''}</span></p></div>
          <Link className={ui['record-panel__close']} href={href({ focus: current.id })} scroll={false} aria-label="Close paper record"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></Link></div>
        <div className={ui['record-panel__body']}>
          <dl className={ui['key-value-list__rows']}>{([['Teacher', [current.teacher !== current.email ? current.teacher : '', current.email].filter(Boolean).join(' · ')], ['School', current.school], ['Payment', [current.payment, current.mode && `Stripe ${current.mode.toLowerCase()} mode`].filter(Boolean).join(' · ')], ['Payment reference', current.paymentIntent || (current.mode ? 'Reference pending' : '')], ['Order reference', current.id], ['Order state', current.state]] as const)
            .filter(([, v]) => v).map(([k, v]) => <div key={k} className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>{k}</dt><dd className={k === 'Order reference' ? ui['key-value-list__value--subtle'] : ui['key-value-list__value']}>{v}</dd></div>)}</dl>
          <div className={ui['notice--neutral']}><p className={ui['notice__title--compact']}>What you can do</p><p className={ui['notice__body']}>Contact the teacher, or refund in Stripe using the payment reference. A full refund recorded by Stripe closes the paper automatically. This page cannot approve, restart or refund.</p></div>
          <div className={ui['record-panel__actions']}>{current.email && <a className={ui['button--secondary']} href={`mailto:${current.email}?subject=${encodeURIComponent('Your Revise It paper ' + current.id.slice(0, 8))}`}>Email teacher</a>}
            {current.paymentIntent && <CopyReference value={current.paymentIntent}/>}</div>
        </div>
      </aside>}
    </div>
  </div></main></>;
}
