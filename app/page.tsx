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
            <div className={styles.navActions}>
              <a href="https://app.reviseit.io" className={styles.navLogin}>
                Log in
              </a>
              <a href="#how-it-works" className={styles.navLink}>
                How it works
              </a>
              <a href="#pilot" className={styles.navCta}>
                Join the Pilot
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
              For Physical Sciences Heads of Department
            </p>
            <h1 className={styles.heroHeadline}>
              You know what a great assessment looks like.<br />
              You just don&apos;t have time to build one.
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
          <p className={`eyebrow eyebrow-terracotta ${styles.sectionEyebrow}`}>
            The Reality
          </p>
          <h2 className={styles.sectionHeadline}>Assessment always comes last.</h2>
          <p className={styles.sectionIntro}>
            You&apos;re not just a Physical Sciences teacher. You&apos;re a grade coordinator,
            a housemaster, a sports coach, a mentor. You contribute to your school in
            ways that go far beyond the classroom. But when Sunday evening arrives and
            the test is due Monday, assessment gets whatever time and energy is left over.
          </p>

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

      {/* Transformation — Before/After */}
      <section className={styles.transformation}>
        <div className="container">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>
            The Transformation
          </p>
          <h2 className={styles.sectionHeadline}>
            What if assessment didn&apos;t need your weekend?
          </h2>
          <div className={styles.transformationCols}>
            <div className={`${styles.transformationCol} ${styles.transformationColBefore}`}>
              <p className="eyebrow eyebrow-terracotta" style={{ marginBottom: '16px' }}>
                The Compromise
              </p>
              <p className={styles.transformationText}>
                It&apos;s Sunday. You spent Saturday at the U16A hockey semifinal. Friday
                was the Grade 9 social you organised. The test is due Monday. You open
                last year&apos;s file, change the scenario, adjust two values, and export.
                You know it could be better. But you&apos;ve given this weekend to your
                school six different ways already.
              </p>
            </div>
            <div className={`${styles.transformationCol} ${styles.transformationColAfter}`}>
              <p className="eyebrow eyebrow-sage" style={{ marginBottom: '16px' }}>
                The Alternative
              </p>
              <p className={styles.transformationText}>
                It&apos;s Tuesday, free period. You open your email.{' '}
                <em>&ldquo;I need a Newton&apos;s Second Law question — connected bodies,
                8 marks, application level. Make the scenario about a mining conveyor
                belt.&rdquo;</em>{' '}
                By Thursday, you have four documents. You review it over coffee.
                Your weekend was yours.
              </p>
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
