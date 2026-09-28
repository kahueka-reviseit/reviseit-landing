'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './TimeStarvation.module.css';

// ── Constants ─────────────────────────────────────────────────
const HOUR_PX = 56;
const DAY_END = 12 * 60;
const GRID_HEIGHT = (DAY_END / 60) * HOUR_PX; // 672px  (8am–8pm)
const CONTAINER_H = 360;
const SCROLL_AFT = 200;  // phase 0: scroll to reveal afternoon
const SCROLL_SCH = 50;   // phase 1: scroll back to school-day view

function minTop(min: number) { return (min / 60) * HOUR_PX; }
function minH(dur: number)   { return (dur / 60) * HOUR_PX; }

// ── Time labels (8am–8pm) ──────────────────────────────────────
const TIME_LABELS = [0,60,120,180,240,300,360,420,480,540,600,660,720].map(m => {
  const h24 = 8 + m / 60;
  const h12 = h24 > 12 ? h24 - 12 : h24;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  return { min: m, label: `${h12}${ampm}` };
});

// ── Period start times (minutes after 8am) ─────────────────────
// P1:0  P2:60  Break:120  P3:140  P4:200  Lunch:260  P5:300  P6:360

// ── Per-day teaching schedule ──────────────────────────────────
// Gr12 Physical Sciences: Mon P1, Wed P3, Fri P2
// Gr11 Physical Sciences: Mon P4, Tue P5, Thu P6
// Gr10 Physical Sciences: Tue P3, Wed P5, Thu P2
// Gr9  Natural Sciences:  Wed P1, Thu P4, Fri P5
type TBlock = { id:string; label:string; sub:string; start:number; dur:number; bg:string; bdr:string; sm:boolean };

const BRK: TBlock = { id:'brk', label:'Break', sub:'', start:120, dur:20, bg:'#F8F6F0', bdr:'none', sm:true };
const LCH: TBlock = { id:'lch', label:'Lunch', sub:'', start:260, dur:40, bg:'#F8F6F0', bdr:'none', sm:true };

const DAY_SCHEDULE: Record<number, TBlock[]> = {
  0: [ // Monday: Gr12 P1, Gr11 P4
    { id:'t1', label:'Grade 12', sub:'Physical Sciences', start:0,   dur:60, bg:'#FBF3DB', bdr:'#DFAB01', sm:false },
    BRK,
    { id:'t2', label:'Grade 11', sub:'Physical Sciences', start:200, dur:60, bg:'#EAE4F2', bdr:'#9A6DD7', sm:false },
    LCH,
  ],
  1: [ // Tuesday: Gr10 P3, Gr11 P5
    BRK,
    { id:'t1', label:'Grade 10', sub:'Physical Sciences', start:140, dur:60, bg:'#DDEDEA', bdr:'#5B8A72', sm:false },
    LCH,
    { id:'t2', label:'Grade 11', sub:'Physical Sciences', start:300, dur:60, bg:'#EAE4F2', bdr:'#9A6DD7', sm:false },
  ],
  2: [ // Wednesday: Gr9 P1, Gr12 P3, Gr10 P5
    { id:'t1', label:'Grade 9',  sub:'Natural Sciences',  start:0,   dur:60, bg:'#E8F4F8', bdr:'#4A90D9', sm:false },
    BRK,
    { id:'t2', label:'Grade 12', sub:'Physical Sciences', start:140, dur:60, bg:'#FBF3DB', bdr:'#DFAB01', sm:false },
    LCH,
    { id:'t3', label:'Grade 10', sub:'Physical Sciences', start:300, dur:60, bg:'#DDEDEA', bdr:'#5B8A72', sm:false },
  ],
  3: [ // Thursday: Gr10 P2, Gr9 P4, Gr11 P6
    { id:'t1', label:'Grade 10', sub:'Physical Sciences', start:60,  dur:60, bg:'#DDEDEA', bdr:'#5B8A72', sm:false },
    BRK,
    { id:'t2', label:'Grade 9',  sub:'Natural Sciences',  start:200, dur:60, bg:'#E8F4F8', bdr:'#4A90D9', sm:false },
    LCH,
    { id:'t3', label:'Grade 11', sub:'Physical Sciences', start:360, dur:50, bg:'#EAE4F2', bdr:'#9A6DD7', sm:false },
  ],
  4: [ // Friday: Gr12 P2, Gr9 P5
    BRK,
    { id:'t1', label:'Grade 12', sub:'Physical Sciences', start:60,  dur:60, bg:'#FBF3DB', bdr:'#DFAB01', sm:false },
    LCH,
    { id:'t2', label:'Grade 9',  sub:'Natural Sciences',  start:300, dur:60, bg:'#E8F4F8', bdr:'#4A90D9', sm:false },
  ],
};

