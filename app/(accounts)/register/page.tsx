import Link from 'next/link';
import { AccountForm, EmailField, PasswordField, SchoolFields } from '../forms';
import { register } from '../actions';
import { SCHOOL_EMAIL_NOTICE, ACCOUNT_UNAVAILABLE } from '../../../lib/auth/policy';
import { authConfig } from '../../../lib/supabase/config';
import styles from '../accounts.module.css';
export default function Register() {
  return <section className={styles.card}><span className={styles.eyebrow}>Teacher platform</span><h1>Create your account</h1><p className={styles.notice}>{SCHOOL_EMAIL_NOTICE}</p>
    {!authConfig() && <p role="status">{ACCOUNT_UNAVAILABLE}</p>}
    <AccountForm action={register} label="Create account"><SchoolFields /><EmailField /><PasswordField newPassword /></AccountForm>
    <p>We use these details to verify your school affiliation and manage access. <Link href="/privacy-policy">Read our privacy policy</Link>.</p>
    <Link href="/login">Already have an account? Log in</Link></section>;
}
