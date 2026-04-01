import styles from './page.module.css';
import AssessmentJourney from './components/AssessmentJourney/AssessmentJourney';
import HeroCycler from './components/HeroCycler/HeroCycler';
import RealityShowcase from './components/RealityShowcase/RealityShowcase';

export default function Home() {
  return (
    <div className={styles.page}>
      {/* Top sage bar */}
      <div className="sage-bar" />

      {/* Nav */}
      <nav className={styles.nav}>
        <div className="container">
          <div className={styles.navInner}>
            <span className={styles.logo}>
              <span className={styles.logoRevise}>REVISE</span>{' '}
              <span className={styles.logoIt}>IT</span>
            </span>
            <a href="#how-it-works" className={styles.navCenter}>
              How it works
            </a>
            <div className={styles.navRight}>
              <a href="https://app.reviseit.io" className={styles.navLogin}>
                Log in
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroInner}>
            <p className={`eyebrow eyebrow-sage ${styles.heroEyebrow}`}>
              For Heads of Department
            </p>
            <h1 className={styles.heroHeadline}>
              Not Just Questions.<br />
              A Complete Package.
            </h1>
            <p className={styles.heroSub}>
              You coach, you coordinate, you mentor, you teach. Assessment creation
              keeps losing to everything else on your plate. Revise It delivers a
              complete 4-document package — the quality your assessments deserve,
              without the weekend it used to cost.
            </p>
            <div className={styles.heroCyclerWrap}>
              <HeroCycler />
            </div>
            <div className={styles.heroCtas}>
              <a
                href="https://tally.so/r/n0vqEP"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.btnPrimary}
              >
                Join the Free Pilot
              </a>
              <a href="#how-it-works" className={styles.btnSecondary}>
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Pain — The Multi-Role Reality */}
      <section className={styles.problems}>
        <div className="container-wide">
          <h2 className={styles.sectionHeadline}>In a perfect world...</h2>
          <div className={styles.perfectWorldGrid}>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardGold}`}>
              <span className={styles.perfectWorldLabel}>Assessment Creation</span>
              <p>You'd design fresh questions for every test, guaranteeing that you're testing for <em>understanding</em>, not preparation.</p>
            </div>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardTerracotta}`}>
              <span className={styles.perfectWorldLabel}>Marking & Moderation</span>
              <p>You'd create memos that anticipate every creative mistake a learner could make, limiting time spent on post-marking moderation.</p>
            </div>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardSage}`}>
              <span className={styles.perfectWorldLabel}>Feedback & Remediation</span>
              <p>You'd ensure every learner received step-by-step feedback on every question, turning the test into a legitimate teaching tool.</p>
            </div>
          </div>

          <div className={styles.realityBridge}>
            <p className={styles.realityBridgeText}>
              But in reality, you don't have time to do it all.
            </p>
            <p className={styles.realityBridgeHint}>
              Do these situations resonate? Each one is interactive — click through to see what it actually looks like.
            </p>
          </div>

          <RealityShowcase />
        </div>
      </section>

      {/* How It Works — AssessmentJourney */}
      <section id="how-it-works" className={styles.reveal}>
        <div className="container-wide">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>
            How It Works
          </p>
          <AssessmentJourney />
        </div>
      </section>

      {/* How We Work Together */}
      <section className={styles.workTogether}>
        <div className="container-wide">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>How We Work Together</p>
          <h2 className={styles.sectionHeadline}>You Design. We Build. You Teach.</h2>

          <div className={styles.workflowList}>

            {/* Step 1 */}
            <div className={styles.workflowStep}>
              <div className={styles.workflowLeft}>
                <div className={`${styles.workflowIcon} ${styles.workflowIconSage}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M3 5h2v2H3V5zm0 4h2v2H3V9zm0 4h2v2H3v-2zm4-8h14v2H7V5zm0 4h14v2H7V9zm0 4h14v2H7v-2z"/></svg>
                </div>
                <div>
                  <p className={styles.workflowStepTitle}>Choose from the catalogue</p>
                  <p className={styles.workflowStepBody}>Pick question types from our library of structured questions and MCQs</p>
                </div>
              </div>
              <div className={`${styles.workflowRight} ${styles.workflowRightSage}`}>
                <p className={styles.workflowQuote}>&ldquo;I want a Newton&apos;s 2nd Law connected bodies question and a momentum collision MCQ&rdquo;</p>
              </div>
            </div>

            <div className={styles.workflowArrow}>↓</div>

            {/* Step 2 */}
            <div className={styles.workflowStep}>
              <div className={styles.workflowLeft}>
                <div className={`${styles.workflowIcon} ${styles.workflowIconTerracotta}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>
                </div>
                <div>
                  <p className={styles.workflowStepTitle}>Define your parameters</p>
                  <p className={styles.workflowStepBody}>Answer follow-up questions that make each question uniquely yours</p>
                </div>
              </div>
              <div className={`${styles.workflowRight} ${styles.workflowRightTerracotta}`}>
                <p className={styles.workflowQuote}>&ldquo;Make it a 5 kg trolley on a surface with a 20 kg hanging crate, &mu;k = 0.4&rdquo;</p>
              </div>
            </div>

            <div className={styles.workflowArrow}>↓</div>

            {/* Step 3 */}
            <div className={styles.workflowStep}>
              <div className={styles.workflowLeft}>
                <div className={`${styles.workflowIcon} ${styles.workflowIconGold}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </div>
                <div>
                  <p className={styles.workflowStepTitle}>We co-create via email</p>
                  <p className={styles.workflowStepBody}>Review drafts, give feedback, iterate until you&apos;re satisfied</p>
                </div>
              </div>
              <div className={`${styles.workflowRight} ${styles.workflowRightGold}`}>
                <p className={styles.workflowQuote}>&ldquo;Questions first, then memos. Collaborative, not handed down&rdquo;</p>
              </div>
            </div>

            <div className={styles.workflowArrow}>↓</div>

            {/* Step 4 */}
            <div className={styles.workflowStep}>
              <div className={styles.workflowLeft}>
                <div className={`${styles.workflowIcon} ${styles.workflowIconNavy}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>
                </div>
                <div>
                  <p className={styles.workflowStepTitle}>Receive your 4-document package</p>
                  <p className={styles.workflowStepBody}>All documents loaded into the platform with Bloom&apos;s analysis per sub-question</p>
                </div>
              </div>
              <div className={`${styles.workflowRight} ${styles.workflowRightNavy}`}>
                <p className={styles.workflowQuote}>&ldquo;Browse, adjust the balance, request edits, export when ready&rdquo;</p>
              </div>
            </div>

          </div>

          <div className={styles.workflowFooterBar}>
            <span className={styles.workflowFooterGold}>You bring the vision.</span>
            {' '}I handle the AI.{' '}
            <strong>Your learners get the result.</strong>
          </div>
        </div>
      </section>

      {/* How We Measure Success */}
      <section className={styles.successMeasure}>
        <div className="container-wide">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>How We Measure Success</p>
          <h2 className={styles.sectionHeadline}>Value Means Something Specific</h2>

          <div className={styles.successGrid}>

            {/* Card 1 */}
            <div className={`${styles.successCard} ${styles.successCardTerracotta}`}>
              <div className={`${styles.successIconWrap} ${styles.successIconTerracotta}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
              </div>
              <h3 className={styles.successCardTitle}>Less time,<br/>better assessments</h3>
              <p className={styles.successCardBody}>Did teachers spend less time creating and preparing tests while feeling the quality was higher than what they&apos;d normally produce?</p>
            </div>

            {/* Card 2 */}
            <div className={`${styles.successCard} ${styles.successCardSage}`}>
              <div className={`${styles.successIconWrap} ${styles.successIconSage}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              </div>
              <h3 className={styles.successCardTitle}>Less time after<br/>the test, too</h3>
              <p className={styles.successCardBody}>Did the teacher memo reduce marking time and moderation disputes? Did teachers spend less time creating post-assessment remediation materials?</p>
            </div>

            {/* Card 3 */}
            <div className={`${styles.successCard} ${styles.successCardGold}`}>
              <div className={`${styles.successIconWrap} ${styles.successIconGold}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/></svg>
              </div>
              <h3 className={styles.successCardTitle}>This year&apos;s learners<br/>outperform previous years</h3>
              <p className={styles.successCardBody}>Did learners understand their mistakes faster? Can this be the benchmark for years to come?</p>
            </div>

          </div>
        </div>
      </section>

      {/* Pilot Offer */}
      <section id="pilot" className={styles.cta}>
        <div className="container">
          <div className={styles.ctaInner}>
            <p className={`eyebrow eyebrow-sage`} style={{ marginBottom: '16px' }}>
              Free Pilot
            </p>
            <h2 className={styles.ctaHeadline}>
              Your assessments deserve your best thinking —<br className={styles.ctaBr} />
              not your last energy.
            </h2>
            <p className={styles.ctaSub}>
              Join the free pilot and get complete 4-document assessment packages for
              all your Grade 11 Physical Sciences formal assessments this year.
            </p>

            <div className={styles.pilotLists}>
              <div>
                <p className={styles.pilotListTitle}>What you get</p>
                <ul className={styles.pilotListSage}>
                  <li>Complete 4-document packages for all formal assessments</li>
                  <li>Unlimited revision rounds until you&apos;re satisfied</li>
                  <li>Direct email support — no platform to learn</li>
                  <li>CAPS-aligned master archetypes, exclusive to your school</li>
                </ul>
              </div>
              <div>
                <p className={styles.pilotListTitle}>What we ask</p>
                <ul className={styles.pilotListTerracotta}>
                  <li>10-minute feedback form after each assessment</li>
                  <li>Permission to use anonymised feedback to improve the system</li>
                  <li>Honest critique — what works, what doesn&apos;t</li>
                </ul>
              </div>
            </div>

            <a
              href="https://tally.so/r/n0vqEP"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnCtaPrimary}
            >
              Join the Free Pilot
            </a>
            <p className={styles.pilotSmall}>
              Limited to 20 teachers. Email-based — because you have enough platforms
              to manage already.
            </p>
          </div>
        </div>
      </section>

      {/* Ecosystem Hint */}
      <section className={styles.ecosystemHint}>
        <div className="container">
          <p className={styles.ecosystemText}>
            Test Creation gives your assessments the quality they deserve.
            Departmental Assessments gives your department the intelligence it needs.
            Join the pilot to shape what comes next.
          </p>
        </div>
      </section>

      {/* Footer */}
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
            <a href="#pilot" className={styles.footerLink}>
              Join the Pilot &rarr;
            </a>
          </div>
        </div>
      </footer>

      {/* Bottom sage bar */}
      <div className="sage-bar" />
    </div>
  );
}