// ── Afternoon/evening blocks (per weekday) ─────────────────────
type ABlock = { id:string; label:string; sub:string; start:number; dur:number; bg:string; bdr:string };

const AFTERNOON: Record<number, ABlock[]> = {
  0: [ // Mon — coaching
    { id:'c', label:'Coaching — U16 Rugby', sub:'3:00–5:00 pm', start:420, dur:120, bg:'#DDEDEA', bdr:'#5B8A72' },
    { id:'d', label:'Drive Home',           sub:'5:00–6:00 pm', start:540, dur:60,  bg:'#F5F3EE', bdr:'#C5BFB5' },
    { id:'e', label:'Cook Dinner',          sub:'6:00–7:00 pm', start:600, dur:60,  bg:'#FBF3DB', bdr:'#DFAB01' },
  ],
  1: [ // Tue
    { id:'d', label:'Drive Home',  sub:'5:00–6:00 pm', start:540, dur:60, bg:'#F5F3EE', bdr:'#C5BFB5' },
    { id:'e', label:'Cook Dinner', sub:'6:00–7:00 pm', start:600, dur:60, bg:'#FBF3DB', bdr:'#DFAB01' },
  ],
  2: [ // Wed — coaching
    { id:'c', label:'Coaching — U16 Rugby', sub:'3:00–5:00 pm', start:420, dur:120, bg:'#DDEDEA', bdr:'#5B8A72' },
    { id:'d', label:'Drive Home',           sub:'5:00–6:00 pm', start:540, dur:60,  bg:'#F5F3EE', bdr:'#C5BFB5' },
    { id:'e', label:'Cook Dinner',          sub:'6:00–7:00 pm', start:600, dur:60,  bg:'#FBF3DB', bdr:'#DFAB01' },
  ],
  3: [ // Thu
    { id:'d', label:'Drive Home',  sub:'5:00–6:00 pm', start:540, dur:60, bg:'#F5F3EE', bdr:'#C5BFB5' },
    { id:'e', label:'Cook Dinner', sub:'6:00–7:00 pm', start:600, dur:60, bg:'#FBF3DB', bdr:'#DFAB01' },
  ],
  4: [ // Fri — coaching
    { id:'c', label:'Coaching — U16 Rugby', sub:'3:00–5:00 pm', start:420, dur:120, bg:'#DDEDEA', bdr:'#5B8A72' },
    { id:'d', label:'Drive Home',           sub:'5:00–6:00 pm', start:540, dur:60,  bg:'#F5F3EE', bdr:'#C5BFB5' },
    { id:'e', label:'Cook Dinner',          sub:'6:00–7:00 pm', start:600, dur:60,  bg:'#FBF3DB', bdr:'#DFAB01' },
  ],
};

// ── Days ──────────────────────────────────────────────────────
const DAYS = [
  { key:'mon', label:'Mon' }, { key:'tue', label:'Tue' },
  { key:'wed', label:'Wed' }, { key:'thu', label:'Thu' },
  { key:'fri', label:'Fri' }, { key:'sat', label:'Sat' },
  { key:'sun', label:'Sun' },
];

// ── Hover sequence ─────────────────────────────────────────────
// [0] Tue P4 free  11:20am–12:20pm  (gap between Gr10 P3 and Lunch)
// [1] Thu P5 free   1:00–2:00 pm    (gap between Lunch and Gr11 P6)
// [2] Sun 10am anchor               (1h, after church)
// [3] Sun 10am–6pm                  (drag down — 8 hours)
const HOVER_SEQ = [
  { dayIdx: 1, start: 200, dur:  60 },
  { dayIdx: 3, start: 300, dur:  60 },
  { dayIdx: 6, start: 120, dur:  60 },
  { dayIdx: 6, start: 120, dur: 480 },
];

