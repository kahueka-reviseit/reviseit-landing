import type { Answer, QuestionField } from '../jobs/questionnaire';
import type { Attention, BloomKey, FacetView, LineChoice, PartView } from './contracts';
import { bloomOnlyClassification } from './legacy-classification';
import { evaluateLine, BLOOM, type Classification, type Issue, type LineInput } from './contract-v1';
import { lineComposition, type LineComposition } from './composition';

/**
 * Adapter between a pinned contract-v1 classification and the order engine.
 * The producer's grammar is evaluated by contract-v1.ts unchanged; this module
 * checks that the classification matches the order's pinned form and marks,
 * and turns results into authored teacher wording (hint keys, never model text).
 */
/** One subquestion as handed to generation: the same parts, inclusion and categories the teacher was shown. */
export type PlannedPart = {id:string; label:string; inclusion:'required'|'selected'|'rule-required'|'structure-required'|'flexible'; marks:{min:number;max:number}|null; bloom:BloomKey|null; bloomOptions:BloomKey[]; learnerDrawn:boolean;
  /** The alternative structure this part belongs to, when the source has several. */
  alternative?:string};
export type ClassifiedItem = {contract:'configurator-contract-v1'; doc:Classification; fields:QuestionField[]};
export type ClassifiedResult = {
  feasible:boolean; issues:string[]; outstanding:string[]; attention:Attention[];
  /** Cognitive composition from supported facts (source ranges, teacher choices, rules); never the whole line as unclassified. */
  composition:LineComposition;
  parts:PartView[]; facets:FacetView[]; blockedFieldOptions:Record<string,Set<string>>;
  plannedParts:PlannedPart[];
  diagram:{stimulus:string; learnerDrawn:string[]}|null;
  diagramView:{stimulus:'required'|'optional'|'not_applicable'|'unknown'; learnerDrawn:string[]; locked?:string}|null;
};

const record=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const span=(r:unknown)=>record(r) && Number.isSafeInteger(r.min) && Number.isSafeInteger(r.max) && 0<=r.min && r.min<=r.max;

/** Version 3: every part belongs to exactly one alternative; effects name known parts. */
function checkStructure(doc:Classification) {
  const s=doc.structure as unknown;
  if(!record(s) || !Array.isArray(s.alternatives) || !s.alternatives.length || !Array.isArray(s.effects)) throw new Error('Unsupported classification structure');
  const ids=new Set(doc.parts.map(p=>p.id)), seen=new Set<string>();
  for(const a of s.alternatives) {
    if(!record(a) || typeof a.id!=='string' || typeof a.label!=='string' || !Array.isArray(a.parts) || !Array.isArray(a.required) || !span(a.additional) || (a.count!==null && !span(a.count))
      || a.parts.some((p:unknown)=>typeof p!=='string' || !ids.has(p) || seen.has(p)) || a.required.some((p:unknown)=>!a.parts.includes(p))) throw new Error('Unsupported classification structure');
    a.parts.forEach((p:string)=>seen.add(p));
  }
  if(seen.size!==ids.size) throw new Error('Unsupported classification structure');
  for(const e of s.effects) if(!record(e) || !record(e.when) || !Array.isArray(e.excludeParts) || e.excludeParts.some((p:unknown)=>!ids.has(p as string)) || (e.additional!==null && !span(e.additional)) || typeof e.reason!=='string')
    throw new Error('Unsupported classification structure');
}
const TOP=['schemaVersion','moduleId','kind','itemId','release','title','curriculumId','marks','parts','facets','rules','diagramPolicy','formBinding','provenance','jevChecks','hints','coverage'];

