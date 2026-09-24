import { isQuestionnaire, type Answer, type QuestionField, type QuestionnaireAnswers } from '../jobs/questionnaire';
import { bloomKeys, bloomLabels, readinessLabels, sectionLabels, type Attention, type BloomKey, type CognitiveRow, type Configuration,
  type ConfigurationView, type CurriculumComparison, type LineView, type ReadinessStatus, type SectionKey } from './contracts';
import { interpretClassification, evaluateClassified, curriculumComparisons, type ClassifiedItem, type ClassifiedResult, type RequirementsProfile } from './classification';

/**
 * Deterministic configuration engine. Runs on the server only: it reads pinned
 * private definitions and returns a result for one teacher's configuration.
 * Code owns ranges, arithmetic, required decisions and declared dependencies.
 * Nothing here chooses an unresolved answer for the teacher.
 */
export const ENGINE_VERSION = 'cfg01-engine@1';

export type LineDefinition = {
  id:string; entryId:string; legacyKind:'specification'|'multiple-choice';
  identity:{moduleId:string; kind:SectionKey; itemId:string; release:string};
  title:string; range:{min:number; max:number}; fixedMarks:number|null; fields:QuestionField[];
  classification:ClassifiedItem|null; classificationSha256:string|null; requirementsRef:string|null;
  classificationProblem:string|null;
};
export type Definitions = {
  sha256:string; module:string; release:string; formRevision:string;
  lines:LineDefinition[]; paperFields:QuestionField[]; profiles:Record<string,RequirementsProfile>;
};

const record=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);

/** Adapt the private pinned snapshot and issued form into engine definitions. */
export function readDefinitions(snapshot:unknown, form:unknown, sha256:string):Definitions {
  if(!record(snapshot) || snapshot.schema!=='reviseit/configured-authored-inputs@1' || !Array.isArray(snapshot.lines) || !isQuestionnaire(form)) throw new Error('Unsupported configured order definitions');
  if(snapshot.formRevision!==form.revision) throw new Error('Pinned form mismatch');
  const profiles:Record<string,RequirementsProfile>={};
  for(const [ref,value] of Object.entries(record(snapshot.requirements)?snapshot.requirements:{})) if(record(value)) profiles[ref]=value.payload as RequirementsProfile;
  const lines=snapshot.lines.map((l:any,i:number):LineDefinition=>{
    const item=form.items[i];
    if(!item || item.id!==l.id) throw new Error('Pinned form and definitions disagree');
    const legacyKind=l.kind==='multiple-choice'?'multiple-choice':'specification';
    // Explicit adapter from the legacy private kind to the configurator kind.
    const kind:SectionKey=legacyKind==='multiple-choice'?'multiple_choice':'structured';
    if(l.identity?.kind!==kind) throw new Error('Line kind mismatch');
    let classification:ClassifiedItem|null=null, problem:string|null=null;
    if(l.classification) {
      try { classification=interpretClassification(l.classification.payload, l.classification.requirementsRef?profiles[l.classification.requirementsRef]??null:null, item.fields,
        {range:l.range,fixedMarks:typeof l.fixedMarks==='number'?l.fixedMarks:null,formRevision:l.binding?.formRevision,kind}); }
      catch(e) { problem=e instanceof Error?e.message:'Unsupported classification'; }
    }
    return {id:l.id,entryId:l.entryId,legacyKind,identity:l.identity,title:l.title,range:l.range,fixedMarks:typeof l.fixedMarks==='number'?l.fixedMarks:null,
      fields:item.fields,classification,classificationSha256:l.classification?.sha256??null,requirementsRef:l.classification?.requirementsRef??null,classificationProblem:problem};
  });
  return {sha256,module:String(snapshot.module),release:String(snapshot.release),formRevision:form.revision,lines,paperFields:form.paperFields,profiles};
}

