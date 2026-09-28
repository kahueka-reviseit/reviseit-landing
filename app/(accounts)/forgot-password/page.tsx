'use client';
import Link from 'next/link';
import { AccountForm, EmailField } from '../forms';
import { forgotPassword } from '../actions';
import { SignedOutHeader } from '../shell';
import ui from '../experience.module.css';
/** T2 F and G. The reply is the same whether or not the account exists. */
export default function ForgotPassword() {
  return <><SignedOutHeader entry="none"/><main className={ui['site-shell__main']}><div className={ui['page']}><div className={ui['auth-layout']}>
    <div className={ui['auth-layout__intro']}><p className={ui['auth-layout__eyebrow']}>Account recovery</p><h1 className={ui['auth-layout__title']}>Reset your password</h1><p className={ui['auth-layout__lede']}>We will email a reset link to the school address you used to create your account.</p></div>
    <section className={ui['form-card']} aria-label="Reset your password">
      <AccountForm action={forgotPassword} label="Send reset link" done={state=><div className={ui['form']} role="status"><h2 className={ui['form-card__title']}>Check your inbox</h2><p className={ui['form-card__body']}>{state.message}</p><p className={ui['form-card__links']}><Link href="/login">Back to sign in</Link></p></div>}>
        <p className={ui['form-card__body']}>Enter your school email and we will send a reset link.</p><EmailField/>
      </AccountForm>
      <p className={ui['form-card__links']}><Link href="/login">Back to sign in</Link></p>
    </section>
  </div></div></main></>;
}
