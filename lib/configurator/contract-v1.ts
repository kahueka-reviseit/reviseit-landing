import type { Answer } from '../jobs/questionnaire';

/**
 * Server evaluator for configurator contract version 1 (the producer's closed
 * rule grammar). It must return the producer's normalised result for every
 * conformance fixture. There is no expression language: conditions and actions
 * are the fixed shapes below, with no negation, so the forced-option fixpoint
 * is unique and rule order cannot change a result.
 */
export const BLOOM = ['remember','understand','apply','analyse','evaluate','create'] as const;
export const CATEGORIES = [...BLOOM,'unclassified'] as const;
export type Category = typeof CATEGORIES[number];
type Range = {min:number;max:number};

export type Condition = {always:true} | {facet:string; is:string} | {facet:string; in:string[]} | {marksAtLeast:number} | {marksAtMost:number}
  | {partSelected:string} | {all:Condition[]} | {any:Condition[]};
export type Action = {requireParts:string[]} | {excludeParts:string[]} | {excludeOptions:{facet:string; options:string[]}}
  | {requireOption:{facet:string; option:string}} | {partMarks:{part:string; min:number; max:number}} | {partCount:{min:number; max:number}}
  | {preferOptions:{facet:string; options:string[]}};
export type Rule = {id:string; kind:'constraint'|'preference'; activation:'active'|'held'; when:Condition; then:Action[]; reason:string; origin:unknown};
export type Facet = {id:string; type:'integer'|'choice'|'text'|'parts'; stage:'pre'|'post'; required:boolean; delegable:boolean; allowCustom:boolean; prompt:string|null;
  binding:{scope:'line-marks'}|{scope:'line-parts'}|{scope:'item-form'; fieldId:string};
  domain:any};
export type Part = {id:string; label:string; summary:string|null; inclusion:'required'|'optional'|'unspecified';
  marks:{basis:'range'|'typical'|'unknown'; min:number|null; max:number|null};
  cognitive:{bloom:typeof BLOOM[number]|null; unknownReason:string|null; curriculumBand:string|null; curriculumBandCandidates:string[]; sourceLabels:unknown}; locator:unknown};
export type Classification = {schemaVersion:1; moduleId:string; kind:'structured'|'multiple_choice'; itemId:string; release:string; title:string;
  curriculumId:string; curriculumRequirementsRef:{profileId:string; version:number}; marks:{mode:'fixed'; value:number}|{mode:'range'; min:number; max:number};
  parts:Part[]; facets:Facet[]; rules:Rule[];
  diagramPolicy:{stimulus:'required'|'optional'|'not_applicable'|'unspecified'; stimulusFacet:string|null; learnerDrawnParts:string[]; whenLeftOut:string|null; locators:unknown[]};
  formBinding:{status:'bound'|'explicit-no-input'|'no-form'; itemForm:null|{formRevision:string; privateKind:string; fieldCount:number}; fieldMap:{facetId:string; fieldId:string}[]; sharedForms:unknown[]};
  provenance:unknown; jevChecks:JevCheck[]; hints:Record<string,string>; coverage:{status:string; gaps:unknown[]}};
export type JevCheck = {id:string; type:'noul'|'choice'; activation:'shadow'; stage:'pre'|'post'; fields:string[]; instructions:string; criteria:string[]; hint:string;
  flagAbove?:number; suggestAbove?:number; target?:string; options?:string[]};
export type Profile = {profileId:string; version:number; curriculumId:string; bands:{id:string; label?:string}[];
  distributions:{id:string; taxonomy:'bloom'|'curriculum-band'|'knowledge-area'; basis:'marks'|'item-count'; targets:{key:string; percent:number|null}[]; [k:string]:unknown}[]; [k:string]:unknown};

