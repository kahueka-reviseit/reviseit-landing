import Link from 'next/link';
import { requireTeacher } from '../../../lib/auth/access';
import styles from '../accounts.module.css';
export default async function Teacher() {
  await requireTeacher();
  return <section className={styles.card}><span className={styles.eyebrow}>Teacher workspace</span><h1>Welcome to your workspace</h1><p>Your school account is verified. Paper selection and ordering are the next features being prepared.</p><Link href="/account">Manage my account</Link></section>;
}
