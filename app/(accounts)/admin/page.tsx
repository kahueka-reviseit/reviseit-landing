import Link from 'next/link';
import { requireReviewer } from '../../../lib/auth/access';
import { StaffHeader } from '../staff-header';
import { accountCounts, emailKindLabels, emailNeedsLook, emailNotifications, emailStatusLabels, papersNeedingAttention, reasonTone } from './data';
import ui from '../experience.module.css';
export const dynamic='force-dynamic';

/** Staff overview (Paper S2): the two existing queues, at most five rows each. */
function greeting(){const h=Number(new Intl.DateTimeFormat('en-ZA',{hour:'numeric',hourCycle:'h23',timeZone:'Africa/Johannesburg'}).format(new Date()));return h<12?'Good morning':h<17?'Good afternoon':'Good evening';}
export default async function Administration() {
  const { supabase, user, account } = await requireReviewer();
  const [counts, pending, { paid, queue }, emails] = await Promise.all([
    accountCounts(supabase, user.id),
    supabase.from('teacher_accounts').select('user_id,full_name,requested_school,email_confirmed_at').neq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
    papersNeedingAttention(supabase),
    emailNotifications(supabase),
  ]);
  const emailProblems = (emails || []).filter(emailNeedsLook);
  const papers = [...(paid || []).map(p => ({ id: p.orderId, title: queue?.find(q => q.id === p.orderId)?.title || `Paper ${p.orderId.slice(0, 8)}`, reason: p.reason })),
    ...(queue || []).filter(q => !(paid || []).some(p => p.orderId === q.id)).map(q => ({ id: q.id, title: q.title, reason: q.state === 'held' ? 'Generation held' : 'Being checked' }))];
  const first = (account.full_name || '').split(/\s+/)[0];
  const accountsWaiting = counts?.pending ?? null, papersWaiting = paid || queue ? papers.length : null;
  return <><StaffHeader current="overview" signedIn name={first || undefined} counts={{ accounts: accountsWaiting, papers: papersWaiting }}/>
    <main className={ui['site-shell__main']}><div className={ui['page--staff']}>
    <header className={ui['page-header--staff']}><div className={ui['page-header__titles--staff']}><h1 className={ui['page-header__title--staff']}>{greeting()}{first ? `, ${first}` : ''}</h1>
      <p className={ui['page-header__lede--staff']}>{accountsWaiting === 0 && papersWaiting === 0 ? 'Nothing needs you right now.' : 'Two queues wait for a person. Start with whichever has work.'}</p></div></header>
    <div className={ui['queue-grid']}>
      <section className={ui['queue-card']} aria-labelledby="accounts-queue"><h2 id="accounts-queue" className={ui['queue-card__label']}>School accounts</h2>
        <p className={ui['queue-card__count']}><span className={ui['queue-card__number']}>{accountsWaiting ?? '—'}</span><span className={ui['queue-card__caption']}>{accountsWaiting === null ? 'count unavailable' : 'need a decision'}</span></p>
        {pending.error ? <p className={ui['queue-card__more']} role="status">Accounts could not be loaded. Nothing was changed.</p> :
        <ul className={ui['queue-card__list']}>{(pending.data || []).map(a => <li key={a.user_id} className={ui['queue-card__item']}><Link className={ui['link']} href={`/admin/accounts?review=${a.user_id}`}>{a.full_name || 'School details incomplete'}</Link>
          <span className={a.email_confirmed_at ? ui['queue-card__item-note'] : ui['queue-card__item-note--caution']}>{a.email_confirmed_at ? a.requested_school : 'Email not confirmed'}</span></li>)}</ul>}
        {(accountsWaiting ?? 0) > 5 && <p className={ui['queue-card__more']}>and {(accountsWaiting ?? 0) - 5} more</p>}
        <div><Link className={ui['button--inverse']} href="/admin/accounts">Review accounts →</Link></div></section>
      <section className={ui['queue-card']} aria-labelledby="papers-queue"><h2 id="papers-queue" className={ui['queue-card__label']}>Papers</h2>
        <p className={ui['queue-card__count']}><span className={papersWaiting ? ui['queue-card__number--problem'] : ui['queue-card__number']}>{papersWaiting ?? '—'}</span><span className={ui['queue-card__caption']}>{papersWaiting === null ? 'count unavailable' : 'need attention'}</span></p>
        <ul className={ui['queue-card__list']}>{papers.slice(0, 5).map(p => <li key={p.id} className={ui['queue-card__item']}><Link className={ui['link']} href={`/admin/papers?record=${p.id}`}>{p.title}</Link><span className={reasonTone(p.reason) === 'problem' ? ui['queue-card__item-note--problem'] : ui['queue-card__item-note--caution']}>{p.reason}</span></li>)}</ul>
        {papers.length > 5 && <p className={ui['queue-card__more']}>and {papers.length - 5} more</p>}
        <div><Link className={ui['button--inverse']} href="/admin/papers">Open papers →</Link></div></section>
    </div>
    {emails && emails.length > 0 && <section className={ui['queue-card']} aria-labelledby="email-queue"><h2 id="email-queue" className={ui['queue-card__label']}>Email to teachers</h2>
      <p className={ui['queue-card__more']}>{emailProblems.length === 0 ? `No delivery problems in the last ${emails.length} messages. Delivered means the school's mail server accepted it, not that it was read.` : `${emailProblems.length} ${emailProblems.length === 1 ? 'message needs' : 'messages need'} a look. A failed email never holds a paper; the teacher can still open it from My papers.`}</p>
      {emailProblems.length > 0 && <ul className={ui['queue-card__list']}>{emailProblems.slice(0, 5).map(e => <li key={e.id} className={ui['queue-card__item']}>
        {e.orderId ? <Link className={ui['link']} href={`/admin/papers?record=${e.orderId}`}>{emailKindLabels[e.kind]}</Link> : <span>{emailKindLabels[e.kind]}</span>}
        <span className={emailStatusLabels[e.status]?.tone === 'problem' ? ui['queue-card__item-note--problem'] : ui['queue-card__item-note--caution']}>{emailStatusLabels[e.status]?.label || e.status} · {e.recipient}</span></li>)}</ul>}
    </section>}
  </div></main></>;
}