export type Issue = {code:string; ruleIds:string[]; facet:string|null; part:string|null; option:string|null; lineId:string|null; reasons:string[]};
export type LineInput = {lineId:string; identity:{moduleId:string; kind:string; itemId:string; release:string}; marks:number|null; parts:string[]|null; answers:Record<string,Answer>};
export type Effect = {facet:string; option:string; ruleIds:string[]};
export type LineOutput = {lineId:string; identity:LineInput['identity']; marks:number|null; valid:boolean; complete:boolean; errors:Issue[]; attention:Issue[]; outstanding:string[];
  effectiveParts:{id:string; inclusion:string; marks:Range|null}[]; excludedParts:{part:string; ruleIds:string[]}[];
  excludedOptions:Effect[]; forcedOptions:Effect[]; preferredOptions:Effect[]; feasibility:'feasible'|'infeasible'|'not-determinable'|'not-evaluated';
  cognitive:{basis:'marks'; determinable:boolean; ranges:Record<Category,Range>|null; reason:string|null}};
export type Internal = {mandatory:[string,number,number][]; flexible:[string,number,number][]; count:[number,number]; marks:number};

const sortedSet=(xs:Iterable<string>)=>[...new Set(xs)].sort(cmp);
function cmp(a:string,b:string){return a<b?-1:a>b?1:0;}
function tupleCmp(a:string[],b:string[]){for(let i=0;i<Math.max(a.length,b.length);i++){const c=cmp(a[i]??'',b[i]??'');if(c)return c;}return 0;}
export function issue(code:string,kw:{ruleIds?:Iterable<string>;facet?:string|null;part?:string|null;option?:string|null;lineId?:string|null;reasons?:Iterable<string>}={}):Issue {
  return {code,ruleIds:sortedSet(kw.ruleIds??[]),facet:kw.facet??null,part:kw.part??null,option:kw.option??null,lineId:kw.lineId??null,reasons:sortedSet(kw.reasons??[])};
}
const issueKey=(i:Issue)=>[i.code,i.lineId??'',i.facet??'',i.part??'',i.option??'',i.ruleIds.join(',')];
const sortIssues=(xs:Issue[])=>[...xs].sort((a,b)=>tupleCmp(issueKey(a),issueKey(b)));

export function holds(cond:Condition, values:Map<string,Set<string>>, marks:number|null, selected:Set<string>):boolean {
  if('always' in cond) return cond.always===true;
  if('facet' in cond) { const known=values.get(cond.facet)??new Set(); const wanted='is' in cond?[cond.is]:cond.in; return wanted.some(w=>known.has(w)); }
  if('marksAtLeast' in cond) return marks!==null && marks>=cond.marksAtLeast;
  if('marksAtMost' in cond) return marks!==null && marks<=cond.marksAtMost;
  if('partSelected' in cond) return selected.has(cond.partSelected);
  if('all' in cond) return cond.all.every(c=>holds(c,values,marks,selected));
  if('any' in cond) return cond.any.some(c=>holds(c,values,marks,selected));
  throw new Error('Unknown condition');
}

/** Exact per-category mark bounds over every integer allocation, or null when none reaches the total. */
export function allocationBounds(mandatory:[string,number,number][], flexible:[string,number,number][], count:[number,number], total:number,
  categoryOf:Record<string,string>, categories:readonly string[]=CATEGORIES):Record<string,[number,number]>|null {
  const parts=[...mandatory.map(p=>[...p,true] as const),...flexible.map(p=>[...p,false] as const)];
  function optimise(category:string, maximise:boolean):number|null {
    const better=(a:number,b:number)=>maximise?a>b:a<b;
    let states=new Map<string,number>([['0,0',0]]);
    for(const [pid,lo,hi,must] of parts) {
      const next=new Map<string,number>();
      for(const [key,v] of states) {
        const [k,s]=key.split(',').map(Number);
        if(!must && (!next.has(key) || better(v,next.get(key)!))) next.set(key,v);
        for(let m=lo;m<=Math.min(hi,total-s);m++) {
          const nk=`${k+1},${s+m}`, val=v+(categoryOf[pid]===category?m:0);
          if(!next.has(nk) || better(val,next.get(nk)!)) next.set(nk,val);
        }
      }
      states=next;
    }
    const finals=[...states].filter(([key])=>{const [k,s]=key.split(',').map(Number);return s===total && count[0]<=k && k<=count[1];}).map(([,v])=>v);
    if(!finals.length) return null;
    return maximise?Math.max(...finals):Math.min(...finals);
  }
  const result:Record<string,[number,number]>={};
  for(const category of categories) {
    const low=optimise(category,false);
    if(low===null) return null;
    result[category]=[low,optimise(category,true)!];
  }
  return result;
}

