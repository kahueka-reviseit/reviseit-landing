'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { FormState } from './actions';
import ui from './experience.module.css';

/**
 * Account form parts (Paper T1, T2, S4). Every form posts to the existing server
 * action; the reply decides the notice and which field, if any, is marked invalid.
 */
type Action = (state: FormState, data: FormData) => Promise<FormState>;
export function Submit({ label, pending: pendingLabel = 'Please wait…', variant = 'primary' }: { label: string; pending?: string; variant?: 'primary'|'inverse'|'secondary'|'compact' }) {
  const { pending } = useFormStatus();
  return <button className={variant === 'compact' ? ui['button--primary'] : ui[`button--${variant}-large`]} disabled={pending} type="submit">{pending ? pendingLabel : label}</button>;
}
function Reply({ state }: { state: FormState }) {
  if (!state.message || state.field) return null;
  return <div className={state.success ? ui['notice--success'] : ui['notice--problem']} role={state.success ? 'status' : 'alert'}>
    {state.title && <p className={ui['notice__title--compact']}>{state.title}</p>}<p className={ui['notice__body']}>{state.message}</p></div>;
}
/** A form whose reply shows above its fields. `done` replaces the form after success. */
export function AccountForm({ action, label, children, submit, done }: { action: Action; label: string; children: ReactNode | ((state: FormState) => ReactNode); submit?: 'primary'|'inverse'|'secondary'|'compact'; done?: (state: FormState) => ReactNode }) {
  const [state, formAction] = useFormState(action, { message: '' });
  if (state.success && done) return <>{done(state)}</>;
  return <form action={formAction} className={ui['form']} noValidate={false}>
    <Reply state={state} />
    {typeof children === 'function' ? children(state) : children}
    <Submit label={label} variant={submit} />
  </form>;
}
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className={ui['field__error']}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M8 4.5v4.2M8 10.8v.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>{message}</p>;
}
export function TextField({ label, name, error, hint, trailing, className, ...input }: { label: string; name: string; error?: string; hint?: ReactNode; trailing?: ReactNode; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId(), errorId = `${id}-error`, hintId = `${id}-hint`;
  const described = [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined;
  return <div className={className ?? ui['field']}>
    <div className={ui['field__label-row']}><label className={ui['field__label']} htmlFor={id}>{label}</label>{trailing}</div>
    <input id={id} name={name} className={error ? ui['field__input--invalid'] : ui['field__input']} aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
    <FieldError id={errorId} message={error} />
    {hint && <p id={hintId} className={ui['field__hint']}>{hint}</p>}
  </div>;
}
export function EmailField({ value, error, label = 'School email address', placeholder }: { value?: string; error?: string; label?: string; placeholder?: string }) {
  return <TextField label={label} name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={value} error={error} placeholder={placeholder} />;
}
/** Password with a Show control. New passwords state the 12-character rule. */
export function PasswordField({ newPassword = false, label = 'Password', name = 'password', error, trailing, resetKey }: { newPassword?: boolean; label?: string; name?: string; error?: string; trailing?: ReactNode; resetKey?: unknown }) {
  const id = useId(), [shown, setShown] = useState(false), ref = useRef<HTMLInputElement>(null);
  const described = [error ? `${id}-error` : '', newPassword ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  // After a refused sign-in the password is cleared and receives focus (T2 B).
  useEffect(() => { if (resetKey && ref.current) { ref.current.value = ''; ref.current.focus(); } }, [resetKey]);
  return <div className={ui['field']}>
    <div className={ui['field__label-row']}><label className={ui['field__label']} htmlFor={id}>{label}</label>{trailing}</div>
    <div className={ui['field__password']}>
      <input ref={ref} id={id} name={name} type={shown ? 'text' : 'password'} className={error ? ui['field__input--invalid'] : ui['field__input']} aria-invalid={error ? true : undefined} aria-describedby={described}
        autoComplete={newPassword ? 'new-password' : 'current-password'} required minLength={newPassword ? 12 : undefined} maxLength={128} />
      <button type="button" className={ui['field__toggle']} aria-controls={id} aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}<span className="visually-hidden"> {label.toLowerCase()}</span></button>
    </div>
    <FieldError id={`${id}-error`} message={error} />
    {newPassword && <p id={`${id}-hint`} className={ui['field__hint']}>Use at least 12 characters.</p>}
  </div>;
}
export function SchoolFields({ account, error }: { account?: { full_name: string; requested_school: string; requested_department: string }; error?: string }) {
  return <>
    <TextField label="Your full name" name="full_name" autoComplete="name" required minLength={2} maxLength={160} defaultValue={account?.full_name} error={error} />
    <div className={ui['form__row']}>
      <TextField label="School" name="school" autoComplete="organization" required minLength={2} maxLength={160} defaultValue={account?.requested_school} />
      <TextField className={ui['field--narrow']} label="Department" name="department" placeholder="Physical Sciences" required minLength={2} maxLength={160} defaultValue={account?.requested_department} />
    </div>
  </>;
}
/** Collapsible secondary form, for example "Resend the confirmation email". */
export function Disclosure({ summary, children, open }: { summary: string; children: ReactNode; open?: boolean }) {
  return <details className={ui['disclosure']} open={open}><summary className={ui['disclosure__summary']}>{summary}</summary><div className={ui['disclosure__body']}>{children}</div></details>;
}
