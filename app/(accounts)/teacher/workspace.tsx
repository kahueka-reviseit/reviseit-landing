'use client';
import { useEffect, useState } from 'react';
import type { Formatting, Workspace, WorkspaceWrite, CatalogueSearch, CatalogueEntry } from '../../../lib/workspace/contracts';
import styles from './workspace.module.css';
import {formatMarks,totalMarks} from '../../../lib/workspace/catalogue';
function CatalogueDiagram({thumbnail}:{thumbnail:CatalogueEntry['thumbnail']}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[thumbnail?.src]);
  if(!thumbnail) return null;
  return failed ? <span className={styles.diagramFallback}>Diagram preview unavailable</span> :
    <img className={styles.diagram} src={thumbnail.src} alt={thumbnail.alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>;
}
export default function WorkspaceView({initial}:{initial:Workspace}) {
  const [data,setData]=useState(initial);
  const [preferences,setPreferences]=useState<Formatting>(initial.formatting.preferences);
  const [ids,setIds]=useState(initial.selection.release===initial.module?.release ? initial.selection.entryIds : []);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState<{query:string;result:CatalogueSearch;error:string}|null>(null);
  const [tab,setTab]=useState<'catalogue'|'formatting'>('catalogue');
  const formattingDirty=JSON.stringify(preferences)!==JSON.stringify(data.formatting.preferences);
  const selectionDirty=!!data.module && (JSON.stringify(ids)!==JSON.stringify(data.selection.entryIds) || data.selection.release!==data.module.release);
  const dirty=formattingDirty || selectionDirty;
  const chosen=data.entries.filter(e=>ids.includes(e.id));
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
          <div className={styles.entries}>{visibleEntries.map(entry=><label className={`${styles.entry} ${ids.includes(entry.id)?styles.selected:''}`} key={`${data.module!.id}:${entry.id}`}>
            <input type="checkbox" disabled={busy || (!ids.includes(entry.id) && ids.length>=30)} checked={ids.includes(entry.id)} onChange={e=>{setNotice('');setIds(e.target.checked?[...ids,entry.id]:ids.filter(id=>id!==entry.id));}} aria-label={`Select ${entry.title}`} />
            <span><span className={styles.topic}>{entry.topic}</span><strong>{entry.title}</strong><span className={styles.marks}>{formatMarks(entry.marks)} marks</span><span className={styles.description}>{entry.description}</span><CatalogueDiagram thumbnail={entry.thumbnail}/></span>
          </label>)}</div>
          {otherModules.map(module=><section key={module.id} className={styles.otherCurriculum} aria-label={`Results in ${module.name}`}>
            <h3>{module.name}</h3><p>Switch curriculum to select these questions. Each curriculum has its own saved paper.</p>
            <button type="button" className={styles.textButton} disabled={busy} onClick={()=>void switchCurriculum(module.id)}>Browse {module.name}</button>
            <div className={styles.entries}>{matches.filter(m=>m.module.id===module.id).map(({entry})=><article key={entry.id} className={styles.searchCard}><span className={styles.topic}>{entry.topic}</span><h4>{entry.title}</h4><span className={styles.marks}>{formatMarks(entry.marks)} marks</span><p>{entry.description}</p><CatalogueDiagram thumbnail={entry.thumbnail}/></article>)}</div>
          </section>)}
        </section>
        <aside className={styles.summary} aria-labelledby="selection-heading"><span className={styles.eyebrow}>Your paper</span><h2 id="selection-heading">Selection summary</h2><div className={styles.total}><strong>{formatMarks(selectedMarks)}</strong><span>{selectedMarks.min===selectedMarks.max?'total marks':'possible marks'} · {chosen.length} {chosen.length===1?'question':'questions'}</span></div>
          {chosen.length ? <ul>{chosen.map(e=><li key={e.id}><span>{e.title}</span><span>{formatMarks(e.marks)}</span></li>)}</ul>:<p>Select a question to start planning your paper.</p>}
          {selectedMarks.min!==selectedMarks.max && <p className={styles.rangeNote}>Final mark allocations are confirmed before payment.</p>}
          <p className={styles.saveState}>{selectionDirty?'Unsaved changes':data.selection.revision?'Selection saved':'No saved selection yet'}</p>
          <button className={styles.primary} disabled={busy || !selectionDirty} onClick={()=>void save('selection')}>{busy?'Please wait…':'Save selection'}</button>
          <div className={styles.next}><h3>Next: your quote</h3><p>Pricing and checkout are being prepared. Saving does not place an order or charge your school.</p><p>After payment, you will answer the parameter questions for your purchased paper.</p></div>
          <details className={styles.package}><summary>Four documents in one delivery</summary><ul><li>Question paper</li><li>First-draft marking memorandum</li><li>Learner memorandum</li><li>Teacher description</li></ul></details>
        </aside>
      </div> : <section className={styles.formatting}><div><h2>Make it your school’s paper</h2><p>These preferences are shared with your school’s teachers for this curriculum. Saving here sets preferences for future papers.</p>
        <form onSubmit={e=>{e.preventDefault();void save('formatting');}} className={styles.form}>
          <fieldset disabled={busy}><legend>Page and text</legend><p>A4 portrait</p><div className={styles.fieldPair}><label>Font<select value={preferences.font} onChange={e=>setPreferences({...preferences,font:e.target.value as Formatting['font']})}><option>Arial</option><option>Times New Roman</option></select></label><label>Text size<select value={preferences.fontSize} onChange={e=>setPreferences({...preferences,fontSize:Number(e.target.value) as 11|12})}><option value={11}>11 point</option><option value={12}>12 point</option></select></label></div>
          <label>Spacing<select value={preferences.spacing} onChange={e=>setPreferences({...preferences,spacing:e.target.value as Formatting['spacing']})}><option value="normal">Standard</option><option value="relaxed">More space</option></select></label>
          <label>School heading<input value={preferences.header} maxLength={160} placeholder={data.schoolName} onChange={e=>setPreferences({...preferences,header:e.target.value})}/></label>
          <label className={styles.check}><input type="checkbox" checked={preferences.answerLines} onChange={e=>setPreferences({...preferences,answerLines:e.target.checked})}/> Include learner answer lines</label></fieldset>
          <p>Reference-template uploads and exact document previews will follow in a later step.</p><button className={styles.primary} disabled={busy || !formattingDirty}>{busy?'Please wait…':'Save school formatting'}</button>
        </form></div>
        <div className={styles.previewWrap}><span className={styles.eyebrow}>Illustrative layout</span><div className={styles.preview} style={{fontFamily:preferences.font,fontSize:preferences.fontSize+2,lineHeight:preferences.spacing==='relaxed'?2:1.5}}><strong>{preferences.header || data.schoolName}</strong><hr/><p>PHYSICAL SCIENCES</p><p>Question 1</p><p>This sample shows your text and spacing preferences.</p>{preferences.answerLines && <div className={styles.answerLines} aria-label="Sample learner answer lines"><hr/><hr/><hr/></div>}<small>Page 1</small></div><p>This is a layout illustration, not a generated paper.</p></div>
      </section>}
    </>}
  </div>;
}