// ── Phase timing ───────────────────────────────────────────────
// 0: scroll to afternoon (reveal coaching/drive/dinner)
// 1: scroll back to school view + hover Tue P4
// 2: hover Thu P5
// 3: scroll to top + Sunday 10am anchor
// 4: Sunday drag to 6pm
// 5: examLanded
// 6: caption
const PHASE_MS = [3200, 1800, 1800, 2200, 1800, 1400, 0];

// ── Easing ────────────────────────────────────────────────────
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
}

function animateScroll(el: HTMLElement, to: number, ms: number) {
  const from = el.scrollTop;
  const diff = to - from;
  let t0: number | null = null;
  function step(now: number) {
    if (!t0) t0 = now;
    const p = Math.min((now - t0) / ms, 1);
    el.scrollTop = from + diff * easeInOutCubic(p);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Cursor SVG ────────────────────────────────────────────────
function Cursor() {
  return (
    <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.5 2L2.5 19L7 14.5L9.5 21.5L12.5 20.5L10 13.5H16L2.5 2Z"
        fill="white" stroke="#1A1A2E" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────
export default function TimeStarvation() {
  const [phase, setPhase]           = useState(-1);
  const [hasPlayed, setHasPlayed]   = useState(false);
  const [noMotion, setNoMotion]     = useState(false);
  const [examLeft, setExamLeft]     = useState(0);
  const [examWidth, setExamWidth]   = useState(0);
  const [examTop, setExamTop]       = useState(0);
  const [examHeight, setExamHeight] = useState(0);

  const scrollRef  = useRef<HTMLDivElement>(null);
  const colsRef    = useRef<HTMLDivElement>(null);
  const dayRefs    = useRef<(HTMLDivElement|null)[]>([]);
  const sectionRef = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout>|null>(null);

  // Reduced-motion: jump to final state
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setNoMotion(true);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      setPhase(6); setHasPlayed(true);
    }
  }, []);

  // Intersection observer → trigger animation
  useEffect(() => {
    if (noMotion) return;
    const obs = new IntersectionObserver(
      (e) => { if (e[0].isIntersecting && !hasPlayed) setPhase(0); },
      { threshold: 0.15 }
    );
    if (sectionRef.current) obs.observe(sectionRef.current);
    return () => obs.disconnect();
  }, [hasPlayed, noMotion]);

  // Phase 0: scroll down to reveal the packed afternoon
  useEffect(() => {
    if (phase === 0 && scrollRef.current)
      animateScroll(scrollRef.current, SCROLL_AFT, 2800);
  }, [phase]);

  // Phase 1: scroll back to school-day view (free periods visible)
  useEffect(() => {
    if (phase === 1 && scrollRef.current)
      animateScroll(scrollRef.current, SCROLL_SCH, 1500);
  }, [phase]);

  // Phase 3: scroll to top so Sunday church + exam are visible
  useEffect(() => {
    if (phase === 3 && scrollRef.current)
      animateScroll(scrollRef.current, 0, 1500);
  }, [phase]);

  // Timer chain
  useEffect(() => {
    if (phase < 0 || phase >= 6) return;
    timerRef.current = setTimeout(() => {
      setPhase(p => { const n = p + 1; if (n === 6) setHasPlayed(true); return n; });
    }, PHASE_MS[phase]);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase]);

  // Update floating block position/size
  function updatePos(hoverIdx: number) {
    const h = HOVER_SEQ[hoverIdx];
    const col = dayRefs.current[h.dayIdx];
    if (!col) return;
    setExamLeft(col.offsetLeft + 3);
    setExamWidth(col.offsetWidth - 6);
    setExamTop(minTop(h.start) + 1);
    setExamHeight(Math.max(minH(h.dur) - 2, 20));
  }

  useEffect(() => {
    if (phase < 1 || phase > 4) return;
    updatePos(phase - 1);
  }, [phase]);

  useEffect(() => {
    function onResize() {
      if (phase >= 1 && phase <= 4) updatePos(phase - 1);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [phase]);

  function replay() {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setHasPlayed(false);
    setPhase(0);
  }

  // Sunday exam position (HOVER_SEQ[3]: 10am–6pm)
  const sunH = HOVER_SEQ[3];
  const SUN_EXAM_TOP    = minTop(sunH.start) + 4;
  const SUN_EXAM_HEIGHT = Math.max(minH(sunH.dur) - 8, 40);

  const showFloat   = phase >= 1 && phase <= 4 && examWidth > 0;
  const examLanded  = phase >= 5;
  const showCaption = phase >= 6;

  return (
    <section className={styles['teacher-week']} ref={sectionRef}>
      <div className="container">
        <p className="eyebrow eyebrow-terracotta" style={{ marginBottom: '12px' }}>
          THE REALITY
        </p>
        <h2 className={styles['teacher-week__title']}>Where does the exam paper go?</h2>
        <p className={styles['teacher-week__lead']}>
          A South African teacher&apos;s week — every hour, accounted for.
        </p>

        {/* ── Desktop calendar ─────────────────────────────────── */}
        <div className={styles['calendar']}>

          <div className={styles['calendar__header']}>
            <div className={styles['calendar__gutter']} />
            {DAYS.map(d => (
              <div
                key={d.key}
                className={`${styles['calendar__day-heading']} ${d.key === 'sun' && examLanded ? styles['calendar__day-heading--sunday'] : ''}`}
              >
                {d.label}
              </div>
            ))}
          </div>

          <div className={styles['calendar__scroll']} ref={scrollRef} style={{ height: CONTAINER_H }}>
            <div className={styles['calendar__grid']} style={{ height: GRID_HEIGHT }}>

              {/* Time labels */}
              <div className={styles['calendar__times']}>
                {TIME_LABELS.map(t => (
                  <div key={t.min} className={styles['calendar__time']} style={{ top: minTop(t.min) }}>
                    {t.label}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              <div className={styles['calendar__days']} ref={colsRef}>
                {DAYS.map((day, i) => {
                  const isSat     = day.key === 'sat';
                  const isSun     = day.key === 'sun';
                  const isWeekday = !isSat && !isSun;
                  const teaching  = DAY_SCHEDULE[i] ?? [];
                  const afternoon = AFTERNOON[i] ?? [];

                  return (
                    <div
                      key={day.key}
                      className={`${styles['calendar__day']} ${isSun && examLanded ? styles['calendar__day--sunday'] : ''}`}
                      ref={el => { dayRefs.current[i] = el; }}
                    >
                      {/* Grid lines */}
                      {TIME_LABELS.map(t => (
                        <div key={t.min} className={styles['calendar__hour-rule']} style={{ top: minTop(t.min) }} />
                      ))}
                      {TIME_LABELS.slice(0, -1).map(t => (
                        <div key={`h${t.min}`} className={`${styles['calendar__hour-rule']} ${styles['calendar__half-hour-rule']}`} style={{ top: minTop(t.min + 30) }} />
                      ))}

                      {/* Teaching + break/lunch blocks */}
                      {isWeekday && teaching.map(b => (
                        <div
                          key={b.id}
                          className={`${styles['calendar__event']} ${b.sm ? styles['calendar__event--compact'] : ''}`}
                          style={{
                            top: minTop(b.start) + 1,
                            height: Math.max(minH(b.dur) - 2, 14),
                            background: b.bg,
                            borderLeftColor: b.bdr === 'none' ? 'transparent' : b.bdr,
                          }}
                        >
                          {!b.sm && <span className={styles['calendar__event-label']}>{b.label}</span>}
                          {!b.sm && b.sub && <span className={styles['calendar__event-detail']}>{b.sub}</span>}
                          {b.sm && <span className={styles['calendar__event-label--compact']}>{b.label}</span>}
                        </div>
                      ))}

                      {/* Afternoon blocks */}
                      {isWeekday && afternoon.map(b => (
                        <div
                          key={b.id}
                          className={styles['calendar__event']}
                          style={{
                            top: minTop(b.start) + 1,
                            height: Math.max(minH(b.dur) - 2, 14),
                            background: b.bg,
                            borderLeftColor: b.bdr,
                          }}
                        >
                          <span className={styles['calendar__event-label']}>{b.label}</span>
                          <span className={styles['calendar__event-detail']}>{b.sub}</span>
                        </div>
                      ))}

                      {/* Saturday */}
                      {isSat && (
                        <div
                          className={`${styles['teacher-week__sat-block']} ${styles['teacher-week__sat-visible']}`}
                          style={{ top: 1, height: GRID_HEIGHT - 2 }}
                        >
                          <span className={styles['calendar__event-label']}>Inter-school Rugby Festival</span>
                          <span className={styles['calendar__event-detail']}>All day</span>
                        </div>
                      )}

                      {/* Sunday church (always visible) */}
                      {isSun && (
                        <div
                          className={styles['calendar__event']}
                          style={{
                            top: 1,
                            height: Math.max(minH(120) - 2, 14),
                            background: '#EAE4F2',
                            borderLeftColor: '#9A6DD7',
                          }}
                        >
                          <span className={styles['calendar__event-label']}>Church</span>
                          <span className={styles['calendar__event-detail']}>8:00–10:00 am</span>
                        </div>
                      )}

                      {/* Sunday exam landed */}
                      {isSun && examLanded && (
                        <div
                          className={styles['teacher-week__exam-landed']}
                          style={{ top: SUN_EXAM_TOP, height: SUN_EXAM_HEIGHT }}
                        >
                          <span className={styles['teacher-week__exam-text']}>✎ Create June Exam</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Floating exam block + cursor */}
                {showFloat && (
                  <div
                    className={styles['teacher-week__exam-group']}
                    style={{ left: examLeft, width: examWidth, top: examTop, height: examHeight }}
                  >
                    <div className={styles['teacher-week__cursor-wrap']} aria-hidden="true"><Cursor /></div>
                    <div className={styles['teacher-week__exam-float']}>
                      <span className={styles['teacher-week__exam-text']}>✎ Create June Exam</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={styles['teacher-week__fade-top']} />
            <div className={styles['teacher-week__fade-bottom']} />
          </div>
        </div>

        {/* ── Mobile timeline ───────────────────────────────────── */}
        <div className={styles['teacher-week__list']}>
          {DAYS.map((day, i) => {
            const isSat = day.key === 'sat';
            const isSun = day.key === 'sun';
            const teaching = DAY_SCHEDULE[i] ?? [];
            const hasCoaching = (AFTERNOON[i] ?? []).some(b => b.id === 'c');
            const grades = teaching.filter(b => !b.sm).map(b => b.label).join(' · ');
            return (
              <div
                key={day.key}
                className={`${styles['teacher-week__mobile-row']} ${isSun && examLanded ? styles['teacher-week__mobile-row-sun'] : ''}`}
              >
                <span className={`${styles['teacher-week__mobile-day']} ${isSun && examLanded ? styles['teacher-week__mobile-day-sun'] : ''}`}>
                  {day.label}
                </span>
                <div className={styles['teacher-week__mobile-detail']}>
                  {!isSat && !isSun && (
                    <span className={styles['teacher-week__mobile-school']}>
                      {grades}{hasCoaching ? ' · Coaching' : ''}
                    </span>
                  )}
                  {isSat && <span className={`${styles['teacher-week__mobile-ghost']} ${styles['teacher-week__mobile-visible']}`}>Rugby Festival — All day</span>}
                  {isSun && <span className={styles['teacher-week__mobile-school']}>Church 8–10am{examLanded ? '' : ' · Free'}</span>}
                  {isSun && examLanded && <span className={styles['teacher-week__mobile-exam']}>✎ Create June Exam — 10am–6pm</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Caption */}
        <div className={`${styles['teacher-week__caption']} ${showCaption ? styles['teacher-week__caption-visible'] : ''}`}>
          <p className={styles['teacher-week__caption-head']}>Sunday. Every time.</p>
          <p className={styles['teacher-week__caption-body']}>
            Your teachers aren&apos;t choosing to work on weekends. Their weeks leave them no choice.
          </p>
        </div>

        {hasPlayed && !noMotion && (
          <button onClick={replay} className={styles['button--replay']} type="button">↺ Replay</button>
        )}
      </div>
    </section>
  );
}
