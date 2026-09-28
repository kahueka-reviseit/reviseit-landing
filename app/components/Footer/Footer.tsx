import styles from './Footer.module.css';

type LegalLink = {
  label: string;
  href: string;
};

// Add future legal pages here (Terms of Service, Cookie Policy, etc.)
const legalLinks: LegalLink[] = [
  { label: 'Privacy Policy', href: '/privacy-policy' },
];

export default function Footer() {
  return (
    <footer className={styles['site-footer']}>
      <div className="container">
        <div className={styles['site-footer__row']}>
          <span className={styles['site-footer__brand']}>
            <span className={styles['site-footer__wordmark']}>REVISE</span>{' '}
            <span className={styles['site-footer__wordmark--accent']}>IT</span>
          </span>
          <p className={styles['site-footer__text']}>
            &copy; {new Date().getFullYear()} Revise It. Built for teachers who do more than teach.
          </p>
          <div className={styles['site-footer__links']}>
            <a href="#catalogue" className={styles['site-footer__link']}>
              View Catalogue &rarr;
            </a>
            <a href="/pilot" className={styles['site-footer__link']}>
              Pilot Programme &rarr;
            </a>
          </div>
        </div>
        {legalLinks.length > 0 && (
          <div className={styles['site-footer__legal']}>
            {legalLinks.map((link) => (
              <a key={link.href} href={link.href} className={styles['site-footer__legal-link']}>
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
