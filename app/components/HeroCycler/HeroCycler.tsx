'use client';

import { useState, useEffect } from 'react';
import styles from './HeroCycler.module.css';

const ITEMS = [
  {
    src: '/teacher_description_widget.html',
    phase: 'Design',
    document: "Teacher's Description",
    color: '#B85042',
    headline: 'Design with intent.',
    sub: "Bloom's levels on every sub-question. See the cognitive balance of your test before a single learner writes it.",
  },
  {
    src: '/question_paper_widget.html',
    phase: 'Assessment',
    document: 'Question Paper',
    color: '#5B8A72',
    headline: "Questions they've never seen.",
    sub: 'Original scenarios built from your brief. Exclusive to your school. Impossible to pre-drill.',
  },
  {
    src: '/teacher_memo_widget.html',
    phase: 'Marking',
    document: 'Teacher Memo',
    color: '#1A1A2E',
    headline: 'Every error anticipated.',
    sub: 'Marking scenarios, permutations, and error protocols. Your department marks consistently — no calibration session needed.',
  },
  {
    src: '/learner_memo_widget.html',
    phase: 'Remediation',
    document: 'Learner-Facing Memo',
    color: '#D4A574',
    headline: 'More than model answers.',
    sub: 'Step-by-step reasoning for every question. A document every learner can sit with and genuinely work through.',
  },
];

const INTERVAL_MS = 4200;

export default function HeroCycler() {
  const [active, setActive] = useState(0);
  const [copyVisible, setCopyVisible] = useState(true);

  // Auto-advance with functional state updater — no stale closure
  useEffect(() => {
    const id = setInterval(() => {
      setCopyVisible(false);
      setTimeout(() => {
        setActive((a) => (a + 1) % ITEMS.length);
        setCopyVisible(true);
      }, 220);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const goTo = (index: number) => {
    if (index === active) return;
    setCopyVisible(false);
    setTimeout(() => {
      setActive(index);
      setCopyVisible(true);
    }, 220);
  };

  const current = ITEMS[active];

  return (
    <div className={styles.root}>

      {/* Stacked iframes — all loaded, one visible at a time */}
      <div className={styles.frames}>
        {ITEMS.map((item, i) => (
          <iframe
            key={item.src}
            src={item.src}
            title={item.document}
            scrolling="no"
            className={`${styles.frame} ${i === active ? styles.frameVisible : ''}`}
          />
        ))}
      </div>

      {/* Value copy — fades with each cycle */}
      <div className={`${styles.copy} ${copyVisible ? styles.copyVisible : ''}`}>
        <p className={styles.copyLabel} style={{ color: current.color }}>
          {current.phase}&ensp;&middot;&ensp;{current.document}
        </p>
        <p className={styles.copyHeadline}>{current.headline}</p>
        <p className={styles.copySub}>{current.sub}</p>
      </div>

      {/* Dot navigation */}
      <div className={styles.dots} role="tablist">
        {ITEMS.map((item, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            aria-label={`View ${item.document}`}
            className={`${styles.dot} ${i === active ? styles.dotActive : ''}`}
            style={i === active ? { background: current.color } : undefined}
            onClick={() => goTo(i)}
          />
        ))}
      </div>

    </div>
  );
}
