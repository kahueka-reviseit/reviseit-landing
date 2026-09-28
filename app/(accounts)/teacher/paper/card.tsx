'use client';
import { useEffect, useState, type MouseEvent } from 'react';
import type { CatalogueEntry } from '../../../../lib/workspace/contracts';
import { formatMarks } from '../../../../lib/workspace/catalogue';
import { bloomSpan, codeOf, kindLabels, kindOf } from '../../../../lib/workspace/paper';
import styles from '../paper.module.css';
import { Icon } from './ui';

export const cardId=(id:string)=>`card-${id.replace(/[^A-Za-z0-9_-]/g,'-')}`;

/** The selection control: a real checkbox, drawn as the design's round add button or "Added" pill. */
export function AddControl({entry,count,disabled,onToggle,small=false}:{entry:CatalogueEntry;count:number;disabled:boolean;onToggle:(checked:boolean)=>void;small?:boolean}) {
  const selected=count>0;
  return <label className={`${styles['catalogue-card__add']} ${selected?styles['catalogue-card__add--added']:''} ${small?styles['catalogue-card__add--compact']:''} ${disabled&&!selected?styles['catalogue-card__add--unavailable']:''}`} title={!entry.orderable?'Not yet available to order':undefined}>
    <input type="checkbox" checked={selected} disabled={disabled && !selected} onChange={e=>onToggle(e.target.checked)} aria-label={`Select ${entry.title}`}/>
    {selected ? <span>{Icon.check(12)}{small?null:<> Added{count>1?` ×${count}`:''}</>}</span> : <span>{Icon.plus(small?12:14)}</span>}
  </label>;
}

export function CatalogueCard({entry,count,disabled,onToggle,onOpen,onTopic}:{entry:CatalogueEntry;count:number;disabled:boolean;onToggle:(checked:boolean)=>void;onOpen:()=>void;onTopic?:()=>void}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[entry.thumbnail?.src]);
  const kind=kindOf(entry), span=bloomSpan(entry), preview=entry.preview;
  const titleId=`${cardId(entry.id)}-title`;
  // Clicking the card body opens the detail view; the add and topic controls keep their own action.
  const open=(e:MouseEvent)=>{if(!(e.target as HTMLElement).closest('button,a,label,input'))onOpen();};
  const compact=kind==='multiple_choice' && !entry.thumbnail;
  return <article className={`${styles['catalogue-card']} ${count?styles['catalogue-card--added']:''} ${!entry.orderable?styles['catalogue-card--unavailable']:''} ${compact?styles['catalogue-card--compact']:''}`} aria-labelledby={titleId} onClick={open}>
    <div className={styles['catalogue-card__header']}><span className={kind==='structured'?styles['catalogue-card__type--structured']:styles['catalogue-card__type--multiple-choice']}>{kindLabels[kind]}</span><span className={styles['catalogue-card__code']}>{codeOf(entry.id)}</span></div>
    <h3 id={titleId} className={styles['catalogue-card__title']}><button type="button" id={cardId(entry.id)} onClick={onOpen}>{entry.title}</button></h3>
    <p className={styles['catalogue-card__marks']}><strong>{formatMarks(entry.marks)}</strong> <span>marks</span></p>
    {!compact && <div className={`${styles['catalogue-card__diagram']} ${entry.thumbnail?'':styles['catalogue-card__diagram--empty']}`}>{entry.thumbnail && !failed ? <img src={entry.thumbnail.src} alt={entry.thumbnail.alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/> :
      <span>{entry.thumbnail?'Diagram preview unavailable':'No diagram preview'}</span>}</div>}
    <div className={styles['catalogue-card__meta']}>
      <span>{Icon.parts()}{preview ? `${formatMarks(preview.subquestions)} ${preview.subquestions.max===1?(kind==='multiple_choice'?'item':'part'):'parts'}` : 'Parts not yet published'}</span>
      <span>{Icon.steps()}{span ?? 'Not yet classified'}</span>
    </div>
    {!entry.orderable && <p className={styles['catalogue-card__unavailable-note']}>Not yet available to order.</p>}
    <div className={styles['catalogue-card__footer']}>
      {onTopic ? <button type="button" className={styles['catalogue-card__topic']} onClick={onTopic} aria-label={`Show only ${entry.topic}`}>{entry.topic}</button> : <span className={styles['catalogue-card__topic']}>{entry.topic}</span>}
      <AddControl entry={entry} count={count} disabled={disabled || !entry.orderable} onToggle={onToggle}/>
    </div>
  </article>;
}
