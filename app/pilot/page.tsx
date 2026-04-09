import Link from 'next/link';
import CountdownTimer from '../components/CountdownTimer/CountdownTimer';
import styles from './pilot.module.css';

export const metadata = {
  title: '2026 Pilot Programme — Revise It',
  description:
    'We\'re partnering with three Physical Sciences departments for a full calendar year. Applications close 15 August 2026.',
};

export default function PilotPage() {
  return (
    <div className={styles.page}>
      <div className="sage-bar" />

      {/* Nav */}
      <nav className={styles.nav}>
        <Link href="/" className={styles.navLogo}>
          <span className={styles.logoRevise}>REVISE</span>{' '}
          <span className={styles.logoIt}>IT</span>
        </Link>
        <Link href="/" className={styles.navHome}>
          &larr; Back to home
        </Link>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className="container">
          <p className={styles.heroEyebrow}>2026 Founding Partner Programme</p>
          <h1 className={styles.heroHeadline}>
            We&apos;re building this<br />with three schools.
          </h1>
          <p className={styles.heroSub}>
            For a full calendar year, your physics department gets every formal
            assessment built from the ground up — questions designed to your
            school&apos;s style, your learners&apos; world, and your
            department&apos;s standards. In exchange, you walk the journey with
            us as we figure out what this can become.
          </p>
          <CountdownTimer />
          <p className={styles.deadline}>Applications close 15 August 2026</p>
          <a href="#apply" className={styles.btnApply}>Apply Now &darr;</a>
        </div>
      </section>

      {/* What your department gets */}
      <section className={styles.offer}>
        <div className="container">
          <p className={styles.sectionEyebrow}>What Your Department Gets</p>
          <h2 className={styles.sectionHeadline}>A full year. Your department. Your style.</h2>
          <div className={styles.offerGrid}>

            <div className={`${styles.offerCard} ${styles.offerCardTerracotta}`}>
              <p className={styles.offerCardNumber}>01</p>
              <p className={styles.offerCardTitle}>Every formal assessment, end-to-end</p>
              <p className={styles.offerCardBody}>
                From mid-Term 3 2026 through Term 3 2027, every formal Physical
                Sciences assessment your department needs — question paper, teacher
                memo, marking guide, and learner remediation document — built
                completely, for every grade you teach.
              </p>
            </div>

            <div className={`${styles.offerCard} ${styles.offerCardSage}`}>
              <p className={styles.offerCardNumber}>02</p>
              <p className={styles.offerCardTitle}>Questions built to your school&apos;s style</p>
              <p className={styles.offerCardBody}>
                Your preferred question patterns, your scenarios, your level of
                challenge — fed back into our platform as we build. The longer we
                work together, the better the fit. By the end of the year, the
                platform knows what your department values.
              </p>
            </div>

            <div className={`${styles.offerCard} ${styles.offerCardGold}`}>
              <p className={styles.offerCardNumber}>03</p>
              <p className={styles.offerCardTitle}>A direct say in what we build next</p>
              <p className={styles.offerCardBody}>
                What frustrates you becomes our next feature. What you love becomes
                the standard. Pilot schools have a direct line to the founding team
                and real input into the platform&apos;s development. You&apos;re not
                a customer — you&apos;re a co-builder.
              </p>
            </div>

            <div className={`${styles.offerCard} ${styles.offerCardNavy}`}>
              <p className={styles.offerCardNumber}>04</p>
              <p className={styles.offerCardTitle}>Preferential pricing. In writing.</p>
              <p className={styles.offerCardBody}>
                We don&apos;t have a commercial pricing model yet. But pilot schools
                won&apos;t pay full price when we do. We&apos;ll agree on your rate
                before we launch commercially — and put it in writing before a single
                invoice is raised.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* The exchange */}
      <section className={styles.exchange}>
        <div className="container">
          <h2 className={styles.sectionHeadline}>The exchange.</h2>
          <p className={styles.exchangeSub}>This isn&apos;t a free trial. It&apos;s a founding partnership — and we take that seriously on both sides.</p>
          <div className={styles.exchangeList}>
            <div className={styles.exchangeItem}>
              <div className={styles.exchangeDot} />
              <p className={styles.exchangeItemText}>
                <strong>Honest feedback at each stage</strong> — what&apos;s working,
                what isn&apos;t, and what you wish it could do. One short feedback
                call per term, plus informal input as we go.
              </p>
            </div>
            <div className={styles.exchangeItem}>
              <div className={styles.exchangeDot} />
              <p className={styles.exchangeItemText}>
                <strong>Permission to use anonymized data</strong> — assessment
                structures, question performance, and learner outcomes, used to
                improve the platform and inform our research. Never identifiable.
              </p>
            </div>
            <div className={styles.exchangeItem}>
              <div className={styles.exchangeDot} />
              <p className={styles.exchangeItemText}>
                <strong>The journey</strong> — we&apos;re early, and we&apos;re
                honest about that. Pilot schools accept that we&apos;re building
                something together, not receiving a finished product.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How We Measure Success */}
      <section className={styles.success}>
        <div className="container">
          <p className={styles.sectionEyebrow}>How We Measure Success</p>
          <h2 className={styles.sectionHeadline}>Value means something specific.</h2>
          <div className={styles.successGrid}>

            <div className={styles.successCard}>
              <div className={`${styles.successIconWrap} ${styles.successIconTerracotta}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
              </div>
              <h3 className={styles.successCardTitle}>Less time,<br />better assessments</h3>
              <p className={styles.successCardBody}>Did teachers spend less time creating and preparing tests while feeling the quality was higher than what they&apos;d normally produce?</p>
            </div>

            <div className={styles.successCard}>
              <div className={`${styles.successIconWrap} ${styles.successIconSage}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              </div>
              <h3 className={styles.successCardTitle}>Less time after<br />the test, too</h3>
              <p className={styles.successCardBody}>Did the teacher memo reduce marking time and moderation disputes? Did teachers spend less time creating post-assessment remediation materials?</p>
            </div>

            <div className={styles.successCard}>
              <div className={`${styles.successIconWrap} ${styles.successIconGold}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/></svg>
              </div>
              <h3 className={styles.successCardTitle}>This year&apos;s learners<br />outperform previous years</h3>
              <p className={styles.successCardBody}>Did learners understand their mistakes faster? Can this be the benchmark for years to come?</p>
            </div>

          </div>
        </div>
      </section>

      {/* Spots */}
      <section className={styles.spots}>
        <div className="container">
          <h2 className={styles.spotsHeadline}>Three departments. That&apos;s it.</h2>
          <p className={styles.spotsSub}>
            We&apos;re not offering this to twenty schools. We&apos;re offering it to
            three — so we can go deep, not wide. Every department gets our full
            attention, not a scaled-down version of it.
          </p>
          <div className={styles.spotsCount}>
            <span className={styles.spotPill}>Department 1 — Open</span>
            <span className={styles.spotPill}>Department 2 — Open</span>
            <span className={styles.spotPill}>Department 3 — Open</span>
          </div>
          <a href="#apply" className={styles.btnApply}>Apply Now &darr;</a>
        </div>
      </section>

      {/* Application form */}
      <section id="apply" className={styles.formSection}>
        <div className="container">
          <div className={styles.formWrap}>
            <h2 className={styles.formHeadline}>Apply to join the pilot.</h2>
            <p className={styles.formSub}>
              Tell us about your department. We&apos;ll follow up within five school days.
            </p>
            <iframe
              data-tally-src="https://tally.so/embed/A7qv6z?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1"
              loading="lazy"
              width="100%"
              height="500"
              frameBorder={0}
              marginHeight={0}
              marginWidth={0}
              title="Apply to Join the 2026 Pilot"
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className="container">
          <p className={styles.footerCopy}>
            &copy; {new Date().getFullYear()} Revise It &nbsp;·&nbsp;{' '}
            <Link href="/privacy-policy" className={styles.footerLink}>
              Privacy Policy
            </Link>
          </p>
        </div>
      </footer>

      <div className="sage-bar" />
    </div>
  );
}