/** Defensive structural checks for what the evaluator relies on, plus binding to the pinned order. */
export function interpretClassification(payload:unknown, fields:QuestionField[], pinned?:{range:{min:number;max:number}; fixedMarks:number|null; formRevision?:string; kind:string}):ClassifiedItem {
  payload=bloomOnlyClassification(payload);
  const v3=record(payload) && payload.structure!==undefined;
  if(!record(payload) || payload.schemaVersion!==4 || Object.keys(payload).sort().join()!==[...TOP,...(v3?['structure']:[])].sort().join()) throw new Error('Unsupported classification schema');
  const doc=payload as Classification;
  if(v3) checkStructure(doc);
  if(!Array.isArray(doc.parts) || !Array.isArray(doc.facets) || !Array.isArray(doc.rules) || !record(doc.hints) || !record(doc.formBinding) || !record(doc.diagramPolicy)) throw new Error('Unsupported classification shape');
  const marksFacets=doc.facets.filter(f=>f?.binding?.scope==='line-marks');
  if(marksFacets.length!==1 || marksFacets[0].type!=='integer') throw new Error('Classification marks facet required');
  const m=doc.marks, lo=m.mode==='fixed'?m.value:m.min, hi=m.mode==='fixed'?m.value:m.max;
  if(marksFacets[0].domain.min!==lo || marksFacets[0].domain.max!==hi) throw new Error('Classification marks facet disagrees with its marks');
  if(pinned) {
    if(pinned.kind!==doc.kind) throw new Error('Classification kind differs from the purchased item');
    // A fixed engineering allocation (two-mark multiple choice) must lie inside the
    // source range; a ranged item must match its purchased range exactly.
    if(pinned.fixedMarks!==null ? !(lo<=pinned.fixedMarks && pinned.fixedMarks<=hi) : (pinned.range.min!==lo || pinned.range.max!==hi))
      throw new Error('Classification marks differ from the purchased range');
    if(doc.formBinding.status==='no-form') throw new Error('Classification has no authored form for a supported item');
    if(pinned.formRevision && doc.formBinding.itemForm?.formRevision!==pinned.formRevision) throw new Error('Classification is bound to another form revision');
  }
  // Every authored field maps to exactly one form-bound facet, and back.
  const formFacets=doc.facets.filter(f=>f.binding.scope==='item-form');
  const map=doc.formBinding.fieldMap;
  const byField=new Map(fields.map(f=>[f.id,f]));
  if(map.length!==fields.length || formFacets.length!==fields.length) throw new Error('Classification field map does not cover the authored form');
  for(const f of formFacets) {
    const field=byField.get((f.binding as {fieldId:string}).fieldId);
    if(!field || f.id!==field.id || !map.some(x=>x.facetId===f.id && x.fieldId===field.id)) throw new Error('Classification field map does not match the authored form');
    if(f.required!==field.required || f.delegable!==field.allowAutomatic || (field.type==='choice' && (f.type!=='choice' || f.allowCustom!==field.allowOther)) || (field.type==='text' && f.type!=='text'))
      throw new Error('Classification facet permissions differ from the authored form');
    if(field.type==='choice' && (f.domain.options as {id:string}[]).map(o=>o.id).join()!==field.choices.map(c=>c.id).join()) throw new Error('Classification options differ from the authored form');
  }
  return {contract:'configurator-contract-v1',doc,fields};
}

const MESSAGES:Record<string,string>={
  'marks-out-of-range':'These marks are outside the range this question supports.',
  'marks-infeasible':'No permitted combination of this question’s parts adds up to these marks. Change the marks or the parts.',
  'part-count-infeasible':'The chosen parts cannot be combined for this question.',
  'part-conflict':'A required part is ruled out by another choice.',
  'part-excluded':'A part you selected is ruled out by another choice.',
  'part-marks-conflict':'Your choices ask for incompatible marks on one part.',
  'unknown-part':'A selected part is not available for this question.',
  'parts-not-configurable':'This question’s parts are not selectable.',
  'option-conflict':'Two choices require different answers to the same question. Change one of them.',
  'option-excluded':'Another choice rules this answer out. Your answer is kept until you change it.',
  'forced-option-excluded':'Your choices both require and rule out the same answer. Change one of them.',
  'no-options-left':'Your other choices leave no permitted answer here.',
  'custom-answer-affected':'Another choice now requires a specific answer here. Check your written answer.',
  'omitted-answer-affected':'Another choice now requires an answer here.',
  'held-rule-applies':'This combination has a recorded dependency that has not yet been confirmed.',
  'delegation-not-permitted':'“Choose for me” is not available for this question.',
  'omission-not-permitted':'This question needs an answer.',
  'custom-answer-not-permitted':'Choose one of the listed options.',
  'unknown-option':'This answer is not one of the listed options.',
  'text-too-long':'This answer is too long.',
  'unknown-facet':'This answer does not belong to this question.',
  'choice-on-text-facet':'Write an answer for this question.',
  'no-authored-form':'This question has no authored form.',
};
const FIELD_CODES=new Set(['option-excluded','no-options-left','custom-answer-affected','omitted-answer-affected','delegation-not-permitted','omission-not-permitted','custom-answer-not-permitted','unknown-option','text-too-long','unknown-facet','choice-on-text-facet','forced-option-excluded','option-conflict']);
const MARK_CODES=new Set(['marks-out-of-range','marks-infeasible','part-count-infeasible','part-marks-conflict']);

