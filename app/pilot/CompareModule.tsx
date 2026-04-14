'use client';

import { useState } from 'react';
import styles from './pilot.module.css';

const rows = [
  {
    id: 'creation',
    dimension: 'Assessment creation',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8zm0-4h8v2H8zm0-4h5v2H8z" />
      </svg>
    ),
    today:
      "Teachers either build papers from scratch — a process that takes weeks, including originating questions and moderation rounds with colleagues — or they recycle tests from previous years that are likely already in circulation among the tutors helping this year's learners.",
    revise:
      "Every question paper, teacher memo, marking guide, and learner-facing document delivered in five days. Original questions, CAPS-aligned, built to your school's style. Exclusively yours.",
  },
  {
    id: 'marking',
    dimension: 'After the test',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ),
    today:
      "The teacher who set the paper writes the memo. If it's incomplete, they field a stream of queries from colleagues at moderation — because learners are infinitely creative at being wrong, and a gap in the memo creates uncertainty across the whole department.",
    revise:
      "A comprehensive teacher memo with multiple marking scenarios and edge cases per sub-question. Plus a learner-facing explanation document that walks every learner through the reasoning behind each correct answer.",
  },
  {
    id: 'visibility',
    dimension: 'Department visibility',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
        <path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" />
      </svg>
    ),
    today:
      "A HoD sees class averages on a spreadsheet. No sub-topic breakdown. No way to tell whether a class underperformed because of a coverage gap, a poorly framed question, or a misconception that's been sitting in the department for years.",
    revise:
      "Mark entry question by question. Sub-topic dashboards for every teacher. A HoD view of the whole department — drill from aggregate results to any individual learner.",
  },
];

export default function CompareModule() {
  const [activeTab, setActiveTab] = useState<'today' | 'revise'>('today');
  const isToday = activeTab === 'today';

  return (
    <section className={styles.compare}>
      <div className="container">
        <p className={styles.sectionEyebrow}>How This Compares</p>
        <h2 className={styles.sectionHeadline}>
          What assessment looks like today — and what it could.
        </h2>

        <div className={styles.compareTabs}>
          <button
            className={`${styles.compareTab} ${isToday ? styles.compareTabTodayActive : styles.compareTabInactive}`}
            onClick={() => setActiveTab('today')}
          >
            How departments do it today
          </button>
          <button
            className={`${styles.compareTab} ${!isToday ? styles.compareTabReviseActive : styles.compareTabInactive}`}
            onClick={() => setActiveTab('revise')}
          >
            With Revise It
          </button>
        </div>

        <div className={styles.compareRows}>
          {rows.map((row) => (
            <div key={row.id} className={styles.compareRow}>
              <div className={styles.compareRowLeft}>
                <div
                  className={`${styles.compareRowIconWrap} ${isToday ? styles.compareRowIconWrapToday : styles.compareRowIconWrapRevise}`}
                >
                  {row.icon}
                </div>
                <span className={styles.compareRowDimension}>{row.dimension}</span>
              </div>
              <p key={`${row.id}-${activeTab}`} className={styles.compareRowBody}>
                {isToday ? row.today : row.revise}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
