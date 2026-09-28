'use client';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { bloomCategories, type CatalogueEntry, type CatalogueSearch } from '../../../../lib/workspace/contracts';
import { formatMarks } from '../../../../lib/workspace/catalogue';
import { applyFilters, codeOf, emptyFilters, filterCount, filterLabel, highlight, kindOf, markBands, matchesQuery, optionCount, topicGroups, type FilterKey, type Filters } from '../../../../lib/workspace/paper';
import styles from '../paper.module.css';
import type { PaperModel } from './model';
import { CatalogueCard } from './card';
import { Icon } from './ui';

type Option = {value:string; label:string};
const filterDefs:{key:FilterKey; label:string; heading:string}[] = [
  {key:'topics',label:'Topic',heading:'Topic'},
  {key:'kinds',label:'Question type',heading:'Question type'},
  {key:'marks',label:'Marks',heading:'Marks the question can carry'},
  {key:'bloom',label:'Bloom’s level',heading:'Bloom’s level · published outlines only'},
  {key:'diagram',label:'Has diagram',heading:'Diagram preview'},
  {key:'availability',label:'Availability',heading:'Availability'},
];

function FilterMenu({def,options,paper,query,open,onOpen,onClose}:{def:typeof filterDefs[number];options:Option[];paper:PaperModel;query:string;open:boolean;onOpen:()=>void;onClose:(focusPill?:boolean)=>void}) {
  const menuId=useId(), pill=useRef<HTMLButtonElement>(null), menu=useRef<HTMLDivElement>(null);
  const {filters,setFilters,data}=paper;
  const selected=filters[def.key] as string[];
  const shown=applyFilters(data.entries,filters,query).length;
  useEffect(()=>{
    if(!open) return;
    menu.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    const outside=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node)&&!pill.current?.contains(e.target as Node))onClose();};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  const set=(value:string,on:boolean)=>setFilters({...filters,[def.key]:on?[...selected,value]:selected.filter(v=>v!==value)});
  // Long option lists (fine-grained topic labels) get a find box; ticked options always stay listed.
  const [find,setFind]=useState('');
  const findable=options.length>12, f=find.trim().toLocaleLowerCase();
  const listed=findable&&f?options.filter(o=>selected.includes(o.value)||o.label.toLocaleLowerCase().includes(f)):options;
  const keys=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose(true);pill.current?.focus();}};
  return <div className={styles['filter__container']} onKeyDown={keys}>
    <button ref={pill} type="button" className={`${styles['filter']} ${selected.length?styles['filter--active']:''}`} aria-expanded={open} aria-controls={menuId} onClick={()=>open?onClose():onOpen()}>
      {def.label}{selected.length>0&&<span className={styles['filter__badge']} aria-label={`${selected.length} selected`}>{selected.length}</span>}{Icon.chevron(open)}
    </button>
    {open && <div ref={menu} id={menuId} className={styles['filter-menu']} role="group" aria-label={`${def.label} filter`}>
      <div className={styles['filter-menu__header']}><span>{def.heading}</span>{selected.length>0&&<button type="button" onClick={()=>setFilters({...filters,[def.key]:[]})}>Clear</button>}</div>
      {findable && <label className={styles['filter-menu__search']}><span className={styles['visually-hidden']}>Find a {def.label.toLocaleLowerCase()}</span><input type="search" value={find} placeholder={`Find a ${def.label.toLocaleLowerCase()} (${options.length})`} onChange={e=>setFind(e.target.value)}/></label>}
      {findable && f && listed.length===0 && <p className={styles['filter-menu__empty']}>No {def.label.toLocaleLowerCase()} matches “{find.trim()}”.</p>}
      {options.length===0 && <p className={styles['filter-menu__empty']}>{def.key==='bloom'?'No published outlines name a Bloom’s level in this curriculum yet.':'No options in this curriculum.'}</p>}
      {listed.map(o=>{const n=optionCount(data.entries,filters,def.key,o.value,query),on=selected.includes(o.value);
        return <label key={o.value} className={`${styles['filter-menu__option']} ${!n&&!on?styles['filter-menu__option--empty']:''}`}>
          <input type="checkbox" checked={on} disabled={!n&&!on} onChange={e=>set(o.value,e.target.checked)}/><span className={styles['checkbox']} aria-hidden="true">{on&&Icon.check(12)}</span>
          <span className={styles['filter-menu__option-label']}>{o.label}</span><span className={styles['filter-menu__option-count']}>{n}</span></label>;})}
      <div className={styles['filter-menu__footer']}><button type="button" className={styles['button--primary-compact']} onClick={()=>{onClose(true);pill.current?.focus();}}>Show {shown} {shown===1?'question':'questions'}</button></div>
    </div>}
  </div>;
}

