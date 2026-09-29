import { holds, partCategory, type Alternative, type Classification, type LineStructure } from './contract-v1';

/**
 * Cognitive composition of one configured line, from supported facts only.
 *
 * A line's marks are split across subquestions. Mark certainty and structure are separate facts:
 * - Structure: which subquestions exist. The source lists them in one table, or in alternative
 *   tables (variants) of which exactly one applies. A line may contain subquestions the source does
 *   not list only where the source says so: a stated sub-question count above the listed rows, or a
 *   choice naming an unlisted task (`structure.alternatives[].additional`, choice effects). Example
 *   marks never make a structure open. Version 1 and 2 definitions carry no `structure`: their parts
 *   are one closed alternative.
 * - Marks: a part's marks are bounded when the source states them (basis `range`, rule `partMarks`);
 *   otherwise each included subquestion carries at least one mark. Example marks are reported
 *   separately, per alternative, and never used as bounds.
 *
 * Each alternative still possible is solved on its own; a category's range is the union over them,
 * never over mixtures of their rows. Within one alternative each category's range is exact, but the
 * extremes of different categories cannot in general occur together. Grouped categories
 * (apply-or-analyse) stay their own bucket; subquestions the source does not list count under
 * `unclassified`. Nothing is counted twice.
 */
export type Range = {min:number; max:number};
export type CompositionReason = 'marks-not-set'|'invalid-configuration'|'no-supported-allocation'|'choices-conflict-with-source'|'definition-unreadable';
export type Example = {label:string; marks:Range; parts:number; categories:Record<string,Range>};
export type PartState = 'included'|'possible'|'excluded';
export type LineComposition = {
  /** exact: every mark's category is fixed; bounded: ranges; unclassified: no category is known for any mark. */
  status:'exact'|'bounded'|'unclassified'|'not-calculable'; reason:CompositionReason|null; marks:number|null;
  /** Subquestions the source does not list may be written (source-stated). */
  open:boolean;
  categories:Record<string,Range>; bands:Record<string,Range>;
  /** Categories of listed subquestions still in play, known even when marks cannot be calculated. */
  known:string[];
  /** Alternative structures still possible, by label; more than one means the choice is unresolved. */
  alternatives:string[];
  /** Each possible alternative's own source example (its example marks), labelled; never summed across alternatives. */
  examples:Example[];
  /** Where each listed part stands once choices and structure are applied. */
  parts:Record<string,PartState>;
  /** Parts left out by a choice effect, with the effect's reason keys. */
  droppedBy:Record<string,string[]>;
};
export const UNLISTED = 'unclassified';

type Slot = {category:string; band:string; lo:number; hi:number; must:boolean};

/** Least and greatest marks `target` can receive, or null when no allocation reaches the total. */
function targetBounds(slots:Slot[], of:(s:Slot)=>string, target:string, count:[number,number], total:number, extra:Range):[number,number]|null {
  const K=Math.min(slots.length,count[1]), S=total, W=S+1, NONE=1e9;
  let lo=new Float64Array((K+1)*W).fill(NONE), hi=new Float64Array((K+1)*W).fill(-NONE);
  lo[0]=0;hi[0]=0;
  for(const slot of slots) {
    const nlo=slot.must?new Float64Array((K+1)*W).fill(NONE):lo.slice(), nhi=slot.must?new Float64Array((K+1)*W).fill(-NONE):hi.slice();
    const gain=of(slot)===target?1:0;
    for(let k=0;k<K;k++) for(let s=0;s<=S;s++) {
      const a=lo[k*W+s];if(a===NONE) continue;const b=hi[k*W+s];
      for(let m=slot.lo;m<=Math.min(slot.hi,S-s);m++) {
        const i=(k+1)*W+s+m;
        if(a+gain*m<nlo[i]) nlo[i]=a+gain*m;
        if(b+gain*m>nhi[i]) nhi[i]=b+gain*m;
      }
    }
    lo=nlo;hi=nhi;
  }
  let best:[number,number]|null=null;
  const unlisted=target===UNLISTED;
  for(let k=0;k<=K;k++) for(let s=0;s<=S;s++) {
    if(lo[k*W+s]===NONE) continue;
    // j unlisted subquestions carry the rest, at least one mark each.
    const rest=S-s, jmin=Math.max(count[0]-k,extra.min,rest>0?1:0), jmax=Math.min(extra.max,rest,count[1]-k);
    if(rest===0 ? (k<count[0] || extra.min>0) : jmin>jmax) continue;
    const a=lo[k*W+s]+(unlisted?rest:0), b=hi[k*W+s]+(unlisted?rest:0);
    best=best?[Math.min(best[0],a),Math.max(best[1],b)]:[a,b];
  }
  return best;
}

