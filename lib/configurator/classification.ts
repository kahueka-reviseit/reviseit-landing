import type { Answer, QuestionField } from '../jobs/questionnaire';
import type { Attention, BloomKey, CurriculumComparison, FacetView, LineChoice, PartView } from './contracts';
import { bandRanges, evaluateLine, evaluatePaper, BLOOM, CATEGORIES, type Classification, type Issue, type LineInput, type PaperInput, type Profile } from './contract-v1';

/**
 * Adapter between a pinned contract-v1 classification and the order engine.
 * The producer's grammar is evaluated by contract-v1.ts unchanged; this module
 * checks that the classification matches the order's pinned form and marks,
 * and turns results into authored teacher wording (hint keys, never model text).
 */
export type RequirementsProfile = Profile;
export type ClassifiedItem = {contract:'configurator-contract-v1'; doc:Classification; profile:Profile|null; fields:QuestionField[]};
export type ClassifiedResult = {
  feasible:boolean; issues:string[]; outstanding:string[]; attention:Attention[];
  cognitive:Record<BloomKey|'unclassified',{min:number;max:number}>; bands:Record<string,{min:number;max:number}>;
  parts:PartView[]; facets:FacetView[]; blockedFieldOptions:Record<string,Set<string>>;
  plannedParts:{id:string; marks:{min:number;max:number}|null; bloom:BloomKey|null; learnerDrawn:boolean}[];
  diagram:{stimulus:string; learnerDrawn:string[]}|null;
  diagramView:{stimulus:'required'|'optional'|'not_applicable'|'unknown'; learnerDrawn:string[]; locked?:string}|null;
};

const record=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const TOP=['schemaVersion','moduleId','kind','itemId','release','title','curriculumId','curriculumRequirementsRef','marks','parts','facets','rules','diagramPolicy','formBinding','provenance','jevChecks','hints','coverage'];

