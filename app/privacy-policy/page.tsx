import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import Link from 'next/link';
import styles from './privacy-policy.module.css';

export const metadata = {
  title: 'Privacy Policy — Revise It',
  description: 'How Revise It collects, stores, and uses your personal information in accordance with POPIA.',
};

export default function PrivacyPolicyPage() {
  const filePath = path.join(process.cwd(), 'content', 'privacy-policy.md');
  const markdown = fs.readFileSync(filePath, 'utf-8');
  const html = marked(markdown) as string;

  return (
    <div className={styles.page}>
      <div className="sage-bar" />
      <nav className={styles.nav}>
        <Link href="/" className={styles.navLogo}>
          <span className={styles.logoRevise}>REVISE</span>{' '}
          <span className={styles.logoIt}>IT</span>
        </Link>
      </nav>
      <main className={styles.main}>
        <div className={styles.container}>
          <article
            className={styles.content}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          <p className={styles.footerCopy}>
            &copy; {new Date().getFullYear()} Revise It.{' '}
            <a href="/" className={styles.footerLink}>Back to home &rarr;</a>
          </p>
        </div>
      </footer>
      <div className="sage-bar" />
    </div>
  );
}
