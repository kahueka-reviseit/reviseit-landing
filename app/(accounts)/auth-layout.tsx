import type { ReactNode } from 'react';
import { SignedOutHeader } from './shell';
import ui from './experience.module.css';

/** T1/T2 frame: signed-out header, editorial left column, form card on the right. */
const steps=[
  ['Create your account','Your name, school, department and school email'],
  ['Confirm your school email','Follow the link we send you'],
  ['We verify your school','Then your curricula open in My curricula'],
] as const;
export default function AuthLayout({eyebrow='For Physical Sciences departments',title,lede,step,entry,children}:{eyebrow?:string;title:string;lede?:string;step?:1|2|3;entry:'sign-in'|'create'|'none';children:ReactNode}) {
  return <><SignedOutHeader entry={entry}/><main className={ui['site-shell__main']}><div className={ui['page']}><div className={ui['auth-layout']}>
    <div className={ui['auth-layout__intro']}>
      <p className={ui['auth-layout__eyebrow']}>{eyebrow}</p>
      <h1 className={ui['auth-layout__title']}>{title}</h1>
      {lede&&<p className={ui['auth-layout__lede']}>{lede}</p>}
      {step&&<ol className={ui['auth-steps']}>{steps.map(([t,d],i)=><li key={t} className={ui['auth-steps__step']} aria-current={i+1===step?'step':undefined}>
        <span className={i+1<step?ui['auth-steps__marker--done']:i+1===step?ui['auth-steps__marker--current']:ui['auth-steps__marker']} aria-hidden="true">{i+1<step?'✓':i+1}</span>
        <span className={ui['auth-steps__text']}><span className={ui['auth-steps__title']}>{t}</span><span className={ui['auth-steps__detail']}>{d}</span></span></li>)}</ol>}
    </div>
    {children}
  </div></div></main></>;
}