function Typeahead({paper,query,setQuery}:{paper:PaperModel;query:string;setQuery:(q:string)=>void}) {
  const [open,setOpen]=useState(false),[active,setActive]=useState(-1);
  const listId=useId();
  const q=query.trim();
  const topics=q?topicGroups(paper.data.entries).filter(g=>g.topic.toLocaleLowerCase().includes(q.toLocaleLowerCase())).slice(0,3):[];
  const matches=q?paper.data.entries.filter(e=>matchesQuery(e,q)):[];
  const items:{key:string;act:()=>void;node:ReactNode}[]=[
    ...topics.map(t=>({key:'t:'+t.topic,act:()=>{paper.setFilters({...emptyFilters(),topics:[t.topic]});setQuery('');},
      node:<><span className={styles['typeahead__option-icon']}>{Icon.topic()}</span><span className={styles['typeahead__option-body']}><span>{highlight(t.topic,q).map((p,i)=>p.match?<mark key={i}>{p.text}</mark>:p.text)}</span><small>Topic</small></span><span className={styles['typeahead__option-count']}>{t.total} {t.total===1?'question':'questions'}</span></>})),
    ...matches.slice(0,5).map(e=>({key:'q:'+e.id,act:()=>{setOpen(false);paper.go('question',e.id);},
      node:<><span className={styles['typeahead__option-code']}>{codeOf(e.id)}</span><span className={styles['typeahead__option-body']}><span>{highlight(e.title,q).map((p,i)=>p.match?<mark key={i}>{p.text}</mark>:p.text)}</span></span><span className={styles['typeahead__option-marks']}>{formatMarks(e.marks)}</span></>})),
  ];
  const show=open&&!!q;
  const keys=(e:KeyboardEvent<HTMLInputElement>)=>{
    if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(a=>Math.min(items.length-1,a+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(-1,a-1));}
    else if(e.key==='Enter'){e.preventDefault();if(active>=0&&items[active])items[active].act();setOpen(false);setActive(-1);}
    else if(e.key==='Escape'){setOpen(false);setActive(-1);}
  };
  return <div className={styles['search-field__container']} role="search">
    <label htmlFor="catalogue-search" className={styles['visually-hidden']}>Search this catalogue</label>
    <div className={`${styles['search-field']} ${show?styles['search-field--active']:''}`}>{Icon.search()}
      <input id="catalogue-search" type="search" role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={show&&active>=0?`${listId}-${active}`:undefined}
        maxLength={120} value={query} placeholder={`Search ${paper.data.entries.length} questions, topics or codes`}
        onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(-1);}} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)} onKeyDown={keys}/>
      {query && <button type="button" className={styles['search-field__clear']} onClick={()=>{setQuery('');setOpen(false);}}>Clear search</button>}
    </div>
    {show && <div className={styles['typeahead']}>
      <ul id={listId} role="listbox" aria-label="Suggestions">
        {topics.length>0&&<li role="presentation" className={styles['typeahead__section-title']}>Topics</li>}
        {items.slice(0,topics.length).map((it,i)=><li key={it.key} id={`${listId}-${i}`} role="option" aria-selected={active===i} className={`${styles['typeahead__option']} ${active===i?styles['typeahead__option--focused']:''}`} onMouseDown={e=>{e.preventDefault();it.act();setOpen(false);}}>{it.node}</li>)}
        {matches.length>0&&<li role="presentation" className={styles['typeahead__section-title']}>Questions</li>}
        {items.slice(topics.length).map((it,j)=>{const i=j+topics.length;return <li key={it.key} id={`${listId}-${i}`} role="option" aria-selected={active===i} className={`${styles['typeahead__option']} ${active===i?styles['typeahead__option--focused']:''}`} onMouseDown={e=>{e.preventDefault();it.act();setOpen(false);}}>{it.node}</li>;})}
        {!items.length&&<li role="presentation" className={styles['typeahead__empty']}>No questions or topics match “{q}”.</li>}
      </ul>
      {matches.length>0&&<div className={styles['typeahead__footer']}><span>See all {matches.length} {matches.length===1?'result':'results'}</span><kbd>Enter</kbd></div>}
    </div>}
  </div>;
}