function answerError(facet:Facet, answer:Answer):string|null {
  if(answer.kind==='automatic') return facet.delegable?null:'delegation-not-permitted';
  if(answer.kind==='omit') return !facet.required?null:'omission-not-permitted';
  if(answer.kind==='choice') {
    if(facet.type!=='choice') return 'choice-on-text-facet';
    return (facet.domain.options as {id:string}[]).some(o=>o.id===answer.choiceId)?null:'unknown-option';
  }
  if(facet.type==='choice') return facet.allowCustom?null:'custom-answer-not-permitted';
  return answer.text.length>facet.domain.maxLength?'text-too-long':null;
}
const resolved=(a:Answer|undefined)=>!!a && (a.kind!=='text' || !!a.text.trim());

export function evaluateLine(doc:Classification, line:LineInput):{result:LineOutput; internal:Internal|null} {
  const lid=line.lineId;const errors:Issue[]=[],attention:Issue[]=[];
  const facets=new Map(doc.facets.map(f=>[f.id,f]));
  const marksFacet=doc.facets.find(f=>f.binding.scope==='line-marks');
  if(!marksFacet) throw new Error('Classification without a marks facet');
  const partsFacet=doc.facets.find(f=>f.type==='parts')??null;
  const parts=doc.parts;const byId=new Map(parts.map(p=>[p.id,p]));
  const marks=line.marks;const outstanding:string[]=[];
  if(doc.formBinding.status==='no-form') errors.push(issue('no-authored-form',{lineId:lid}));
  if(marks===null) outstanding.push(marksFacet.id);
  else if(!(marksFacet.domain.min<=marks && marks<=marksFacet.domain.max)) errors.push(issue('marks-out-of-range',{facet:marksFacet.id,lineId:lid}));
  const selected=new Set<string>();
  if(line.parts!==null) {
    if(!partsFacet) errors.push(issue('parts-not-configurable',{lineId:lid}));
    else for(const pid of line.parts) { if(!(partsFacet.domain.parts as string[]).includes(pid)) errors.push(issue('unknown-part',{part:pid,lineId:lid})); else selected.add(pid); }
  }
  const answers=line.answers;const explicit=new Map<string,string>();
  for(const fid of Object.keys(answers).sort(cmp)) {
    const answer=answers[fid];const facet=facets.get(fid);
    if(!facet || facet.binding.scope!=='item-form') { errors.push(issue('unknown-facet',{facet:fid,lineId:lid})); continue; }
    const problem=answerError(facet,answer);
    if(problem) errors.push(issue(problem,{facet:fid,option:answer.kind==='choice'?answer.choiceId:null,lineId:lid}));
    else if(answer.kind==='choice') explicit.set(fid,answer.choiceId);
  }
  for(const f of doc.facets) if(f.binding.scope==='item-form' && f.required && !resolved(answers[f.id])) outstanding.push(f.id);

  const active=[...doc.rules].filter(r=>r.activation==='active').sort((a,b)=>cmp(a.id,b.id));
  const constraints=active.filter(r=>r.kind==='constraint');
  const forced=new Map<string,Set<string>>(); // key facet\u0000option -> rule ids
  const fkey=(f:string,o:string)=>f+'\u0000'+o, split=(k:string)=>k.split('\u0000') as [string,string];
  const values=new Map<string,Set<string>>([...explicit].map(([f,o])=>[f,new Set([o])]));
  let changed=true;
  while(changed) {
    changed=false;
    for(const r of constraints) {
      if(!holds(r.when,values,marks,selected)) continue;
      for(const action of r.then) if('requireOption' in action) {
        const body=action.requireOption;const key=fkey(body.facet,body.option);
        if(!forced.has(key)) forced.set(key,new Set());
        if(!forced.get(key)!.has(r.id)) { forced.get(key)!.add(r.id); changed=true; }
        if(!values.has(body.facet)) values.set(body.facet,new Set());
        if(!values.get(body.facet)!.has(body.option)) { values.get(body.facet)!.add(body.option); changed=true; }
      }
    }
  }
  const firing=constraints.filter(r=>holds(r.when,values,marks,selected));
  for(const facet of [...values.keys()].sort(cmp)) {
    if(values.get(facet)!.size>1) {
      const rules=new Set<string>();for(const [k,rids] of forced) if(split(k)[0]===facet) rids.forEach(x=>rules.add(x));
      errors.push(issue('option-conflict',{facet,ruleIds:rules,lineId:lid,reasons:firing.filter(r=>rules.has(r.id)).map(r=>r.reason)}));
    }
  }
  const excludedOpts=new Map<string,Set<string>>(), requiredParts=new Map<string,Set<string>>(), excludedParts=new Map<string,Set<string>>();
  const partRanges=new Map<string,[number,number,string][]>(), counts:[number,number,string][]=[];
  const add=(m:Map<string,Set<string>>,k:string,v:string)=>{if(!m.has(k))m.set(k,new Set());m.get(k)!.add(v);};
  for(const r of firing) for(const action of r.then) {
    if('excludeOptions' in action) for(const o of action.excludeOptions.options) add(excludedOpts,fkey(action.excludeOptions.facet,o),r.id);
    else if('requireParts' in action) for(const p of action.requireParts) add(requiredParts,p,r.id);
    else if('excludeParts' in action) for(const p of action.excludeParts) add(excludedParts,p,r.id);
    else if('partMarks' in action) { const b=action.partMarks;if(!partRanges.has(b.part))partRanges.set(b.part,[]);partRanges.get(b.part)!.push([b.min,b.max,r.id]); }
    else if('partCount' in action) counts.push([action.partCount.min,action.partCount.max,r.id]);
  }
  const reasonOf=new Map(doc.rules.map(r=>[r.id,r.reason]));const reasons=(ids:Iterable<string>)=>[...ids].map(x=>reasonOf.get(x)!);
  const sortedKeys=(m:Map<string,Set<string>>)=>[...m.keys()].sort((a,b)=>tupleCmp(split(a),split(b)));
  for(const k of sortedKeys(excludedOpts)) {
    const [facet,option]=split(k);const rids=excludedOpts.get(k)!;
    if(explicit.get(facet)===option) errors.push(issue('option-excluded',{facet,option,ruleIds:rids,lineId:lid,reasons:reasons(rids)}));
    if(forced.has(k)) { const both=new Set([...rids,...forced.get(k)!]); errors.push(issue('forced-option-excluded',{facet,option,ruleIds:both,lineId:lid,reasons:reasons(both)})); }
  }
  for(const fid of [...facets.keys()].sort(cmp)) {
    const f=facets.get(fid)!;if(f.type!=='choice') continue;
    const remaining=(f.domain.options as {id:string}[]).filter(o=>!excludedOpts.has(fkey(fid,o.id)));
    if(!remaining.length) {
      const rids=new Set<string>();for(const [k,s] of excludedOpts) if(split(k)[0]===fid) s.forEach(x=>rids.add(x));
      const answer=answers[fid];const custom=!!answer && answer.kind==='text';
      const target=(f.required || (answer && answer.kind==='automatic')) && !custom?errors:attention;
      target.push(issue('no-options-left',{facet:fid,ruleIds:rids,lineId:lid,reasons:reasons(rids)}));
    }
  }
  for(const k of sortedKeys(forced)) {
    const [facet,option]=split(k);const rids=forced.get(k)!;const answer=answers[facet];
    if(answer && answer.kind==='text') attention.push(issue('custom-answer-affected',{facet,option,ruleIds:rids,lineId:lid,reasons:reasons(rids)}));
    else if(answer && answer.kind==='omit') attention.push(issue('omitted-answer-affected',{facet,option,ruleIds:rids,lineId:lid,reasons:reasons(rids)}));
  }
  for(const r of [...doc.rules].sort((a,b)=>cmp(a.id,b.id))) if(r.activation==='held' && holds(r.when,values,marks,selected)) attention.push(issue('held-rule-applies',{ruleIds:[r.id],lineId:lid,reasons:[r.reason]}));
  const preferred=new Map<string,Set<string>>();
  for(const r of active) if(r.kind==='preference' && holds(r.when,values,marks,selected)) for(const action of r.then) if('preferOptions' in action) {
    for(const o of action.preferOptions.options) if(!excludedOpts.has(fkey(action.preferOptions.facet,o))) add(preferred,fkey(action.preferOptions.facet,o),r.id);
  }
  const included:[string,string][]=[],flexible:[string,string][]=[];
  for(const p of parts) {
    const pid=p.id;const byRule=requiredParts.has(pid);
    const must=p.inclusion==='required' || selected.has(pid) || byRule;
    if(excludedParts.has(pid)) {
      const rids=excludedParts.get(pid)!;
      if(p.inclusion==='required' || byRule) { const both=new Set([...rids,...(requiredParts.get(pid)??[])]); errors.push(issue('part-conflict',{part:pid,ruleIds:both,lineId:lid,reasons:reasons(both)})); }
      else if(selected.has(pid)) errors.push(issue('part-excluded',{part:pid,ruleIds:rids,lineId:lid,reasons:reasons(rids)}));
      continue;
    }
    if(must) included.push([pid,p.inclusion==='required'?'required':selected.has(pid)?'selected':'rule-required']);
    else if(p.inclusion==='unspecified') flexible.push([pid,'flexible']);
  }
  let ranged=true;const effective:{id:string;inclusion:string;marks:Range|null}[]=[];const ranges=new Map<string,[number|null,number|null]>();
  for(const [pid,inclusion] of [...included,...flexible]) {
    const pm=byId.get(pid)!.marks;
    let lo:number|null=pm.basis==='range'?pm.min:null, hi:number|null=pm.basis==='range'?pm.max:null;
    const here=partRanges.get(pid)??[];
    if(here.length) {
      const clo=Math.max(...here.map(c=>c[0])),chi=Math.min(...here.map(c=>c[1]));
      if(lo===null){lo=clo;hi=chi;}else{lo=Math.max(lo,clo);hi=Math.min(hi!,chi);}
      if(lo>hi!) { const rids=new Set(here.map(c=>c[2])); errors.push(issue('part-marks-conflict',{part:pid,ruleIds:rids,lineId:lid,reasons:reasons(rids)})); }
    }
    if(lo===null) ranged=false;
    ranges.set(pid,[lo,hi]);
    effective.push({id:pid,inclusion,marks:lo===null||lo>hi!?null:{min:lo,max:hi!}});
  }
  const order=new Map(parts.map((p,i)=>[p.id,i]));effective.sort((a,b)=>order.get(a.id)!-order.get(b.id)!);
  let cmin=included.length,cmax=included.length+flexible.length;const countRules=new Set<string>();
  for(const [lo,hi,rid] of counts){cmin=Math.max(cmin,lo);cmax=Math.min(cmax,hi);countRules.add(rid);}
  if(cmin>cmax) errors.push(issue('part-count-infeasible',{ruleIds:countRules,lineId:lid,reasons:reasons(countRules)}));
  const categoryOf=Object.fromEntries(parts.map(p=>[p.id,p.cognitive.bloom??'unclassified']));
  let cognitive:LineOutput['cognitive']={basis:'marks',determinable:false,ranges:null,reason:null};
  let feasibility:LineOutput['feasibility'];let internal:Internal|null=null;
  let mand:[string,number,number][]=[],flex:[string,number,number][]=[];
  if(errors.length){feasibility='not-evaluated';cognitive.reason='invalid-configuration';}
  else if(marks===null){feasibility='not-evaluated';cognitive.reason='marks-not-set';}
  else if(!parts.length){feasibility='not-determinable';cognitive.reason='no-parts';}
  else if(!ranged){feasibility='not-determinable';cognitive.reason='part-marks-not-ranged';}
  else {
    mand=included.map(([pid])=>[pid,ranges.get(pid)![0]!,ranges.get(pid)![1]!]);
    flex=flexible.map(([pid])=>[pid,ranges.get(pid)![0]!,ranges.get(pid)![1]!]);
    const bounds=allocationBounds(mand,flex,[cmin,cmax],marks,categoryOf);
    if(bounds===null) {
      feasibility='infeasible';
      const rids=new Set<string>([...countRules]);for(const v of partRanges.values()) v.forEach(c=>rids.add(c[2]));
      for(const group of [...requiredParts.values(),...excludedParts.values()]) group.forEach(x=>rids.add(x));
      errors.push(issue('marks-infeasible',{facet:marksFacet.id,ruleIds:rids,lineId:lid,reasons:reasons(rids)}));
      cognitive.reason='infeasible';
    } else {
      feasibility='feasible';
      cognitive={basis:'marks',determinable:true,reason:null,ranges:Object.fromEntries(Object.entries(bounds).map(([k,v])=>[k,{min:v[0],max:v[1]}])) as Record<Category,Range>};
      internal={mandatory:mand,flexible:flex,count:[cmin,cmax],marks};
    }
  }
  const effects=(m:Map<string,Set<string>>):Effect[]=>sortedKeys(m).map(k=>{const [facet,option]=split(k);return {facet,option,ruleIds:sortedSet(m.get(k)!)};});
  const valid=!errors.length;
  return {internal,result:{lineId:lid,identity:{...line.identity},marks,valid,complete:valid && !outstanding.length && feasibility!=='infeasible',
    errors:sortIssues(errors),attention:sortIssues(attention),outstanding:sortedSet(outstanding),effectiveParts:effective,
    excludedParts:[...excludedParts.keys()].sort(cmp).map(p=>({part:p,ruleIds:sortedSet(excludedParts.get(p)!)})),
    excludedOptions:effects(excludedOpts),forcedOptions:effects(forced),preferredOptions:effects(preferred),feasibility,cognitive}};
}

