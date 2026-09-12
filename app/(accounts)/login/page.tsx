import Link from 'next/link';
import { AccountForm, EmailField, PasswordField } from '../forms';
import { login, resendConfirmation } from '../actions';
import { SCHOOL_EMAIL_NOTICE, ACCOUNT_UNAVAILABLE } from '../../../lib/auth/policy';
import { authConfig } from '../../../lib/supabase/config';
import styles from '../accounts.module.css';
export default async function Login({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className={styles.card}><span className={styles.eyebrow}>Teacher platform</span><h1>Welcome back</h1><p className={styles.notice}>{SCHOOL_EMAIL_NOTICE}</p>
    {(!authConfig() || message === 'unavailable') && <p role="status">{ACCOUNT_UNAVAILABLE}</p>}
    {message === 'password-updated' && <p role="status">Your password has been updated. Log in with your new password.</p>}
    <AccountForm action={login} label="Log in"><EmailField /><PasswordField /></AccountForm>
    <div className={styles.links}><Link href="/register">Create an account</Link><Link href="/forgot-password">Forgot your password?</Link></div>
    <details className={styles.details}><summary>Resend email confirmation</summary><AccountForm action={resendConfirmation} label="Send confirmation link"><EmailField /></AccountForm></details>
  </section>;
}
