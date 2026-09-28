import Link from 'next/link';
import { requireReviewer } from '../../../../lib/auth/access';
import { StaffHeader } from '../../staff-header';
import { accountCounts, accountFilters, isFilter, papersNeedingAttention, searchTerm, statusLabels, type AccountStatus } from '../data';
import { AddDepartment, FocusRow, ReviewPanel } from './review';
import ui from '../../experience.module.css';

/**
 * School accounts (Paper S3, S4, S6, S7p, S8p). The queue is filtered and searched on the
 * server; selecting a row opens the review panel beside it (a sheet on tablets and its
 * own page on phones). The decision itself is the existing `review_teacher_account` call.
 */
type Row = { user_id:string; email:string; full_name:string; requested_school:string; requested_department:string; status:AccountStatus; school_id:string|null; department_id:string|null; revision:number; email_confirmed_at:string|null };
type Params = { page?:string; status?:string; q?:string; review?:string; focus?:string; add?:string };
export default async function ReviewAccounts({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const requested = Number(params.page || 1);
  const currentPage = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const offset = (currentPage - 1) * 50, filter = isFilter(params.status) ? params.status : 'pending', q = searchTerm(params.q);
  const { supabase, user, account } = await requireReviewer();
  let list = supabase.from('teacher_accounts').select('*', { count: 'exact' }).neq('user_id', user.id);
  if (filter !== 'all') list = list.eq('status', filter);
  if (q) list = list.or(['full_name','email','requested_school'].map(c => `${c}.ilike."*${q}*"`).join(','));
  const selected = params.review && /^[0-9a-f-]{36}$/i.test(params.review) ? params.review : null;
  const [accountsResult, departmentsResult, schoolsResult, counts, papers, reviewing] = await Promise.all([
    list.order('created_at', { ascending: false }).order('user_id').range(offset, offset + 49),
    supabase.from('departments').select('id,school_id,name').order('name'),
    supabase.from('schools').select('id,name').order('name'),
    accountCounts(supabase, user.id),
    papersNeedingAttention(supabase),
    selected ? supabase.from('teacher_accounts').select('*').eq('user_id', selected).neq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const failed = !!(accountsResult.error || departmentsResult.error || schoolsResult.error);
  const schools = new Map((schoolsResult.data || []).map(s => [s.id, s.name]));
  const departments = (departmentsResult.data || []).map(d => ({ id: d.id, label: `${schools.get(d.school_id) ?? 'Unknown school'} · ${d.name}` }));
  const departmentName = new Map((departmentsResult.data || []).map(d => [d.id, d.name]));
  const rows = (accountsResult.data || []) as Row[];
  const current = reviewing.data as Row | null;
  const paperCount = papers.paid ? papers.paid.length + (papers.queue || []).filter(x => !papers.paid!.some(p => p.orderId === x.id)).length : null;
  const href = (next: Partial<Params>) => { const u = new URLSearchParams(); const merged = { status: filter === 'pending' ? undefined : filter, q: q || undefined, page: currentPage > 1 ? String(currentPage) : undefined, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v); const s = u.toString(); return `/admin/accounts${s ? `?${s}` : ''}`; };
  const pendingIds = rows.filter(r => r.status === 'pending').map(r => r.user_id);
  const nextId = current ? pendingIds.find(id => id !== current.user_id && pendingIds.indexOf(id) > pendingIds.indexOf(current.user_id)) ?? pendingIds.find(id => id !== current.user_id) : undefined;
  const position = current ? `${rows.findIndex(r => r.user_id === current.user_id) + 1} of ${rows.length}` : undefined;
  const firstName = (account.full_name || '').split(/\s+/)[0] || undefined;
  return <><StaffHeader current="accounts" signedIn name={firstName} counts={{ accounts: counts?.pending ?? null, papers: paperCount }}
      record={current ? { back: href({ focus: current.user_id }), label: 'School accounts', position: position && !position.startsWith('0') ? position : undefined } : undefined}/>
    <main className={ui['site-shell__main']}><div className={ui['page--staff']}>
    <FocusRow id={params.focus}/>
    <header className={ui['page-header--staff']}>
      <div className={ui['page-header__titles--staff']}><h1 className={ui['page-header__title--staff']}>School accounts</h1>
        <p className={ui['page-header__lede--staff']}>Verify each teacher's school independently. An email domain alone is not enough. Every decision records you, the time and your evidence.</p></div>
      <AddDepartment open={params.add === '1'}/>
    </header>
    <div className={ui['filter-bar']} role="navigation" aria-label="Filter school accounts">
      {accountFilters.filter(f => f.key === 'pending' || f.key === 'all' || (counts && counts[f.key] > 0)).map(f => <Link key={f.key} href={href({ status: f.key === 'pending' ? undefined : f.key, page: undefined, review: undefined })} className={f.key === filter ? ui['filter-chip--current'] : ui['filter-chip']} aria-current={f.key === filter ? 'page' : undefined}>
        {f.label}{counts ? ` · ${counts[f.key]}` : ''}</Link>)}
      <span className={ui['filter-bar__spacer']}/>
      <form className={ui['search-field']} action="/admin/accounts" role="search">
        {filter !== 'pending' && <input type="hidden" name="status" value={filter}/>}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5"/><path d="m11 11 3.5 3.5" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round"/></svg>
        <input className={ui['search-field__input']} type="search" name="q" defaultValue={q} placeholder="Search name, email or school" aria-label="Search name, email or school" maxLength={80}/>
        <button className={ui['search-field__submit']} type="submit">Search</button>
      </form>
    </div>
    {failed ? <div className={ui['notice--problem']} role="alert"><p className={ui['notice__title--compact']}>We could not load accounts</p><p className={ui['notice__body']}>Nothing was changed. Refresh to try again.</p></div> :
    <div className={`${ui['record-layout']} ${current ? ui['record-layout--reviewing'] : ''}`}>
      <div className={ui['record-layout__list']}>
        {rows.length === 0 ? <section className={ui['empty-state']}><h2 className={ui['empty-state__title']}>{q ? 'No accounts match this search' : filter === 'pending' ? 'No accounts need a decision' : 'No accounts in this group'}</h2>
          <p className={ui['empty-state__body']}>{q ? 'Try a different name, email address or school.' : 'New registrations appear here as soon as they are created.'}</p>
          {filter === 'pending' && !q && <Link className={ui['button--secondary']} href={href({ status: 'approved' })}>Show verified accounts</Link>}</section> :
        <div className={ui['record-table']} role="table" aria-label="School accounts">
          <div className={ui['record-table__head']} role="row"><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--primary']}`}>Teacher</span><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--school']}`}>School and department</span><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--email']} ${ui['record-table__heading--email']}`}>Email</span><span role="columnheader" className={`${ui['record-table__heading']} ${ui['record-table__cell--status']}`}>Status</span></div>
          {rows.map(a => { const s = statusLabels[a.status]; const selectedRow = a.user_id === current?.user_id;
            return <Link id={`row-${a.user_id}`} key={a.user_id} role="row" href={href({ review: a.user_id })} scroll={false} aria-current={selectedRow ? 'true' : undefined} className={selectedRow ? ui['record-table__row--selected'] : ui['record-table__row']}>
              <span role="cell" className={ui['record-table__cell--primary']}><span className={ui['record-table__name']}>{a.full_name || 'School details incomplete'}</span><span className={ui['record-table__sub']}>{a.email}</span>
                <span className={ui['record-table__sub']}>{a.requested_school} · {a.requested_department}</span>
                <span className={ui['record-table__mobile-status']}><span className={ui['status']}><span className={ui[`status__dot--${s.tone}`]} aria-hidden="true"/><span className={ui[`status__label--${s.tone}`]}>{s.label} · email {a.email_confirmed_at ? 'confirmed' : 'not confirmed'}</span></span></span></span>
              <span role="cell" className={ui['record-table__cell--school']}><span className={ui['record-table__text']}>{a.school_id ? schools.get(a.school_id) ?? a.requested_school : a.requested_school}</span><span className={ui['record-table__sub']}>{a.department_id ? departmentName.get(a.department_id) ?? a.requested_department : a.requested_department}</span></span>
              <span role="cell" className={`${ui['record-table__cell--email']} ${a.email_confirmed_at ? ui['record-table__text'] : ui['record-table__text--caution']}`}>{a.email_confirmed_at ? 'Confirmed' : 'Not confirmed'}</span>
              <span role="cell" className={ui['record-table__cell--status']}><span className={ui['status']}><span className={ui[`status__dot--${s.tone}`]} aria-hidden="true"/><span className={ui[`status__label--${s.tone}`]}>{s.label}</span></span></span>
              <span className={ui['record-table__cell--chevron']} aria-hidden="true">›</span>
            </Link>; })}
        </div>}
        <nav className={ui['pagination']} aria-label="Account review pages">{currentPage > 1 && <Link href={href({ page: String(currentPage - 1) })}>Previous page</Link>}{(accountsResult.count || 0) > offset + 50 && <Link href={href({ page: String(currentPage + 1) })}>Next page</Link>}</nav>
      </div>
      {current && <ReviewPanel key={current.user_id} account={{ ...current, schoolName: current.school_id ? schools.get(current.school_id) : undefined }} departments={departments}
        closeHref={href({ focus: current.user_id })} nextHref={nextId ? href({ review: nextId }) : undefined} statusLabel={statusLabels[current.status].label}/>}
      {selected && !current && <aside className={ui['record-panel']}><div className={ui['record-panel__body']}><div className={ui['notice--neutral']} role="status"><p className={ui['notice__body']}>This account is not available to review. It may be your own account or no longer exist.</p></div><Link className={ui['link']} href={href({})}>Back to school accounts</Link></div></aside>}
    </div>}
  </div></main></>;
}
