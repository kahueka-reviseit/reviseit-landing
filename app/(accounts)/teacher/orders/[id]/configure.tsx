'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Answer, QuestionField } from '../../../../../lib/jobs/questionnaire';
import { groupLabel, type Attention, type Configuration, type ConfigurationView, type FacetView, type LineView } from '../../../../../lib/configurator/contracts';
import styles from './configure.module.css';
import JevAdvice from './jev-advice';
import PaperPanel from './paper-panel';
import {emptyBrief,briefConflicts} from '../../../../../lib/configurator/brief';

/**
 * Configured order (Paper C5, C6 and C3a): marks, parts and authored details stay
 * editable until submission. The browser holds only the teacher's own choices and
 * the server's projection; every rule and total comes back from the server after a save.
 */
type SaveState = 'saved'|'pending'|'saving'|'conflict'|'failed';
const bloomClass:Record<string,string>={grouped:styles['tag--grouped'],remember:styles['tag--remember'],understand:styles['tag--understand'],apply:styles['tag--apply'],analyse:styles['tag--analyse'],evaluate:styles['tag--evaluate'],create:styles['tag--create'],unclassified:styles['tag--unclassified']};

function lineStatus(line:LineView,paid:boolean){
  if(line.marks.value===null || line.attention.some(a=>a.scope==='marks')) return {text:'Marks needed',ready:false};
  if(!paid) return {text:'Marks set',ready:true};
  if(line.issues.length) return {text:'Needs attention',ready:false};
  return line.ready?{text:'Details ready',ready:true}:{text:'Details to complete',ready:false};
}
const range=(r:{min:number;max:number})=>r.min===r.max?String(r.min):`${r.min}–${r.max}`;
/** Plain-language summary of one answer, for the side summary and final review. */
function describe(field:QuestionField,answer:Answer|undefined):string|null {
  if(!answer) return null;
  if(answer.kind==='automatic') return 'chosen for you';
  if(answer.kind==='omit') return 'no preference';
  if(answer.kind==='text') return answer.text.trim()?`“${answer.text.trim().slice(0,60)}${answer.text.trim().length>60?'…':''}”`:null;
  return field.type==='choice'?field.choices.find(c=>c.id===answer.choiceId)?.label ?? null:null;
}

function Chips({name,field,facet,value,onChange,disabled,attention}:{name:string;field:QuestionField;facet?:FacetView;value?:Answer;onChange:(a:Answer|null)=>void;disabled:boolean;attention?:Attention}) {
  const id=`${name}-${field.id}`;
  const selected=value?.kind==='choice'?`choice:${value.choiceId}`:value?.kind??'';
  const options=field.type==='choice'?field.choices.map(c=>({...c,view:facet?.options.find(o=>o.id===c.id)})):[];
  const writing=value?.kind==='text';
  const pick=(mode:string)=>{
    if(mode.startsWith('choice:')) onChange({kind:'choice',choiceId:mode.slice(7)});
    else if(mode==='text') onChange({kind:'text',text:''});
    else if(mode==='automatic'||mode==='omit') onChange({kind:mode});
  };
  const radio=(mode:string,label:string,extra:{dashed?:boolean;off?:boolean;reason?:string;preferred?:boolean}={})=>
    <label key={mode} className={`${styles['chip']} ${extra.dashed?styles['chip--delegate']:''} ${selected===mode?styles['chip--selected']:''} ${extra.off?styles['chip--unavailable']:''}`} title={extra.reason}>
      <input type="radio" name={id} value={mode} checked={selected===mode} disabled={disabled||(extra.off&&selected!==mode)} onChange={()=>pick(mode)}/>
      <span>{selected===mode?'✓ ':''}{label}{extra.preferred?<em className={styles['chip__suggestion']}> · suggested</em>:null}</span>
    </label>;
  const describedBy=[field.hint?`${id}-hint`:'',attention?`${id}-attention`:'',facet?.reason?`${id}-reason`:''].filter(Boolean).join(' ')||undefined;
  return <fieldset className={styles['choice-field']} aria-describedby={describedBy} id={id}>
    <legend className={styles['choice-field__header']}><span className={styles['choice-field__label']}>{field.label}{field.required?'':' (optional)'}</span>
      {(!field.required||value)&&<span className={styles['choice-field__message']} aria-hidden="true">{field.required?'✓ Your current choice':'Optional · can stay blank'}</span>}
    </legend>
    {field.hint&&<p id={`${id}-hint`} className={styles['paragraph']}>{field.hint}</p>}
    <div className={styles['chip-group']}>
      {options.map(o=>radio(`choice:${o.id}`,o.label,{off:o.view?.disabled,reason:o.view?.reason,preferred:o.view?.preferred}))}
      {(field.type==='text'||field.allowOther)&&radio('text',field.type==='text'?'Write my answer':'Describe my own')}
      {field.allowAutomatic&&radio('automatic','Choose for me',{dashed:true})}
      {!field.required&&radio('omit','No preference',{dashed:true})}
      {value&&!field.required&&<button type="button" className={styles['link']} disabled={disabled} onClick={()=>onChange(null)}>Leave blank</button>}
    </div>
    {writing&&<><label className={styles['text-field__label']} htmlFor={`${id}-text`}>Your answer for {field.label}</label>
      <textarea id={`${id}-text`} className={styles['text-input']} value={value.kind==='text'?value.text:''} disabled={disabled} maxLength={field.type==='text'?field.maxLength:2000} onChange={e=>onChange({kind:'text',text:e.target.value})}/></>}
    {facet?.forced&&<p id={`${id}-reason`} className={styles['notice--required']}>Required by your other choices: {facet.options.find(o=>o.id===facet.forced)?.label}. {facet.reason}</p>}
    {options.some(o=>o.view?.disabled)&&<ul className={styles['paragraph']}>{options.filter(o=>o.view?.disabled).map(o=><li key={o.id}>{o.label}: {o.view?.reason}</li>)}</ul>}
    {attention&&<p id={`${id}-attention`} role="alert" className={styles['notice--error']}>{attention.message}</p>}
  </fieldset>;
}

