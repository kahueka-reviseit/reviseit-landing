import { bloomCategories, type BloomCategory, type CatalogueEntry } from './contracts';
import { searchTerms } from './catalogue';

/**
 * Browser-safe helpers for the paper-building journey. They read only the public
 * catalogue projection; nothing here infers private classifications, curriculum
 * bands or paper membership that the catalogue does not publish.
 */
export type Kind = 'structured'|'multiple_choice';
export const kindOf = (e:{id:string}):Kind => e.id.startsWith('mcq:') ? 'multiple_choice' : 'structured';
export const kindLabels:Record<Kind,string> = {structured:'Structured',multiple_choice:'Multiple choice'};
/** The catalogue code a teacher can quote, e.g. `P1-MECH-02` from `structured:P1-MECH-02`. */
export const codeOf = (id:string) => id.includes(':') ? id.slice(id.indexOf(':')+1) : id;

/** Bloom's categories named in the published outline, in taxonomy order. */
export function bloomSet(entry:CatalogueEntry):BloomCategory[] {
  const found=new Set(entry.preview?.outline?.map(r=>r.bloom) ?? []);
  return bloomCategories.filter(b=>found.has(b));
}
/** "Remember to Analyse", "Apply", or null when no reviewed outline was published. */
export function bloomSpan(entry:CatalogueEntry):string|null {
  const set=bloomSet(entry);
  if(!set.length) return null;
  return set.length===1 ? set[0] : `${set[0]} to ${set[set.length-1]}`;
}
/** Marks per Bloom's category in the published example outline (only rows that publish marks). */
export function outlineMix(entry:CatalogueEntry):{bloom:BloomCategory;min:number;max:number}[] {
  const rows=entry.preview?.outline ?? [];
  if(!rows.length || rows.some(r=>!r.marks)) return [];
  return bloomCategories.map(bloom=>rows.filter(r=>r.bloom===bloom).reduce((t,r)=>({bloom,min:t.min+r.marks!.min,max:t.max+r.marks!.max}),{bloom,min:0,max:0})).filter(r=>r.max>0);
}

export type TopicGroup = {topic:string; total:number; structured:number; multipleChoice:number; ready:number};
/** Topics as published, largest first, then by name. */
export function topicGroups(entries:CatalogueEntry[]):TopicGroup[] {
  const map=new Map<string,TopicGroup>();
  for(const e of entries){
    const g=map.get(e.topic) ?? {topic:e.topic,total:0,structured:0,multipleChoice:0,ready:0};
    g.total++; if(kindOf(e)==='structured') g.structured++; else g.multipleChoice++; if(e.orderable) g.ready++;
    map.set(e.topic,g);
  }
  return [...map.values()].sort((a,b)=>b.total-a.total || a.topic.localeCompare(b.topic));
}

// ---------------------------------------------------------------- filters
/**
 * Semantics: values within one filter are alternatives (OR); different filters
 * must all hold (AND). A mark band matches when the item's permitted range
 * overlaps the band. Bloom's matches only items whose published outline names
 * that category; items without an outline never match a Bloom's filter.
 */
export const markBands = [
  {id:'1-5',label:'Up to 5 marks',min:1,max:5},
  {id:'6-10',label:'6 to 10 marks',min:6,max:10},
  {id:'11-15',label:'11 to 15 marks',min:11,max:15},
  {id:'16-20',label:'16 to 20 marks',min:16,max:20},
  {id:'21+',label:'More than 20 marks',min:21,max:Infinity},
] as const;
export type MarkBand = typeof markBands[number]['id'];
export type Filters = {
  topics:string[]; kinds:Kind[]; marks:MarkBand[]; bloom:BloomCategory[];
  diagram:('with'|'without')[]; availability:('ready'|'unavailable')[];
};
export type FilterKey = keyof Filters;
export const emptyFilters = ():Filters => ({topics:[],kinds:[],marks:[],bloom:[],diagram:[],availability:[]});
export const filterCount = (f:Filters) => Object.values(f).reduce((n,v)=>n+v.length,0);

const tests:{[K in FilterKey]:(e:CatalogueEntry,v:Filters[K][number])=>boolean} = {
  topics:(e,v)=>e.topic===v,
  kinds:(e,v)=>kindOf(e)===v,
  marks:(e,v)=>{const b=markBands.find(x=>x.id===v)!;return e.marks.min<=b.max && e.marks.max>=b.min;},
  bloom:(e,v)=>bloomSet(e).includes(v),
  diagram:(e,v)=>v==='with'?!!e.thumbnail:!e.thumbnail,
  availability:(e,v)=>v==='ready'?e.orderable:!e.orderable,
};
function passes(e:CatalogueEntry,f:Filters,skip?:FilterKey):boolean {
  return (Object.keys(tests) as FilterKey[]).every(k=>k===skip || !f[k].length || (f[k] as string[]).some(v=>(tests[k] as (e:CatalogueEntry,v:string)=>boolean)(e,v)));
}
export function matchesQuery(e:CatalogueEntry,query:string):boolean {
  const terms=searchTerms(query);
  const text=[e.title,e.topic,codeOf(e.id),e.description].join(' ').toLocaleLowerCase();
  return terms.every(t=>text.includes(t));
}
export function applyFilters(entries:CatalogueEntry[],f:Filters,query=''):CatalogueEntry[] {
  return entries.filter(e=>passes(e,f) && (!query.trim() || matchesQuery(e,query)));
}
/**
 * How many items each option would show, given every other active filter and the
 * search. Counts are shown before an option is ticked, so a choice never leads to
 * an unexpected empty page.
 */
export function optionCount(entries:CatalogueEntry[],f:Filters,key:FilterKey,value:string,query=''):number {
  return entries.filter(e=>passes(e,f,key) && (tests[key] as (e:CatalogueEntry,v:string)=>boolean)(e,value) && (!query.trim() || matchesQuery(e,query))).length;
}
export const filterLabel = (key:FilterKey,value:string):string =>
  key==='kinds' ? kindLabels[value as Kind] :
  key==='marks' ? markBands.find(b=>b.id===value)!.label :
  key==='diagram' ? (value==='with'?'Diagram preview':'No diagram preview') :
  key==='availability' ? (value==='ready'?'Ready to order':'Not yet available') : value;

/** Case-insensitive split for highlighting a search match inside a label. */
export function highlight(text:string,query:string):{text:string;match:boolean}[] {
  const q=query.trim();
  if(!q) return [{text,match:false}];
  const at=text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if(at<0) return [{text,match:false}];
  return [{text:text.slice(0,at),match:false},{text:text.slice(at,at+q.length),match:true},{text:text.slice(at+q.length),match:false}].filter(p=>p.text);
}
