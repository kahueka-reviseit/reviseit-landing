import {useEffect,useRef,type ReactNode} from 'react';
import styles from './configure.module.css';
export default function PaperPanel({title,eyebrow,summary,children,footer,onClose}:{title:string;eyebrow:string;summary:string;children:ReactNode;footer?:ReactNode;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;
  const position=()=>{const nav=document.querySelector('[aria-label="Account navigation"]');
   const top=window.innerWidth<=1050?0:Math.max(0,nav?.getBoundingClientRect().bottom??81);
   dialog.style.setProperty('--panel-top',`${top}px`);
  };position();window.addEventListener('resize',position);
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  return()=>{window.removeEventListener('resize',position);if(typeof dialog.close==='function')dialog.close();document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 return <dialog ref={ref} className={styles['side-panel']} aria-labelledby="panel-title" onCancel={e=>{e.preventDefault();onClose();}}>
  <header className={styles['side-panel__header']}><div className={styles['side-panel__top']}><p>{eyebrow}</p><button type="button" aria-label="Close editor" onClick={onClose}>×</button></div>
   <h2 id="panel-title">{title}</h2><p className={styles['side-panel__summary']}>{summary}</p></header>
  <div className={styles['side-panel__body']}>{children}</div>
  <footer className={styles['side-panel__footer']}>{footer??<button type="button" className={styles['button--secondary']} onClick={onClose}>Back to paper</button>}</footer>
 </dialog>;
}
