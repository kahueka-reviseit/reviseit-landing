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
    <div className={styles['pilot']}>
      <div className="sage-bar" />

      {/* Nav */}
      <nav className={styles['site-nav']}>
        <Link href="/" className={styles['site-nav__brand']}>
          <span className={styles['site-nav__wordmark']}>Revise It</span>
        </Link>
        <Link href="/" className={styles['site-nav__back']}>
          &larr; Back to home
        </Link>
      </nav>

      {/* Hero */}
      <section className={styles['hero']}>
        <div className="container">
          <p className={styles['hero__eyebrow']}>2026 Founding Partner Programme</p>
          <h1 className={styles['hero__title']}>
            We&apos;re building this<br />with three schools.
          </h1>
          <p className={styles['hero__lead']}>
            For a full calendar year, your physics department gets every formal
            assessment built from the ground up — questions designed to your
            school&apos;s style, your learners&apos; world, and your
            department&apos;s standards. In exchange, you walk the journey with
            us as we figure out what this can become.
          </p>
          <CountdownTimer />
          <p className={styles['cta__deadline']}>Applications close 15 August 2026</p>
          <a href="#apply" className={styles['button--primary']}>Apply Now &darr;</a>
        </div>
      </section>

      {/* What we're building with you */}
      <section className={styles['section--journey']}>
        <div className="container">
          <p className={styles['section__eyebrow']}>What We&apos;re Building With You</p>
          <h2 className={styles['section__title']}>More than a test paper service.</h2>
          <p className={styles['section__lead']}>
            Revise It touches every stage of the assessment cycle — from question paper
            to department-wide insight. The pilot gives your department access to all three layers.
          </p>
          <div className={styles['timeline']}>

            <div className={styles['timeline__item']}>
              <div className={`${styles['pilot__journey-accent']} ${styles['pilot__journey-accent-terracotta']}`} />
              <div className={styles['timeline__content']}>
                <span className={`${styles['pilot__journey-badge']} ${styles['pilot__journey-badge-ready']}`}>Fully operational</span>
                <h3 className={styles['timeline__title']}>Bespoke assessments</h3>
                <p className={styles['timeline__body']}>
                  Every formal Physical Sciences assessment your department needs — question paper,
                  comprehensive teacher memo, marking guide, and a learner-facing document that
                  explains the reasoning behind every correct answer. Delivered in five days.
                  CAPS-aligned, original, and built to your school&apos;s style.
                </p>
              </div>
            </div>

            <div className={styles['timeline__item']}>
              <div className={`${styles['pilot__journey-accent']} ${styles['pilot__journey-accent-sage']}`} />
              <div className={styles['timeline__content']}>
                <span className={`${styles['pilot__journey-badge']} ${styles['pilot__journey-badge-deploying']}`}>Ready to deploy with you</span>
                <h3 className={styles['timeline__title']}>The departmental platform</h3>
                <p className={styles['timeline__body']}>
                  Mark entry question by question. Sub-topic performance dashboards for every
                  teacher. A HoD command view that lets you see the whole department — and drill
                  down to any individual learner. The platform is already built. Pilot schools
                  are the first departments to run on it.
                </p>
              </div>
            </div>

            <div className={styles['timeline__item']}>
              <div className={`${styles['pilot__journey-accent']} ${styles['pilot__journey-accent-gold']}`} />
              <div className={styles['timeline__content']}>
                <span className={`${styles['pilot__journey-badge']} ${styles['pilot__journey-badge-building']}`}>Co-building in 2026</span>
                <h3 className={styles['timeline__title']}>Five structured revision papers a year</h3>
                <p className={styles['timeline__body']}>
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
      <section className={styles['pilot__exchange']}>
        <div className="container">
          <h2 className={styles['section__title']}>A good partnership starts with a conversation.</h2>
          <p className={styles['pilot__exchange-sub']}>We&apos;re only working with three departments — so after you apply, we&apos;ll arrange a short meeting with your team.</p>
          <p className={styles['pilot__exchange-body']}>
            We&apos;ll be direct about where each layer of the programme stands today, what
            we&apos;ll be building together, and what we&apos;d need from your side. You&apos;ll
            have everything you need to decide if this is right for your department — and
            we&apos;ll be honest if we don&apos;t think the fit is there.
          </p>
        </div>
      </section>

      {/* How We Measure Success */}
      <section className={styles['pilot__success']}>
        <div className="container">
          <p className={styles['section__eyebrow']}>How We Measure Success</p>
          <h2 className={styles['section__title']}>Value means something specific.</h2>
          <div className={styles['pilot__success-grid']}>

            <div className={styles['pilot__success-card']}>
              <div className={`${styles['pilot__success-icon-wrap']} ${styles['pilot__success-icon-terracotta']}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
              </div>
              <h3 className={styles['pilot__success-card-title']}>Less time,<br />better assessments</h3>
              <p className={styles['pilot__success-card-body']}>Did teachers spend less time creating and preparing tests while feeling the quality was higher than what they&apos;d normally produce?</p>
            </div>

            <div className={styles['pilot__success-card']}>
              <div className={`${styles['pilot__success-icon-wrap']} ${styles['pilot__success-icon-sage']}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              </div>
              <h3 className={styles['pilot__success-card-title']}>Less time after<br />the test, too</h3>
              <p className={styles['pilot__success-card-body']}>Did the teacher memo reduce marking time and moderation disputes? Did teachers spend less time creating post-assessment remediation materials?</p>
            </div>

            <div className={styles['pilot__success-card']}>
              <div className={`${styles['pilot__success-icon-wrap']} ${styles['pilot__success-icon-gold']}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/></svg>
              </div>
              <h3 className={styles['pilot__success-card-title']}>This year&apos;s learners<br />outperform previous years</h3>
              <p className={styles['pilot__success-card-body']}>Did learners understand their mistakes faster? Can this be the benchmark for years to come?</p>
            </div>

          </div>
        </div>
      </section>

      {/* Spots */}
      <section className={styles['pilot__spots']}>
        <div className="container">
          <h2 className={styles['pilot__spots-headline']}>Three departments. That&apos;s it.</h2>
          <p className={styles['pilot__spots-sub']}>
            We&apos;re not offering this to twenty schools. We&apos;re offering it to
            three — so we can go deep, not wide. Every department gets our full
            attention, not a scaled-down version of it.
          </p>
          <div className={styles['pilot__spots-count']}>
            <span className={styles['pilot__spot-pill']}>Department 1 — Open</span>
            <span className={styles['pilot__spot-pill']}>Department 2 — Open</span>
            <span className={styles['pilot__spot-pill']}>Department 3 — Open</span>
          </div>
          <a href="#apply" className={styles['button--primary']}>Apply Now &darr;</a>
        </div>
      </section>

      {/* Application form */}
      <section id="apply" className={styles['form']}>
        <div className="container">
          <div className={styles['form__container']}>
            <h2 className={styles['form__title']}>Apply to join the pilot.</h2>
            <p className={styles['form__lead']}>
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
      <footer className={styles['site-footer']}>
        <div className="container">
          <p className={styles['site-footer__text']}>
            &copy; {new Date().getFullYear()} Revise It &nbsp;·&nbsp;{' '}
            <Link href="/privacy-policy" className={styles['site-footer__link']}>
              Privacy Policy
            </Link>
          </p>
        </div>
      </footer>

      <div className="sage-bar" />
    </div>
  );
}