/** Defensive structural checks for what the evaluator relies on, plus binding to the pinned order. */
export function interpretClassification(payload:unknown, profile:Profile|null, fields:QuestionField[], pinned?:{range:{min:number;max:number}; fixedMarks:number|null; formRevision?:string; kind:string}):ClassifiedItem {
  if(!record(payload) || payload.schemaVersion!==1 || Object.keys(payload).sort().join()!==[...TOP].sort().join()) throw new Error('Unsupported classification schema');
  const doc=payload as Classification;
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
  if(profile && (profile.profileId!==doc.curriculumRequirementsRef.profileId || profile.version!==doc.curriculumRequirementsRef.version)) throw new Error('Classification requirements profile mismatch');
  return {contract:'configurator-contract-v1',doc,profile,fields};
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
  const {result,internal}=evaluateLine(doc,line);
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
  const unclassified=Object.fromEntries(CATEGORIES.map(k=>[k,{min:0,max:0}])) as ClassifiedResult['cognitive'];
  let cognitive=unclassified;
  if(result.cognitive.determinable && result.cognitive.ranges) cognitive=result.cognitive.ranges as ClassifiedResult['cognitive'];
  else cognitive={...unclassified,unclassified:{min:marks,max:marks}};
  const bands:ClassifiedResult['bands']={};
  if(internal) for(const [k,[lo,hi]] of Object.entries(bandRanges(doc,internal))) bands[k]={min:lo,max:hi};
  else bands.unclassified={min:marks,max:marks};
  const effective=new Map(result.effectiveParts.map(p=>[p.id,p]));
  const excluded=new Map(result.excludedParts.map(p=>[p.part,p]));
  const drawn=new Set(doc.diagramPolicy.learnerDrawnParts);
  const partsFacet=doc.facets.find(f=>f.type==='parts');
  const parts:PartView[]=doc.parts.map((p,i)=>{
    const e=effective.get(p.id), x=excluded.get(p.id);
    return {id:p.id,number:String(i+1),summary:p.summary??p.label,bloom:p.cognitive.bloom,bloomUnknownReason:p.cognitive.bloom?undefined:'Not yet classified',
      band:p.cognitive.curriculumBand,marks:e?.marks??(p.marks.basis==='range'&&p.marks.min!==null&&p.marks.max!==null?{min:p.marks.min,max:p.marks.max}:null),
      inclusion:p.inclusion==='required'?'required':'optional',included:!!e && e.inclusion!=='flexible',
      locked:p.inclusion==='required' || e?.inclusion==='rule-required' || !!x || !partsFacet || !(partsFacet.domain.parts as string[]).includes(p.id),
      reason:x?x.ruleIds.map(r=>doc.hints[doc.rules.find(y=>y.id===r)?.reason??'']).filter(Boolean).join(' ')||'Ruled out by another choice.':e?.inclusion==='flexible'?'The generation skill decides whether to include this part.':undefined,
      learnerDrawn:drawn.has(p.id)};
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
  return {feasible,issues,outstanding:opts.paid?result.outstanding.filter(x=>x!==marksFacet):[],attention,cognitive,bands,parts,facets,blockedFieldOptions:blocked,
    plannedParts:result.effectiveParts.map(p=>({id:p.id,marks:p.marks,bloom:doc.parts.find(x=>x.id===p.id)?.cognitive.bloom??null,learnerDrawn:drawn.has(p.id)})),
    diagram:{stimulus:lockedStimulus??(stimulusAnswer?.kind==='choice'?stimulusAnswer.choiceId:doc.diagramPolicy.stimulus),learnerDrawn:[...doc.diagramPolicy.learnerDrawnParts]},
    diagramView:{stimulus,learnerDrawn:[...doc.diagramPolicy.learnerDrawnParts],locked:lockedStimulus}};
}

/** Descriptive comparison against each marks-based distribution, with the producer's semantics. */
export function curriculumComparisons(lines:{lineId:string; item:ClassifiedItem|null; marks:number|null; parts:string[]|null; answers:Record<string,Answer>}[], profiles:Profile[]):CurriculumComparison[] {
  const docs=lines.flatMap(l=>l.item?[l.item.doc]:[]);
  const input=(comparison:PaperInput['comparison']):PaperInput=>({schemaVersion:1,targetMarks:null,comparison,
    lines:lines.map(l=>({lineId:l.lineId,identity:l.item?{moduleId:l.item.doc.moduleId,kind:l.item.doc.kind,itemId:l.item.doc.itemId,release:l.item.doc.release}:{moduleId:'unclassified',kind:'structured',itemId:l.lineId,release:'none'},
      marks:l.marks,parts:l.parts,answers:l.answers}))});
  const out:CurriculumComparison[]=[];
  for(const profile of profiles) for(const d of profile.distributions) {
    const c=evaluatePaper(input({profile:{profileId:profile.profileId,version:profile.version},distributionId:d.id}),docs,[profile]).comparison;
    if(!c) continue;
    const label=(key:string)=>profile.bands.find(b=>b.id===key)?.label??((BLOOM as readonly string[]).includes(key)?key.charAt(0).toUpperCase()+key.slice(1):key);
    const note=c.status==='described'?'Described against this curriculum’s own targets. Not a pass or fail.':c.status==='insufficient-classification'?'Some marks are not yet classified, so this comparison is incomplete.':
      c.status==='unsupported-basis'?'This requirement is not measured in marks, so it is not compared here.':'This requirement is not compared here.';
    out.push({profile:`${profile.profileId} · ${d.id}`,basis:d.basis==='marks'?'marks':'item-count',note,
      rows:(c.byKey as {key:string;targetPercent:number|null;actualMarks:{min:number;max:number}|null}[]).map(r=>({key:r.key,label:label(r.key),min:r.actualMarks?.min??0,max:r.actualMarks?.max??0,target:r.targetPercent===null?'Not specified':`${r.targetPercent}%`}))});
  }
  return out;
}
