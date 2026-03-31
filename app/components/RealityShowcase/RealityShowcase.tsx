'use client';

import { useState, useCallback } from 'react';
import styles from './RealityShowcase.module.css';

type ItemKey = 'recycling' | 'planning' | 'remediation';

interface ShowcaseItem {
  key: ItemKey;
  label: string;
  color: string;
  bgActive: string;
  quote: string;
  src: string;
}

const ITEMS: ShowcaseItem[] = [
  {
    key: 'recycling',
    label: 'Assessment Creation',
    color: '#B85042',
    bgActive: 'rgba(184,80,66,0.06)',
    quote: "I often reuse old questions from old tests because I don't have time to create a new one.",
    src: '/nsc_p1_2018_flipbook.html',
  },
  {
    key: 'planning',
    label: 'Test Planning',
    color: '#1A1A2E',
    bgActive: 'rgba(26,26,46,0.05)',
    quote: "It's hard to block out sufficient time to create new tests.",
    src: '/time_starvation_calendar.html',
  },
  {
    key: 'remediation',
    label: 'After the Test',
    color: '#5B8A72',
    bgActive: 'rgba(91,138,114,0.08)',
    quote: "There's never enough time to properly do remediation with the learners.",
    src: '/remediation_planner.html',
  },
];

export default function RealityShowcase() {
  const [activeKey, setActiveKey] = useState<ItemKey>('recycling');
  const [clickCount, setClickCount] = useState(0);
  const [isPreviewFading, setIsPreviewFading] = useState(false);

  const activeItem = ITEMS.find((i) => i.key === activeKey)!;
  const iframeKey = `${activeKey}-${clickCount}`;

  const handleSelect = useCallback(
    (key: ItemKey) => {
      if (key === activeKey) return;
      setIsPreviewFading(true);
      setTimeout(() => {
        setActiveKey(key);
        setClickCount((c) => c + 1);
        setIsPreviewFading(false);
      }, 200);
    },
    [activeKey]
  );

  return (
    <div className={styles.root}>

      {/* ── Statement selector ─────────────────────────────────── */}
      <div className={styles.selector}>
        {ITEMS.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <button
              key={item.key}
              className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
              style={{
                '--item-color': item.color,
                '--item-bg': item.bgActive,
              } as React.CSSProperties}
              onClick={() => handleSelect(item.key)}
              aria-pressed={isActive}
            >
              <span className={styles.cardLabel}>{item.label}</span>
              <span className={styles.cardQuote}>
                <span className={styles.cardQuoteMark}>&ldquo;</span>
                {item.quote}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Preview iframe ─────────────────────────────────────── */}
      <div className={`${styles.preview} ${isPreviewFading ? styles.previewFading : ''}`}>
        <div className={styles.iframeShell}>
          <iframe
            key={iframeKey}
            src={activeItem.src}
            className={styles.iframe}
            title={activeItem.label}
            scrolling="no"
          />
        </div>
      </div>

    </div>
  );
}
