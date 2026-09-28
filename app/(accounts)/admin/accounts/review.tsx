'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Submit, TextField } from '../../forms';
import { registerDepartment, reviewAccount } from '../../actions';
import ui from '../../experience.module.css';

/**
 * Review panel (Paper S3, S4, S6, S8p). No decision is preselected: the reviewer must
 * choose Approve, Reject or Suspend access every time. Approve is unavailable, with the
 * reason, until the teacher has confirmed their email. The server repeats every rule.
 */
type Account = { user_id:string; email:string; full_name:string; requested_school:string; requested_department:string; revision:number; department_id:string|null; email_confirmed_at:string|null; schoolName?:string };
export function ReviewPanel({account,departments,closeHref,nextHref,statusLabel}:{account:Account;departments:{id:string;label:string}[];closeHref:string;nextHref?:string;statusLabel:string}) {
  const [state, action] = useFormState(reviewAccount, { message: '' });
  const [decision, setDecision] = useState('');
  const router = useRouter(), title = useRef<HTMLHeadingElement>(null), notice = useRef<HTMLDivElement>(null), id = useId();
  const confirmed = !!account.email_confirmed_at;
  // Opening a record moves focus to its heading; Escape returns to the queue and its row.
  useEffect(() => { title.current?.focus(); }, [account.user_id]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLSelectElement)) router.push(closeHref, { scroll: false }); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [closeHref, router]);
  useEffect(() => { if (state.message) notice.current?.focus(); }, [state]);
  return <aside className={ui['record-panel']} aria-labelledby={`${id}-title`}>
    <div className={ui['record-panel__header']}>
      <div className={ui['record-panel__titles']}><p className={ui['record-panel__eyebrow']}>Review account</p>
        <h2 ref={title} tabIndex={-1} id={`${id}-title`} className={ui['record-panel__title']}>{account.full_name || 'School details incomplete'}</h2>
        <p className={ui['record-panel__meta']}>{account.email} · email {confirmed ? 'confirmed' : 'not confirmed'}</p></div>
      <Link className={ui['record-panel__close']} href={closeHref} scroll={false} aria-label="Close review panel"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></Link>
    </div>
    {state.success ? <div className={ui['record-panel__body']}>
      <div ref={notice} tabIndex={-1} className={ui['notice--success']} role="status"><p className={ui['notice__title--compact']}>{state.title} · {account.full_name}</p><p className={ui['notice__body']}>{state.message} The queue has been refreshed.</p></div>
      <div className={ui['record-panel__actions']}>{nextHref ? <Link className={ui['button--primary']} href={nextHref} scroll={false}>Next account needing a decision</Link> : <p className={ui['record-panel__footnote']}>No other account in this list needs a decision.</p>}
        <Link className={ui['button--text']} href={closeHref} scroll={false}>Back to school accounts</Link></div>
    </div> :
    <form action={action} className={ui['record-panel__form']}>
      <input type="hidden" name="user_id" value={account.user_id}/><input type="hidden" name="revision" value={account.revision}/>
      <div className={ui['record-panel__body']}>
        {state.message && <div ref={notice} tabIndex={-1} className={ui['notice--problem']} role="alert"><p className={ui['notice__title--compact']}>{state.title ?? 'The decision was not saved'}</p><p className={ui['notice__body']}>{state.message}</p></div>}
        <dl className={ui['record-panel__facts']}>
          <div className={ui['record-panel__fact']}><dt className={ui['record-panel__fact-key']}>School given</dt><dd className={ui['record-panel__fact-value']}>{account.requested_school}</dd></div>
          <div className={ui['record-panel__fact']}><dt className={ui['record-panel__fact-key']}>Department given</dt><dd className={ui['record-panel__fact-value']}>{account.requested_department}</dd></div>
          <div className={ui['record-panel__fact']}><dt className={ui['record-panel__fact-key']}>Current access</dt><dd className={ui['record-panel__fact-value--caution']}>{statusLabel}</dd></div>
          {account.schoolName && <div className={ui['record-panel__fact']}><dt className={ui['record-panel__fact-key']}>Verified school</dt><dd className={ui['record-panel__fact-value']}>{account.schoolName}</dd></div>}
        </dl>
        <fieldset className={ui['choice-group']} aria-describedby={confirmed ? undefined : `${id}-approve`}>
          <legend className={ui['segmented-control__legend']}>Decision</legend><div className={`${ui['segmented-control']} ${ui['segmented-control--stack']}`}>
          {([['approved','Approve'],['rejected','Reject'],['suspended','Suspend access']] as const).map(([value, label]) =>
            <label key={value} className={ui['segmented-control__option']}><input className={ui['segmented-control__input']} type="radio" name="decision" value={value} required checked={decision === value} disabled={value === 'approved' && !confirmed} onChange={() => setDecision(value)}/><span className={ui['segmented-control__radio']} aria-hidden="true"/>{label}</label>)}
        </div></fieldset>
        {!confirmed && <p id={`${id}-approve`} className={ui['aside-card__note']}>Approve is unavailable: the teacher has not confirmed their email yet.</p>}
        <div className={ui['field']}><label className={ui['field__label']} htmlFor={`${id}-department`}>Verified school and department</label>
          <select id={`${id}-department`} name="department_id" className={ui['field__select--staff']} defaultValue={account.department_id || ''} aria-describedby={`${id}-department-hint`}>
            <option value="">Required for approval</option>{departments.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
          <p id={`${id}-department-hint`} className={ui['field__hint--staff']}>Required to approve. Not listed? Add a verified school department first.</p></div>
        <div className={ui['field']}><label className={ui['field__label']} htmlFor={`${id}-note`}>Evidence or reason</label>
          <textarea id={`${id}-note`} name="note" className={ui['field__textarea']} required minLength={3} maxLength={2000} placeholder="Required for every decision"/></div>
      </div>
      <div className={ui['record-panel__footer']}><p className={ui['record-panel__footnote']}>Recorded with your name and the time</p><Submit label="Save decision" pending="Saving…" variant="compact"/></div>
    </form>}
  </aside>;
}

/** Add a verified school department (S4 F), in a disclosure beside the page heading. */
export function AddDepartment({open}:{open:boolean}) {
  const [shown, setShown] = useState(open);
  const [state, action] = useFormState(registerDepartment, { message: '' });
  if (!shown) return <button type="button" className={ui['button--secondary']} onClick={() => setShown(true)} aria-expanded={false}>+ Add a verified school department</button>;
  return <section className={ui['aside-card--form']} aria-label="Add a verified school department">
    <div className={ui['aside-card__header']}><h2 className={ui['aside-card__heading']}>Add a verified school department</h2>
      <button type="button" className={ui['record-panel__close']} aria-label="Close" onClick={() => setShown(false)}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></div>
    <form action={action} className={ui['form']}>
      {state.message && <div className={state.success ? ui['notice--success'] : ui['notice--problem']} role={state.success ? 'status' : 'alert'}><p className={ui['notice__body']}>{state.message}</p></div>}
      <TextField label="Full school name" name="school" required minLength={2} maxLength={160}/>
      <TextField label="School identifier" name="slug" required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="full-canonical-school-name" hint="The full school name, slugified. Never initials."/>
      <TextField label="Department" name="department" required minLength={2} maxLength={160}/>
      <div><Submit label="Add department" variant="compact"/></div>
    </form>
  </section>;
}

/** After closing a record, return keyboard focus to its row in the queue. */
export function FocusRow({id}:{id?:string}) {
  useEffect(() => { if (id) document.getElementById(`row-${id}`)?.focus(); }, [id]);
  return null;
}