export function bandRanges(doc:Classification, internal:Internal):Record<string,[number,number]> {
  const bandOf=Object.fromEntries(doc.parts.map(p=>[p.id,p.cognitive.curriculumBand??'unclassified']));
  const keys=sortedSet(Object.values(bandOf));
  return allocationBounds(internal.mandatory,internal.flexible,internal.count,internal.marks,bandOf,keys)??{};
}

export type PaperInput = {schemaVersion:1; targetMarks:number|null; comparison:null|{profile:{profileId:string;version:number}; distributionId:string}; lines:LineInput[]};
const identityKey=(i:LineInput['identity'])=>[i.moduleId,i.kind,i.itemId,i.release].join('\u0000');

/** The producer's paper-level result: every mark attributed exactly once; comparison is descriptive. */
export function evaluatePaper(config:PaperInput, classifications:Classification[], profiles:Profile[]=[]) {
  const index=new Map(classifications.map(c=>[identityKey({moduleId:c.moduleId,kind:c.kind,itemId:c.itemId,release:c.release}),c]));
  const paperErrors:Issue[]=[];const ids=config.lines.map(l=>l.lineId);
  for(const dup of sortedSet(ids.filter((x,i)=>ids.indexOf(x)!==i))) paperErrors.push(issue('duplicate-line',{lineId:dup}));
  const lines:LineOutput[]=[];const docs=new Map<string,Classification>();const internal=new Map<string,Internal|null>();
  for(const line of config.lines) {
    const doc=index.get(identityKey(line.identity));
    if(!doc) {
      lines.push({lineId:line.lineId,identity:{...line.identity},marks:line.marks,valid:false,complete:false,errors:[issue('unknown-identity',{lineId:line.lineId})],attention:[],outstanding:[],
        effectiveParts:[],excludedParts:[],excludedOptions:[],forcedOptions:[],preferredOptions:[],feasibility:'not-evaluated',
        cognitive:{basis:'marks',determinable:false,ranges:null,reason:'invalid-configuration'}});
      continue;
    }
    const r=evaluateLine(doc,line);internal.set(line.lineId,r.internal);docs.set(line.lineId,doc);lines.push(r.result);
  }
  const allocated=config.lines.reduce((n,l)=>n+(l.marks??0),0);const target=config.targetMarks;
  const difference=target===null?null:allocated-target;const balanced=target===null?null:difference===0;
  const scopes=['paper-logistics',...(config.lines.some(l=>l.identity.kind==='multiple_choice')?['multiple-choice-block']:[])];
  const totals=Object.fromEntries(CATEGORIES.map(k=>[k,[0,0]])) as Record<Category,[number,number]>;const undetermined:string[]=[];
  for(const l of lines) {
    if(l.cognitive.determinable) for(const k of CATEGORIES){totals[k][0]+=l.cognitive.ranges![k].min;totals[k][1]+=l.cognitive.ranges![k].max;}
    else {undetermined.push(l.lineId);totals.unclassified[0]+=l.marks??0;totals.unclassified[1]+=l.marks??0;}
  }
  const cognitive={basis:'marks',determinable:!undetermined.length,ranges:Object.fromEntries(CATEGORIES.map(k=>[k,{min:totals[k][0],max:totals[k][1]}])),undeterminedLines:sortedSet(undetermined)};
  let comparison:any=null;
  if(config.comparison!==null) {
    const ref=config.comparison;
    const profile=profiles.find(p=>p.profileId===ref.profile.profileId && p.version===ref.profile.version);
    const dist=profile?.distributions.find(d=>d.id===ref.distributionId);
    if(!dist) paperErrors.push(issue('unknown-comparison-reference'));
    else {
      comparison={profile:ref.profile,distributionId:dist.id,taxonomy:dist.taxonomy,byKey:[]};
      if(dist.basis!=='marks') comparison.status='unsupported-basis';
      else if(dist.taxonomy==='knowledge-area') comparison.status='unsupported-taxonomy';
      else {
        let agg=new Map<string,[number,number]>();const complete=!undetermined.length;
        if(dist.taxonomy==='bloom') agg=new Map(Object.entries(totals) as [string,[number,number]][]);
        else {
          for(const l of lines) { if(!docs.has(l.lineId)||!l.cognitive.determinable) continue;
            for(const [key,[lo,hi]] of Object.entries(bandRanges(docs.get(l.lineId)!,internal.get(l.lineId)!))){const a=agg.get(key)??[0,0];agg.set(key,[a[0]+lo,a[1]+hi]);} }
          for(const l of lines) if(undetermined.includes(l.lineId)){const a=agg.get('unclassified')??[0,0];agg.set('unclassified',[a[0]+(l.marks??0),a[1]+(l.marks??0)]);}
        }
        const unclassified=agg.get('unclassified')??[0,0];
        comparison.status=complete && unclassified[1]===0?'described':'insufficient-classification';
        for(const t of dist.targets){const a=agg.get(t.key);comparison.byKey.push({key:t.key,targetPercent:t.percent,actualMarks:a===undefined?null:{min:a[0],max:a[1]}});}
      }
    }
  }
  const valid=!paperErrors.length && lines.every(l=>l.valid);
  return {schemaVersion:1,valid,complete:valid && lines.every(l=>l.complete) && balanced!==false,errors:sortIssues(paperErrors),lines,
    allocatedMarks:allocated,targetMarks:target,marksDifference:difference,marksBalanced:balanced,sharedScopes:scopes,cognitive,comparison};
}
