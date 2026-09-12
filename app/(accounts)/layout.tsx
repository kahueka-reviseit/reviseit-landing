import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './accounts.module.css';
export const metadata: Metadata = { title: 'Teacher accounts | Revise It', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}><nav className={styles.nav} aria-label="Account navigation"><Link className={styles.brand} href="/">Revise It</Link><Link href="/account">My account</Link></nav><main className={styles.main}>{children}</main><footer className={styles.footer}>Need help? <a href="mailto:kahueka@reviseit.io">kahueka@reviseit.io</a></footer></div>;
}
