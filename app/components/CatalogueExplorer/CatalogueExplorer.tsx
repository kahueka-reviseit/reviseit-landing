'use client';

import { useState, useEffect, useRef } from 'react';
import { CATALOGUES } from '../../data/catalogues';
import { useIntentTracking } from '../../hooks/useIntentTracking';
import styles from './CatalogueExplorer.module.css';

function useCountUp(target: number, active: boolean, duration = 1400): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) { setValue(0); return; }
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [active, target, duration]);
  return value;
}

export default function CatalogueExplorer() {
  const [selectedId, setSelectedId] = useState<string>('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [statsActive, setStatsActive] = useState(false);
  const { track, sectionRef } = useIntentTracking();
  const previewTracked = useRef(false);

  const stats = CATALOGUES.find((c) => c.id === selectedId)?.stats ?? null;

  const papersCount = useCountUp(stats?.papersAnalysed ?? 0, statsActive);
  const structuredCount = useCountUp(stats?.structuredCount ?? 0, statsActive, 1600);
  const mcqCount = useCountUp(stats?.mcqCount ?? 0, statsActive, 1800);
  const totalCount = useCountUp(stats?.totalStructures ?? 0, statsActive, 2000);

  const selected = CATALOGUES.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!previewVisible || !selected || previewTracked.current) return;
    previewTracked.current = true;
    track('catalogue_preview_viewed', { id: selected.id });
  }, [previewVisible, selected, track]);

  useEffect(() => {
    previewTracked.current = false;
  }, [selectedId]);

  // Re-initialize Tally embeds whenever a new catalogue is selected
  useEffect(() => {
    if (!selectedId) return;
    const timeout = setTimeout(() => {
      if (typeof window !== 'undefined' && (window as any).Tally) {
        (window as any).Tally.loadEmbeds();
      }
    }, 150);
    return () => clearTimeout(timeout);
  }, [selectedId]);

  function handleDropdownFocus() {
    track('catalogue_dropdown_opened');
  }

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const entry = CATALOGUES.find((c) => c.id === id);
    if (!entry || entry.status === 'coming-soon') return;
    setSelectedId(id);
    setPreviewVisible(false);
    setStatsActive(false);
    track('catalogue_subject_selected', { id });
    requestAnimationFrame(() => {
      setPreviewVisible(true);
      setTimeout(() => setStatsActive(true), 200);
    });
  }

  function handleGetCatalogue() {
    if (selected) {
      track('catalogue_form_opened', { id: selected.id });
    }
  }

  return (
    <div ref={sectionRef} className={styles.wrapper}>

      {/* Top row: intro copy left, selector right */}
      <div className={styles.topRow}>
        <div className={styles.topLeft}>
          <p className={`eyebrow eyebrow-sage ${styles.eyebrow}`}>The Catalogue</p>
          <h2 className={styles.headline}>Every Assessment<br />Starts Here.</h2>
          <p className={styles.intro}>
            Every teacher knows the move. When a test is due, you open last year&apos;s
            paper. Then the year before. Then a provincial June. You&apos;re scanning for
            a question type you can adapt — the right structure, the right cognitive level,
            something you can make your own.
          </p>
          <p className={styles.intro}>
            That&apos;s what we do for every curriculum we add. The scanning, the
            pattern-finding, the mapping — done. Select a curriculum below to see
            how much institutional knowledge we&apos;ve captured.
          </p>
        </div>

        <div className={styles.topRight}>
          <div className={styles.selectorCard}>
            <p className={styles.selectorCardEyebrow}>Browse by curriculum</p>
            <label htmlFor="catalogue-select" className={styles.selectLabel}>
              Select a curriculum
            </label>
            <select
              id="catalogue-select"
              className={styles.select}
              value={selectedId}
              onFocus={handleDropdownFocus}
              onChange={handleSelect}
            >
              <option value="">Choose a curriculum...</option>
              {CATALOGUES.map((entry) => (
                <option
                  key={entry.id}
                  value={entry.id}
                  disabled={entry.status === 'coming-soon'}
                >
                  {entry.displayLabel}
                  {entry.status === 'coming-soon' ? ' — Coming Soon' : ''}
                </option>
              ))}
            </select>
            {!selectedId && (
              <p className={styles.selectorHint}>
                Grade 11 Physical Sciences is available now. Grade 12 coming soon.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Preview card — fades in on selection */}
      {selected && (
        <div className={`${styles.previewCard} ${previewVisible ? styles.previewVisible : ''}`}>

          {stats && (
            <div className={styles.statsStrip}>
              <div className={styles.statItem}>
                <span className={styles.statNumber}>{papersCount}</span>
                <span className={styles.statLabel}>papers analysed</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statNumber}>{structuredCount}</span>
                <span className={styles.statLabel}>structured question types</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statNumber}>{mcqCount}</span>
                <span className={styles.statLabel}>MCQ types</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statNumber}>{totalCount}</span>
                <span className={styles.statLabel}>total structures mapped</span>
              </div>
            </div>
          )}

          <div className={styles.previewImageWrap}>
            <img
              src={selected.previewImage}
              alt={`Preview of the ${selected.displayLabel} catalogue`}
              className={styles.previewImage}
            />
          </div>
          <div className={styles.previewMeta}>
            <p className={styles.previewCaption}>{selected.displayLabel}</p>
            <h3 className={styles.previewHeadline}>
              Every question type that exists in this curriculum. All of them.
            </h3>
            <p className={styles.previewNote}>
              Each structure was extracted from actual provincial papers. You
              bring the scenario — the context, the numbers, the difficulty.
              We build a question that has never existed before.
            </p>
            <div className={styles.tallyEmbed} onClick={handleGetCatalogue}>
              <iframe
                data-tally-src={`https://tally.so/embed/${selected.tallyFormId}?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1`}
                loading="lazy"
                width="100%"
                height="400"
                frameBorder={0}
                marginHeight={0}
                marginWidth={0}
                title={`Get the ${selected.displayLabel} Catalogue`}
              />
            </div>
            <p className={styles.emailNote}>
              Sent to your <strong>school email only</strong> — no personal addresses.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
