'use client';
import { useEffect, useState, useId } from 'react';
import type { Formatting, Workspace, WorkspaceWrite, CatalogueSearch, CatalogueEntry } from '../../../lib/workspace/contracts';
import styles from './workspace.module.css';
import {formatMarks,totalMarks} from '../../../lib/workspace/catalogue';
import {formatRand} from '../../../lib/payments/contracts';
const bloomStyles:Record<string,string>={Remember:styles.remember,Understand:styles.understand,Apply:styles.apply,Analyse:styles.analyse,Evaluate:styles.evaluate,Create:styles.create};
function CatalogueCard({entry,selected=false,disabled=false,onSelect}:{entry:CatalogueEntry;selected?:boolean;disabled?:boolean;onSelect?:(checked:boolean)=>void}) {
  const [failed,setFailed]=useState(false),[expanded,setExpanded]=useState(false);
  const detailId=useId(),titleId=useId();
  useEffect(()=>setFailed(false),[entry.thumbnail?.src]);
  const preview=entry.preview;
  return <article className={`${styles.entry} ${selected?styles.selected:''}`} aria-labelledby={titleId}>
    <div className={styles.cardHeading}>
      <div><span className={styles.topic}>{entry.topic}</span><h3 id={titleId}>{entry.title}</h3></div>
      {onSelect && <input type="checkbox" disabled={disabled} checked={selected} onChange={e=>onSelect(e.target.checked)} aria-label={`Select ${entry.title}`}/>}
    </div>
    <div className={styles.cardMetrics}><span className={styles.marks}>{formatMarks(entry.marks)} marks</span>
      {preview ? <span className={styles.subquestionCount}>{formatMarks(preview.subquestions)} {preview.subquestions.max===1?'subquestion':'subquestions'}</span> : <span className={styles.subquestionCount}>Subquestion range not yet available</span>}
    </div>
    {!entry.orderable && <p className={styles.previewNote}>Not yet available to order.</p>}
    <p className={styles.description}>{entry.description}</p>
    {entry.thumbnail && (failed ? <p className={styles.diagramFallback}>Diagram preview unavailable</p> : <img className={styles.diagram} src={entry.thumbnail.src} alt={entry.thumbnail.alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>)}
    {preview?.outline ? <>
      <button type="button" className={styles.reveal} aria-expanded={expanded} aria-controls={detailId} onClick={()=>setExpanded(!expanded)}>{expanded?'Show less':'Reveal more'}<span aria-hidden="true">{expanded?'−':'+'}</span></button>
      <div id={detailId} hidden={!expanded} className={styles.outline}>
        <p className={styles.outlineHeading}>What learners would do · example structure</p>
        <ol>{preview.outline.map((row,i)=><li key={i} className={styles.outlineRow}>
          <span className={styles.partNumber} aria-label={`Subquestion ${i+1}`}>1.{i+1}</span>
          <div><p>{row.summary}</p><span aria-hidden="true" className={styles.redaction}><i/><i/></span><span className={`${styles.bloom} ${bloomStyles[row.bloom]}`}>{row.bloom}</span></div>
          {row.marks && <span className={styles.partMarks}>({formatMarks(row.marks)})</span>}
        </li>)}</ol>
        <p className={styles.previewNote}>One possible structure. The final subquestions and mark allocations can vary within the published ranges.</p>
        <p className={styles.previewNote}>Your paper is created after payment and parameter selection.</p>
      </div>
    </> : <p className={styles.previewNote}>Question outline not yet available.</p>}
  </article>;
}
export default function WorkspaceView({initial}:{initial:Workspace}) {
  const [data,setData]=useState(initial);
  const [preferences,setPreferences]=useState<Formatting>(initial.formatting.preferences);
  const [ids,setIds]=useState(initial.selection.release===initial.module?.release ? initial.selection.entryIds : []);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState<{query:string;result:CatalogueSearch;error:string}|null>(null);
  const [tab,setTab]=useState<'catalogue'|'formatting'>('catalogue');
  const [marks,setMarks]=useState<Record<string,number>>({});
  const formattingDirty=JSON.stringify(preferences)!==JSON.stringify(data.formatting.preferences);
  const selectionDirty=!!data.module && (JSON.stringify(ids)!==JSON.stringify(data.selection.entryIds) || data.selection.release!==data.module.release);
  const dirty=formattingDirty || selectionDirty;
  // Configured path: occurrences in the teacher's order (a multiple-choice type may repeat).
  // The existing path keeps its one-per-item catalogue-order summary.
  const occurrences=data.purchase?.configurator?ids.map(id=>data.entries.find(e=>e.id===id)).filter((e):e is CatalogueEntry=>!!e):data.entries.filter(e=>ids.includes(e.id));
  const chosen=occurrences;
  const selectedMarks=totalMarks(chosen);
  const searchQuery=query.trim();
  const searching=!!searchQuery && search?.query!==searchQuery;
  const matches=search?.query===searchQuery ? search.result.matches : [];
  const visibleEntries=searchQuery ? matches.filter(m=>m.module.id===data.module?.id && m.module.release===data.module?.release).map(m=>m.entry) : data.entries;
  const otherModules=data.curricula.filter(m=>m.id!==data.module?.id && matches.some(r=>r.module.id===m.id));
  const hiddenSelected=chosen.filter(e=>!visibleEntries.some(v=>v.id===e.id)).length;
  useEffect(()=>{
    if(!searchQuery){setSearch(null);return;}
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const response=await fetch(`/api/teacher/catalogue/search?q=${encodeURIComponent(searchQuery)}`,{cache:'no-store',signal:controller.signal});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error || 'Search is unavailable. Please try again.');
        if(!controller.signal.aborted) setSearch({query:searchQuery,result,error:''});
      } catch(e) {
        if(!controller.signal.aborted) setSearch({query:searchQuery,result:{matches:[],hasMore:false},error:e instanceof Error?e.message:'Search is unavailable. Please try again.'});
      }
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[searchQuery]);
  const stale=data.selection.revision>0 && data.selection.release!==data.module?.release;
  // Multiple-choice items are two marks each; structured items take a mark within the published range.
  const fixedMarks=(e:CatalogueEntry)=>e.id.startsWith('mcq:')?2:null;
  // Editable-configuration path: marks are set explicitly against a paper total and are never
  // filled in for the teacher. The existing path keeps its previous behaviour unchanged.
  const configured=!!data.purchase?.configurator;
  const [paperTarget,setPaperTarget]=useState<number|null>(null);
  const allocation=Object.fromEntries(chosen.map(e=>[e.id,fixedMarks(e) ?? marks[e.id] ?? (configured?NaN:e.marks.max)]));
  const inRange=(e:CatalogueEntry)=>Number.isInteger(allocation[e.id]) && allocation[e.id]>=e.marks.min && allocation[e.id]<=e.marks.max;
  const allocatedTotal=chosen.reduce((a,e)=>a+(Number.isInteger(allocation[e.id])?allocation[e.id]:0),0);
  const [sectionTargets,setSectionTargets]=useState<{multiple_choice?:number;structured?:number}>({});
  const sectionTotal=(k:'multiple_choice'|'structured')=>chosen.filter(e=>(k==='multiple_choice')===e.id.startsWith('mcq:')).reduce((a,e)=>a+(Number.isInteger(allocation[e.id])?allocation[e.id]:0),0);
  const sectionsOk=(['multiple_choice','structured'] as const).every(k=>sectionTargets[k]===undefined||sectionTargets[k]===sectionTotal(k));
  const move=(i:number,by:number)=>{const next=[...ids];const j=i+by;if(j<0||j>=next.length)return;[next[i],next[j]]=[next[j],next[i]];setNotice('');setIds(next);};
  const marksSet=chosen.every(inRange);
  const balanced=!configured || (paperTarget!==null && marksSet && allocatedTotal===paperTarget && sectionsOk);
  const price=data.purchase ? formatRand(data.purchase.amountMinor) : 'R100';
  const maxQuestions=data.purchase?.maxQuestions ?? 30;
  const maxStructured=data.purchase?.maxStructured ?? 30, maxMultipleChoice=data.purchase?.maxMultipleChoice ?? 30;
  const mcqCount=chosen.filter(e=>e.id.startsWith('mcq:')).length;
  const withinPilotSize=chosen.length<=maxQuestions && mcqCount<=maxMultipleChoice && chosen.length-mcqCount<=maxStructured;
  const canPay=!!data.module && !!data.purchase?.available && !selectionDirty && data.selection.revision>0 && chosen.length>0 && chosen.every(e=>e.orderable) &&
    marksSet && balanced && withinPilotSize;
  async function checkout() {
    if(!data.module || !canPay) return;
    setBusy(true);setError('');setNotice('');
    const payload={moduleId:data.module.id,selectionRevision:data.selection.revision,allocations:allocation,...(configured?{targets:{paper:paperTarget!,...(Object.keys(sectionTargets).length?{sections:sectionTargets}:{})}}:{})};
    // The same selection and marks reuse one request key, so a double click, timeout or uncertain
    // retry cannot start a second checkout. The key is replaced only when the server confirms that
    // its unpaid checkout has ended (cancelled or expired); this click is then a new attempt.
    const storageKey='checkout:'+JSON.stringify(payload);
    const newKey=()=>{const k=crypto.randomUUID();try{sessionStorage.setItem(storageKey,k);}catch{}return k;};
    let requestKey='';
    try{requestKey=sessionStorage.getItem(storageKey)||'';}catch{}
    if(!requestKey) requestKey=newKey();
    try {
      for(let attempt=0;attempt<2;attempt++){
        const r=await fetch('/api/teacher/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey,...payload})});
        const result=await r.json();
        if(!r.ok) throw new Error([result.error || 'Checkout could not be started. Nothing has been charged.',...(Array.isArray(result.problems)?result.problems:[])].join(' '));
        if(result.terminal===true && attempt===0){requestKey=newKey();continue;}
        window.location.assign(result.checkoutUrl || `/teacher/orders/${result.orderId}`);
        return;
      }
      throw new Error('Checkout could not be started. Nothing has been charged.');
    }catch(e){setError(e instanceof Error?e.message:'Checkout could not be started. Nothing has been charged.');setBusy(false);}
  }
  useEffect(()=> {
    const guard=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
  },[dirty]);
  async function switchCurriculum(moduleId:string) {
    if(dirty && !window.confirm('You have unsaved changes. Discard them and change curriculum?')) return;
    setBusy(true);setError('');setNotice('');
    try {
      const r=await fetch(`/api/teacher/workspace?curriculum=${encodeURIComponent(moduleId)}`,{cache:'no-store'});const next=await r.json();
      if(!r.ok) throw new Error(next.error || 'Could not load the curriculum. Try again.');
      setData(next);setPreferences(next.formatting.preferences);setIds(next.selection.release===next.module?.release?next.selection.entryIds:[]);
    } catch(e){setError(e instanceof Error?e.message:'Could not load the curriculum. Try again.');}
    finally{setBusy(false);}
  }
  async function save(kind:'formatting'|'selection') {
    if(!data.module) return;
    setBusy(true);setError('');setNotice('');
    const body:WorkspaceWrite=kind==='formatting' ? {kind,moduleId:data.module.id,revision:data.formatting.revision,preferences} :
      {kind,moduleId:data.module.id,revision:data.selection.revision,release:data.module.release,entryIds:ids};
    try {
      const r=await fetch('/api/teacher/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await r.json();if(!r.ok) throw new Error(result.error || 'Could not save. Try again.');
      setData(current=>kind==='formatting'?{...current,formatting:{revision:result.revision,preferences}}:
        {...current,selection:{revision:result.revision,release:current.module!.release,entryIds:ids}});
      setNotice(kind==='formatting'?'School formatting saved for this curriculum.':ids.length?'Your paper selection is saved. You can return to it later.':'Your saved selection is cleared.');
    }catch(e){setError(e instanceof Error?e.message:'Could not save. Your changes are still here; try again.');}
    finally{setBusy(false);}
  }
  return <div className={styles.workspace}>
    <header className={styles.hero}><span className={styles.eyebrow}>Teacher workspace</span><h1>Plan your next paper</h1><p>{data.schoolName}</p></header>
    {!data.module ? <section className={styles.empty}><h2>Your curricula will appear here</h2><p>Your school account is verified. Contact our team to arrange curriculum access for your department.</p><a href="mailto:kahueka@reviseit.io">Contact Revise It</a></section> : <>
      <div className={styles.toolbar}><label>Curriculum<select disabled={busy} value={data.module.id} onChange={e=>void switchCurriculum(e.target.value)}>{data.curricula.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><span className={styles.badge}>{data.module.isDemo?'Demonstration catalogue':'School access active'}</span></div>
      {data.module.isDemo && <p className={styles.demo}>Explore with sample entries. These are demonstration selections; purchasing and paper generation are not available yet.</p>}
      <nav className={styles.tabs} aria-label="Workspace sections"><button type="button" aria-pressed={tab==='catalogue'} onClick={()=>setTab('catalogue')}>Question catalogue</button><button type="button" aria-pressed={tab==='formatting'} onClick={()=>setTab('formatting')}>School formatting{formattingDirty?' · Unsaved':''}</button></nav>
      <div aria-live="polite">{notice && <p role="status" className={styles.success}>{notice}</p>}</div>
      {error && <p role="alert" className={styles.error}>{error} <a href="/teacher">Reload workspace</a></p>}
      {tab==='catalogue' ? <div className={styles.columns}>
        <section aria-labelledby="catalogue-heading"><div className={styles.sectionHeading}><div><h2 id="catalogue-heading">Choose your questions</h2><p>Select up to 30 questions. Your choices stay private to your account.</p></div></div>
          <div className={styles.search} role="search">
            <label htmlFor="catalogue-search">Search topics or curricula</label>
            <div className={styles.searchInput}><input id="catalogue-search" type="search" maxLength={120} value={query} placeholder="Try electricity, motion or Grade 11" onChange={e=>setQuery(e.target.value)} aria-describedby="search-scope"/>{query && <button type="button" onClick={()=>setQuery('')}>Clear search</button>}</div>
            <p id="search-scope">Search all curricula available to your school. Searching does not change your paper selection.</p>
          </div>
          {searchQuery && <div aria-live="polite" className={styles.searchStatus}>
            {searching ? 'Searching…' : search?.error ? <p role="alert">{search.error}</p> : <p>{matches.length} {search?.result.hasMore?'shown matching':'matching'} {matches.length===1?'question':'questions'}{search?.result.hasMore?'. Refine your search to see more.':'.'}</p>}
          </div>}
          {searchQuery && !searching && !search?.error && matches.length===0 && <div className={styles.empty}><h3>No matching questions</h3><p>Try a broader topic or a curriculum name.</p><button type="button" className={styles.textButton} onClick={()=>setQuery('')}>Show all questions in this curriculum</button></div>}
          {hiddenSelected>0 && searchQuery && <p className={styles.searchStatus}>{hiddenSelected} selected {hiddenSelected===1?'question is':'questions are'} outside these results. Your selection is unchanged.</p>}
          {stale && <p className={styles.error}>The catalogue has changed since you saved. Review the current entries and save a new selection. Your previous selection stays saved until then.</p>}
          {data.entries.length===0 && <p className={styles.empty}>There are no published questions for this curriculum yet.</p>}
          <div className={styles.entries}>{visibleEntries.map(entry=><CatalogueCard key={`${data.module!.id}:${data.module!.release}:${entry.id}`} entry={entry} selected={ids.includes(entry.id)} disabled={busy || (!ids.includes(entry.id) && (!entry.orderable || ids.length>=30))} onSelect={checked=>{setNotice('');setIds(checked?[...ids,entry.id]:ids.filter(id=>id!==entry.id));}}/>)}</div>
          {otherModules.map(module=><section key={module.id} className={styles.otherCurriculum} aria-label={`Results in ${module.name}`}>
            <h3>{module.name}</h3><p>Switch curriculum to select these questions. Each curriculum has its own saved paper.</p>
            <button type="button" className={styles.textButton} disabled={busy} onClick={()=>void switchCurriculum(module.id)}>Browse {module.name}</button>
            <div className={styles.entries}>{matches.filter(m=>m.module.id===module.id).map(({entry})=><CatalogueCard key={`${module.id}:${module.release}:${entry.id}`} entry={entry}/>)}</div>
          </section>)}
        </section>
        <aside className={styles.summary} aria-labelledby="selection-heading"><span className={styles.eyebrow}>Your paper</span><h2 id="selection-heading">Selection summary</h2><div className={styles.total}><strong>{formatMarks(selectedMarks)}</strong><span>{selectedMarks.min===selectedMarks.max?'total marks':'possible marks'} · {chosen.length} {chosen.length===1?'question':'questions'}</span></div>
          {chosen.length ? (configured ? <ol className={styles.occurrences}>{chosen.map((e,i)=>{const repeat=chosen.slice(0,i).filter(x=>x.id===e.id).length;return <li key={`${e.id}:${i}`}>
            <span>{e.title}{repeat?` · occurrence ${repeat+1}`:''}</span><span>{formatMarks(e.marks)}</span>
            <span className={styles.rowActions}>
              <button type="button" disabled={busy||i===0} aria-label={`Move ${e.title}${repeat?` occurrence ${repeat+1}`:''} earlier`} onClick={()=>move(i,-1)}>↑</button>
              <button type="button" disabled={busy||i===chosen.length-1} aria-label={`Move ${e.title}${repeat?` occurrence ${repeat+1}`:''} later`} onClick={()=>move(i,1)}>↓</button>
              {e.id.startsWith('mcq:') && <button type="button" disabled={busy||ids.length>=30} aria-label={`Add another ${e.title}`} onClick={()=>{setNotice('');setIds([...ids.slice(0,i+1),e.id,...ids.slice(i+1)]);}}>+ another</button>}
              <button type="button" disabled={busy} aria-label={`Remove ${e.title}${repeat?` occurrence ${repeat+1}`:''}`} onClick={()=>{setNotice('');setIds(ids.filter((_,j)=>j!==i));}}>Remove</button>
            </span></li>;})}</ol>
            : <ul>{chosen.map(e=><li key={e.id}><span>{e.title}</span><span>{formatMarks(e.marks)}</span></li>)}</ul>):<p>Select a question to start planning your paper.</p>}
          {configured && chosen.some(e=>e.id.startsWith('mcq:')) && <p className={styles.rangeNote}>A multiple-choice type can be added more than once; each occurrence becomes its own question with its own details.</p>}
          {selectedMarks.min!==selectedMarks.max && <p className={styles.rangeNote}>Final mark allocations are confirmed before payment.</p>}
          <p className={styles.saveState}>{selectionDirty?'Unsaved changes':data.selection.revision?'Selection saved':'No saved selection yet'}</p>
          <button className={styles.primary} disabled={busy || !selectionDirty} onClick={()=>void save('selection')}>{busy?'Please wait…':'Save selection'}</button>
          <div className={styles.next}><h3>Next: payment · {price} per paper</h3>
            <p>This pilot allows up to {maxQuestions} questions per paper. Each repeated multiple-choice question counts separately.</p>
            {(maxStructured<maxQuestions || maxMultipleChoice<maxQuestions) && <p>Up to {maxStructured} structured questions and {maxMultipleChoice} multiple-choice questions.</p>}
            {!withinPilotSize && chosen.length<=maxQuestions && <p role="alert">Reduce the number of structured or multiple-choice questions to fit the pilot limits before paying.</p>}
            {chosen.length>maxQuestions && <p role="alert">Remove {chosen.length-maxQuestions} {chosen.length-maxQuestions===1?'question':'questions'} before continuing to payment.</p>}
            {chosen.length>0 && <fieldset className={styles.allocations} disabled={busy}><legend>Marks for each question</legend>
              {configured && <label>Total marks for this paper<input type="number" min={1} max={3000} step={1} value={paperTarget ?? ''} placeholder="Set a total" onChange={ev=>setPaperTarget(ev.target.value===''?null:Number(ev.target.value))}/></label>}
              {configured && <>{(['multiple_choice','structured'] as const).filter(k=>chosen.some(e=>(k==='multiple_choice')===e.id.startsWith('mcq:'))).map(k=><label key={k}>{k==='multiple_choice'?'Multiple-choice section total (optional)':'Structured section total (optional)'}
                <input type="number" min={0} max={3000} step={1} value={sectionTargets[k]??''} placeholder="Any" aria-invalid={sectionTargets[k]!==undefined&&sectionTargets[k]!==sectionTotal(k)} onChange={ev=>{const v=ev.target.value;setSectionTargets(t=>{const n={...t};if(v==='')delete n[k];else n[k]=Number(v);return n;});}}/></label>)}</>}
              {chosen.map((e,i)=>fixedMarks(e)!==null ? (chosen.findIndex(x=>x.id===e.id)===i ? <p key={e.id}>{`${e.title}: 2 marks · fixed for this type${chosen.filter(x=>x.id===e.id).length>1?` (×${chosen.filter(x=>x.id===e.id).length})`:''}`}</p> : null) :
                <label key={e.id}>{`${e.title}: marks (${formatMarks(e.marks)})`}<input type="number" min={e.marks.min} max={e.marks.max} step={1} value={Number.isNaN(allocation[e.id])?'':allocation[e.id]} placeholder={configured?'Set':undefined} aria-invalid={configured && marks[e.id]!==undefined && !inRange(e)} onChange={ev=>setMarks({...marks,[e.id]:ev.target.value===''?NaN:Number(ev.target.value)})}/></label>)}
              {configured ? <div role="status"><p><strong>{marksSet && balanced ? 'Ready for payment' : 'Marks needed'}</strong></p>
                <p>Allocated {allocatedTotal} of {paperTarget ?? '—'} marks{paperTarget!==null && marksSet && allocatedTotal<paperTarget ? ` · ${paperTarget-allocatedTotal} still to allocate` : ''}{paperTarget!==null && allocatedTotal>paperTarget ? ` · ${allocatedTotal-paperTarget} over the total` : ''}</p>
                {(['multiple_choice','structured'] as const).filter(k=>sectionTargets[k]!==undefined).map(k=><p key={k}>{k==='multiple_choice'?'Multiple choice':'Structured'}: {sectionTotal(k)} of {sectionTargets[k]} marks</p>)}
                <p>After payment you can still move marks between these questions and change every other choice until you submit.</p></div> :
              <p>Paper total: {allocatedTotal} marks</p>}</fieldset>}
            {!data.purchase?.available ? <p>Purchasing is not open for your account yet. Your saved selection stays here.</p> :
              selectionDirty || !data.selection.revision ? <p>Save your selection before continuing to payment.</p> :
              chosen.some(e=>!e.orderable) ? <p>Remove questions that are not yet available before paying.</p> : null}
            <button className={styles.primary} disabled={busy || !canPay} onClick={()=>void checkout()}>{busy?'Please wait…':`Continue to payment · ${price}`}</button>
            <p>You pay {price} for one paper through Stripe's secure checkout. After payment is confirmed, you will answer the parameter questions for the questions you bought.</p></div>
          <details className={styles.package}><summary>Four documents in one delivery</summary><ul><li>Question paper</li><li>First-draft marking memorandum</li><li>Learner memorandum</li><li>Teacher description</li></ul></details>
        </aside>
      </div> : <section className={styles.formatting}><div><h2>Make it your school’s paper</h2><p>These preferences are shared with your school’s teachers for this curriculum. Saving here sets preferences for future papers.</p>
        <form onSubmit={e=>{e.preventDefault();void save('formatting');}} className={styles.form}>
          <fieldset disabled={busy}><legend>Page and text</legend><p>A4 portrait</p><div className={styles.fieldPair}><label>Font<select value={preferences.font} onChange={e=>setPreferences({...preferences,font:e.target.value as Formatting['font']})}><option>Arial</option><option>Times New Roman</option></select></label><label>Text size<select value={preferences.fontSize} onChange={e=>setPreferences({...preferences,fontSize:Number(e.target.value) as 11|12})}><option value={11}>11 point</option><option value={12}>12 point</option></select></label></div>
          <label>Spacing<select value={preferences.spacing} onChange={e=>setPreferences({...preferences,spacing:e.target.value as Formatting['spacing']})}><option value="normal">Standard</option><option value="relaxed">More space</option></select></label>
          <label>School heading<input value={preferences.header} maxLength={160} placeholder={data.schoolName} onChange={e=>setPreferences({...preferences,header:e.target.value})}/></label>
          <label className={styles.check}><input type="checkbox" checked={preferences.answerLines} onChange={e=>setPreferences({...preferences,answerLines:e.target.checked})}/> Include answer lines for written responses</label></fieldset>
          <p>Reference-template uploads and exact document previews will follow in a later step.</p><button className={styles.primary} disabled={busy || !formattingDirty}>{busy?'Please wait…':'Save school formatting'}</button>
        </form></div>
        <div className={styles.previewWrap}><span className={styles.eyebrow}>Illustrative layout</span><div className={styles.preview} style={{fontFamily:preferences.font,fontSize:preferences.fontSize+2,lineHeight:preferences.spacing==='relaxed'?2:1.5}}><strong>{preferences.header || data.schoolName}</strong><hr/><p>PHYSICAL SCIENCES</p><p>Question 1</p><p>This sample shows your text and spacing preferences.</p>{preferences.answerLines && <div className={styles.answerLines} aria-label="Sample learner answer lines"><hr/><hr/><hr/></div>}<small>Page 1</small></div><p>This is a layout illustration, not a generated paper.</p></div>
      </section>}
    </>}
  </div>;
}