/** C05A: real curricula publish many fine-grained topic labels (Grade 11: 81 labels, 73 used
 * once). The overview shows the largest few as tiles and discloses the full list on request,
 * keeping every published label unchanged. */
export const TILE_LIMIT=8, GROUP_LIMIT=8;
function Overview({paper,compact,setCompact}:{paper:PaperModel;compact:boolean;setCompact:(v:boolean)=>void}) {
  const {data,filters,setFilters}=paper;
  const [all,setAll]=useState(false);
  const listId=useId();
  const groups=topicGroups(data.entries);
  const structured=data.entries.filter(e=>kindOf(e)==='structured').length, mcq=data.entries.length-structured, ready=data.entries.filter(e=>e.orderable).length;
  if(compact) return <p className={styles['breadth-strip--compact']}><span>{data.entries.length} questions in this catalogue</span><span>·</span><span>{structured} structured</span><span>·</span><span>{mcq} multiple choice</span><span>·</span><span>{ready} ready to order</span>
    <button type="button" className={styles['link']} onClick={()=>setCompact(false)}>Show topic overview</button></p>;
  const toggle=(topic:string)=>{const on=filters.topics.includes(topic);setFilters({...filters,topics:on?filters.topics.filter(t=>t!==topic):[...filters.topics,topic]});};
  const more=groups.length>TILE_LIMIT;
  return <section className={styles['breadth-strip']} aria-label="Catalogue overview">
    <div className={styles['breadth-strip__totals']}>
      <p className={styles['eyebrow--inverse']}>In this catalogue</p>
      <p className={styles['stat']}><strong>{data.entries.length}</strong> <span>questions</span></p>
      <dl><div><dt>Structured</dt><dd>{structured}</dd></div><div><dt>Multiple choice types</dt><dd>{mcq}</dd></div><div><dt>Topic groups</dt><dd>{groups.length}</dd></div><div><dt>Ready to order</dt><dd>{ready}</dd></div></dl>
      <p className={styles['breadth-strip__note']}>Each question is rebuilt with new scenarios and values for your school when you configure it.</p>
    </div>
    <div className={styles['topic-groups']}>
      <div className={styles['topic-group__header']}><p className={styles['section__eyebrow']}>Topics · {groups.length}{more?' · largest first':''}</p><button type="button" className={styles['link']} onClick={()=>setCompact(true)}>Hide overview</button></div>
      {!all && <ul className={styles['topic-group__tiles']}>{groups.slice(0,TILE_LIMIT).map((g,i)=>{const on=filters.topics.includes(g.topic);
        return <li key={g.topic} className={i>=4?styles['topic-groups__more']:''}><button type="button" aria-pressed={on} className={`${styles['topic-tile']} ${on?styles['topic-tile--selected']:''}`} onClick={()=>toggle(g.topic)}>
          <span className={styles['topic-tile__title']} title={g.topic}>{g.topic}</span>
          <span className={styles['topic-tile__stats']}><strong>{g.total}</strong><small>{g.structured} S · {g.multipleChoice} MC</small></span>
          <span className={styles['type-split__bar']} aria-hidden="true"><i className={styles['type-split__segment--structured']} style={{flexGrow:g.structured}}/><i className={styles['type-split__segment--multiple-choice']} style={{flexGrow:g.multipleChoice}}/></span>
          <span className={styles['visually-hidden']}>{g.structured} structured, {g.multipleChoice} multiple choice. {on?'Filtering by this topic.':'Show only this topic.'}</span>
        </button></li>;})}</ul>}
      {all && <ul id={listId} className={styles['topic-list']}>{groups.map(g=>{const on=filters.topics.includes(g.topic);
        return <li key={g.topic}><button type="button" aria-pressed={on} className={on?styles['topic-list__item--selected']:''} onClick={()=>toggle(g.topic)}><span>{g.topic}</span><small>{g.total}</small></button></li>;})}</ul>}
      {more && <button type="button" className={styles['topic-groups__disclosure']} aria-expanded={all} aria-controls={all?listId:undefined} onClick={()=>setAll(!all)}>
        {all?'Show the largest topics only':`Show all ${groups.length} topics`}</button>}
    </div>
  </section>;
}

