'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { useId, type ReactNode } from 'react';
import type { FormState } from './actions';
import styles from './accounts.module.css';
export function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className={styles.button} disabled={pending} type="submit">{pending ? 'Please wait…' : label}</button>;
}
export function AccountForm({ action, label, children }: { action: (state: FormState, data: FormData) => Promise<FormState>; label: string; children: ReactNode }) {
  const [state, formAction] = useFormState(action, { message: '' });
  return <form action={formAction} className={styles.form}>
    {children}
    {state.message && <p className={state.success ? styles.success : styles.error} role={state.success ? 'status' : 'alert'}>{state.message}</p>}
    <Submit label={label} />
  </form>;
}
export function EmailField({ value }: { value?: string }) {
  return <label>School email address<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={value} /></label>;
}
export function PasswordField({ newPassword = false }: { newPassword?: boolean }) {
  const hintId = useId();
  return <><label>Password<input aria-describedby={newPassword ? hintId : undefined} name="password" type="password" autoComplete={newPassword ? 'new-password' : 'current-password'} required minLength={newPassword ? 12 : undefined} maxLength={128} /></label>{newPassword && <small id={hintId}>Use at least 12 characters.</small>}</>;
}
export function SchoolFields({ account }: { account?: { full_name: string; requested_school: string; requested_department: string } }) {
  return <>
    <label>Your full name<input name="full_name" autoComplete="name" required minLength={2} maxLength={160} defaultValue={account?.full_name} /></label>
    <label>School name<input name="school" autoComplete="organization" required minLength={2} maxLength={160} defaultValue={account?.requested_school} /></label>
    <label>Department<input name="department" placeholder="For example, Physical Sciences" required minLength={2} maxLength={160} defaultValue={account?.requested_department} /></label>
  </>;
}
