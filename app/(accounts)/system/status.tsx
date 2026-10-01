import styles from './status.module.css';

/**
 * Status marker (Paper K09): a coloured dot and a short label. The tone comes from the
 * fact the server reported; this component never decides what the status is.
 */
export type StatusTone = 'done'|'progress'|'attention'|'problem'|'closed';
export function StatusDot({tone}:{tone:StatusTone}) {
  return <span className={styles[`status__dot--${tone}`]} aria-hidden="true"/>;
}
/** `table` is the denser presentation inside a question table row: a regular-weight label in the body colour. */
export function Status({tone,label,as:Tag='span',density='default'}:{tone:StatusTone;label:React.ReactNode;as?:'span'|'p'|'div';density?:'default'|'table'}) {
  return <Tag className={styles['status']}><StatusDot tone={tone}/><span className={`${styles[`status__label--${tone}`]}${density==='table'?` ${styles['status__label--table']}`:''}`}>{label}</span></Tag>;
}
