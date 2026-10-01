import type { ReactNode, RefObject } from 'react';
import styles from './notice.module.css';

/**
 * Task feedback (Paper K04): what happened to the person's work and what they can do
 * next. A notice stays until the state behind it changes; it is never an optional hint
 * and has no dismiss control. The caller decides the tone, the words and whether the
 * message is announced as a status or an alert.
 */
export type NoticeTone = 'progress'|'caution'|'success'|'neutral'|'problem';
type NoticeProps = {
  tone:NoticeTone;
  /** Shown above the body. `prominent` is the larger page-level heading. */
  title?:ReactNode; prominent?:boolean;
  children?:ReactNode;
  /** Recovery controls, placed under the message. */
  actions?:ReactNode;
  role?:'status'|'alert';
  /** `p` renders a single-line message; the default block takes a title, body and actions. */
  as?:'div'|'p';
  id?:string; tabIndex?:number; focusRef?:RefObject<HTMLDivElement>;
};
export function Notice({tone,title,prominent=false,children,actions,role,as='div',id,tabIndex,focusRef}:NoticeProps) {
  if(as==='p') return <p id={id} role={role} className={styles[`notice--${tone}`]}><span className={styles['notice__body']}>{children}</span></p>;
  return <div ref={focusRef} id={id} tabIndex={tabIndex} className={styles[`notice--${tone}`]} role={role}>
    {title&&<p className={styles[prominent?'notice__title':'notice__title--compact']}>{title}</p>}
    {children&&<p className={styles['notice__body']}>{children}</p>}
    {actions&&<div className={styles['notice__actions']}>{actions}</div>}
  </div>;
}

/** Several notices above a page keep one rhythm. */
export function NoticeStack({children}:{children:ReactNode}) {
  return <div className={styles['notice-stack']}>{children}</div>;
}

/**
 * Feedback beside the control it concerns, inside a question editor: a failed save, a
 * conflict, a required consequence of another choice. Compact, and always persistent.
 */
export type InlineTone = 'problem'|'required'|'info';
export function InlineNotice({tone,children,role,id,as:Tag='p',className,label}:{tone:InlineTone;children:ReactNode;role?:'status'|'alert';id?:string;as?:'p'|'span'|'div'|'section';className?:string;label?:string}) {
  return <Tag id={id} role={role} aria-label={label} className={`${styles[`notice--inline-${tone}`]}${className?` ${className}`:''}`}>{children}</Tag>;
}
