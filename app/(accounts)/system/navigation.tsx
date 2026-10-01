'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './navigation.module.css';

/**
 * Site header (family K11). One definition for teachers, signed-out visitors and the public site:
 * the stripe, the wordmark and the bar, in three explicit variants. Each screen supplies its own
 * destinations, current place and action, so audiences keep their own routes and permissions.
 */
export type NavVariant='account'|'public'|'inverse';
export function SiteHeader({variant,label,brandHref,children}:{variant:NavVariant;label?:string;brandHref?:string;children?:ReactNode}) {
  const brand=brandHref?<Link className={styles['site-nav__brand']} href={brandHref}>Revise It</Link>:<span className={styles['site-nav__brand']}>Revise It</span>;
  return <header className={styles['site-header']}>
    <nav className={`${styles['site-nav']} ${styles[`site-nav--${variant}`]}`} aria-label={label}>
      <div className={styles['site-nav__inner']}>{brand}{children}</div>
    </nav>
  </header>;
}

/** Phone menu state: Escape closes it and returns focus to the Menu button. */
export function useMenu(){
  const [open,setOpen]=useState(false);const button=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
  return {open,setOpen,button};
}
export function MenuButton({menu,controls,inverse=false}:{menu:ReturnType<typeof useMenu>;controls:string;inverse?:boolean}){
  return <button ref={menu.button} type="button" className={`${styles['site-nav__menu-toggle']}${inverse?` ${styles['site-nav__menu-toggle--inverse']}`:''}`} aria-expanded={menu.open} aria-controls={controls} onClick={()=>menu.setOpen(!menu.open)}>Menu <span className={styles['site-nav__menu-icon']} aria-hidden="true"/></button>;
}
