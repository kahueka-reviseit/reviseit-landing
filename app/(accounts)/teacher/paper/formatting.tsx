'use client';
import { useState } from 'react';
import type { Formatting } from '../../../../lib/workspace/contracts';
import styles from '../paper.module.css';
import ui from '../../experience.module.css';
import type { PaperModel } from './model';

/**
 * School formatting (Paper F1, F1p). The controls are exactly the existing ones and
 * save through the existing endpoint. The server's reply decides the notice: 409 means
 * someone at the school changed the settings, 422 unsupported settings, 503 unavailable.
 */
const failures:Record<number,{tone:'caution'|'problem';title:string;body:string}>={
  409:{tone:'caution',title:'Someone at your school changed these settings',body:'Reload to see the latest settings before saving yours.'},
  422:{tone:'problem',title:'These saved settings are no longer supported',body:'Review them and save again.'},
  503:{tone:'problem',title:'School formatting is unavailable',body:'Nothing was changed; try again shortly.'},
};
export default function FormattingView({paper,preferences,setPreferences,dirty,save,saved,failure}:{paper:PaperModel;preferences:Formatting;setPreferences:(p:Formatting)=>void;dirty:boolean;save:()=>void;saved:boolean;failure:number|null}) {
  const {data,busy}=paper;const [preview,setPreview]=useState(false);
  const problem=failure===null?null:failures[failure]??failures[503];
  const name=data.module!.name;
  return <div className={ui['formatting__page']}>
    <header className={ui['page-header--paper']}>
      <nav className={`${ui['breadcrumb']} ${ui['breadcrumb--collapsible']}`} aria-label="Breadcrumb"><button type="button" className={ui['breadcrumb__back']} onClick={()=>paper.go('home')}>← {name}</button>
        <button type="button" className={ui['breadcrumb__link']} onClick={()=>paper.go('home')}>{name}</button><span aria-hidden="true">/</span><span className={ui['breadcrumb__current']} aria-current="page">School formatting</span>{dirty&&<span className={ui['formatting__unsaved']}>· Unsaved changes</span>}</nav>
      <div className={ui['page-header__titles']}><p className={ui['formatting__eyebrow']}>School formatting</p><h1 className={ui['page-header__title--paper']}>Make it your school’s paper</h1></div>
    </header>
    <div className={ui['formatting']}>
      <form onSubmit={e=>{e.preventDefault();save();}} className={ui['formatting__form']} aria-describedby="formatting-scope">
        <div id="formatting-scope" className={ui['notice--progress']}><p className={ui['notice__title--compact']}>Shared with your school</p><p className={ui['notice__body']}>These settings are shared with every teacher at {data.schoolName} for {name}. Saving sets them for future papers.</p></div>
        <div aria-live="polite">{saved&&!problem&&<div className={ui['notice--success']} role="status"><p className={ui['notice__title--compact']}>School formatting saved for this curriculum.</p></div>}</div>
        {problem&&<div className={ui[`notice--${problem.tone}`]} role="alert"><p className={ui['notice__title--compact']}>{problem.title}</p><p className={ui['notice__body']}>{problem.body}</p>{failure===409&&<div className={ui['notice__actions']}><a className={ui['button--secondary']} href="/teacher?view=formatting">Reload settings</a></div>}</div>}
        <fieldset disabled={busy} className={ui['formatting__fields']}>
          <div className={ui['formatting__section-head']}><legend className={ui['formatting__legend']}>Page and text</legend><p className={ui['formatting__fixed']}>Page size: A4 portrait (fixed)</p></div>
          <div className={ui['form__row']}>
            <label className={ui['field']}><span className={ui['field__label']}>Font</span><select className={ui['field__select']} value={preferences.font} onChange={e=>setPreferences({...preferences,font:e.target.value as Formatting['font']})}><option>Arial</option><option>Times New Roman</option></select></label>
            <label className={ui['field--narrow']}><span className={ui['field__label']}>Text size</span><select className={ui['field__select']} value={preferences.fontSize} onChange={e=>setPreferences({...preferences,fontSize:Number(e.target.value) as 11|12})}><option value={11}>11 point</option><option value={12}>12 point</option></select></label>
          </div>
          <fieldset className={ui['formatting__spacing']}><legend className={ui['formatting__spacing-label']}>Spacing</legend>
            <div className={ui['segmented-control--form']}>{([['normal','Standard'],['relaxed','More space']] as const).map(([value,label])=><label key={value} className={ui['segmented-control__option']}><input className={ui['segmented-control__input']} type="radio" name="spacing" value={value} checked={preferences.spacing===value} onChange={()=>setPreferences({...preferences,spacing:value})}/>{label}</label>)}</div></fieldset>
          <div className={ui['field']}><label className={ui['field__label']} htmlFor="school-heading">School heading</label><input id="school-heading" className={ui['field__input']} value={preferences.header} maxLength={160} placeholder={data.schoolName} aria-describedby="heading-hint" onChange={e=>setPreferences({...preferences,header:e.target.value})}/>
            <p id="heading-hint" className={ui['field__hint']}>Printed at the top of each paper. Leave blank to use your school’s name. Up to 160 characters.</p></div>
          <label className={ui['field__check']}><input type="checkbox" checked={preferences.answerLines} onChange={e=>setPreferences({...preferences,answerLines:e.target.checked})}/> Include answer lines for written responses</label>
        </fieldset>
        <div className={ui['formatting__actions']}>
          <button type="button" className={ui['button--text']} onClick={()=>paper.go('home')}>← Back to {name}</button>
          <button className={ui['button--primary']} disabled={busy || !dirty}>{busy?'Saving…':'Save school formatting'}</button>
        </div>
      </form>
      <section className={`${ui['formatting__preview']} ${preview?'':ui['formatting__preview--collapsed']}`} aria-label="Illustrative layout">
        <button type="button" className={`${ui['disclosure__summary']} ${ui['formatting__preview-toggle']}`} aria-expanded={preview} onClick={()=>setPreview(!preview)}>Illustrative layout</button>
        <div className={ui['formatting__preview-body']}>
          <p className={ui['formatting__section-label']}>Illustrative layout</p>
          <div className={styles['paper-preview__page']} style={{fontFamily:preferences.font,fontSize:preferences.fontSize+2,lineHeight:preferences.spacing==='relaxed'?2:1.5}}><strong>{preferences.header || data.schoolName}</strong><hr/><p>PHYSICAL SCIENCES</p><p>Question 1</p><p>This sample shows your text and spacing preferences.</p>{preferences.answerLines && <div className={styles['paper-preview__answer-lines']} aria-label="Sample learner answer lines"><hr/><hr/><hr/></div>}<small>Page 1</small></div>
          <p className={ui['field__hint']}>Updates as you change settings. This is a layout illustration, not a generated paper.</p>
        </div>
      </section>
    </div>
  </div>;
}