// ---------------------------------------------------------------- authored fields
export function answerFits(field:QuestionField, answer:Answer):boolean {
  if(answer.kind==='automatic') return field.allowAutomatic;
  if(answer.kind==='omit') return !field.required;
  if(answer.kind==='choice') return field.type==='choice' && field.choices.some(c=>c.id===answer.choiceId);
  if(field.type==='choice') return field.allowOther && !!answer.text.trim();
  return answer.text.length<=field.maxLength && (!field.required || !!answer.text.trim());
}
type FieldState = {outstanding:string[]; attention:Attention[]};
function authoredFields(fields:QuestionField[], given:Record<string,Answer>|undefined, blocked:Record<string,Set<string>>={}):FieldState {
  const out:FieldState={outstanding:[],attention:[]};
  const answers=given||{};
  for(const field of fields) {
    const a=answers[field.id];
    if(!a) { if(field.required) out.outstanding.push(field.id); continue; }
    if(!answerFits(field,a)) { out.attention.push({scope:'field',id:field.id,message:'This answer no longer fits this question. Choose again.'}); continue; }
    if(a.kind==='choice' && blocked[field.id]?.has(a.choiceId)) out.attention.push({scope:'field',id:field.id,message:'Another choice for this question rules this answer out. Your answer is kept until you change it.'});
  }
  for(const id of Object.keys(answers)) if(!fields.some(f=>f.id===id)) out.attention.push({scope:'field',id,message:'This answer belongs to a question that is no longer part of this form.'});
  return out;
}

// ---------------------------------------------------------------- evaluation
export type LineResult = {
  id:string; marks:number|null; marksProblem:string|null; classified:ClassifiedResult|null;
  outstanding:string[]; attention:Attention[]; issues:string[]; ready:boolean;
};
export type Evaluation = {
  engine:string; definitionsSha256:string; paid:boolean; ready:boolean; status:ReadinessStatus; outstanding:number;
  totals:{target:number|null; allocated:number; complete:boolean; sections:Record<SectionKey,number>; sectionTargets:Partial<Record<SectionKey,number>>; problems:string[]};
  cognitive:Record<BloomKey|'unclassified',{min:number;max:number}>;
  lines:LineResult[]; paper:{outstanding:string[]; attention:Attention[]}; issues:string[];
};

export function evaluate(defs:Definitions, cfg:Configuration, opts:{paid:boolean}):Evaluation {
  const issues:string[]=[];
  const lineIds=defs.lines.map(l=>l.id);
  if(Object.keys(cfg.lines).sort().join()!==[...lineIds].sort().join()) throw new Error('Configuration lines do not match the order');
  const cognitive=Object.fromEntries([...bloomKeys,'unclassified'].map(k=>[k,{min:0,max:0}])) as Evaluation['cognitive'];
  const sections:Record<SectionKey,number>={multiple_choice:0,structured:0};
  let allocated=0, marksMissing=false;
  const lines=defs.lines.map((def):LineResult=>{
    const choice=cfg.lines[def.id];
    const marks=def.fixedMarks ?? choice.marks;
    let marksProblem:string|null=null;
    if(def.fixedMarks!==null && choice.marks!==null && choice.marks!==def.fixedMarks) marksProblem=`This question type is fixed at ${def.fixedMarks} marks.`;
    if(marks===null) { marksProblem='Set the marks for this question.'; marksMissing=true; }
    else if(!Number.isSafeInteger(marks) || marks<def.range.min || marks>def.range.max) { marksProblem=`Choose between ${def.range.min} and ${def.range.max} marks.`; marksMissing=true; }
    else { allocated+=marks; sections[def.identity.kind]+=marks; }
    const lineIssues:string[]=[];
    if(def.classificationProblem) lineIssues.push('This question’s configuration definition could not be read. It cannot be submitted until the definition is corrected.');
    let classified:ClassifiedResult|null=null, blocked:Record<string,Set<string>>={};
    if(def.classification && marks!==null && !marksProblem) {
      classified=evaluateClassified(def.classification, choice, marks, cfg.answers.items[def.id]||{}, {paid:opts.paid});
      blocked=classified.blockedFieldOptions;
      lineIssues.push(...classified.issues);
      for(const [k,v] of Object.entries(classified.cognitive)) { cognitive[k as BloomKey].min+=v.min; cognitive[k as BloomKey].max+=v.max; }
    } else if(marks!==null && !marksProblem) {
      // Without a genuine classification the marks stay visibly unclassified.
      cognitive.unclassified.min+=marks; cognitive.unclassified.max+=marks;
    }
    if(!def.classification && choice.parts!==null) lineIssues.push('This question has no configurable parts.');
    if(!def.classification && Object.keys(choice.facets).length) lineIssues.push('This question has no additional choices.');
    const outstanding:string[]=[], attention:Attention[]=[];
    if(marksProblem) attention.push({scope:'marks',id:def.id,message:marksProblem});
    if(opts.paid) {
      const fields=authoredFields(def.fields,cfg.answers.items[def.id],blocked);
      outstanding.push(...new Set([...fields.outstanding,...(classified?.outstanding??[])]));
      // Classified lines report answer problems through the contract evaluator's authored wording.
      attention.push(...(classified?classified.attention:fields.attention));
    }
    return {id:def.id,marks:marksProblem?null:marks,marksProblem,classified,outstanding,attention,issues:lineIssues,ready:!marksProblem&&!outstanding.length&&!attention.length&&!lineIssues.length};
  });
  const paper=opts.paid?authoredFields(defs.paperFields,cfg.answers.paper):{outstanding:[],attention:[]};
  const target=cfg.targets.paper;
  const problems:string[]=[];
  if(target===null) problems.push('Set the total marks for the paper.');
  else if(!marksMissing && allocated!==target) problems.push(allocated<target?`${target-allocated} marks still to allocate.`:`${allocated-target} marks over the paper total.`);
  const sectionTargets=cfg.targets.sections||{};
  for(const [key,value] of Object.entries(sectionTargets) as [SectionKey,number][]) if(!marksMissing && sections[key]!==value) problems.push(`${sectionLabels[key]} section: ${sections[key]} of ${value} marks.`);
  const complete=!marksMissing && !problems.length && lines.every(l=>!l.classified || l.classified.feasible);
  const outstanding=lines.reduce((n,l)=>n+l.outstanding.length,0)+paper.outstanding.length;
  const attentionCount=lines.reduce((n,l)=>n+l.attention.filter(a=>a.scope!=='marks').length,0)+paper.attention.length;
  const lineIssues=lines.some(l=>l.issues.length);
  let status:ReadinessStatus;
  if(!complete) status='marks_needed';
  else if(!opts.paid) status='ready_for_payment';
  else status=outstanding||attentionCount||lineIssues?'details_to_complete':'ready_to_generate';
  return {engine:ENGINE_VERSION,definitionsSha256:defs.sha256,paid:opts.paid,ready:status==='ready_to_generate',status,outstanding,
    totals:{target,allocated,complete,sections,sectionTargets,problems},cognitive,lines,paper,issues};
}

