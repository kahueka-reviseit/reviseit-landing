import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import styles from './privacy-policy.module.css';
import nav from '../(accounts)/system/navigation.module.css';
import { SiteHeader } from '../(accounts)/system/navigation';

export const metadata = {
  title: 'Privacy Policy — Revise It',
  description: 'How Revise It collects, stores, and uses your personal information in accordance with POPIA.',
};

export default function PrivacyPolicyPage() {
  const filePath = path.join(process.cwd(), 'content', 'privacy-policy.md');
  const markdown = fs.readFileSync(filePath, 'utf-8');
  const html = marked(markdown) as string;

  return (
    <div className={styles['privacy-policy']}>
      <SiteHeader variant="inverse" label="Site" brandHref="/" />
      <main className={styles['page-body']}>
        <div className={styles['page-body__container']}>
          <article
            className={styles['section']}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </main>
      <footer className={styles['site-footer']}>
        <div className={styles['page-body__container']}>
          <p className={styles['site-footer__text']}>
            &copy; {new Date().getFullYear()} Revise It.{' '}
            <a href="/" className={styles['site-footer__link']}>Back to home &rarr;</a>
          </p>
        </div>
      </footer>
      <div className="sage-bar" />
    </div>
  );
}
