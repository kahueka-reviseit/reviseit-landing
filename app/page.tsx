import styles from './page.module.css';
import AssessmentJourney from './components/AssessmentJourney/AssessmentJourney';
import CatalogueExplorer from './components/CatalogueExplorer/CatalogueExplorer';
import HeroCycler from './components/HeroCycler/HeroCycler';
import RealityShowcase from './components/RealityShowcase/RealityShowcase';
import TrackedCTA from './components/TrackedCTA/TrackedCTA';
import Footer from './components/Footer/Footer';

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
            <div className={styles.navCenter}>
              <a href="#how-it-works" className={styles.navCenterLink}>How it works</a>
              <span className={styles.navDivider}>·</span>
              <a href="#catalogue" className={styles.navCenterLink}>Catalogue</a>
              <span className={styles.navDivider}>·</span>
              <a href="/pilot" className={styles.navCenterLink}>Pilot Programme</a>
            </div>
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
              It starts with the catalogue. You choose the questions that matter
              for your department, set the balance, define what your learners need.
              We build the full assessment package from there — test to memo to
              remediation guide.
            </p>
            <div className={styles.heroCyclerWrap}>
              <HeroCycler />
            </div>
            <div className={styles.heroCtas}>
              <a href="#catalogue" className={styles.btnPrimary}>
                View the Catalogue &rarr;
              </a>
              <TrackedCTA
                href="#tally-open=A7qv6z&tally-emoji-text=✏️&tally-emoji-animation=wave"
                eventName="pilot_form_opened"
                className={styles.btnSecondary}
              >
                Join the Free Pilot
              </TrackedCTA>
            </div>
          </div>
        </div>
      </section>

      {/* Pain — The Multi-Role Reality */}
      <section className={styles.problems}>
        <div className="container-wide">
          <h2 className={styles.sectionHeadline}>In a perfect world...</h2>
          <div className={styles.perfectWorldGrid}>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardNavy}`}>
              <span className={styles.perfectWorldLabel}>Question Design</span>
              <p>Every sub-question would have an intentional Bloom&apos;s level — and in aggregate, the paper would meet the standards set by the curriculum. Every mark allocation a deliberate decision, not an afterthought.</p>
            </div>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardGold}`}>
              <span className={styles.perfectWorldLabel}>Assessment Creation</span>
              <p>Learners would face questions they&apos;ve never seen before, set in scenarios that are relevant to their world — because you designed the context, not just the calculation.</p>
            </div>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardTerracotta}`}>
              <span className={styles.perfectWorldLabel}>Marking & Moderation</span>
              <p>Marking would be faster and fairer — memos detailed enough that every teacher in the department awards marks the same way, with no disputes left to resolve after the fact.</p>
            </div>
            <div className={`${styles.perfectWorldCard} ${styles.perfectWorldCardSage}`}>
              <span className={styles.perfectWorldLabel}>Feedback & Remediation</span>
              <p>Every learner would understand exactly where they went wrong and why — turning the test into a teaching moment, not just a measurement.</p>
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
                  <p className={styles.workflowStepBody}>Browse question specs by topic — each one defines a question type&apos;s structure, Bloom&apos;s level, and mark range. You decide which ones belong in your test.</p>
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
            {' '}We handle the AI.{' '}
            <strong>Your learners get the result.</strong>
          </div>
        </div>
      </section>

      {/* Catalogue Explorer */}
      <section id="catalogue" className={styles.catalogueSection}>
        <div className="container-wide">
          <CatalogueExplorer />
        </div>
      </section>

      {/* Pilot Teaser */}
      <section className={styles.pilotTeaser}>
        <div className="container">
          <div className={styles.pilotTeaserInner}>
            <div className={styles.pilotTeaserLeft}>
              <p className={`eyebrow eyebrow-sage`}>2026 Pilot Programme</p>
              <p className={styles.pilotTeaserText}>
                We&apos;re partnering with three Physical Sciences departments for a full
                calendar year — every formal assessment built end-to-end, questions adapted
                to your school&apos;s style, and preferential pricing locked in before we
                have a model.
              </p>
            </div>
            <div className={styles.pilotTeaserRight}>
              <p className={styles.pilotTeaserDeadline}>Applications close 15 Aug 2026</p>
              <a href="/pilot" className={styles.btnPilotTeaser}>
                Learn more &rarr;
              </a>
            </div>
          </div>
        </div>
      </section>


      {/* Footer */}
      <Footer />

      {/* Bottom sage bar */}
      <div className="sage-bar" />
    </div>
  );
}