/** The compact verdict bound to a saved revision. */
export function storedEvaluation(e:Evaluation) {
  return {engine:e.engine,definitionsSha256:e.definitionsSha256,ready:e.ready,status:e.status,outstanding:e.outstanding,
    totals:{allocated:e.totals.allocated,target:e.totals.target},lines:e.lines.map(l=>({id:l.id,marks:l.marks,ready:l.ready}))};
}

// ---------------------------------------------------------------- submission
/** Exact answers for the issued form: optional fields left blank are explicit omissions. */
export function submittedAnswers(defs:Definitions, cfg:Configuration):QuestionnaireAnswers {
  const fill=(fields:QuestionField[],given:Record<string,Answer>|undefined)=>Object.fromEntries(fields.map(f=>[f.id,given?.[f.id] ?? {kind:'omit' as const}]));
  return {schemaVersion:2,revision:defs.formRevision,items:Object.fromEntries(defs.lines.map(l=>[l.id,fill(l.fields,cfg.answers.items[l.id])])),paper:fill(defs.paperFields,cfg.answers.paper)};
}

export type PlanLine = {id:string; entryId:string; identity:LineDefinition['identity']; kind:LineDefinition['legacyKind']; marks:number;
  parts:{id:string; marks:{min:number;max:number}|null; bloom:BloomKey|null; learnerDrawn:boolean}[]|null;
  facets:Record<string,Answer>; answers:Record<string,Answer>; classificationSha256:string|null; requirementsRef:string|null;
  diagram:{stimulus:string; learnerDrawn:string[]}|null};
export type GenerationPlan = {schema:'reviseit/configured-generation-plan@1'; orderId:string; module:string; release:string; formRevision:string;
  configurationRevision:number; definitionsSha256:string; targets:Configuration['targets']; lines:PlanLine[]};

