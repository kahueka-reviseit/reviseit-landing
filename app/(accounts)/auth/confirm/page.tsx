import Link from 'next/link';
import { AccountForm } from '../../forms';
import { confirmEmail } from '../../actions';
import styles from '../../accounts.module.css';
export default async function Confirm({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash, type } = await searchParams;
  const valid = token_hash && token_hash.length <= 512 && ['email','signup','recovery','email_change'].includes(type || '');
  return <section className={styles.card}><h1>{type === 'recovery' ? 'Reset your password' : 'Confirm your email'}</h1>
    {valid ? <><p>Continue to securely verify this link.</p><AccountForm action={confirmEmail} label="Continue"><input type="hidden" name="token_hash" value={token_hash} /><input type="hidden" name="type" value={type} /></AccountForm></> : <p>This confirmation link is incomplete. Request a new link from the login screen.</p>}
    <Link href="/login">Back to log in</Link></section>;
}
