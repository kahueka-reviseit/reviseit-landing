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
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.footerInner}>
          <span className={styles.footerLogo}>
            <span className={styles.logoRevise}>REVISE</span>{' '}
            <span className={styles.logoIt}>IT</span>
          </span>
          <p className={styles.footerCopy}>
            &copy; {new Date().getFullYear()} Revise It. Built for teachers who do more than teach.
          </p>
          <div className={styles.footerLinks}>
            <a href="#catalogue" className={styles.footerLink}>
              View Catalogue &rarr;
            </a>
            <a href="/pilot" className={styles.footerLink}>
              Pilot Programme &rarr;
            </a>
          </div>
        </div>
        {legalLinks.length > 0 && (
          <div className={styles.footerLegal}>
            {legalLinks.map((link) => (
              <a key={link.href} href={link.href} className={styles.footerLegalLink}>
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
