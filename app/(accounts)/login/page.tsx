import { ACCOUNT_UNAVAILABLE, SCHOOL_EMAIL_NOTICE, safeNext } from '../../../lib/auth/policy';
import { authConfig } from '../../../lib/supabase/config';
import AuthLayout from '../auth-layout';
import LoginForm from './form';
import ui from '../experience.module.css';
export default async function Login({ searchParams }: { searchParams: Promise<{ message?: string; resend?: string; next?: string }> }) {
  const { message, resend, next: requested } = await searchParams;
  const next = safeNext(requested);
  return <AuthLayout entry="create" title="Sign in to your teacher account" lede={SCHOOL_EMAIL_NOTICE}>
    <section className={ui['form-card']} aria-labelledby="sign-in-title">
      <h2 id="sign-in-title" className={ui['form-card__title']}>Welcome back</h2>
      {(!authConfig() || message === 'unavailable') && <div className={ui['notice--neutral']} role="status"><p className={ui['notice__body']}>{ACCOUNT_UNAVAILABLE}</p></div>}
      {message === 'password-updated' && <div className={ui['notice--success']} role="status"><p className={ui['notice__title--compact']}>Password updated</p><p className={ui['notice__body']}>Sign in with your new password.</p></div>}
      {next && <div className={ui['notice--neutral']} role="status"><p className={ui['notice__title--compact']}>{next.startsWith('/teacher/orders/') ? 'Sign in to continue to your paper' : 'Sign in to continue'}</p><p className={ui['notice__body']}>You will go straight back to it after signing in.</p></div>}
      <LoginForm resend={resend === '1'} next={next}/>
    </section>
  </AuthLayout>;
}