export default function CatalogueView({paper,status,query,setQuery,search,switchCurriculum}:{paper:PaperModel;status:ReactNode;query:string;setQuery:(q:string)=>void;search:{query:string;result:CatalogueSearch;error:string}|null;switchCurriculum:(id:string)=>void}) {
  const {data,filters,setFilters,ids,busy}=paper;
  const [menu,setMenu]=useState<FilterKey|null>(null);
  const [compact,setCompact]=useState(false);
  const q=query.trim();
  const visible=useMemo(()=>applyFilters(data.entries,filters,q),[data.entries,filters,q]);
  const active=filterCount(filters);
  const counts=(id:string)=>ids.filter(x=>x===id).length;
  const hiddenSelected=[...new Set(ids)].filter(id=>!visible.some(v=>v.id===id)).length;
  const options:Record<FilterKey,Option[]>={
    topics:topicGroups(data.entries).map(g=>({value:g.topic,label:g.topic})),
    kinds:[{value:'structured',label:'Structured'},{value:'multiple_choice',label:'Multiple choice'}],
    marks:markBands.map(b=>({value:b.id,label:b.label})),
    bloom:bloomCategories.filter(b=>data.entries.some(e=>e.preview?.outline?.some(r=>r.bloom===b))).map(b=>({value:b,label:b})),
    diagram:[{value:'with',label:'Diagram preview'},{value:'without',label:'No diagram preview'}],
    availability:[{value:'ready',label:'Ready to order'},{value:'unavailable',label:'Not yet available'}],
  };
  const onlyKind=filters.kinds.length===1?filters.kinds[0]:null;
  const heading=q?`Results for “${q}”`:onlyKind==='multiple_choice'?'Multiple choice types':onlyKind==='structured'?'Structured questions':'All questions';
  const order=(a:CatalogueEntry,b:CatalogueEntry)=>(kindOf(a)===kindOf(b)?0:kindOf(a)==='structured'?-1:1) || a.id.localeCompare(b.id);
  // C05A: group by topic only when the labels form a few real groups; otherwise one compact
  // grid sorted by topic, with each card's topic chip naming its label.
  const visibleTopics=topicGroups(visible);
  const grouped=!q && visibleTopics.length<=GROUP_LIMIT;
  const byTopic=(a:CatalogueEntry,b:CatalogueEntry)=>a.topic.localeCompare(b.topic)||order(a,b);
  const groups=grouped?visibleTopics.map(g=>({topic:g.topic,items:visible.filter(e=>e.topic===g.topic).sort(order)})):[{topic:'',items:[...visible].sort(q?order:byTopic)}];
  const others=search?.query===q?data.curricula.filter(m=>m.id!==data.module!.id&&search.result.matches.some(r=>r.module.id===m.id)):[];
  const full=paper.data.selection && ids.length>=30;
  const card=(e:CatalogueEntry)=><CatalogueCard key={`${data.module!.id}:${data.module!.release}:${e.id}`} entry={e} count={counts(e.id)} disabled={busy || (!counts(e.id) && full)}
    onToggle={checked=>paper.toggle(e,checked)} onOpen={()=>paper.go('question',e.id)} onTopic={filters.topics.length===1&&filters.topics[0]===e.topic?undefined:()=>setFilters({...filters,topics:[e.topic]})}/>;
  return <>
    <nav className={styles['breadcrumb']} aria-label="Breadcrumb">
      <button type="button" onClick={()=>paper.go('home')}>My curricula</button><span aria-hidden="true">/</span>
      {data.curricula.length>1 ? <select aria-label="Curriculum" disabled={busy} value={data.module!.id} onChange={e=>switchCurriculum(e.target.value)}>{data.curricula.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select> :
        <span>{data.module!.name}</span>}<span aria-hidden="true">/</span><span aria-current="page">Catalogue</span>
    </nav>
    <header className={styles['page-header--catalogue']}>
      <h1>{data.module!.name} catalogue</h1>
      <p>Every question we can build for your department in this curriculum. Add questions as you browse; you set marks in the paper builder.</p>
      <Typeahead paper={paper} query={query} setQuery={setQuery}/>
    </header>
    {status}
    {paper.stale && <p className={styles['notice--error']}>The catalogue has changed since you saved. Review the current entries and save a new selection. Your previous selection stays saved until then.</p>}
    {data.entries.length===0 ? <p className={styles['empty-state']}>There are no published questions for this curriculum yet.</p> : <>
      <Overview paper={paper} compact={compact||active>0||!!q} setCompact={setCompact}/>
      <div className={styles['filter-bar']}>
        <div><h2 id="results-heading">{heading}</h2><p aria-live="polite">{active||q?`${visible.length} of ${data.entries.length} questions match`:grouped?`${data.entries.length} questions · structured first in each topic`:`${data.entries.length} questions · sorted by topic`}</p></div>
        <div className={styles['filter-bar__filters']} role="group" aria-label="Filters">{filterDefs.map(def=><FilterMenu key={def.key} def={def} options={options[def.key]} paper={paper} query={q} open={menu===def.key} onOpen={()=>setMenu(def.key)} onClose={()=>setMenu(null)}/>)}</div>
      </div>
      {active>0 && <div className={styles['active-filters']}><span>Filtered by</span>
        {filterDefs.flatMap(def=>(filters[def.key] as string[]).map(v=><button key={def.key+v} type="button" className={styles['active-filters__chip']} aria-label={`Remove filter ${filterLabel(def.key,v)}`}
          onClick={()=>setFilters({...filters,[def.key]:(filters[def.key] as string[]).filter(x=>x!==v)})}>{filterLabel(def.key,v)}{Icon.close()}</button>))}
        <button type="button" className={styles['button--clear']} onClick={()=>setFilters(emptyFilters())}>Clear all</button></div>}
      {hiddenSelected>0 && (active>0||q) && <p className={styles['paragraph--subtle']}>{hiddenSelected} selected {hiddenSelected===1?'question is':'questions are'} outside these results. Your selection is unchanged.</p>}
      {filters.bloom.length>0 && <p className={styles['paragraph--subtle']}>Bloom’s filtering uses published outlines only; {data.entries.filter(e=>!e.preview?.outline).length} questions without a published outline are not shown by this filter.</p>}
      {visible.length===0 ? <div className={styles['empty-state']}><h3>No matching questions</h3>
        <p>{q?'Try a broader topic, a question code or another curriculum.':'No question meets every filter. Remove a filter to see more.'}</p>
        <button type="button" className={styles['link']} onClick={()=>{setQuery('');setFilters(emptyFilters());}}>Show all questions in this curriculum</button></div> :
        groups.map(g=><section key={g.topic||'results'} className={styles['catalogue-group']} aria-labelledby={g.topic?undefined:'results-heading'} aria-label={g.topic?`${g.topic}, ${g.items.length} questions`:undefined}>
          {g.topic && <div className={styles['catalogue-group__title']}><h3>{g.topic} · {g.items.length}</h3>{(filters.topics.length!==1)&&<button type="button" className={styles['link']} onClick={()=>setFilters({...filters,topics:[g.topic]})}>Show only this topic</button>}</div>}
          <div className={styles['catalogue-grid']}>{g.items.map(card)}</div>
        </section>)}
    </>}
    {q && search?.query===q && search.error && <p role="alert" className={styles['paragraph--subtle']}>{search.error}</p>}
    {others.map(module=><section key={module.id} className={styles['curriculum-suggestions']} aria-label={`Results in ${module.name}`}>
      <h3>Also in {module.name}</h3><p>Switch curriculum to add these questions. Each curriculum has its own saved paper.</p>
      <ul>{search!.result.matches.filter(m=>m.module.id===module.id).map(({entry})=><li key={entry.id}><span className={styles['typeahead__option-code']}>{codeOf(entry.id)}</span><span>{entry.title}</span><span className={styles['typeahead__option-marks']}>{formatMarks(entry.marks)}</span></li>)}</ul>
      <button type="button" className={styles['button--secondary-compact']} disabled={busy} onClick={()=>switchCurriculum(module.id)}>Browse {module.name}</button>
    </section>)}
  </>;
}
