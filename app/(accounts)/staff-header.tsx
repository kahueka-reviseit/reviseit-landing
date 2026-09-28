'use client';
import Link from 'next/link';
import { useId } from 'react';
import ui from './experience.module.css';
import { logout } from './actions';
import { MenuButton, useMenu } from './shell';

export type StaffPlace='overview'|'accounts'|'papers';
/** Navy staff header (S2 to S8p). Counts come from the page's own server reads. */
export function StaffHeader({current,counts,name,signedIn=false,record}:{current?:StaffPlace;counts?:{accounts:number|null;papers:number|null};name?:string;signedIn?:boolean;record?:{back:string;label:string;position?:string}}){
 const menu=useMenu(),id=useId();
 const links:{place:StaffPlace;href:string;label:string;count?:number|null;problem?:boolean}[]=[
  {place:'overview',href:'/admin',label:'Overview'},{place:'accounts',href:'/admin/accounts',label:'School accounts',count:counts?.accounts},
  {place:'papers',href:'/admin/papers',label:'Papers',count:counts?.papers,problem:true}];
 return <header className={`${ui['staff-header']} ${record?ui['staff-header--record']:''}`}>
  <div className={ui['staff-header__start']}>
   <Link className={ui['staff-header__brand']} href={signedIn?'/admin':'/admin/login'}><span className={ui['staff-header__wordmark']}>Revise It</span><span className={ui['staff-header__mark']}>ADMIN</span></Link>
   {signedIn&&<nav className={ui['staff-nav']} aria-label="Staff navigation">{links.map(l=><Link key={l.place} href={l.href} className={l.place===current?ui['staff-nav__link--current']:ui['staff-nav__link']} aria-current={l.place===current?'page':undefined}>
    {l.label}{typeof l.count==='number'&&l.count>0&&<span className={l.problem?ui['staff-nav__count--problem']:ui['staff-nav__count']}><span className="visually-hidden"> (</span>{l.count}<span className="visually-hidden"> waiting)</span></span>}</Link>)}</nav>}
  </div>
  {record&&<Link className={ui['staff-header__back']} href={record.back}>← {record.label}</Link>}
  {record?.position&&<span className={ui['staff-header__position']}>{record.position}</span>}
  {signedIn&&<div className={ui['staff-header__end']}>{name&&<span className={ui['staff-header__user']}>Signed in as {name} · reviewer</span>}<form action={logout}><button className={ui['staff-header__signout']}>Sign out</button></form>
   <MenuButton menu={menu} controls={id} light/></div>}
  {signedIn&&<div id={id} className={menu.open?ui['nav-menu--open']:ui['nav-menu']}>{links.map(l=><Link key={l.place} href={l.href} className={l.place===current?ui['nav-menu__link--current']:ui['nav-menu__link']}>{l.label}{typeof l.count==='number'&&l.count>0?` · ${l.count}`:''}</Link>)}<form action={logout}><button className={ui['nav-menu__button']}>Sign out</button></form></div>}
 </header>;
}