function wording(doc:Classification, i:Issue):string {
  const authored=i.reasons.map(k=>doc.hints[k]).filter((x):x is string=>typeof x==='string');
  return authored.length?authored.join(' '):(MESSAGES[i.code]??'This choice needs attention.');
}

export function evaluateClassified(item:ClassifiedItem, choice:LineChoice, marks:number, answers:Record<string,Answer>, opts:{paid:boolean}):ClassifiedResult {
  // Before payment the teacher chooses marks only. Parts selectable after payment
  // count as possible, so marks are refused only when no selection could fit.
  const doc=opts.paid?item.doc:{...item.doc,parts:item.doc.parts.map(p=>p.inclusion==='optional'?{...p,inclusion:'unspecified' as const}:p)};
  const line:LineInput={lineId:'line',identity:{moduleId:doc.moduleId,kind:doc.kind,itemId:doc.itemId,release:doc.release},marks,parts:opts.paid?choice.parts:null,answers:opts.paid?answers:{}};
  const {result,structure}=evaluateLine(doc,line);
  const marksFacet=doc.facets.find(f=>f.binding.scope==='line-marks')!.id;
  const issues:string[]=[],attention:Attention[]=[];
  for(const e of result.errors) {
    if(FIELD_CODES.has(e.code) && e.facet) attention.push({scope:'field',id:e.facet,message:wording(doc,e)});
    else if(e.code==='part-excluded' || e.code==='part-conflict' || e.code==='unknown-part') attention.push({scope:'part',id:e.part??'',message:wording(doc,e)});
    else if(MARK_CODES.has(e.code)) attention.push({scope:'marks',id:'marks',message:wording(doc,e)});
    else issues.push(wording(doc,e));
  }
  if(opts.paid) for(const a of result.attention) attention.push({scope:a.facet?'field':'part',id:a.facet??a.part??'',message:wording(doc,a)});
  const feasible=!result.errors.some(e=>MARK_CODES.has(e.code));
  const composition=lineComposition(doc,structure,marks);
  const effective=new Map(result.effectiveParts.map(p=>[p.id,p]));
  const excluded=new Map(result.excludedParts.map(p=>[p.part,p]));
  const drawn=new Set(doc.diagramPolicy.learnerDrawnParts);
  const partsFacet=doc.facets.find(f=>f.type==='parts');
  const hint=(key:string)=>doc.hints[key]??'';
  const ruleHints=(ids:string[])=>ids.map(r=>hint(doc.rules.find(y=>y.id===r)?.reason??'')).filter(Boolean).join(' ');
  const alternativeOf=(id:string)=>doc.structure&&doc.structure.alternatives.length>1?doc.structure.alternatives.find(a=>a.parts.includes(id))?.label:undefined;
  const parts:PartView[]=doc.parts.map((p,i)=>{
    const e=effective.get(p.id), x=excluded.get(p.id), state=composition.parts[p.id], dropped=composition.droppedBy[p.id];
    const options=(BLOOM as readonly string[]).filter(k=>(p.cognitive.bloomCandidates??[]).includes(k)) as BloomKey[];
    const reason=x?ruleHints(x.ruleIds)||'Ruled out by another choice.':dropped?dropped.map(hint).filter(Boolean).join(' ')||'Left out by another choice.':
      state==='excluded'?'Not part of the structure your choices set.':
      e?.inclusion==='rule-required'?ruleHints(structure.ruleRequired[p.id]??[])||'Included because of another choice.':
      state==='included'&&!e?.inclusion?.match(/^(required|selected)$/)?`Part of the ${alternativeOf(p.id)??'specified'} structure.`:
      state==='possible'?'The generation skill decides whether to include this part.':undefined;
    return {id:p.id,number:String(i+1),summary:p.summary??p.label,bloom:p.cognitive.bloom,bloomOptions:options,bloomBasis:p.cognitive.bloomBasis??null,bloomUnknownReason:p.cognitive.bloom||options.length?undefined:'Not yet classified',
      marks:e?.marks??(p.marks.basis==='range'&&p.marks.min!==null&&p.marks.max!==null?{min:p.marks.min,max:p.marks.max}:null),
      inclusion:p.inclusion==='required'?'required':'optional',included:state==='included',
      locked:p.inclusion==='required' || e?.inclusion==='rule-required' || !!x || !partsFacet || !(partsFacet.domain.parts as string[]).includes(p.id),
      reason,exampleMarks:p.marks.basis==='typical'&&p.marks.min!==null&&p.marks.max!==null?{min:p.marks.min,max:p.marks.max}:null,
      learnerDrawn:drawn.has(p.id),possible:state==='possible'};
  });
  const facets:FacetView[]=[];const blocked:Record<string,Set<string>>={};
  for(const f of doc.facets) {
    if(f.type!=='choice' || f.binding.scope!=='item-form') continue;
    const ex=new Set(result.excludedOptions.filter(o=>o.facet===f.id).map(o=>o.option));
    const forced=result.forcedOptions.filter(o=>o.facet===f.id).map(o=>o.option);
    const preferred=new Set(result.preferredOptions.filter(o=>o.facet===f.id).map(o=>o.option));
    const field=(f.binding as {fieldId:string}).fieldId;
    if(ex.size) blocked[field]=ex;
    const reasonFor=(option:string)=>{const e=result.excludedOptions.find(o=>o.facet===f.id&&o.option===option);return e?e.ruleIds.map(r=>doc.hints[doc.rules.find(y=>y.id===r)?.reason??'']).filter(Boolean).join(' ')||'Ruled out by another choice.':undefined;};
    facets.push({id:field,label:item.fields.find(x=>x.id===field)?.label??f.id,hint:f.prompt?doc.hints[f.prompt]??'':'',type:'choice',required:f.required,allowAutomatic:f.delegable,
      options:(f.domain.options as {id:string;label:string}[]).map(o=>({id:o.id,label:o.label,disabled:ex.has(o.id),reason:reasonFor(o.id),preferred:preferred.has(o.id)})),
      value:answers[field]??null,forced:forced.length===1?forced[0]:undefined,reason:forced.length?doc.rules.filter(r=>result.forcedOptions.some(o=>o.facet===f.id&&o.ruleIds.includes(r.id))).map(r=>doc.hints[r.reason]).filter(Boolean).join(' '):undefined});
  }
  const stimulusAnswer=doc.diagramPolicy.stimulusFacet?answers[doc.diagramPolicy.stimulusFacet]:undefined;
  const lockedStimulus=doc.diagramPolicy.stimulusFacet?result.forcedOptions.find(o=>o.facet===doc.diagramPolicy.stimulusFacet)?.option:undefined;
  const stimulus=doc.diagramPolicy.stimulus==='unspecified'?'unknown':doc.diagramPolicy.stimulus;
  return {feasible,issues,outstanding:opts.paid?result.outstanding.filter(x=>x!==marksFacet):[],attention,composition,parts,facets,blockedFieldOptions:blocked,
    // Generation receives the parts the composition keeps, with the same inclusion the teacher sees.
    plannedParts:doc.parts.filter(p=>composition.parts[p.id]!=='excluded').map(d=>{const e=effective.get(d.id), alternative=alternativeOf(d.id);
      const inclusion:PlannedPart['inclusion']=composition.parts[d.id]==='possible'?'flexible':e&&e.inclusion!=='flexible'?e.inclusion as PlannedPart['inclusion']:'structure-required';
      return {id:d.id,label:d.label,inclusion,marks:e?.marks??(d.marks.basis==='range'&&d.marks.min!==null&&d.marks.max!==null?{min:d.marks.min,max:d.marks.max}:null),bloom:d.cognitive.bloom,
        bloomOptions:(BLOOM as readonly string[]).filter(k=>(d.cognitive.bloomCandidates??[]).includes(k)) as BloomKey[],learnerDrawn:drawn.has(d.id),...(alternative?{alternative}:{})};}),
    diagram:{stimulus:lockedStimulus??(stimulusAnswer?.kind==='choice'?stimulusAnswer.choiceId:doc.diagramPolicy.stimulus),learnerDrawn:[...doc.diagramPolicy.learnerDrawnParts]},
    diagramView:{stimulus,learnerDrawn:[...doc.diagramPolicy.learnerDrawnParts],locked:lockedStimulus}};
}
