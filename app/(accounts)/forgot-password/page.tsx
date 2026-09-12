import Link from 'next/link';
import { AccountForm, EmailField } from '../forms';
import { forgotPassword } from '../actions';
import styles from '../accounts.module.css';
export default function ForgotPassword() {
  return <section className={styles.card}><h1>Reset your password</h1><p>Enter the school email address you used to create your account.</p><AccountForm action={forgotPassword} label="Send reset link"><EmailField /></AccountForm><Link href="/login">Back to log in</Link></section>;
}
