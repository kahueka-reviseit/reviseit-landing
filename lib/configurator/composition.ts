import { partCategory, type Classification, type LineStructure } from './contract-v1';

/**
 * Cognitive composition of one configured line, from supported facts only.
 *
 * A line's marks are split across subquestions. The engine knows each listed
 * subquestion's category from its classification, whether the teacher's choices
 * require or exclude it, and its marks when the source states them. When the
 * source gives only example marks (basis `typical`), the listed subquestions are
 * one published instance: the real question may carry other marks on them and
 * may contain subquestions the source does not list. Such a line is `open`:
 * each included listed subquestion carries at least one mark, and any other
 * subquestion counts under `unclassified` (its category is unknown until it is
 * written). Example marks are reported separately, never used as bounds.
 *
 * Each category's range is exact over every allocation the facts permit, but
 * the extremes of different categories cannot in general occur together.
 * Grouped categories (apply-or-analyse) stay their own bucket; nothing is
 * counted twice.
 */
export type Range = {min:number; max:number};
export type CompositionReason = 'marks-not-set'|'invalid-configuration'|'no-supported-allocation'|'definition-unreadable';
export type LineComposition = {
  /** exact: every mark's category is fixed; bounded: ranges; unclassified: no category is known for any mark. */
  status:'exact'|'bounded'|'unclassified'|'not-calculable'; reason:CompositionReason|null; marks:number|null; open:boolean;
  categories:Record<string,Range>; bands:Record<string,Range>;
  /** Categories of the listed subquestions still in play, known even when marks cannot be calculated. */
  known:string[];
  /** The source's own example instance (its typical part marks), labelled as such. */
  example:{marks:Range; parts:number; categories:Record<string,Range>}|null;
};
export const UNLISTED = 'unclassified';

type Slot = {category:string; band:string; lo:number; hi:number; must:boolean};

/** Least and greatest marks `target` can receive, or null when no allocation reaches the total. */
function targetBounds(slots:Slot[], of:(s:Slot)=>string, target:string, count:[number,number], total:number, unlisted:number):[number,number]|null {
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
  const extra=target===UNLISTED;
  for(let k=0;k<=K;k++) for(let s=0;s<=S;s++) {
    if(lo[k*W+s]===NONE) continue;
    const rest=S-s;
    // Unlisted subquestions: j of them carry the rest, at least one mark each.
    const jmin=Math.max(count[0]-k,rest>0?1:0), jmax=Math.min(unlisted,rest,count[1]-k);
    if(rest===0 ? k<count[0] : jmin>jmax) continue;
    const a=lo[k*W+s]+(extra?rest:0), b=hi[k*W+s]+(extra?rest:0);
    best=best?[Math.min(best[0],a),Math.max(best[1],b)]:[a,b];
  }
  return best;
}

export function lineComposition(doc:Classification, structure:LineStructure, marks:number|null, version:1|2=doc.schemaVersion):LineComposition {
  const byId=new Map(doc.parts.map(p=>[p.id,p]));
  const categoryOf=(id:string)=>{const p=byId.get(id)!;return version===2?partCategory(p):p.cognitive.bloom??UNLISTED;};
  const bandOf=(id:string)=>byId.get(id)!.cognitive.curriculumBand??UNLISTED;
  const listed=[...structure.included.map(p=>p.id),...structure.flexible];
  const known=[...new Set(listed.map(categoryOf))].sort();
  const typical=doc.parts.length>0 && doc.parts.every(p=>p.marks.basis==='typical' && p.marks.min!==null && p.marks.max!==null);
  const add=(a:Record<string,Range>,k:string,r:Range)=>{a[k]={min:(a[k]?.min??0)+r.min,max:(a[k]?.max??0)+r.max};return a;};
  const example=typical?{marks:doc.parts.reduce((n,p)=>({min:n.min+p.marks.min!,max:n.max+p.marks.max!}),{min:0,max:0}),parts:doc.parts.length,
    categories:doc.parts.reduce<Record<string,Range>>((a,p)=>add(a,version===2?partCategory(p):p.cognitive.bloom??UNLISTED,{min:p.marks.min!,max:p.marks.max!}),{})}:null;
  // The listed subquestions are the whole structure only when the source states every part's marks.
  const open=!doc.parts.length || doc.parts.some(p=>p.marks.basis!=='range');
  const base={marks,open,known,example};
  const pending=(reason:CompositionReason):LineComposition=>({...base,status:'not-calculable',reason,categories:{},bands:{}});
  if(!structure.valid) return pending('invalid-configuration');
  if(marks===null) return pending('marks-not-set');
  const slot=(id:string,must:boolean):Slot=>{const r=structure.ranges[id];return {category:categoryOf(id),band:bandOf(id),lo:r?r.min:1,hi:r?r.max:marks,must};};
  const slots=[...structure.included.map(p=>slot(p.id,true)),...structure.flexible.map(id=>slot(id,false))];
  const count:[number,number]=open?[structure.countRules?.[0]??Math.max(1,structure.included.length),structure.countRules?.[1]??listed.length+marks]:structure.count;
  const unlisted=open?Math.max(0,Math.min(marks,count[1]-structure.included.length)):0;
  const solve=(of:(s:Slot)=>string)=>{
    const keys=[...new Set([...slots.map(of),...(unlisted?[UNLISTED]:[])])].sort();
    const out:Record<string,Range>={};
    for(const k of keys){const b=targetBounds(slots,of,k,count,marks,unlisted);if(!b)return null;out[k]={min:b[0],max:b[1]};}
    return keys.length||!marks?out:null;
  };
  const categories=solve(s=>s.category), bands=solve(s=>s.band);
  if(!categories || !bands) return pending('no-supported-allocation');
  const unknown=categories[UNLISTED]??{min:0,max:0};
  const status=unknown.min===marks?'unclassified':!unknown.max && [...Object.values(categories),...Object.values(bands)].every(r=>r.min===r.max)?'exact':'bounded';
  return {...base,status,reason:null,categories,bands};
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
  return {categories,bands,known:[...known].sort(),pending,exact};
}
