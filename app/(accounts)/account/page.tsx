import Link from 'next/link';
import { requireAccount } from '../../../lib/auth/access';
import { canEnterWorkspace } from '../../../lib/auth/policy';
import { TeacherHeader } from '../shell';
import { logout } from '../actions';
import AccountDetails, { ResendConfirmation } from './details';
import ui from '../experience.module.css';

/**
 * My account (Paper T3, T4). One page says where access stands and the one action
 * available. Access is decided by the server (`canEnterWorkspace`), never by this page.
 */
type Tone = 'done'|'progress'|'attention'|'problem';
type Access = { tone:Tone; marker:string; title:string; body:string; step:number };
const Tick = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const path = ['Account created','Email confirmed','School verified','Curricula open'];
export default async function Account() {
  const { account, user, supabase } = await requireAccount();
  const confirmed = !!user.email_confirmed_at;
  const approved = canEnterWorkspace(account, user.email || '', confirmed);
  const [{ data: reviewer }, school, department] = await Promise.all([
    supabase.rpc('is_account_reviewer'),
    account.school_id ? supabase.from('schools').select('name').eq('id', account.school_id).maybeSingle() : Promise.resolve({ data: null }),
    account.department_id ? supabase.from('departments').select('name').eq('id', account.department_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const access: Access = !confirmed ? { tone:'attention', marker:'Waiting for you', title:'Confirm your school email', body:`Open the link we sent to ${user.email}. Our team can only verify your school after that.`, step:1 }
    : approved ? { tone:'done', marker:'Access verified', title:'Your school account is verified', body:"Your department's curricula are open. Build a paper from My curricula, and follow every paper in My papers.", step:4 }
    : account.status === 'rejected' ? { tone:'problem', marker:'Not verified', title:'We could not verify your account', body:'If you think this is a mistake, email kahueka@reviseit.io from your school address and we will look again.', step:2 }
    : account.status === 'suspended' ? { tone:'problem', marker:'Paused', title:'Your account access is paused', body:'Your curricula and papers are unavailable while access is paused. Email kahueka@reviseit.io to resolve it.', step:2 }
    // Pending, or approved but not yet linked to a verified school and department.
    : { tone:'progress', marker:'With our team', title:'Your account is awaiting verification', body:'We check your school and department independently before opening any curricula. Nothing more is needed from you. Questions: kahueka@reviseit.io.', step:2 };
  const stopped = access.tone === 'problem';
  const schoolName = (school.data as { name?: string } | null)?.name, departmentName = (department.data as { name?: string } | null)?.name;
  return <><TeacherHeader current="account" name={account.full_name} verified={approved}/><main className={ui['site-shell__main']}><div className={ui['page']}>
    <header className={ui['page-header']}><div className={ui['page-header__titles']}>
      <p className={ui['page-header__eyebrow']}>My account</p>
      <h1 className={ui['page-header__title']}>{account.full_name || 'Your account'}</h1>
      <p className={ui['page-header__lede']}>{[approved ? departmentName ?? account.requested_department : account.requested_department, approved ? schoolName ?? account.requested_school : account.requested_school].filter(Boolean).join(' · ')}</p>
    </div></header>
    <div className={ui['page-columns']}>
      <section className={ui['access-status']} aria-labelledby="access-title">
        <div className={ui['access-status__heading']}>
          <p className={ui['access-status__marker']}><span className={ui[`status__dot--${access.tone}`]} aria-hidden="true"/><span className={ui[`status__label--${access.tone}`]}>{access.marker}</span></p>
          <h2 id="access-title" className={ui['access-status__title']}>{access.title}</h2>
          <p className={ui['access-status__body']}>{access.body}</p>
        </div>
        {!stopped && <ol className={ui['access-path']} aria-label="Access progress">{path.map((label, i) => {
          const state = i < access.step ? 'done' : i === access.step ? 'current' : 'next';
          return <li key={label} className={ui['access-path__step']} aria-current={state === 'current' ? 'step' : undefined}>
            <span className={ui['access-path__track']}><span className={ui[`access-path__marker--${state}`]}>{state === 'done' && <Tick/>}</span>{i < path.length - 1 && <span className={i + 1 < access.step ? ui['access-path__line--done'] : ui['access-path__line']} aria-hidden="true"/>}</span>
            <span className={state === 'next' ? ui['access-path__label--next'] : ui['access-path__label']}>{label}<span className="visually-hidden">{state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : ''}</span></span>
          </li>; })}</ol>}
        <div className={ui['button-row']}>
          {approved && <><a className={ui['button--primary']} href="/teacher?view=home">Go to My curricula →</a><Link className={ui['button--secondary']} href="/teacher/orders">My papers</Link></>}
          {!confirmed && <ResendConfirmation email={user.email || ''}/>}
          {stopped && <a className={ui['button--secondary']} href="mailto:kahueka@reviseit.io">Email kahueka@reviseit.io</a>}
        </div>
      </section>
      <aside className={ui['page-columns__aside--wide']}>
        <section className={ui['aside-card']} aria-labelledby="details-title">
          <h2 id="details-title" className={ui['aside-card__title']}>Your details</h2>
          <dl className={ui['key-value-list__rows']}>
            <div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>Email</dt><dd className={ui['key-value-list__value']}>{user.email}</dd></div>
            <div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>{approved ? 'Verified school' : 'School given'}</dt><dd className={ui['key-value-list__value']}>{approved ? schoolName ?? account.requested_school : account.requested_school}</dd></div>
            <div className={ui['key-value-list__row']}><dt className={ui['key-value-list__key']}>Department</dt><dd className={ui['key-value-list__value']}>{approved ? departmentName ?? account.requested_department : account.requested_department}</dd></div>
          </dl>
          {['pending','approved'].includes(account.status) && <AccountDetails account={account}/>}
        </section>
        {reviewer === true && <section className={ui['aside-card--staff']} aria-labelledby="staff-title">
          <h2 id="staff-title" className={ui['aside-card__heading']}>You also have staff access</h2>
          <p className={ui['aside-card__body']}>Staff work happens in the separate Revise It admin workspace. Teachers never see this panel.</p>
          <div><Link className={ui['button--secondary']} href="/admin">Open admin workspace</Link></div>
        </section>}
        <form action={logout}><button className={ui['button--text']}>Sign out</button></form>
      </aside>
    </div>
  </div></main></>;
}