const intersect=(a:Range,b:Range|null):Range=>b?{min:Math.max(a.min,b.min),max:Math.min(a.max,b.max)}:a;

export function lineComposition(doc:Classification, structure:LineStructure, marks:number|null, version:1|2|3=doc.schemaVersion):LineComposition {
  const byId=new Map(doc.parts.map(p=>[p.id,p]));
  const categoryOf=(id:string)=>{const p=byId.get(id)!;return version>=2?partCategory(p):p.cognitive.bloom??UNLISTED;};
  const bandOf=(id:string)=>byId.get(id)!.cognitive.curriculumBand??UNLISTED;
  // Definitions without a structure: their listed parts are one closed alternative; none listed means none known.
  const alternatives:Alternative[]=doc.structure?.alternatives ?? [{id:'listed',label:'',parts:doc.parts.map(p=>p.id),count:null,required:[],
    additional:doc.parts.length?{min:0,max:0}:{min:0,max:Number.MAX_SAFE_INTEGER},locator:null}];
  const values=new Map(Object.entries(structure.values).map(([f,o])=>[f,new Set(o)]));
  const effects=(doc.structure?.effects??[]).filter(e=>holds(e.when,values,marks,new Set(structure.selected)));
  const dropped=new Set(effects.flatMap(e=>e.excludeParts));
  const droppedBy=Object.fromEntries([...dropped].map(id=>[id,effects.filter(e=>e.excludeParts.includes(id)).map(e=>e.reason)]));
  const limit=effects.reduce<Range|null>((r,e)=>e.additional?intersect(r??{min:0,max:Number.MAX_SAFE_INTEGER},e.additional):r,null);
  const listed=new Set([...structure.included.map(p=>p.id),...structure.flexible].filter(id=>!dropped.has(id)));
  const must=new Set(structure.included.map(p=>p.id));
  const range=(id:string,total:number)=>structure.ranges[id]??{min:1,max:total};
  // An alternative is possible when every part the choices require belongs to it and its own required parts remain.
  const candidates=alternatives.map(alt=>{
    const available=alt.parts.filter(id=>listed.has(id)), mustHere=new Set([...must].filter(id=>alt.parts.includes(id)).concat(alt.required));
    const possible=[...must].every(id=>alt.parts.includes(id)) && alt.required.every(id=>listed.has(id));
    const extra=intersect(alt.additional,limit);
    const count:Range=intersect(alt.count??{min:Math.max(1,mustHere.size+extra.min),max:available.length+extra.max},
      structure.countRules?{min:structure.countRules[0],max:structure.countRules[1]}:null);
    // When the stated count leaves no room to leave any listed part out, every one is in.
    if(available.length+extra.max<=count.min) available.forEach(id=>mustHere.add(id));
    return {alt,available,mustHere,possible:possible && extra.min<=extra.max && count.min<=count.max,extra,count};
  });
  const typicalOf=(ids:string[])=>ids.length>0 && ids.every(id=>{const m=byId.get(id)!.marks;return m.basis==='typical' && m.min!==null && m.max!==null;});
  const exampleOf=(alt:Alternative):Example|null=>typicalOf(alt.parts)?{label:alt.label,parts:alt.parts.length,
    marks:alt.parts.reduce((n,id)=>({min:n.min+byId.get(id)!.marks.min!,max:n.max+byId.get(id)!.marks.max!}),{min:0,max:0}),
    categories:alt.parts.reduce<Record<string,Range>>((a,id)=>{const k=categoryOf(id),m=byId.get(id)!.marks;a[k]={min:(a[k]?.min??0)+m.min!,max:(a[k]?.max??0)+m.max!};return a;},{})}:null;
  const describe=(live:typeof candidates)=>{
    const parts:Record<string,PartState>={};
    for(const p of doc.parts) {
      const homes=live.filter(c=>c.available.includes(p.id));
      parts[p.id]=!homes.length?'excluded':homes.every(c=>c.mustHere.has(p.id)) && homes.length===live.length?'included':'possible';
    }
    return {parts,droppedBy,alternatives:live.map(c=>c.alt.label).filter(Boolean),examples:live.flatMap(c=>exampleOf(c.alt)??[]),
      known:[...new Set(live.flatMap(c=>c.available.map(categoryOf)))].sort(),open:live.some(c=>c.extra.max>0)};
  };
  const live=candidates.filter(c=>c.possible);
  const pending=(reason:CompositionReason,shown=live):LineComposition=>({...describe(shown),marks,status:'not-calculable',reason,categories:{},bands:{}});
  if(!structure.valid) return pending('invalid-configuration');
  if(!live.length) return pending('choices-conflict-with-source',candidates);
  if(marks===null) return pending('marks-not-set');
  const solved=live.flatMap(c=>{
    const slots=c.available.map(id=>{const r=range(id,marks);return {category:categoryOf(id),band:bandOf(id),lo:r.min,hi:r.max,must:c.mustHere.has(id)};});
    const extra={min:c.extra.min,max:Math.min(c.extra.max,marks)};
    const solve=(of:(s:Slot)=>string)=>{
      const out:Record<string,Range>={};
      for(const k of [...new Set([...slots.map(of),...(extra.max?[UNLISTED]:[])])].sort()){const b=targetBounds(slots,of,k,[c.count.min,c.count.max],marks,extra);if(!b)return null;out[k]={min:b[0],max:b[1]};}
      return Object.keys(out).length?out:null;
    };
    const cat=solve(s=>s.category), band=cat&&solve(s=>s.band);
    return cat&&band?[{c,cat,band}]:[];
  });
  // Parts left out by rules or effects mean the teacher's choices, not the marks, removed every structure.
  const chosenOut=dropped.size>0 || doc.parts.some(p=>!listed.has(p.id));
  if(!solved.length) return pending(chosenOut?'choices-conflict-with-source':'no-supported-allocation');
  // Union over feasible alternatives; a category an alternative lacks is zero there.
  const merge=(xs:Record<string,Range>[])=>Object.fromEntries([...new Set(xs.flatMap(Object.keys))].sort().map(k=>
    [k,{min:Math.min(...xs.map(x=>x[k]?.min??0)),max:Math.max(...xs.map(x=>x[k]?.max??0))}]));
  const categories=merge(solved.map(x=>x.cat)), bands=merge(solved.map(x=>x.band)), feasible=solved.map(x=>x.c);
  const unknown=categories[UNLISTED]??{min:0,max:0};
  const status=unknown.min===marks?'unclassified':!unknown.max && [...Object.values(categories),...Object.values(bands)].every(r=>r.min===r.max)?'exact':'bounded';
  return {...describe(feasible),marks,status,reason:null,categories,bands};
}

/** Line compositions summed per category. Lines are independent, so each paper range is exact per category. */
export function sumCompositions(lines:{marks:number|null; composition:LineComposition}[]) {
  const categories:Record<string,Range>={}, bands:Record<string,Range>={};const known=new Set<string>();let pending=0;
  const add=(into:Record<string,Range>,from:Record<string,Range>)=>{for(const [k,r] of Object.entries(from)){into[k]??={min:0,max:0};into[k].min+=r.min;into[k].max+=r.max;}};
  for(const l of lines) {
    l.composition.known.forEach(k=>known.add(k));
    if(l.composition.status==='not-calculable') pending+=l.marks??0;
    else {add(categories,l.composition.categories);add(bands,l.composition.bands);}
  }
  const exact=!pending && !categories[UNLISTED]?.max && [...Object.values(categories),...Object.values(bands)].every(r=>r.min===r.max);
  return {categories,bands,known:[...new Set(known)].sort(),pending,exact};
}
