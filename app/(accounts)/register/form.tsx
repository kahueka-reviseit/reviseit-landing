'use client';
import Link from 'next/link';
import { AccountForm, EmailField, PasswordField, SchoolFields } from '../forms';
import { register } from '../actions';
import ui from '../experience.module.css';
/** T1 form; after success it becomes the T2 C "Check your school inbox" card. */
export default function RegisterForm() {
  return <AccountForm action={register} label="Create account" done={state=><div className={ui['form']} role="status">
    <span className={ui['form-card__icon']} aria-hidden="true"><svg width="20" height="16" viewBox="0 0 20 16"><rect x="1" y="1" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="m2 3 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></span>
    <h2 className={ui['form-card__title']}>Check your school inbox</h2>
    <p className={ui['form-card__body']}>We sent a confirmation link to {state.email||'your school email'}. After you confirm, our team verifies your school. If you already have an account, sign in or reset your password instead.</p>
    <ol className={ui['journey-steps--inline']} aria-label="Account progress"><li className={ui['journey-steps__step--done']}>✓ Account created</li><li className={ui['journey-steps__step--current']} aria-current="step">Confirm email</li><li className={ui['journey-steps__step--next']}>School verified</li></ol>
    <p className={ui['form-card__links']}><Link href="/login">Go to sign in</Link></p>
  </div>}>{state=><>
    <SchoolFields error={state.field==='details'?state.message:undefined}/>
    <EmailField error={state.field==='email'?state.message:undefined}/>
    <PasswordField newPassword error={state.field==='password'?state.message:undefined}/>
    <p className={ui['form-card__note']}>We use these details only to verify your school and manage access. <Link href="/privacy-policy">Read our privacy policy</Link>.</p>
  </>}</AccountForm>;
}
