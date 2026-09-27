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
  return <label className={`${styles.add} ${selected?styles.added:''} ${small?styles.addSmall:''} ${disabled&&!selected?styles.addOff:''}`} title={!entry.orderable?'Not yet available to order':undefined}>
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
  return <article className={`${styles.card} ${count?styles.cardAdded:''} ${!entry.orderable?styles.cardUnavailable:''} ${compact?styles.cardCompact:''}`} aria-labelledby={titleId} onClick={open}>
    <div className={styles.typeRow}><span className={kind==='structured'?styles.kindStructured:styles.kindMcq}>{kindLabels[kind]}</span><span className={styles.code}>{codeOf(entry.id)}</span></div>
    <h3 id={titleId} className={styles.cardTitle}><button type="button" id={cardId(entry.id)} onClick={onOpen}>{entry.title}</button></h3>
    <p className={styles.cardMarks}><strong>{formatMarks(entry.marks)}</strong> <span>marks</span></p>
    {!compact && <div className={styles.diagramBox}>{entry.thumbnail && !failed ? <img src={entry.thumbnail.src} alt={entry.thumbnail.alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/> :
      <span>{entry.thumbnail?'Diagram preview unavailable':'No diagram preview'}</span>}</div>}
    <div className={styles.metaRow}>
      <span>{Icon.parts()}{preview ? `${formatMarks(preview.subquestions)} ${preview.subquestions.max===1?(kind==='multiple_choice'?'item':'part'):'parts'}` : 'Parts not yet published'}</span>
      <span>{Icon.steps()}{span ?? 'Not yet classified'}</span>
    </div>
    {!entry.orderable && <p className={styles.unavailableNote}>Not yet available to order.</p>}
    <div className={styles.cardFooter}>
      {onTopic ? <button type="button" className={styles.topicChip} onClick={onTopic} aria-label={`Show only ${entry.topic}`}>{entry.topic}</button> : <span className={styles.topicChip}>{entry.topic}</span>}
      <AddControl entry={entry} count={count} disabled={disabled || !entry.orderable} onToggle={onToggle}/>
    </div>
  </article>;
}
