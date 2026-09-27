import type { ReactNode } from 'react';
import type { BloomCategory } from '../../../../lib/workspace/contracts';
import styles from '../paper.module.css';

/** Icons drawn from the Paper design; decorative, so hidden from assistive technology. */
export const Icon = {
  plus:(size=14)=><svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  check:(size=12)=><svg aria-hidden="true" width={size} height={size} viewBox="0 0 12 12"><path d="M2 6.5 L5 9 L10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  arrow:(size=14)=><svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14"><path d="M3 7 L11 7 M7.5 3.5 L11 7 L7.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  back:(size=14)=><svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14"><path d="M11 7 L3 7 M6.5 3.5 L3 7 L6.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevron:(open=false)=><svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" style={{transform:open?'rotate(180deg)':undefined}}><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  close:()=><svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  search:()=><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M11 11 L14.5 14.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  parts:()=><svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h10M2 7h10M2 11h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  steps:()=><svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><path d="M1.5 12.5h3v-3h3v-3h3v-3h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  topic:()=><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M2 13 L14 13 L14 5 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  up:()=><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M6 10 V2 M2.5 5.5 L6 2 L9.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  down:()=><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M6 2 V10 M2.5 6.5 L6 10 L9.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

export const bloomClass:Record<string,string> = {
  Remember:styles.bRemember, Understand:styles.bUnderstand, Apply:styles.bApply, Analyse:styles.bAnalyse, Evaluate:styles.bEvaluate, Create:styles.bCreate,
};
export function BloomTag({bloom}:{bloom:BloomCategory|string}) {
  return <span className={`${styles.bloomTag} ${bloomClass[bloom] ?? styles.bUnclassified}`}>{bloom}</span>;
}
/** Proportional Bloom's bar; widths come from marks, never from invented weights. */
export function BloomBar({rows}:{rows:{bloom:string;weight:number}[]}) {
  return <span className={styles.bloomBar} aria-hidden="true">{rows.map(r=><i key={r.bloom} className={bloomClass[r.bloom]} style={{flexGrow:r.weight}}/>)}</span>;
}

export type Stage = {label:string; state:'done'|'now'|'next'};
/** The journey pills shared by the builder, review and paid configuration screens. */
export function Stages({stages,label='Progress'}:{stages:Stage[];label?:string}) {
  return <ol className={styles.stages} aria-label={label}>{stages.map((s,i)=><li key={s.label} className={styles[s.state]} aria-current={s.state==='now'?'step':undefined}>
    {s.state==='done'?<><span aria-hidden="true">✓ </span><span className={styles.srOnly}>Done: </span></>:<span>{i+1} </span>}{s.label}</li>)}</ol>;
}

export function PageHeader({eyebrow,title,subtitle,back,aside}:{eyebrow?:ReactNode;title:ReactNode;subtitle?:ReactNode;back?:{label:string;onClick:()=>void};aside?:ReactNode}) {
  return <header className={styles.pageHeader}>
    <div className={styles.pageTitle}>
      {back ? <button type="button" className={styles.backEyebrow} onClick={back.onClick}>{Icon.back(12)} {back.label}</button> : eyebrow ? <p className={styles.eyebrowSlate}>{eyebrow}</p> : null}
      <h1>{title}</h1>
      {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
    </div>
    {aside}
  </header>;
}

export function Meter({label,value,fill,tone}:{label:string;value:string;fill:number;tone:'structured'|'mc'}) {
  return <div className={styles.meter}>
    <div><span>{label}</span><strong>{value}</strong></div>
    <span className={styles.track} aria-hidden="true"><i className={tone==='mc'?styles.fillMc:styles.fillStructured} style={{width:`${Math.max(0,Math.min(100,Math.round(fill*100)))}%`}}/></span>
  </div>;
}
