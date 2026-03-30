'use client';

import { useState, useCallback } from 'react';
import styles from './AssessmentJourney.module.css';

type PhaseKey = 'start' | 'design' | 'assessment' | 'marking' | 'remediation';

interface Phase {
  key: PhaseKey;
  label: string;
  stepNum?: number;
  color: string;
  bgInactive: string;
  bgHover: string;
  textActive: string;
  src: string;
  document?: string;
  tagline?: string;
  headline?: string;
  body: string;
  transformation?: string;
}

const PHASES: Phase[] = [
  {
    key: 'start',
    label: 'Start',
    color: '#6A5D50',
    bgInactive: 'rgba(106,93,80,0.10)',
    bgHover: 'rgba(106,93,80,0.18)',
    textActive: '#fff',
    src: '/catalogue_widget.html',
    headline: 'Everything begins in the catalogue.',
    body: "The catalogue holds the accumulated knowledge of hundreds of provincial past papers, reduced to their underlying structural patterns and organised by topic. It's not a question bank — it's the curriculum, atomized. Every assessment starts here.",
  },
  {
    key: 'design',
    label: 'Design',
    stepNum: 1,
    color: '#B85042',
    bgInactive: 'rgba(184,80,66,0.11)',
    bgHover: 'rgba(184,80,66,0.20)',
    textActive: '#fff',
    src: '/01_design_phase_scene.html',
    document: "Teacher's Description",
    tagline: "Your scenario. Your intent. A question that's never been seen.",
    body: "The catalogue holds the patterns. You supply the creative direction — the scenario, the context, what the question is about. You're not writing from scratch; you're curating from experience. The Teacher's Description is where your intent takes shape: topic, cognitive level, the scenario you chose.",
    transformation: "From recycling last year's scenarios → directing original questions that fit your learners",
  },
  {
    key: 'assessment',
    label: 'Assessment',
    stepNum: 2,
    color: '#5B8A72',
    bgInactive: 'rgba(91,138,114,0.11)',
    bgHover: 'rgba(91,138,114,0.21)',
    textActive: '#fff',
    src: '/02_assessment_phase_scene.html',
    document: 'Question Paper',
    tagline: "A question your learners have genuinely never seen.",
    body: "What arrives in the exam room is original — not recycled from three years ago, not something a tutor has drilled. Learners have to apply what they've been taught to a scenario they've never encountered. That's what assessment is supposed to do: test understanding, not preparation.",
    transformation: "From questions in tutor circulation → questions that genuinely test capability",
  },
  {
    key: 'marking',
    label: 'Marking',
    stepNum: 3,
    color: '#1A1A2E',
    bgInactive: 'rgba(26,26,46,0.08)',
    bgHover: 'rgba(26,26,46,0.16)',
    textActive: '#fff',
    src: '/03_marking_phase_scene.html',
    document: 'Teacher Memo',
    tagline: "Less back-and-forth. More consistency.",
    body: "The memo doesn't just show the right answer — it anticipates the wrong ones. Marking scenarios, permutations, error protocols. When a learner does something unexpected, the memo already has an answer. No mid-marking WhatsApp to a colleague. No inconsistency between classrooms.",
    transformation: "From resolving ambiguity during marking → comprehensive guidance that settles it before it starts",
  },
  {
    key: 'remediation',
    label: 'Remediation',
    stepNum: 4,
    color: '#C49255',
    bgInactive: 'rgba(196,146,85,0.12)',
    bgHover: 'rgba(196,146,85,0.22)',
    textActive: '#fff',
    src: '/04_remediation_phase_scene.html',
    document: 'Learner-Facing Memo',
    tagline: "More than model answers. A document that teaches.",
    body: "Going over a test typically means two or three questions on the board. Learners get one pass. The Learner-Facing Memo is a document they can sit with — step-by-step reasoning for every question, showing how correct working builds and why each step matters. Teachers decide when to deploy it: revision, retest, independent work.",
    transformation: "From model answers on the board → a learning document learners can genuinely work from",
  },
];

export default function AssessmentJourney() {
  const [activeKey, setActiveKey] = useState<PhaseKey>('start');
  const [clickCount, setClickCount] = useState(0);
  const [isCopyFading, setIsCopyFading] = useState(false);

  const activePhase = PHASES.find((p) => p.key === activeKey)!;
  const iframeKey = `${activeKey}-${clickCount}`;

  const handleTabClick = useCallback(
    (key: PhaseKey) => {
      if (key === activeKey) {
        setClickCount((c) => c + 1);
        return;
      }
      setIsCopyFading(true);
      setTimeout(() => {
        setActiveKey(key);
        setClickCount((c) => c + 1);
        setIsCopyFading(false);
      }, 180);
    },
    [activeKey]
  );

  return (
    <div className={styles.root}>

      {/* ── Button strip ──────────────────────────────────────── */}
      <div className={styles.tabStrip} role="tablist">
        {PHASES.map((phase) => {
          const isActive = phase.key === activeKey;
          return (
            <button
              key={phase.key}
              role="tab"
              aria-selected={isActive}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              style={{
                '--phase-color': phase.color,
                '--phase-bg': phase.bgInactive,
                '--phase-bg-hover': phase.bgHover,
                '--phase-text-active': phase.textActive,
              } as React.CSSProperties}
              onClick={() => handleTabClick(phase.key)}
            >
              {phase.stepNum !== undefined && (
                <span className={styles.tabStep}>{phase.stepNum}</span>
              )}
              <span className={styles.tabLabel}>{phase.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Content: copy left + iframe right ─────────────────── */}
      <div className={styles.content}>

        {/* Copy panel */}
        <div
          className={`${styles.copyPanel} ${isCopyFading ? styles.copyFading : ''}`}
          aria-live="polite"
        >
          {activePhase.key === 'start' ? (
            <>
              <h3 className={styles.copyHeadline}>{activePhase.headline}</h3>
              <p className={styles.copyBody}>{activePhase.body}</p>
            </>
          ) : (
            <>
              <p
                className={styles.copyEyebrow}
                style={{ color: activePhase.color }}
              >
                {activePhase.label}&ensp;&middot;&ensp;{activePhase.document}
              </p>
              <h3 className={styles.copyTagline}>{activePhase.tagline}</h3>
              <p className={styles.copyBody}>{activePhase.body}</p>
              {activePhase.transformation && (
                <p className={styles.copyTransformation}>
                  {activePhase.transformation}
                </p>
              )}
            </>
          )}
        </div>

        {/* Iframe */}
        <div className={styles.iframeOuter}>
          <div className={styles.iframeInner}>
            <iframe
              key={iframeKey}
              src={activePhase.src}
              className={styles.iframe}
              title={`${activePhase.label} phase`}
              scrolling="no"
            />
          </div>
        </div>

      </div>

    </div>
  );
}
