import { ACCOUNT_UNAVAILABLE, SCHOOL_EMAIL_NOTICE, safeNext } from '../../../lib/auth/policy';
import { authConfig } from '../../../lib/supabase/config';
import AuthLayout from '../auth-layout';
import LoginForm from './form';
import ui from '../experience.module.css';
import { Notice } from '../system/notice';
export default async function Login({ searchParams }: { searchParams: Promise<{ message?: string; resend?: string; next?: string }> }) {
  const { message, resend, next: requested } = await searchParams;
  const next = safeNext(requested);
  return <AuthLayout entry="create" title="Sign in to your teacher account" lede={SCHOOL_EMAIL_NOTICE}>
    <section className={ui['form-card']} aria-labelledby="sign-in-title">
      <h2 id="sign-in-title" className={ui['form-card__title']}>Welcome back</h2>
      {(!authConfig() || message === 'unavailable') && <Notice tone="neutral" role="status">{ACCOUNT_UNAVAILABLE}</Notice>}
      {message === 'password-updated' && <Notice tone="success" role="status" title="Password updated">Sign in with your new password.</Notice>}
      {next && <Notice tone="neutral" role="status" title={next.startsWith('/teacher/orders/') ? 'Sign in to continue to your paper' : 'Sign in to continue'}>You will go straight back to it after signing in.</Notice>}
      <LoginForm resend={resend === '1'} next={next}/>
    </section>
  </AuthLayout>;
}
