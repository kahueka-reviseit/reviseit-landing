import type { Metadata } from 'next';
import ui from './experience.module.css';
export const metadata: Metadata = { title: 'Teacher accounts | Revise It', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
/** Each page renders the header for its audience (teacher, signed-out or staff). */
export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return <div className={ui['site-shell']}>{children}<footer className={ui['site-footer']}>Need help? <a href="mailto:kahueka@reviseit.io">kahueka@reviseit.io</a></footer></div>;
}