/** Freeze the resolved configuration the worker and skill must consume. Refuses anything not ready. */
export function generationPlan(defs:Definitions, cfg:Configuration, e:Evaluation, orderId:string, revision:number):{plan:GenerationPlan; answers:QuestionnaireAnswers} {
  if(!e.ready || e.definitionsSha256!==defs.sha256) throw new Error('Configuration is not ready');
  const answers=submittedAnswers(defs,cfg);
  const lines=defs.lines.map((def,i):PlanLine=>{
    const r=e.lines[i];
    return {id:def.id,entryId:def.entryId,identity:def.identity,kind:def.legacyKind,marks:r.marks!,
      parts:r.classified?r.classified.plannedParts:null,facets:cfg.lines[def.id].facets,answers:answers.items[def.id],
      classificationSha256:def.classificationSha256,requirementsRef:def.requirementsRef,diagram:r.classified?.diagram??null};
  });
  return {plan:{schema:'reviseit/configured-generation-plan@1',orderId,module:defs.module,release:defs.release,formRevision:defs.formRevision,
    configurationRevision:revision,definitionsSha256:defs.sha256,targets:cfg.targets,lines},answers};
}

// ---------------------------------------------------------------- projection
/** Explicit allowlist for the browser. Before payment: marks, totals and safe labels only. */
export function project(defs:Definitions, cfg:Configuration, e:Evaluation, meta:{orderId:string; state:string; paymentStatus:string; revision:number; submitted:boolean}):ConfigurationView {
  const paid=e.paid;
  let mcq=0, structured=0;
  const numbers=defs.lines.map(l=>l.identity.kind==='multiple_choice'?`1.${++mcq}`:'');
  const hasMcq=mcq>0;
  defs.lines.forEach((l,i)=>{ if(l.identity.kind==='structured') numbers[i]=String((hasMcq?1:0)+(++structured)); });
  const lines=defs.lines.map((def,i):LineView=>{
    const r=e.lines[i];
    const c=paid && r.classified ? r.classified : null;
    return {id:def.id,number:numbers[i],title:def.title,kind:def.identity.kind,configurable:def.classification?'classified':'authored',
      marks:{value:def.fixedMarks ?? cfg.lines[def.id].marks,min:def.range.min,max:def.range.max,fixed:def.fixedMarks!==null},
      parts:c?c.parts:[],facets:c?c.facets:[],fields:paid?def.fields:[],answers:paid?(cfg.answers.items[def.id]||{}):{},
      outstanding:paid?r.outstanding:[],attention:paid?r.attention:r.attention.filter(a=>a.scope==='marks'),issues:r.issues,ready:r.ready,
      diagram:c?c.diagramView:null};
  });
  const cognitive:CognitiveRow[]=[...bloomKeys.map(k=>({key:k,label:bloomLabels[k],...e.cognitive[k]})),{key:'unclassified' as const,label:'Not yet classified',...e.cognitive.unclassified}];
  const curriculum:CurriculumComparison[]=paid?comparisons(defs,cfg,e):[];
  const remaining=e.totals.target===null?0:Math.max(0,e.totals.target-e.totals.allocated);
  const excess=e.totals.target===null?0:Math.max(0,e.totals.allocated-e.totals.target);
  return {orderId:meta.orderId,state:meta.state,paid,paymentStatus:meta.paymentStatus,revision:meta.revision,submitted:meta.submitted,
    status:e.status,statusLabel:readinessLabels[e.status],outstanding:e.outstanding,canSubmit:e.ready&&!meta.submitted&&meta.state==='awaiting_answers',
    totals:{target:e.totals.target,allocated:e.totals.allocated,remaining,excess,complete:e.totals.complete,
      sections:(['multiple_choice','structured'] as SectionKey[]).filter(k=>defs.lines.some(l=>l.identity.kind===k)).map(k=>({key:k,label:sectionLabels[k],allocated:e.totals.sections[k],target:e.totals.sectionTargets[k]??null}))},
    cognitive,curriculum,lines,paper:{fields:paid?defs.paperFields:[],answers:paid?cfg.answers.paper:{},outstanding:e.paper.outstanding},
    issues:[...e.totals.problems,...e.issues],configuration:cfg};
}

function comparisons(defs:Definitions, cfg:Configuration, e:Evaluation):CurriculumComparison[] {
  const profiles=Object.values(defs.profiles);
  if(!profiles.length) return [];
  return curriculumComparisons(defs.lines.map((def,i)=>({lineId:def.id,item:def.classification,marks:e.lines[i].marks,parts:cfg.lines[def.id].parts,answers:cfg.answers.items[def.id]||{}})),profiles as never);
}
