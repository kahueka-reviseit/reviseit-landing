import styles from './page.module.css';
import TimeStarvation from './components/TimeStarvation/TimeStarvation';

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
          <p className={`eyebrow eyebrow-sage ${styles.heroEyebrow}`}>
            For Physical Sciences Teachers
          </p>
          <h1 className={styles.heroHeadline}>
            You know what a great assessment looks like.<br />
            You just don&apos;t have time to build one.
          </h1>
          <p className={styles.heroSub}>
            You coach, you coordinate, you mentor, you teach. Assessment creation is
            bread and butter — but it keeps losing to everything else on your plate.
            Revise It delivers a complete 4-document assessment package so you can
            give your assessments the quality they deserve, without giving up your weekend.
          </p>
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
      </section>

      {/* Pain — The Multi-Role Reality */}
      <section className={styles.problems}>
        <div className="container">
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

          <div className={styles.problemGrid}>
            <div className={styles.problemCard}>
              <div className={styles.problemCardBorder} />
              <p className="eyebrow eyebrow-terracotta">The Rational Compromise</p>
              <h3 className={styles.problemTitle}>
                Recycling isn&apos;t laziness. It&apos;s the only option the schedule allows.
              </h3>
              <p className={styles.problemBody}>
                You know recycling last year&apos;s test isn&apos;t ideal. But it&apos;s 9pm,
                you&apos;ve just returned from a Saturday fixture, and Term 2 assessments
                are due. So you pull up last year&apos;s file, change the numbers, and hope
                the tutors haven&apos;t already drilled it with your learners.
              </p>
            </div>

            <div className={styles.problemCard}>
              <div className={styles.problemCardBorder} />
              <p className="eyebrow eyebrow-terracotta">The Circulation Problem</p>
              <h3 className={styles.problemTitle}>
                When teachers recycle, tests enter circulation.
              </h3>
              <p className={styles.problemBody}>
                Tutors get copies. Learners prepare for specific questions. Your assessment
                stops measuring understanding and starts measuring preparation. The validity
                erodes — not because the questions are bad, but because they&apos;re no
                longer exclusive.
              </p>
            </div>

            <div className={styles.problemCard}>
              <div className={styles.problemCardBorder} />
              <p className="eyebrow eyebrow-terracotta">The Memo You Never Write</p>
              <h3 className={styles.problemTitle}>
                You know what a proper memo looks like. You never have time to write it.
              </h3>
              <p className={styles.problemBody}>
                A proper memo anticipates every way a learner could go wrong. Remediation
                should be personalised, not a rushed board review. But creating that
                material takes hours you&apos;ve already spent on everything else your
                school needs from you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Time Starvation Animation */}
      <TimeStarvation />

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

      {/* 4-Document Package */}
      <section className={styles.levels}>
        <div className="container">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>
            What You Get
          </p>
          <h2 className={styles.sectionHeadline}>
            Everything you&apos;d build if you had the time.
          </h2>
          <p className={styles.sectionIntro}>
            You know what a complete assessment looks like. Design notes, original
            questions, a memo that handles every wrong answer, remediation that reaches
            every learner. You&apos;ve just never had time to build it all. Each question
            you request generates four purpose-built documents.
          </p>

          <div className={styles.levelsStack}>
            {[
              {
                n: '1',
                bg: '#B85042',
                color: '#fff',
                phase: 'Design Phase',
                label: "Teacher's Description",
                desc: "Your blueprint. Bloom's taxonomy level, CAPS topic, cognitive demand, and mark allocation — so you design a balanced test before learners see a question.",
              },
              {
                n: '2',
                bg: '#5B8A72',
                color: '#fff',
                phase: 'Assessment Phase',
                label: "Learner's Question",
                desc: "Original, so tutors can't pre-drill. CAPS-aligned, formatted for the exam room, and exclusive to your school.",
              },
              {
                n: '3',
                bg: '#1A1A2E',
                color: '#fff',
                phase: 'Marking Phase',
                label: 'Comprehensive Teacher Memo',
                desc: "Every anticipated error scenario, consequential error protocols, partial mark allocation. The memo you'd write if you weren't also coaching on Thursday.",
              },
              {
                n: '4',
                bg: '#D4A574',
                color: '#1A1A2E',
                phase: 'Remediation Phase',
                label: 'Learner-Facing Memo',
                desc: "Step-by-step reasoning in learner language. The remediation you've always wanted to give but never had time to create.",
              },
            ].map((item) => (
              <div key={item.n} className={styles.levelRow}>
                <div
                  className={styles.levelNum}
                  style={{ background: item.bg, color: item.color }}
                >
                  {item.n}
                </div>
                <div className={styles.levelContent}>
                  <p className={styles.levelPhase}>{item.phase}</p>
                  <p className={styles.levelLabel}>{item.label}</p>
                  <p className={styles.levelDesc}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className={styles.workflow}>
        <div className="container">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>
            How It Works
          </p>
          <h2 className={styles.sectionHeadline}>Teacher decides, AI executes</h2>
          <p className={styles.sectionIntro}>
            Your expertise is irreplaceable. Your time is not unlimited.
          </p>

          <div className={styles.workflowGrid}>
            <div className={styles.workflowCard}>
              <p className={styles.workflowStepNum}>1</p>
              <h3 className={styles.workflowCardTitle}>You Describe</h3>
              <p className={styles.workflowCardBody}>
                Tell us what you need — topic, cognitive level, mark allocation, any
                context. The same brief you&apos;d give a trusted colleague.
              </p>
            </div>
            <div className={styles.workflowCard}>
              <p className={styles.workflowStepNum}>2</p>
              <h3 className={styles.workflowCardTitle}>We Generate</h3>
              <p className={styles.workflowCardBody}>
                AI produces all four documents from master archetypes reverse-engineered
                from real provincial assessments. Not a chatbot — a purpose-built
                assessment engine.
              </p>
            </div>
            <div className={styles.workflowCard}>
              <p className={styles.workflowStepNum}>3</p>
              <h3 className={styles.workflowCardTitle}>You Refine</h3>
              <p className={styles.workflowCardBody}>
                Review the package. Request changes. Approve when satisfied. Your
                professional judgement stays central — we just removed the hours of
                execution.
              </p>
            </div>
          </div>

          <p className={styles.workflowClosing}>
            No app to learn. No platform to master. Just email — because you have
            enough tools to manage already.
          </p>

          <div className={styles.animationBlock}>
            <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`} style={{ marginBottom: '8px' }}>
              See It In Action
            </p>
            <p className={styles.animationIntro}>
              Watch a Grade 11 Physical Sciences paper come together — from question
              catalogue to finished document, with a teacher refining it in real time.
            </p>
            <div className={styles.animationFrame}>
              <iframe
                src="/scene_07_full_journey.html"
                title="How Revise It works — full journey animation"
                className={styles.animationIframe}
              />
            </div>
            <p className={styles.animationCaption}>
              Three questions selected from the catalogue. Teacher adds a synthesis
              sub-question, requests a diagram, adds a purity twist. Each change takes
              seconds. The paper adjusts in real time.
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof — Nomsa's Story */}
      {/* NOTE: Narrative illustration — replace with real pilot testimonial */}
      <section className={styles.vision}>
        <div className="container">
          <p className={`eyebrow ${styles.visionEyebrow}`}>
            From the Classroom
          </p>
          <blockquote className={styles.testimonialQuote}>
            &ldquo;I coach netball, I coordinate Grade 9, and I teach three Physical
            Sciences classes. Assessment used to get whatever energy I had left on
            Sunday. Now it gets my best thinking on Tuesday — and takes 30 minutes.&rdquo;
          </blockquote>
          <p className={styles.testimonialAttribution}>
            — Nomsa, Grade 11 Physical Sciences&nbsp;&nbsp;|&nbsp;&nbsp;Grade 9 Coordinator&nbsp;&nbsp;|&nbsp;&nbsp;Netball Coach
          </p>
        </div>
      </section>

      {/* Objection Handling */}
      <section className={styles.objection}>
        <div className="container">
          <p className={`eyebrow eyebrow-terracotta ${styles.sectionEyebrow}`}>
            A Fair Question
          </p>
          <h2 className={styles.objectionHeadline}>
            &ldquo;But I want to create my own questions.&rdquo;
          </h2>
          <p className={styles.objectionBody}>
            Good. That instinct is what makes you effective. Revise It doesn&apos;t
            replace your judgement — it removes the execution burden your schedule
            can&apos;t accommodate. You decide what to assess, at what cognitive level,
            in what context. A school that loves rugby? Your projectile motion question
            features a conversion kick at Loftus. The creative direction is yours. The
            hours of formatting, memo construction, and learner-language translation?
            That&apos;s what we take off your plate.
          </p>
          <p className={styles.objectionArchitect}>
            An architect designs a building. They don&apos;t mix the concrete.
          </p>
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