export default function ConfigureOrder({orderId,onSubmitted,title,children,topics={}}:{topics?:Record<string,string>;orderId:string;onSubmitted:()=>void;title?:string;children?:ReactNode}) {
  const [view,setView]=useState<ConfigurationView|null>(null);
  const [draft,setDraft]=useState<Configuration|null>(null);
  const [active,setActive]=useState<string|null>(null);
  const [panel,setPanel]=useState<'question'|'review'|null>(null);
  const [save,setSave]=useState<SaveState>('saved');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [manual,setManual]=useState<Record<string,boolean>>({});
  const [briefError,setBriefError]=useState('');
  const [editingBrief,setEditingBrief]=useState<Record<string,boolean>>({});
  const revision=useRef(0), latest=useRef<Configuration|null>(null), timer=useRef<ReturnType<typeof setTimeout>|null>(null), inFlight=useRef(false);
  const detailsRef=useRef<HTMLDivElement>(null);

  const load=useCallback(async(keepLocal=false)=>{
    const r=await fetch(`/api/teacher/orders/${orderId}/configuration`,{cache:'no-store'});
    if(r.status===401){window.location.assign('/login');return;}
    const data=await r.json();
    if(!r.ok){setError(data.error||'This paper could not be loaded. Refresh to try again.');return;}
    setView(data);revision.current=data.revision;
    if(!keepLocal){setDraft(data.configuration);latest.current=data.configuration;setSave('saved');}
  },[orderId]);
  useEffect(()=>{void load();},[load]);

  const flush=useCallback(async()=>{
    if(inFlight.current||!latest.current) return;
    inFlight.current=true;setSave('saving');
    const sent=latest.current;
    try{
      const r=await fetch(`/api/teacher/orders/${orderId}/configuration`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revision.current,configuration:sent})});
      const data=await r.json();
      if(r.status===409){setSave('conflict');setError(data.error);return;}
      if(!r.ok){setSave('failed');setError(data.error||'We could not save this. Your choices are still on this page.');return;}
      setView(data);revision.current=data.revision;setError('');
      // Edits made while saving stay on the page and are saved next.
      if(latest.current!==sent){setSave('pending');timer.current=setTimeout(()=>void flush(),300);}else setSave('saved');
    }catch{setSave('failed');setError('Connection lost. Your choices are still on this page; they will save when you try again.');}
    finally{inFlight.current=false;}
  },[orderId]);

  function update(change:(c:Configuration)=>Configuration){
    if(!draft) return;
    const next=change(structuredClone(draft));setDraft(next);latest.current=next;
    if(save==='conflict') return;
    setSave('pending');if(timer.current) clearTimeout(timer.current);timer.current=setTimeout(()=>void flush(),700);
  }
  useEffect(()=>()=>{if(timer.current) clearTimeout(timer.current);},[]);

  async function submit(){
    if(!view) return;
    setBusy(true);setError('');
    const storage=`configure-submit:${orderId}:${view.revision}`;
    let key='';try{key=sessionStorage.getItem(storage)||'';}catch{}
    if(!key){key=crypto.randomUUID();try{sessionStorage.setItem(storage,key);}catch{}}
    try{
      const r=await fetch(`/api/teacher/orders/${orderId}/configuration/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey:key,revision:view.revision})});
      const data=await r.json();
      if(!r.ok){setError(data.error||'Submission could not be confirmed. Retry; this will not create a second request.');if(r.status===409)await load(true);return;}
      onSubmitted();
    }catch{setError('Submission could not be confirmed. Retry; this will not create a second request.');}
    finally{setBusy(false);}
  }

  if(!view||!draft) return <section className={styles['card']}><p>{error||'Loading your paper…'}</p>{children}</section>;
  const paid=view.paid&&view.state==='awaiting_answers';
  const editable=!busy&&!view.submitted&&['awaiting_payment','awaiting_answers'].includes(view.state);
  const index=Math.max(0,view.lines.findIndex(l=>l.id===active));
  const line=view.lines[index];
  const own=draft.lines[line.id];
  const setMarks=(id:string,value:number|null)=>update(c=>{c.lines[id].marks=value;return c;});
  const setAnswer=(scope:'item'|'paper',field:string,answer:Answer|null)=>update(c=>{
    const section=scope==='paper'?c.answers.paper:(c.answers.items[line.id]??={});
    if(answer===null) delete section[field]; else section[field]=answer;
    const b=c.briefs?.[line.id];if(scope==='item'&&b?.suggestions[field])b.resolutions[field]='choice';return c;});
  const togglePart=(id:string,on:boolean)=>update(c=>{const cur=new Set(c.lines[line.id].parts??[]);if(on)cur.add(id);else cur.delete(id);c.lines[line.id].parts=[...cur];return c;});
  const chooseAll=()=>update(c=>{const section=(c.answers.items[line.id]??={});for(const f of line.fields)if(f.allowAutomatic&&!section[f.id])section[f.id]={kind:'automatic'};return c;});
  const attentionFor=(id:string,scope='field')=>line.attention.find(a=>a.scope===scope&&a.id===id);
  const saveText={saved:'All changes saved',pending:'Unsaved changes',saving:'Saving…',conflict:'Not saved: this paper changed elsewhere',failed:'Not saved'}[save];
  const t=view.totals;
  const maxBloom=Math.max(1,...view.cognitive.map(r=>r.max));
  const go=(i:number)=>{setBriefError('');setActive(view.lines[i].id);setPanel('question');};

  // Reorder the purchased occurrences (identities and answers unchanged); saved as a revision.
  const moveLine=(id:string,by:number)=>update(c=>{const o=[...(c.order??Object.keys(c.lines))];
    const kind=view.lines.find(l=>l.id===id)!.kind;const same=o.filter(x=>view.lines.find(l=>l.id===x)!.kind===kind);
    const at=same.indexOf(id),to=same[at+by];if(to===undefined)return c;const i=o.indexOf(id),j=o.indexOf(to);[o[i],o[j]]=[o[j],o[i]];c.order=o;return c;});
  const sameKind=view.lines.filter(l=>l.kind===line.kind);const position=sameKind.findIndex(l=>l.id===line.id);
  const allReady=paid&&!view.submitted&&view.canSubmit;
  const brief=draft.briefs?.[line.id],briefOn=!!view.briefEnabled||!!brief;
  const conflicts=briefConflicts(brief,draft.answers.items[line.id]??{});
  const briefDone=!!brief&&brief.interpretedText===brief.text;
  const showManual=!briefOn||manual[line.id];
  function manualOptions(){
    setManual(m=>({...m,[line.id]:true}));setBriefError('');
    if(brief)update(c=>{const b=c.briefs![line.id];b.interpretedText=b.text;b.suggestions={};b.resolutions={};return c;});
  }
  async function configureBrief(){
    if(save!=='saved'||busy||!view)return;
    setBusy(true);setBriefError('');
    try{
      const r=await fetch(`/api/teacher/orders/${orderId}/configuration/interpret`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,lineId:line.id,requestKey:crypto.randomUUID()})});
      const data=await r.json();
      if(!r.ok){setBriefError(data.error||'Your brief is saved. Try again or choose options yourself.');if(r.status===409){setSave('conflict');setError(data.error);}return;}
      setView(data);setDraft(data.configuration);latest.current=data.configuration;revision.current=data.revision;setSave('saved');setManual(m=>({...m,[line.id]:false}));setEditingBrief(m=>({...m,[line.id]:false}));
    }catch{setBriefError('Your brief is saved. We could not configure it just now. Try again or choose options yourself.');}
    finally{setBusy(false);}
  }
  function resolveBrief(field:string,useBrief:boolean){update(c=>{
    const b=c.briefs![line.id];if(useBrief)c.answers.items[line.id][field]=b.suggestions[field];
    b.resolutions[field]=useBrief?'brief':'choice';return c;
  });}
  const closePanel=()=>setPanel(null);
  const saveNotice=<><p className={styles['save-status']} role="status">{saveText}</p>
    {save==='conflict'&&<button type="button" className={styles['button--secondary']} onClick={()=>void load()}>Load the latest saved choices</button>}
    {save==='failed'&&<button type="button" className={styles['button--secondary']} onClick={()=>void flush()}>Try saving again</button>}
    {error&&<p role="alert" className={styles['notice--error']}>{error}</p>}</>;
  return <>
  <header className={styles['paper-header']}>
    <div><p className={styles['paper-header__breadcrumb']}>{title||'Your selected questions'} / Your paper · {paid?'Paid':view.submitted?'Submitted':'Awaiting payment'}</p>
      <h1 className={styles['paper-header__title']}>Your paper</h1></div>
    <div className={styles['paper-header__actions']}>
      <button type="button" className={styles['button--secondary']} onClick={()=>setPanel('review')}>Marks and cognitive mix</button>
      <button type="button" className={styles['button--primary']} onClick={()=>setPanel('review')}>Review paper →</button>
    </div>
  </header>
  <div className={styles['paper-totals']}>
    <label>Paper total <input aria-label="Paper total" inputMode="numeric" value={draft.targets.paper??''} disabled={!editable}
      onChange={e=>{const v=e.target.value.trim();update(c=>{c.targets.paper=v===''?null:Number.isInteger(Number(v))?Number(v):c.targets.paper;return c;});}}/> marks</label>
    <strong className={t.complete?styles['paper-totals__balanced']:styles['paper-totals__remaining']}>{t.allocated} allocated · {t.excess?`${t.excess} over total`:t.remaining?`${t.remaining} still to allocate`:t.complete?'balanced':t.target===null?'set a total':'check question marks'}</strong>
    <span>{t.sections.map(s=>`${s.label} ${s.allocated}${s.target!==null?` of ${s.target}`:''}`).join(' · ')}</span>
    <span>{view.lines.filter(l=>l.ready).length} of {view.lines.length} questions {paid?'configured':'have marks'}</span>
  </div>
  <div className={styles['paper-save']}>{!panel&&save!=='saved'&&saveNotice}</div>
  <div className={styles['question-table']} role="table" aria-label="Questions in your paper">
    <div className={styles['question-table__head']} role="row">{['No.','Question','Topic','Type','Marks','Subquestions','Status','Actions'].map(h=><div role="columnheader" key={h}>{h}</div>)}</div>
    {view.lines.map((l,i)=>{const status=lineStatus(l,paid),m=draft.lines[l.id].marks;
      return <div key={l.id} role="row" className={`${styles['question-table__row']} ${panel==='question'&&i===index?styles['question-table__row--active']:''}`}>
        <div role="cell" className={l.kind==='multiple_choice'?styles['question-table__number--mcq']:styles['question-table__number']}>{l.number}</div>
        <div role="cell" className={styles['question-table__question']}><strong>{l.title}</strong>{l.entryId&&<small>{l.entryId.split(':').slice(1).join(':')}</small>}</div>
        <div role="cell" className={styles['question-table__topic']}>{l.entryId&&topics[l.entryId]||'Not published'}</div>
        <div role="cell" className={l.kind==='multiple_choice'?styles['question-table__kind--mcq']:styles['question-table__kind']}>{l.kind==='multiple_choice'?'Multiple choice':'Structured'}</div>
        <div role="cell" className={styles['question-table__marks']}>
          {l.marks.fixed?<><strong>{l.marks.min}</strong><small>fixed</small></>:<><input aria-label={`Table marks for question ${l.number}`} inputMode="numeric" value={m??''} placeholder="Set" disabled={!editable}
            onChange={e=>{const v=e.target.value.trim();setMarks(l.id,v===''?null:Number.isInteger(Number(v))?Number(v):m);}}/><small>of {range(l.marks)}</small></>}
        </div>
        <div role="cell" className={styles['question-table__parts']}>{l.kind==='multiple_choice'?'1':l.outline?range(l.outline.subquestions):'Not published'}<span className={styles['question-table__mobile-label']}> subquestions</span></div>
        <div role="cell" className={`${styles['question-table__status']} ${status.ready?styles['question-table__status--ready']:''}`}><i aria-hidden="true"/>{paid&&status.ready?'Configured':status.text}</div>
        <div role="cell" className={styles['question-table__actions']}><button type="button" className={styles['button--secondary']} disabled={busy} aria-label={`Edit question ${l.number}`} onClick={()=>go(i)}>Edit question</button></div>
      </div>;
    })}
  </div>
  <details className={styles['paper-record']}><summary>Payment and request details</summary>{children}</details>
  {panel==='question'&&<PaperPanel title={line.title} eyebrow={`Question ${line.number} · ${line.kind==='multiple_choice'?'Multiple choice':'Structured'}${line.entryId?` · ${line.entryId.split(':').slice(1).join(':')}`:''}`} onClose={closePanel}
    summary={`${own.marks??'—'} marks · ${line.outstanding.length?`${line.outstanding.length} choices still to decide`:lineStatus(line,paid).text}`}
    footer={<>{saveNotice}<button type="button" className={styles['button--secondary']} onClick={closePanel}>Close</button></>}>
    <div className={styles['question-editor']} ref={detailsRef}>
      {paid&&briefOn&&<section className={styles['brief-card']} aria-label="Your question brief">
        {briefDone&&!editingBrief[line.id]?<div className={styles['retained-brief']}>
          <div><h3>Your brief</h3><button type="button" className={styles['button--text']} disabled={!editable} onClick={()=>setEditingBrief(m=>({...m,[line.id]:true}))}>Edit brief</button></div>
          <p>{brief.text}</p>
        </div>:<>
        <h2 id="brief-heading" className={styles['card__title']}>What would you like this question to do?</h2>
        <p className={styles['paragraph']}>Describe the scenario, what learners should do and anything you want included or left out.</p>
        <label className={styles['text-field__label']} htmlFor="teacher-brief">Your brief</label>
        <textarea id="teacher-brief" className={styles['text-input']} value={brief?.text??''} maxLength={4000} disabled={!editable}
          placeholder="Tell us what you want from this question…"
          onChange={e=>{const text=e.target.value;setBriefError('');update(c=>{c.briefs??={};c.briefs[line.id]??=emptyBrief();c.briefs[line.id].text=text;return c;});}}/>
        <div className={styles['question-order-controls']}><span className={styles['paragraph']}>Your words stay with this question.</span>
          <button type="button" className={styles['button--primary']} disabled={!editable||save!=='saved'||!brief?.text.trim()||!view.briefEnabled} onClick={()=>void configureBrief()}>{busy?'Configuring…':'Configure →'}</button></div>
        {save!=='saved'&&<p className={styles['paragraph']} role="status">{saveText}</p>}
        {briefError&&<p role="alert" className={styles['notice--error']}>{briefError}</p>}
        <button type="button" className={styles['button--text']} disabled={!editable} onClick={manualOptions}>{brief?.text?'Keep my words and choose options myself →':'Or choose the options yourself →'}</button>
        </>}
        {brief?.text&&<p className={styles['card__note']}>Your full description accompanies the final choices. Where they differ, your explicit choices take precedence.</p>}
        {briefDone&&Object.keys(brief.suggestions).length>0&&<div className={styles['interpretation']}>
          <h3 className={styles['interpretation__title']}>What we understood</h3><p className={styles['interpretation__description']}>Taken from your words. Existing choices are kept until you change them.</p>
          {Object.entries(brief.suggestions).map(([id,answer])=>{const field=line.fields.find(f=>f.id===id);return field&&<div key={id} className={styles['interpretation__row']}>
            <div className={styles['interpretation__answer']}><span className={styles['interpretation__label']}>{field.label}</span><strong className={styles['interpretation__value']}>{describe(field,answer)}</strong></div>
            <button type="button" className={styles['interpretation__change']} aria-label={`Change ${field.label}`} disabled={!editable} onClick={()=>setManual(m=>({...m,[line.id]:true}))}>Change</button>
            {conflicts.includes(id)&&<div className={styles['interpretation__conflict']} role="alert"><p>Your current choice differs: {describe(field,draft.answers.items[line.id]?.[id])}.</p>
              <button type="button" className={styles['button--secondary']} disabled={!editable} onClick={()=>resolveBrief(id,true)}>Use the choice from my brief</button>{' '}
              <button type="button" className={styles['button--secondary']} disabled={!editable} onClick={()=>resolveBrief(id,false)}>Keep my current choice</button></div>}
            {brief.resolutions[id]==='choice'&&<p className={styles['interpretation__conflict']}>Your current choice takes precedence: {describe(field,draft.answers.items[line.id]?.[id])}</p>}
          </div>;})}
        </div>}
        {briefDone&&!line.fields.length&&<p className={styles['paragraph']}>Your brief is saved for generation. This question has no additional options to choose.</p>}
        {briefDone&&line.ready&&!conflicts.length&&<p className={styles['save-status']}>Configured · Everything stays editable until you submit.</p>}
      </section>}
      {!paid&&!view.submitted&&<section className={styles['card']}><p className={styles['card__eyebrow--structured']}>After payment</p><p className={styles['paragraph']}>Detailed choices for each question unlock once Stripe confirms your payment. You can still change marks, parts and every other choice until you submit.</p></section>}

      {paid&&(!briefOn||briefDone||showManual)&&<section className={styles['card']} aria-labelledby="details-heading">
        <div className={styles['card__header']}><div><p className={styles['card__eyebrow--structured']}>Question {line.number} · {line.title} · {own.marks??'?'} marks</p>
          <h2 id="details-heading" className={styles['card__title']}>{briefOn?(showManual?'Choose options yourself':'Still to decide'):(line.fields.length?'Set the details':'No further details are needed')}</h2></div>
          {editable&&line.fields.some(f=>f.allowAutomatic&&!draft.answers.items[line.id]?.[f.id])&&<button type="button" className={styles['button--text']} onClick={chooseAll}>Choose for me on all</button>}</div>
        {line.configurable==='authored'&&<p className={styles['paragraph']}>This question uses its authored details. Parts and cognitive levels are not yet classified.</p>}
        {line.issues.map((m,i)=><p key={i} role="alert" className={styles['notice--error']}>{m}</p>)}
        {line.diagram&&<div className={styles['notice--info']}><strong>{line.diagram.locked?'Stimulus diagram set by your choices':line.diagram.stimulus==='required'?'This question needs its diagram':line.diagram.stimulus==='not_applicable'?'No stimulus diagram for this question':'Stimulus diagram'}</strong>
          <span>{line.diagram.learnerDrawn.length?'A drawing learners make themselves is a separate part and is not affected by the stimulus diagram choice.':'The stimulus diagram is what learners are given; it is separate from anything learners draw.'}</span></div>}
        {line.fields.filter(f=>showManual||!draft.answers.items[line.id]?.[f.id]||!!attentionFor(f.id)).map(f=><Chips key={f.id} name={`q-${line.id}`} field={f} facet={line.facets.find(x=>x.id===f.id)} value={draft.answers.items[line.id]?.[f.id]} disabled={!editable}
          attention={attentionFor(f.id)} onChange={a=>setAnswer('item',f.id,a)}/>)}
        <JevAdvice orderId={orderId} lineId={line.id} revision={view.revision} enabled={!briefOn&&!!view.advice?.enabled&&view.advice.lineIds.includes(line.id)&&editable&&!busy}
          saved={save==='saved'} answers={draft.answers.items[line.id]??{}} fields={line.fields} onAccept={(field,answer)=>setAnswer('item',field,answer)}/>
      </section>}

      <details className={styles['question-allocation']}><summary>Marks and question outline <strong>{own.marks??'—'} marks</strong></summary><section className={styles['card']} aria-labelledby="allocation-heading">
        <p id="allocation-heading" className={styles['card__eyebrow--positive']}>{paid?'Your allocation · still editable':'Marks for this question'}</p>
        <div className={styles['marks-control']}>
          <p>Question {line.number} · {line.title}<br/><span className={styles['paragraph']}>{line.marks.fixed?`${line.marks.min} marks · fixed for this type`:`Permitted range ${range(line.marks)} marks`}</span></p>
          {line.marks.fixed?<strong className={styles['marks-fixed__value']}>{line.marks.min}</strong>:
          <div className={styles['stepper']}>
            <button type="button" aria-label={`One mark fewer for question ${line.number}`} disabled={!editable||own.marks===null||own.marks<=line.marks.min} onClick={()=>setMarks(line.id,(own.marks??line.marks.min)-1)}>−</button>
            <input aria-label={`Marks for question ${line.number}`} inputMode="numeric" value={own.marks??''} placeholder="Set" disabled={!editable}
              onChange={e=>{const v=e.target.value.trim();setMarks(line.id,v===''?null:Number.isInteger(Number(v))?Number(v):own.marks);}}/>
            <button type="button" aria-label={`One mark more for question ${line.number}`} disabled={!editable||(own.marks??0)>=line.marks.max} onClick={()=>setMarks(line.id,own.marks===null?line.marks.min:own.marks+1)}>+</button>
          </div>}
        </div>
        {attentionFor('marks','marks')&&<p role="alert" className={styles['notice--error']}>{attentionFor('marks','marks')!.message}</p>}
        {line.attention.filter(a=>a.scope==='marks'&&a.id!=='marks').map((a,i)=><p key={i} role="alert" className={styles['notice--error']}>{a.message}</p>)}
        <p className={styles['card__footer']}>Paper total: {t.allocated} of {t.target??'—'} marks allocated. {t.remaining?`${t.remaining} still to allocate. `:''}{t.excess?`${t.excess} over the total. `:''}Move marks between questions within their ranges; the totals and cognitive mix update when saved.</p>
        {sameKind.length>1&&editable&&<div className={styles['question-order-controls']} role="group" aria-label={`Position of question ${line.number}`}>
          <span className={styles['paragraph']}>{line.kind==='multiple_choice'?'Order within multiple choice':'Order of structured questions'}: {position+1} of {sameKind.length}. Answers stay with the question.</span>
          <button type="button" className={styles['button--secondary']} disabled={position===0} onClick={()=>moveLine(line.id,-1)}>Move earlier</button>
          <button type="button" className={styles['button--secondary']} disabled={position===sameKind.length-1} onClick={()=>moveLine(line.id,1)}>Move later</button>
        </div>}
      </section>      <section className={styles['card']} aria-labelledby="outline-heading">
        <p id="outline-heading" className={styles['card__eyebrow--structured']}>Question outline</p>
        {line.outline&&line.outline.rows.length?<><p className={styles['paragraph']}>One published example structure ({range(line.outline.subquestions)} subquestions). Your paper can differ within the published ranges.</p>
          <ol className={styles['paper-preview']}>{line.outline.rows.map((r,i)=><li key={i}><span>{line.number}.{i+1} {r.summary}</span><span className={`${styles['tag']} ${bloomClass[r.bloom.toLowerCase()]??styles['tag--unclassified']}`}>{r.bloom}</span><span>{r.marks?range(r.marks):''}</span></li>)}</ol></>:
         line.outline?<p className={styles['paragraph']}>{range(line.outline.subquestions)} subquestions. A reviewed outline has not been published for this question.</p>:
         <p className={styles['paragraph']}>A reviewed outline has not been published for this question yet.</p>}
      </section>

<section className={styles['card']}>        {(line.parts.length>1||line.parts.some(p=>!p.locked))&&<fieldset className={styles['choice-field']}><legend>What the question covers</legend><span className={styles['choice-field__message']} aria-hidden="true">Include or leave out each part</span>
          <ol className={styles['subquestion-list']}>{line.parts.map(p=><li key={p.id} className={p.included?'':styles['subquestion-toggle--excluded']}>
            <label className={styles['subquestion-toggle__control']}><input type="checkbox" checked={p.included} disabled={!editable||p.locked} onChange={e=>togglePart(p.id,e.target.checked)}/><span aria-hidden="true" className={styles['switch']}/> <span className={styles['subquestion-toggle__number']}>{line.number}.{p.number}</span> <span className={styles['subquestion-toggle__text']}>{p.summary}</span></label>
            <span className={`${styles['tag']} ${bloomClass[p.bloom??(p.bloomOptions.length?'grouped':'unclassified')]}`} title={p.bloomBasis==='profile-authorised-fallback'?'Taken from the curriculum level under the agreed Grade 10 assumption':p.bloomBasis==='profile-single-mapping'?'Taken from the curriculum level':p.bloomOptions.length?'The curriculum level allows either category; the source does not say which':undefined}>
              {p.bloom?p.bloom.charAt(0).toUpperCase()+p.bloom.slice(1):p.bloomOptions.length?groupLabel(p.bloomOptions.join('-or-')):'Not yet classified'}</span>
            {p.band?<span className={styles['subquestion-toggle__level']}>Curriculum band {p.band}</span>:<span/>}
            <span className={styles['subquestion-toggle__marks']}>{p.included?(p.marks?range(p.marks):'—'):<em>Left out</em>}</span>
            {p.learnerDrawn&&<span className={styles['paragraph']}>Learners draw this themselves</span>}
            {p.reason&&<span className={styles['paragraph']}>{p.reason}</span>}
            {attentionFor(p.id,'part')&&<span role="alert" className={styles['notice--error']}>{attentionFor(p.id,'part')!.message}</span>}
          </li>)}</ol></fieldset>}
</section></details>
    </div></PaperPanel>}
  {panel==='review'&&<PaperPanel title="Review your paper" eyebrow={allReady?'Ready to submit':'Your paper'} onClose={closePanel}
    summary={`${t.allocated} of ${t.target??'—'} marks · ${view.outstanding} choices to complete`}>
    <aside className={styles['paper-review']} aria-label="Paper status">
      <section className={styles['card']}>
        <p className={styles['card__eyebrow--neutral']}>{view.submitted?'Submitted':'Paper status'}</p>
        <p className={styles['card__meta']} aria-live="polite">{view.submitted?'Submitted for generation':view.statusLabel}</p>
        {!view.submitted&&paid&&view.outstanding>0&&<p className={styles['paragraph']}>{view.outstanding} required {view.outstanding===1?'choice':'choices'} to make. Optional notes can stay blank.</p>}
        {view.issues.map((m,i)=><p key={i} className={styles['paragraph']}>{m}</p>)}
        <p className={styles['save-status']} role="status">{saveText}</p>
        {save==='conflict'&&<button type="button" className={styles['button--secondary']} onClick={()=>void load()}>Load the latest saved choices</button>}
        {save==='failed'&&<button type="button" className={styles['button--secondary']} onClick={()=>void flush()}>Try saving again</button>}
        {error&&<p role="alert" className={styles['notice--error']}>{error}</p>}
      </section>
      <section className={styles['card']} aria-labelledby="budget-heading">
        <p id="budget-heading" className={styles['card__eyebrow--neutral']}>Marks budget</p>
        <label className={styles['totals__paper-target']}>Paper total<input aria-label="Review paper total" inputMode="numeric" value={draft.targets.paper??''} disabled={!editable} onChange={e=>{const v=e.target.value.trim();update(c=>{c.targets.paper=v===''?null:Number.isInteger(Number(v))?Number(v):c.targets.paper;return c;});}}/></label>
        {t.sections.map(s=><div key={s.key} className={styles['budget-line']}><label className={styles['totals__section-target']}><span>{s.label}</span>
          <input inputMode="numeric" aria-label={`${s.label} section total (optional)`} placeholder="Any" value={draft.targets.sections?.[s.key]??''} disabled={!editable}
            onChange={e=>{const v=e.target.value.trim();update(c=>{const sec={...(c.targets.sections??{})};if(v==='')delete sec[s.key];else if(Number.isInteger(Number(v)))sec[s.key]=Number(v);
              if(Object.keys(sec).length)c.targets.sections=sec;else delete c.targets.sections;return c;});}}/></label>
          <span>{s.allocated}{s.target!==null?` of ${s.target}`:''} marks{s.target!==null&&s.allocated===s.target?' ✓':''}</span>
          <span className={styles['meter__track']} aria-hidden="true"><i className={s.key==='multiple_choice'?styles['meter__fill--multiple-choice']:styles['meter__fill--structured']} style={{width:`${s.target?Math.min(100,Math.round(s.allocated/s.target*100)):100}%`}}/></span></div>)}
        <div className={styles['totals']}><strong>Allocated</strong><strong>{t.allocated} of {t.target??'—'}</strong></div>
        {t.remaining>0&&<p className={styles['paragraph']}>{t.remaining} marks still to allocate</p>}
        {t.excess>0&&<p className={styles['notice--error']}>{t.excess} marks over the paper total</p>}
      </section>
      <section className={styles['card']} aria-labelledby="bloom-heading">
        <p id="bloom-heading" className={styles['card__eyebrow--neutral']}>Bloom’s cognitive mix · by marks</p>
        <ul className={styles['bloom-mix']}>{view.cognitive.map(r=><li key={r.key}><span>{r.label}</span>
          <span className={styles['meter__track']} aria-hidden="true"><i className={bloomClass[r.grouped?'grouped':r.key]} style={{width:`${Math.round(r.max/maxBloom*100)}%`}}/></span>
          <span>{r.min===r.max?r.min:`${r.min}–${r.max}`}</span></li>)}</ul>
        <p className={styles['card__note']}>A range means the final split between parts is decided within their permitted marks. Marks whose level allows two categories are shown together, and marks without a classification as not yet classified; neither is spread across categories.</p>
      </section>
      {view.curriculum.length>0&&<section className={styles['card']} aria-labelledby="curriculum-heading">
        <p id="curriculum-heading" className={styles['card__eyebrow--neutral']}>Curriculum requirements</p>
        {view.curriculum.map(c=><div key={c.profile}><p className={styles['paragraph']}>{c.note}</p>
          <table className={styles['data-table']}><thead><tr><th scope="col">Curriculum band</th><th scope="col">This paper</th><th scope="col">Target</th></tr></thead>
            <tbody>{c.rows.map(r=><tr key={r.key}><td>{r.label}</td><td>{r.min===r.max?r.min:`${r.min}–${r.max}`} marks</td><td>{r.target}</td></tr>)}</tbody></table></div>)}
      </section>}
      {paid&&!view.submitted&&<button type="button" className={styles['button--primary']} disabled={busy||!view.canSubmit||save!=='saved'} onClick={()=>void submit()}>{busy?'Submitting…':'Submit for generation →'}</button>}
      {paid&&!view.submitted&&<p className={styles['card__note']}>Once submitted, your choices are fixed for this paper. All four documents are released together.</p>}
    </aside></PaperPanel>}
  </>;
}
