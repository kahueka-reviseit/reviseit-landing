import styles from './button.module.css';

/**
 * Buttons (Paper Design System, Components 1 "Buttons"; family K13). One definition for every
 * button and button-styled link in the application and the public site. Every button is a full
 * pill. Tone says what the button does; size says where it sits:
 *
 * - primary   the one decision on a panel (dark sage)
 * - action    progress through the catalogue and builder (sage)
 * - secondary the way back, or a lesser choice (sage outline)
 * - inverse   on the staff overview (navy)
 * - text      small jobs inside rows; danger is the destructive text link
 *
 * Sizes: xsmall inside table rows, small beside other controls, medium as a standalone action,
 * hero on the public site, large as the commit of a panel or form. `full` fills its container.
 * Returns class names so the same look applies to <button>, <a> and <Link>. Callers may add a
 * layout class (margin, alignment) of their own, never a visual one.
 */
export type ButtonTone='primary'|'action'|'secondary'|'inverse'|'text'|'danger';
export type ButtonSize='xsmall'|'small'|'medium'|'hero'|'large';
const defaults:Record<ButtonTone,ButtonSize>={primary:'medium',action:'medium',inverse:'small',secondary:'small',text:'medium',danger:'medium'};
export function button(tone:ButtonTone,{size,full=false,className}:{size?:ButtonSize;full?:boolean;className?:string}={}):string {
  const link=tone==='text'||tone==='danger';
  return [styles['button'],styles[`button--${tone}`],styles[`button--${link?`link-${size??defaults[tone]}`:size??defaults[tone]}`],full?styles['button--full']:'',className??''].filter(Boolean).join(' ');
}
