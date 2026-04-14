import Link from 'next/link';
import CountdownTimer from '../components/CountdownTimer/CountdownTimer';
import CompareModule from './CompareModule';
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

      {/* What we're building with you */}
      <section className={styles.journey}>
        <div className="container">
          <p className={styles.sectionEyebrow}>What We&apos;re Building With You</p>
          <h2 className={styles.sectionHeadline}>More than a test paper service.</h2>
          <p className={styles.journeyIntro}>
            Revise It touches every stage of the assessment cycle — from question paper
            to department-wide insight. The pilot gives your department access to all three layers.
          </p>
          <div className={styles.journeyList}>

            <div className={styles.journeyItem}>
              <div className={`${styles.journeyAccent} ${styles.journeyAccentTerracotta}`} />
              <div className={styles.journeyContent}>
                <span className={`${styles.journeyBadge} ${styles.journeyBadgeReady}`}>Fully operational</span>
                <h3 className={styles.journeyTitle}>Bespoke assessments</h3>
                <p className={styles.journeyBody}>
                  Every formal Physical Sciences assessment your department needs — question paper,
                  comprehensive teacher memo, marking guide, and a learner-facing document that
                  explains the reasoning behind every correct answer. Delivered in five days.
                  CAPS-aligned, original, and built to your school&apos;s style.
                </p>
              </div>
            </div>

            <div className={styles.journeyItem}>
              <div className={`${styles.journeyAccent} ${styles.journeyAccentSage}`} />
              <div className={styles.journeyContent}>
                <span className={`${styles.journeyBadge} ${styles.journeyBadgeDeploying}`}>Ready to deploy with you</span>
                <h3 className={styles.journeyTitle}>The departmental platform</h3>
                <p className={styles.journeyBody}>
                  Mark entry question by question. Sub-topic performance dashboards for every
                  teacher. A HoD command view that lets you see the whole department — and drill
                  down to any individual learner. The platform is already built. Pilot schools
                  are the first departments to run on it.
                </p>
              </div>
            </div>

            <div className={styles.journeyItem}>
              <div className={`${styles.journeyAccent} ${styles.journeyAccentGold}`} />
              <div className={styles.journeyContent}>
                <span className={`${styles.journeyBadge} ${styles.journeyBadgeBuilding}`}>Co-building in 2026</span>
                <h3 className={styles.journeyTitle}>Five structured revision papers a year</h3>
                <p className={styles.journeyBody}>
                  Five progressive assessments released through the year — covering 20%, 40%, 60%,
                  80%, then the full curriculum. Learners complete them, self-mark, and see where
                  they stand sub-topic by sub-topic. Memos are released on a set schedule after
                  each marking window. The platform can also generate variations of past questions —
                  same concepts, different numbers and scenarios — so revision stays fresh.
                  These papers don&apos;t exist yet. Pilot schools will help define what they become.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      <CompareModule />

      {/* A good partnership starts with a conversation */}
      <section className={styles.exchange}>
        <div className="container">
          <h2 className={styles.sectionHeadline}>A good partnership starts with a conversation.</h2>
          <p className={styles.exchangeSub}>We&apos;re only working with three departments — so after you apply, we&apos;ll arrange a short meeting with your team.</p>
          <p className={styles.exchangeBody}>
            We&apos;ll be direct about where each layer of the programme stands today, what
            we&apos;ll be building together, and what we&apos;d need from your side. You&apos;ll
            have everything you need to decide if this is right for your department — and
            we&apos;ll be honest if we don&apos;t think the fit is there.
          </p>
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
