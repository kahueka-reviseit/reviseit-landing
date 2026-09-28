'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Formatting, Workspace, WorkspaceWrite, CatalogueSearch, CatalogueEntry } from '../../../lib/workspace/contracts';
import { formatRand } from '../../../lib/payments/contracts';
import { emptyFilters, kindOf, type Filters } from '../../../lib/workspace/paper';
import styles from './paper.module.css';
import { occurrencesOf, type PaperModel, type SectionKey, type View } from './paper/model';
import CatalogueView from './paper/catalogue';
import QuestionDetail from './paper/detail';
import { BuilderView, BuilderQuestion, BuilderMultipleChoice } from './paper/builder';
import ReviewView from './paper/review';
import { HomeView, ShapeView } from './paper/home';
import FormattingView from './paper/formatting';
import PaperBar from './paper/paper-bar';

const views:View[]=['home','shape','catalogue','question','builder','builder-question','builder-mcq','review','formatting'];
type Draft = {paperTarget:number|null; sectionTargets:Partial<Record<SectionKey,number>>; marks:Record<string,number>};
// C05A: targets and marks live only in this page's memory until checkout sends them, as
// before C05. Nothing is written to browser storage, so another account on the same
// browser can never inherit them. The chosen questions are saved to the account as before.
const emptyDraft=():Draft=>({paperTarget:null,sectionTargets:{},marks:{}});

