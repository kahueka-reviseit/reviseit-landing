import type { Metadata } from 'next';
import styles from './accounts.module.css';
import AccountNav from './account-nav';
export const metadata: Metadata = { title: 'Teacher accounts | Revise It', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles['site-shell']}><AccountNav/><main className={styles['page-body']}>{children}</main><footer className={styles['site-footer']}>Need help? <a href="mailto:kahueka@reviseit.io">kahueka@reviseit.io</a></footer></div>;
}
