import styles from './status.module.css';

/**
 * Status marker (Paper K09): a coloured dot and a short label. The tone comes from the
 * fact the server reported; this component never decides what the status is.
 */
export type StatusTone = 'done'|'progress'|'attention'|'problem'|'closed';
export function StatusDot({tone}:{tone:StatusTone}) {
  return <span className={styles[`status__dot--${tone}`]} aria-hidden="true"/>;
}
export function Status({tone,label,as:Tag='span'}:{tone:StatusTone;label:React.ReactNode;as?:'span'|'p'}) {
  return <Tag className={styles['status']}><StatusDot tone={tone}/><span className={styles[`status__label--${tone}`]}>{label}</span></Tag>;
}
