import styles from './page.module.css';

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
            <a href="https://app.reviseit.io" className={styles.navCta}>
              Log in
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className="container">
          <p className={`eyebrow eyebrow-terracotta ${styles.heroEyebrow}`}>
            For Heads of Department
          </p>
          <h1 className={styles.heroHeadline}>
            Stop managing in the dark.<br />
            Start leading with evidence.
          </h1>
          <p className={styles.heroSub}>
            Our platform gives you the evidence, tools, and insights to lead a
            department where teachers thrive, students excel, and parents become
            true learning partners.
          </p>
          <div className={styles.heroCtas}>
            <a href="https://app.reviseit.io" className={styles.btnPrimary}>
              Get started
            </a>
            <a href="#products" className={styles.btnSecondary}>
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Problem section */}
      <section className={styles.problems}>
        <div className="container">
          <p className={`eyebrow eyebrow-terracotta ${styles.sectionEyebrow}`}>
            The Problem
          </p>
          <h2 className={styles.sectionHeadline}>What Does Anyone Actually Know?</h2>
          <p className={styles.sectionIntro}>
            When you look at your department&apos;s results, you see numbers. Your
            teachers see different numbers. Parents see percentages. But is
            anyone actually seeing the same story? Are you all working from the
            same evidence, or is everyone operating in their own bubble of
            incomplete data?
          </p>

          <div className={styles.problemGrid}>
            <div className={styles.problemCard}>
              <div className={styles.problemCardBorder} />
              <p className={`eyebrow eyebrow-terracotta`}>The Grade Paradox</p>
              <h3 className={styles.problemTitle}>
                Without granular data, what are you actually managing?
              </h3>
              <p className={styles.problemBody}>
                When Teacher A&apos;s class averages 73% and Teacher B&apos;s averages
                68%, you know the outcome — but not why. These numbers show you
                who is passing, not whether students consistently fail the same
                three question types.
              </p>
            </div>

            <div className={styles.problemCard}>
              <div className={styles.problemCardBorder} />
              <p className={`eyebrow eyebrow-terracotta`}>The Feedback Black Hole</p>
              <h3 className={styles.problemTitle}>
                When does your feedback actually change behaviour?
              </h3>
              <p className={styles.problemBody}>
                After every test, scripts go home with red marks and model
                answers. Students glance at their grades, parents see a
                percentage, and the learning opportunity dies. The same mistakes
                repeat next term.
              </p>
            </div>

            <div className={styles.problemCard}>
              <div className={styles.problemCardBorder} />
              <p className={`eyebrow eyebrow-terracotta`}>The Home-School Disconnect</p>
              <h3 className={styles.problemTitle}>
                When tutors don&apos;t know what teachers know, who loses?
              </h3>
              <p className={styles.problemBody}>
                A student fails a trigonometry question. The parent sees
                &ldquo;68% — needs improvement.&rdquo; The expensive tutor focuses on
                general trig review instead of the precise angle calculation
                error that caused the mistake.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it should work */}
      <section className={styles.levels}>
        <div className="container">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>
            The Solution
          </p>
          <h2 className={styles.sectionHeadline}>
            How Assessment Should Actually Work
          </h2>
          <p className={styles.sectionIntro}>
            Most departments stop at level one. High-performing departments
            master all five.
          </p>

          <div className={styles.levelsStack}>
            {[
              {
                n: '1',
                label: 'Quality Test Creation',
                desc: 'Curriculum-aligned, cognitively balanced assessments — created efficiently.',
              },
              {
                n: '2',
                label: 'Accurate Data Capture',
                desc: 'Granular, question-level performance tracking across all students.',
              },
              {
                n: '3',
                label: 'Deep Diagnostic Analysis',
                desc: "Understanding the 'why' behind mistakes through student metacognition.",
              },
              {
                n: '4',
                label: 'Targeted Intervention',
                desc: 'Precise remediation based on specific misconceptions, not generic review.',
              },
              {
                n: '5',
                label: 'Continuous Improvement Loop',
                desc: 'Data feeds back into teaching, creating systematic departmental evolution.',
              },
            ].map((level, i) => {
              const colors = ['#5B8A72', '#B85042', '#D4A574', '#1A1A2E', '#5B8A72'];
              const textColors = ['#fff', '#fff', '#1A1A2E', '#fff', '#fff'];
              return (
                <div key={level.n} className={styles.levelRow}>
                  <div
                    className={styles.levelNum}
                    style={{ background: colors[i], color: textColors[i] }}
                  >
                    {level.n}
                  </div>
                  <div className={styles.levelContent}>
                    <p className={styles.levelLabel}>{level.label}</p>
                    <p className={styles.levelDesc}>{level.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Vision section */}
      <section className={styles.vision}>
        <div className="container">
          <h2 className={styles.visionHeadline}>
            What would your department look like if assessment data flowed
            seamlessly to accelerate every learner toward mastery?
          </h2>

          <div className={styles.visionGrid}>
            <div className={styles.visionItem}>
              <span className={styles.visionIcon}>&#x1F3AF;</span>
              <p>
                Every learner receives a personalised improvement plan — not
                &ldquo;work harder at Maths&rdquo; but <em>&ldquo;here&apos;s exactly why you struggle
                with algebra.&rdquo;</em>
              </p>
            </div>
            <div className={styles.visionItem}>
              <span className={styles.visionIcon}>&#x1F4DA;</span>
              <p>
                Teachers accelerate toward excellence, learning more from how
                other teachers teach than in traditional environments.
              </p>
            </div>
            <div className={styles.visionItem}>
              <span className={styles.visionIcon}>&#x1F3C6;</span>
              <p>
                One teacher&apos;s breakthrough remedy creates grade-wide impact
                across all classes.
              </p>
            </div>
            <div className={styles.visionItem}>
              <span className={styles.visionIcon}>&#x1F4A1;</span>
              <p>
                School leaders make bold promises, confidently guaranteeing
                parents that borderline learners will excel.
              </p>
            </div>
          </div>

          <p className={styles.visionClose}>
            In this world, assessment data becomes your catalyst for guaranteed
            academic transformation.
          </p>
        </div>
      </section>

      {/* Products */}
      <section id="products" className={styles.products}>
        <div className="container">
          <p className={`eyebrow eyebrow-sage ${styles.sectionEyebrow}`}>
            Start Where You Are
          </p>
          <h2 className={styles.sectionHeadline}>
            Transform at Your Pace
          </h2>
          <p className={styles.sectionIntro}>
            Choose the right solution for your department&apos;s current needs.
            Upgrade anytime as you grow.
          </p>

          <div className={styles.productGrid}>
            {/* Past Performance Tracker */}
            <div className={styles.productCard}>
              <div className={styles.productCardTop}>
                <p className={`eyebrow eyebrow-sage`}>Past Performance Tracker</p>
                <h3 className={styles.productName}>Instant Insights, No Commitment</h3>
                <p className={styles.productTagline}>See what you&apos;ve been missing</p>
              </div>
              <div className={styles.productCardBody}>
                <div className={styles.productFor}>
                  <p className={styles.productForLabel}>Perfect if you&apos;re</p>
                  <p className={styles.productForText}>
                    Curious about what insights are hiding in your existing
                    data. Want to see the platform&apos;s value before committing.
                  </p>
                </div>
                <div className={styles.productPrice}>
                  <span className={styles.priceAmount}>R100</span>
                  <span className={styles.pricePer}> / learner</span>
                  <p className={styles.priceSub}>Upload 8 past assessments</p>
                </div>
                <ul className={styles.productFeatures}>
                  <li>Instant performance patterns across your department</li>
                  <li>Class comparison dashboards</li>
                  <li>Topic-level weakness identification</li>
                  <li>Concierge Google Sheets setup</li>
                </ul>
                <a href="https://app.reviseit.io" className={styles.btnProductSage}>
                  Get Insights Now
                </a>
              </div>
            </div>

            {/* Homework Assessments */}
            <div className={`${styles.productCard} ${styles.productCardFeatured}`}>
              <div className={styles.featuredBadge}>Most Popular</div>
              <div className={styles.productCardTop}>
                <p className={`eyebrow`} style={{ color: '#D4A574' }}>Homework Assessments</p>
                <h3 className={styles.productName} style={{ color: '#fff' }}>
                  Zero Marking, Maximum Insight
                </h3>
                <p className={styles.productTagline} style={{ color: '#A7BEAE' }}>
                  Save 3+ hours per teacher weekly
                </p>
              </div>
              <div className={styles.productCardBody}>
                <div className={styles.productFor}>
                  <p className={styles.productForLabel} style={{ color: '#A7BEAE' }}>Perfect if you&apos;re</p>
                  <p className={styles.productForText} style={{ color: '#A7BEAE' }}>
                    Needing immediate relief for your teachers while maintaining
                    quality insights into student performance.
                  </p>
                </div>
                <div className={styles.productPrice}>
                  <span className={styles.priceAmount} style={{ color: '#D4A574' }}>R500</span>
                  <span className={styles.pricePer} style={{ color: '#A7BEAE' }}> / learner / term</span>
                  <p className={styles.priceSub} style={{ color: '#5B8A72' }}>FREE for two terms</p>
                </div>
                <ul className={styles.productFeaturesDark}>
                  <li>Homework published as topics are taught</li>
                  <li>Students self-mark with guidance</li>
                  <li>Instant performance reports for teachers</li>
                  <li>Friday planning intelligence dashboard</li>
                </ul>
                <a href="https://app.reviseit.io" className={styles.btnProductGold}>
                  Automate Homework Now
                </a>
              </div>
            </div>

            {/* Departmental Assessments */}
            <div className={styles.productCard}>
              <div className={styles.productCardTop}>
                <p className={`eyebrow eyebrow-terracotta`}>Departmental Assessments</p>
                <h3 className={styles.productName}>Your Assessment Command Centre</h3>
                <p className={styles.productTagline}>Full transformation in 30 days</p>
              </div>
              <div className={styles.productCardBody}>
                <div className={styles.productFor}>
                  <p className={styles.productForLabel}>Perfect if you&apos;re</p>
                  <p className={styles.productForText}>
                    Ready to transform your entire department with complete
                    visibility and control over assessment and learning outcomes.
                  </p>
                </div>
                <div className={styles.productPrice}>
                  <span className={styles.priceAmount}>Custom</span>
                  <p className={styles.priceSub}>
                    A proposal crafted around your school&apos;s needs and budget
                  </p>
                </div>
                <ul className={styles.productFeatures}>
                  <li>Everything in Homework Assessments</li>
                  <li>Test-Builder with 500+ CAPS questions</li>
                  <li>Mark calculation &amp; moderation tools</li>
                  <li>Targeted remedy dispenser</li>
                  <li>Department heat maps &amp; analytics</li>
                </ul>
                <a href="https://app.reviseit.io" className={styles.btnProductTerracotta}>
                  Book a Demo
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.cta}>
        <div className="container">
          <div className={styles.ctaInner}>
            <h2 className={styles.ctaHeadline}>
              Ready to lead with evidence?
            </h2>
            <p className={styles.ctaSub}>
              Join the departments already reclaiming Sunday nights and
              transforming Friday planning.
            </p>
            <a href="https://app.reviseit.io" className={styles.btnCtaPrimary}>
              Get started today
            </a>
          </div>
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
              &copy; {new Date().getFullYear()} Revise It. Built for South African schools.
            </p>
            <a href="https://app.reviseit.io" className={styles.footerLink}>
              Log in to the app &rarr;
            </a>
          </div>
        </div>
      </footer>

      {/* Bottom sage bar */}
      <div className="sage-bar" />
    </div>
  );
}
