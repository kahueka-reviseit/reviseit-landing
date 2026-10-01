'use client';
import Link from 'next/link';
import { useId } from 'react';
import ui from './experience.module.css';
import nav from './system/navigation.module.css';
import { MenuButton, SiteHeader, useMenu } from './system/navigation';
import { button } from './system/button';

/**
 * Headers for the three audiences (Paper C07 T1 to T4, M1, S2 to S8p). Teacher and
 * signed-out pages share the sage-striped header; staff pages use the navy header.
 * On phones the links collapse behind one Menu button that closes with Escape.
 */
export type TeacherPlace = 'curricula'|'papers'|'account';
export function initials(name:string){const parts=name.trim().split(/\s+/).filter(Boolean);return (parts.length>1?parts[0][0]+parts[parts.length-1][0]:(parts[0]||'?').slice(0,2)).toUpperCase();}

/** Signed-in teacher header. Until access is verified only My account is shown (T4). */
export function TeacherHeader({current,name,verified=true}:{current:TeacherPlace;name?:string;verified?:boolean}){
 const menu=useMenu(),id=useId();
 const links:{place:TeacherPlace;href:string;label:string;full?:boolean}[]=verified?[
  // A full load: the workspace reads its screen from the address on arrival.
  {place:'curricula',href:'/teacher?view=home',label:'My curricula',full:true},{place:'papers',href:'/teacher/orders',label:'My papers'},{place:'account',href:'/account',label:'My account'}]:
  [{place:'account',href:'/account',label:'My account'}];
 const link=(l:typeof links[number],cls:string,avatar:boolean)=>{
  const body=<>{avatar&&l.place==='account'&&name?<span className={nav['site-nav__avatar']} aria-hidden="true">{initials(name)}</span>:null}{l.label}</>;
  const props={className:cls,'aria-current':l.place===current?'page' as const:undefined};
  return l.full?<a key={l.place} href={l.href} {...props}>{body}</a>:<Link key={l.place} href={l.href} {...props}>{body}</Link>;
 };
 return <SiteHeader variant="account" label="Account navigation" brandHref={verified?'/teacher?view=home':'/account'}>
  <span className={nav['site-nav__links']}>{links.map(l=>link(l,l.place===current?nav['site-nav__link--current']:nav['site-nav__link'],true))}</span>
  <MenuButton menu={menu} controls={id}/>
  <div id={id} className={menu.open?nav['nav-menu--open']:nav['nav-menu']}>{links.map(l=>link(l,l.place===current?nav['nav-menu__link--current']:nav['nav-menu__link'],false))}</div>
 </SiteHeader>;
}

/** Signed-out header (T1, T2): the wordmark and the one alternative way in. */
export function SignedOutHeader({entry}:{entry:'sign-in'|'create'|'none'}){
 return <SiteHeader variant="account" label="Account navigation" brandHref="/">
  {entry==='sign-in'&&<span className={nav['site-nav__entry']}><span className={nav['site-nav__prompt']}>Already have an account?</span><Link className={button('secondary')} href="/login">Sign in</Link></span>}
  {entry==='create'&&<span className={nav['site-nav__entry']}><span className={nav['site-nav__prompt']}>New to Revise It?</span><Link className={button('secondary')} href="/register">Create account</Link></span>}
 </SiteHeader>;
}