export default function WorkspaceView({initial}:{initial:Workspace}) {
  const [data,setData]=useState(initial);
  const [preferences,setPreferences]=useState<Formatting>(initial.formatting.preferences);
  const [ids,setIds]=useState(initial.selection.release===initial.module?.release ? initial.selection.entryIds : []);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState<{query:string;result:CatalogueSearch;error:string}|null>(null);
  const [view,setView]=useState<View>('catalogue');
  const [question,setQuestion]=useState<string|null>(null);
  const [filters,setFilters]=useState<Filters>(emptyFilters);
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const returnFocus=useRef<string|null>(null);

  // Each curriculum starts with its own empty targets and marks.
  useEffect(()=>setDraft(emptyDraft()),[data.module?.id,data.module?.release]);

  // Screens are addressable (?view=…&question=…) so Back and reload keep the teacher's place.
  const fromUrl=useCallback(()=>{
    const p=new URLSearchParams(window.location.search);const v=p.get('view') as View|null;
    setView(v&&views.includes(v)?v:'catalogue');setQuestion(p.get('question'));
  },[]);
  useEffect(()=>{fromUrl();window.addEventListener('popstate',fromUrl);return()=>window.removeEventListener('popstate',fromUrl);},[fromUrl]);
  const go=useCallback((next:View,q?:string)=>{
    if(next==='question'||next==='builder-question') returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement.id||null:null;
    setView(next);setQuestion(q??null);setNotice('');
    try{const p=new URLSearchParams();if(next!=='catalogue')p.set('view',next);if(q)p.set('question',q);
      window.history.pushState(null,'',`${window.location.pathname}${p.size?`?${p}`:''}`);}catch{}
    document.documentElement.scrollTop=0;
  },[]);

  const byId=useMemo(()=>new Map(data.entries.map(e=>[e.id,e])),[data.entries]);
  const occurrences=useMemo(()=>occurrencesOf(ids,byId,kindOf),[ids,byId]);
  const chosen=occurrences.map(o=>o.entry);
  const configured=!!data.purchase?.configurator;
  const formattingDirty=JSON.stringify(preferences)!==JSON.stringify(data.formatting.preferences);
  const selectionDirty=!!data.module && (JSON.stringify(ids)!==JSON.stringify(data.selection.entryIds) || data.selection.release!==data.module.release);
  const dirty=formattingDirty || selectionDirty;
  const stale=data.selection.revision>0 && data.selection.release!==data.module?.release;

  // Search: this curriculum is filtered locally and instantly; the existing server search
  // is used only to show matches in the school's other curricula.
  const searchQuery=query.trim();
  useEffect(()=>{
    if(!searchQuery || data.curricula.length<2){setSearch(null);return;}
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
  },[searchQuery,data.curricula.length]);

  // Multiple-choice items are two marks each; structured items take a mark within the published range.
  const fixedMarks=(e:CatalogueEntry)=>kindOf(e)==='multiple_choice'?2:null;
  // Editable-configuration path: marks are set explicitly against a paper total and are never
  // filled in for the teacher. The existing path keeps its previous behaviour unchanged.
  const allocation=Object.fromEntries(chosen.map(e=>[e.id,fixedMarks(e) ?? draft.marks[e.id] ?? (configured?NaN:e.marks.max)]));
  const inRange=(e:CatalogueEntry)=>Number.isInteger(allocation[e.id]) && allocation[e.id]>=e.marks.min && allocation[e.id]<=e.marks.max;
  const allocatedTotal=chosen.reduce((a,e)=>a+(Number.isInteger(allocation[e.id])?allocation[e.id]:0),0);
  const sectionTotal=(k:SectionKey)=>chosen.filter(e=>kindOf(e)===k).reduce((a,e)=>a+(Number.isInteger(allocation[e.id])?allocation[e.id]:0),0);
  const sectionTargets=draft.sectionTargets, paperTarget=draft.paperTarget;
  const sectionsOk=(['multiple_choice','structured'] as const).every(k=>sectionTargets[k]===undefined||sectionTargets[k]===sectionTotal(k));
  const marksSet=chosen.every(inRange);
  const balanced=!configured || (paperTarget!==null && marksSet && allocatedTotal===paperTarget && sectionsOk);
  const price=data.purchase ? formatRand(data.purchase.amountMinor) : 'R100';
  // Pilot size limits come from the server contract (at most 30 while it is unknown).
  const limits={questions:data.purchase?.maxQuestions ?? 30,structured:data.purchase?.maxStructured ?? 30,multipleChoice:data.purchase?.maxMultipleChoice ?? 30};
  const mcqCount=chosen.filter(e=>kindOf(e)==='multiple_choice').length, structuredCount=chosen.length-mcqCount;
  const withinPilotSize=chosen.length<=limits.questions && mcqCount<=limits.multipleChoice && structuredCount<=limits.structured;
  const canPay=!!data.module && !!data.purchase?.available && !selectionDirty && data.selection.revision>0 && chosen.length>0 && chosen.every(e=>e.orderable) &&
    marksSet && balanced && withinPilotSize;

  const edit=(next:string[])=>{setNotice('');setIds(next);};
  const toggle=(e:CatalogueEntry,checked:boolean)=>edit(checked?[...ids,e.id]:ids.filter(id=>id!==e.id));
  const addAfter=(i:number)=>edit([...ids.slice(0,i+1),ids[i],...ids.slice(i+1)]);
  const remove=(i:number)=>edit(ids.filter((_,j)=>j!==i));
  const swap=(i:number,id:string)=>edit(ids.map((x,j)=>j===i?id:x));
  // Reordering stays within a section (the paper numbers multiple choice first); each
  // occurrence keeps its identity because only positions change.
  const move=(i:number,by:number)=>{
    const kind=kindOf({id:ids[i]});const same=ids.map((id,j)=>({id,j})).filter(x=>kindOf(x)===kind).map(x=>x.j);
    const to=same[same.indexOf(i)+by];if(to===undefined)return;const next=[...ids];[next[i],next[to]]=[next[to],next[i]];edit(next);
  };
  const setMark=(id:string,value:number)=>setDraft(d=>({...d,marks:{...d.marks,[id]:value}}));
  const setPaperTarget=(v:number|null)=>setDraft(d=>({...d,paperTarget:v}));
  const setSectionTarget=(k:SectionKey,v:number|undefined)=>setDraft(d=>{const s={...d.sectionTargets};if(v===undefined)delete s[k];else s[k]=v;return {...d,sectionTargets:s};});

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
      setFilters(emptyFilters());setQuery('');
    } catch(e){setError(e instanceof Error?e.message:'Could not load the curriculum. Try again.');}
    finally{setBusy(false);}
  }
  async function save(kind:'formatting'|'selection'):Promise<boolean> {
    if(!data.module) return false;
    setBusy(true);setError('');setNotice('');
    const body:WorkspaceWrite=kind==='formatting' ? {kind,moduleId:data.module.id,revision:data.formatting.revision,preferences} :
      {kind,moduleId:data.module.id,revision:data.selection.revision,release:data.module.release,entryIds:ids};
    try {
      const r=await fetch('/api/teacher/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await r.json();if(!r.ok) throw new Error(result.error || 'Could not save. Try again.');
      setData(current=>kind==='formatting'?{...current,formatting:{revision:result.revision,preferences}}:
        {...current,selection:{revision:result.revision,release:current.module!.release,entryIds:ids}});
      setNotice(kind==='formatting'?'School formatting saved for this curriculum.':ids.length?'Your paper selection is saved. You can return to it later.':'Your saved selection is cleared.');
      return true;
    }catch(e){setError(e instanceof Error?e.message:'Could not save. Your changes are still here; try again.');return false;}
    finally{setBusy(false);}
  }

  const paper:PaperModel={data,ids,byId,occurrences,configured,busy,price,allocation,inRange,setMark,paperTarget,setPaperTarget,sectionTargets,setSectionTarget,
    allocatedTotal,sectionTotal,marksSet,balanced,limits,mcqCount,structuredCount,withinPilotSize,selectionDirty,canPay,stale,
    toggle,addAfter,move,remove,swap,arrange:edit,go,save:()=>save('selection'),checkout,filters,setFilters};

  // Return keyboard focus to the card that opened a detail view.
  useEffect(()=>{if((view==='catalogue'||view==='builder')&&returnFocus.current){const el=document.getElementById(returnFocus.current);returnFocus.current=null;el?.focus();}},[view]);

  if(!data.module) return <div className={styles['paper-journey']}><section className={styles['empty-state']}><h2>Your curricula will appear here</h2><p>Your school account is verified. Contact our team to arrange curriculum access for your department.</p><a href="mailto:kahueka@reviseit.io">Contact Revise It</a></section></div>;
  const detail=question?byId.get(question):undefined;
  const status=<>
    <div aria-live="polite">{notice && <p role="status" className={styles['notice--success']}>{notice}</p>}</div>
    {error && <p role="alert" className={styles['notice--error']}>{error} <a href="/teacher">Reload workspace</a></p>}
  </>;
  const withBar=['catalogue','question'].includes(view);
  return <div className={`${styles['paper-journey']} ${withBar?styles['paper-journey--with-bottom-bar']:''}`}>
    {data.module.isDemo && <p className={styles['demo-notice']}>Explore with sample entries. These are demonstration selections; purchasing and paper generation are not available yet.</p>}
    {view==='home' ? <HomeView paper={paper} status={status} switchCurriculum={switchCurriculum}/> :
     view==='shape' ? <ShapeView paper={paper} status={status}/> :
     view==='formatting' ? <FormattingView paper={paper} status={status} preferences={preferences} setPreferences={setPreferences} dirty={formattingDirty} save={()=>void save('formatting')}/> :
     view==='question' && detail ? <QuestionDetail paper={paper} entry={detail} status={status} query={searchQuery}/> :
     view==='builder' ? <BuilderView paper={paper} status={status}/> :
     view==='builder-question' && detail ? <BuilderQuestion paper={paper} entry={detail} status={status}/> :
     view==='builder-mcq' ? <BuilderMultipleChoice paper={paper} status={status}/> :
     view==='review' ? <ReviewView paper={paper} status={status}/> :
     <CatalogueView paper={paper} status={status} query={query} setQuery={setQuery} search={search} switchCurriculum={switchCurriculum}/>}
    {withBar && <PaperBar paper={paper}/>}
  </div>;
}
