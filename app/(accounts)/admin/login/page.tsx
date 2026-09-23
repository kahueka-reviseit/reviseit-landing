import Link from 'next/link';
import { AccountForm, EmailField, PasswordField } from '../../forms';
import { adminLogin } from './actions';
import styles from '../../accounts.module.css';
export const metadata = { title: 'Administration | Revise It' };
export default function AdminLogin() {
  return <section className={styles.card}>
    <span className={styles.eyebrow}>Revise It administration</span>
    <h1>Team sign in</h1>
    <p>Manage teacher applications and school access using your authorised team account.</p>
    <AccountForm action={adminLogin} label="Sign in to administration"><EmailField /><PasswordField /></AccountForm>
    <div className={styles.links}><Link href="/forgot-password">Forgot your password?</Link></div>
  </section>;
}
