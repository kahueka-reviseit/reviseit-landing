'use client';
import { formatMarks, totalMarks } from '../../../../lib/workspace/catalogue';
import styles from '../paper.module.css';
import type { PaperModel } from './model';
import { Icon, Meter } from './ui';

/** Always-visible paper summary while browsing (Paper: "Your paper bar"). Figures are computed, never examples. */
export default function PaperBar({paper}:{paper:PaperModel}) {
  const {occurrences,sectionTargets,limits,sectionTotal,configured,data}=paper;
  const structured=occurrences.filter(o=>o.kind==='structured').map(o=>o.entry), mcq=occurrences.filter(o=>o.kind==='multiple_choice');
  const range=totalMarks(structured);
  const sTarget=sectionTargets.structured, allocated=sectionTotal('structured');
  const structuredValue=sTarget!==undefined ? `${configured&&paper.marksSet?allocated:formatMarks(range)} of ${sTarget} marks` : structured.length ? `${structured.length} · ${formatMarks(range)} marks` : 'None chosen';
  const mcCap=sectionTargets.multiple_choice!==undefined ? Math.floor(sectionTargets.multiple_choice/2) : limits.multipleChoice;
  const total=occurrences.length;
  return <aside className={styles['bottom-bar']} aria-label="Your paper">
    <div className={styles['bottom-bar__paper']}><p>Your paper</p><strong>{data.module!.name}</strong></div>
    <Meter tone="structured" label="Structured" value={structuredValue} fill={sTarget?Math.min(range.max,allocated||range.max)/sTarget:structured.length/Math.max(1,limits.structured)}/>
    <Meter tone="mc" label="Multiple choice" value={`${mcq.length} of ${mcCap} chosen`} fill={mcq.length/Math.max(1,mcCap)}/>
    <div className={styles['bottom-bar__actions']}>
      <span className={styles['bottom-bar__status']} aria-live="polite">{total} {total===1?'question':'questions'}{paper.selectionDirty?' · unsaved':''}</span>
      <button type="button" className={styles['bottom-bar__button']} onClick={()=>paper.go('builder')}>Open paper builder {Icon.arrow()}</button>
    </div>
  </aside>;
}
