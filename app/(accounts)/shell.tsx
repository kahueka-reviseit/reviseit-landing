'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import ui from './experience.module.css';

/**
 * Headers for the three audiences (Paper C07 T1 to T4, M1, S2 to S8p). Teacher and
 * signed-out pages share the sage-striped header; staff pages use the navy header.
 * On phones the links collapse behind one Menu button that closes with Escape.
 */
export type TeacherPlace = 'curricula'|'papers'|'account';
export function initials(name:string){const parts=name.trim().split(/\s+/).filter(Boolean);return (parts.length>1?parts[0][0]+parts[parts.length-1][0]:(parts[0]||'?').slice(0,2)).toUpperCase();}

export function useMenu(){
 const [open,setOpen]=useState(false);const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 return {open,setOpen,button};
}
export function MenuButton({menu,controls,light}:{menu:ReturnType<typeof useMenu>;controls:string;light?:boolean}){
 return <button ref={menu.button} type="button" className={ui['site-nav__menu-toggle']} style={light?{color:'var(--color-on-inverse)'}:undefined} aria-expanded={menu.open} aria-controls={controls} onClick={()=>menu.setOpen(!menu.open)}>Menu <span className={ui['site-nav__menu-icon']} aria-hidden="true"/></button>;
}

/** Signed-in teacher header. Until access is verified only My account is shown (T4). */
export function TeacherHeader({current,name,verified=true}:{current:TeacherPlace;name?:string;verified?:boolean}){
 const menu=useMenu(),id=useId();
 const links:{place:TeacherPlace;href:string;label:string;full?:boolean}[]=verified?[
  // A full load: the workspace reads its screen from the address on arrival.
  {place:'curricula',href:'/teacher?view=home',label:'My curricula',full:true},{place:'papers',href:'/teacher/orders',label:'My papers'},{place:'account',href:'/account',label:'My account'}]:
  [{place:'account',href:'/account',label:'My account'}];
 const link=(l:typeof links[number],cls:string,avatar:boolean)=>{
  const body=<>{avatar&&l.place==='account'&&name?<span className={ui['site-nav__avatar']} aria-hidden="true">{initials(name)}</span>:null}{l.label}</>;
  const props={className:cls,'aria-current':l.place===current?'page' as const:undefined};
  return l.full?<a key={l.place} href={l.href} {...props}>{body}</a>:<Link key={l.place} href={l.href} {...props}>{body}</Link>;
 };
 return <header className={ui['site-header']}><nav className={ui['site-nav']} aria-label="Account navigation">
  <Link className={ui['site-nav__brand']} href={verified?'/teacher?view=home':'/account'}>Revise It</Link>
  <span className={ui['site-nav__links']}>{links.map(l=>link(l,l.place===current?ui['site-nav__link--current']:ui['site-nav__link'],true))}</span>
  <MenuButton menu={menu} controls={id}/>
  <div id={id} className={menu.open?ui['nav-menu--open']:ui['nav-menu']}>{links.map(l=>link(l,l.place===current?ui['nav-menu__link--current']:ui['nav-menu__link'],false))}</div>
 </nav></header>;
}

/** Signed-out header (T1, T2): the wordmark and the one alternative way in. */
export function SignedOutHeader({entry}:{entry:'sign-in'|'create'|'none'}){
 return <header className={ui['site-header']}><nav className={ui['site-nav']} aria-label="Account navigation">
  <Link className={ui['site-nav__brand']} href="/">Revise It</Link>
  {entry==='sign-in'&&<span className={ui['site-nav__entry']}><span className={ui['site-nav__prompt']}>Already have an account?</span><Link className={ui['button--secondary']} href="/login">Sign in</Link></span>}
  {entry==='create'&&<span className={ui['site-nav__entry']}><span className={ui['site-nav__prompt']}>New to Revise It?</span><Link className={ui['button--secondary']} href="/register">Create account</Link></span>}
 </nav></header>;
}

