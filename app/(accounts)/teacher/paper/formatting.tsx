'use client';
import type { ReactNode } from 'react';
import type { Formatting } from '../../../../lib/workspace/contracts';
import styles from '../paper.module.css';
import type { PaperModel } from './model';

/** School formatting, unchanged in behaviour; restyled to sit in the paper journey. */
export default function FormattingView({paper,status,preferences,setPreferences,dirty,save}:{paper:PaperModel;status:ReactNode;preferences:Formatting;setPreferences:(p:Formatting)=>void;dirty:boolean;save:()=>void}) {
  const {data,busy}=paper;
  return <>
    <nav className={styles['breadcrumb']} aria-label="Breadcrumb"><button type="button" onClick={()=>paper.go('home')}>{data.module!.name}</button><span aria-hidden="true">/</span><span aria-current="page">School formatting{dirty?' · Unsaved':''}</span></nav>
    {status}
    <section className={styles['page-body']}>
      <div className={styles['card--panel']}><p className={styles['eyebrow--positive']}>School formatting</p><h1 className={styles['page-header--formatting']}>Make it your school’s paper</h1>
        <p className={styles['card__lead']}>These preferences are shared with your school’s teachers for this curriculum. Saving here sets preferences for future papers.</p>
        <form onSubmit={e=>{e.preventDefault();save();}} className={styles['form']}>
          <fieldset disabled={busy}><legend>Page and text</legend><p>A4 portrait</p>
            <div className={styles['form__pair']}><label>Font<select value={preferences.font} onChange={e=>setPreferences({...preferences,font:e.target.value as Formatting['font']})}><option>Arial</option><option>Times New Roman</option></select></label>
              <label>Text size<select value={preferences.fontSize} onChange={e=>setPreferences({...preferences,fontSize:Number(e.target.value) as 11|12})}><option value={11}>11 point</option><option value={12}>12 point</option></select></label></div>
            <label>Spacing<select value={preferences.spacing} onChange={e=>setPreferences({...preferences,spacing:e.target.value as Formatting['spacing']})}><option value="normal">Standard</option><option value="relaxed">More space</option></select></label>
            <label>School heading<input value={preferences.header} maxLength={160} placeholder={data.schoolName} onChange={e=>setPreferences({...preferences,header:e.target.value})}/></label>
            <label className={styles['form__checkbox']}><input type="checkbox" checked={preferences.answerLines} onChange={e=>setPreferences({...preferences,answerLines:e.target.checked})}/> Include answer lines for written responses</label></fieldset>
          <p className={styles['form-field__hint']}>Reference-template uploads and exact document previews will follow in a later step.</p>
          <div className={styles['form__actions']}><button type="button" className={styles['link']} onClick={()=>paper.go('home')}>Back</button><button className={styles['button--primary-compact']} disabled={busy || !dirty}>{busy?'Please wait…':'Save school formatting'}</button></div>
        </form></div>
      <div className={styles['paper-preview__container']}><p className={styles['eyebrow--neutral']}>Illustrative layout</p>
        <div className={styles['paper-preview__page']} style={{fontFamily:preferences.font,fontSize:preferences.fontSize+2,lineHeight:preferences.spacing==='relaxed'?2:1.5}}><strong>{preferences.header || data.schoolName}</strong><hr/><p>PHYSICAL SCIENCES</p><p>Question 1</p><p>This sample shows your text and spacing preferences.</p>{preferences.answerLines && <div className={styles['paper-preview__answer-lines']} aria-label="Sample learner answer lines"><hr/><hr/><hr/></div>}<small>Page 1</small></div>
        <p className={styles['card__note']}>This is a layout illustration, not a generated paper.</p></div>
    </section>
  </>;
}
