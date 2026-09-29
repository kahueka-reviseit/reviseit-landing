import {briefConflicts} from './brief';
import { cataloguePreview, type CataloguePreview } from '../workspace/contracts';
import { isQuestionnaire, type Answer, type QuestionField, type QuestionnaireAnswers } from '../jobs/questionnaire';
import { bloomKeys, bloomLabels, groupLabel, readinessLabels, sectionLabels, type Attention, type BloomKey, type CognitiveRow, type CompositionSummary, type Configuration,
  type ConfigurationView, type LineCompositionView, type LineView, type ReadinessStatus, type SectionKey } from './contracts';
import { interpretClassification, evaluateClassified, type ClassifiedItem, type ClassifiedResult, type PlannedPart, type RequirementsProfile } from './classification';
import { sumCompositions, UNLISTED, type CompositionReason, type LineComposition, type Range } from './composition';

/**
 * Deterministic configuration engine. Runs on the server only: it reads pinned
 * private definitions and returns a result for one teacher's configuration.
 * Code owns ranges, arithmetic, required decisions and declared dependencies.
 * Nothing here chooses an unresolved answer for the teacher.
 */
export const ENGINE_VERSION = 'cfg01-engine@2';

export type LineDefinition = {
  id:string; entryId:string; legacyKind:'specification'|'multiple-choice';
  identity:{moduleId:string; kind:SectionKey; itemId:string; release:string};
  title:string; range:{min:number; max:number}; fixedMarks:number|null; fields:QuestionField[];
  classification:ClassifiedItem|null; classificationSha256:string|null; requirementsRef:string|null;
  classificationProblem:string|null; sourceBinding:SourceBinding; outline:CataloguePreview|null;
};
/** Exact generation inputs of a line; mirrors private.line_source_binding in migration 021. */
export type SourceBinding = {schema:'reviseit/cfg-source-binding@1'; moduleId:string; release:string; entryId:string; privateManifestSha256:string;
  privateBundleDigest:string; formRevision:string; workflowManifestSha256:string; sources:{role:string; path:string; sha256:string}[]};
export function sourceBindingOf(form:any, workflow:string):SourceBinding {
  return {schema:'reviseit/cfg-source-binding@1',moduleId:form.module,release:form.release,entryId:form.entryId,privateManifestSha256:form.manifestSha256,
    privateBundleDigest:form.bundleDigest,formRevision:form.formRevision,workflowManifestSha256:workflow,sources:form.sources};
}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as any)[k])).join(',')}}`:JSON.stringify(v);
export type Definitions = {
  sha256:string; module:string; release:string; formRevision:string;
  lines:LineDefinition[]; paperFields:QuestionField[]; profiles:Record<string,RequirementsProfile>;
};

const record=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);

/** Adapt the private pinned snapshot and issued form into engine definitions. */
export function readDefinitions(snapshot:unknown, form:unknown, sha256:string, options:{workflow?:string}={}):Definitions {
  if(!record(snapshot) || snapshot.schema!=='reviseit/configured-authored-inputs@1' || !Array.isArray(snapshot.lines) || !isQuestionnaire(form)) throw new Error('Unsupported configured order definitions');
  // Checkout candidates do not yet carry the execution frozen by the order trigger.
  const workflow=typeof snapshot.execution?.workflowManifestSha256==='string'?snapshot.execution.workflowManifestSha256:(options.workflow??'');
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
    const binding=sourceBindingOf(l.binding??{},workflow);
    if(l.classification && workflow && !same(l.classification.sourceBinding,binding)) problem='Classification describes other source bytes than this order generates from';
    else if(l.classification) {
      try { classification=interpretClassification(l.classification.payload, l.classification.requirementsRef?profiles[l.classification.requirementsRef]??null:null, item.fields,
        {range:l.range,fixedMarks:typeof l.fixedMarks==='number'?l.fixedMarks:null,formRevision:l.binding?.formRevision,kind}); }
      catch(e) { problem=e instanceof Error?e.message:'Unsupported classification'; }
    }
    return {id:l.id,entryId:l.entryId,legacyKind,identity:l.identity,title:l.title,range:l.range,fixedMarks:typeof l.fixedMarks==='number'?l.fixedMarks:null,
      fields:item.fields,classification,classificationSha256:l.classification?.sha256??null,requirementsRef:l.classification?.requirementsRef??null,classificationProblem:problem,
      sourceBinding:binding,outline:cataloguePreview(l.preview)??null};
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
  id:string; marks:number|null; marksProblem:string|null; classified:ClassifiedResult|null; composition:LineComposition|null;
  outstanding:string[]; attention:Attention[]; issues:string[]; ready:boolean;
};
export type Evaluation = {
  engine:string; definitionsSha256:string; paid:boolean; ready:boolean; status:ReadinessStatus; outstanding:number;
  totals:{target:number|null; allocated:number; complete:boolean; sections:Record<SectionKey,number>; sectionTargets:Partial<Record<SectionKey,number>>; problems:string[]};
  cognitive:Record<BloomKey|'unclassified',{min:number;max:number}>; grouped:Record<string,{min:number;max:number}>;
  bands:Record<string,Range>; composition:{exact:boolean; known:string[]; pending:number; pendingLines:{id:string; reason:CompositionReason}[]};
  lines:LineResult[]; paper:{outstanding:string[]; attention:Attention[]}; issues:string[];
};

/** A line without a classification: every mark's category is unknown, and says so. */
const unclassifiedLine=(marks:number):LineComposition=>({status:'unclassified',reason:null,marks,open:true,coverage:'unknown',known:[],examples:[],alternatives:[],parts:{},droppedBy:{},
  categories:{[UNLISTED]:{min:marks,max:marks}},bands:{[UNLISTED]:{min:marks,max:marks}}});
const pendingLine=(marks:number,reason:CompositionReason):LineComposition=>({status:'not-calculable',reason,marks,open:true,coverage:'unknown',known:[],examples:[],alternatives:[],parts:{},droppedBy:{},categories:{},bands:{}});

export function evaluate(defs:Definitions, cfg:Configuration, opts:{paid:boolean}):Evaluation {
  const issues:string[]=[];
  const lineIds=defs.lines.map(l=>l.id);
  if(Object.keys(cfg.lines).sort().join()!==[...lineIds].sort().join()) throw new Error('Configuration lines do not match the order');
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
    }
    // Without a genuine classification the marks stay visibly unclassified; an unreadable one is not calculable.
    const composition=classified?classified.composition:marks===null||marksProblem?null:def.classificationProblem?pendingLine(marks,'definition-unreadable'):unclassifiedLine(marks);
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
    const brief=cfg.briefs?.[def.id];
    if(brief) {
      if(!opts.paid)throw new Error('Briefs are available after payment');
      if(Object.entries(brief.suggestions).some(([id,a])=>!def.fields.some(f=>f.id===id&&answerFits(f,a))))throw new Error('Brief options do not match the purchased form');
      if(brief.text!==brief.interpretedText) attention.push({scope:'field',id:'teacher-brief',message:'Your description changed. Configure it or keep your current choices explicitly.'});
      for(const id of briefConflicts(brief,cfg.answers.items[def.id]??{})) attention.push({scope:'field',id,message:'Your description and existing choice differ. Choose which to use.'});
    }
    return {id:def.id,marks:marksProblem?null:marks,marksProblem,classified,composition,outstanding,attention,issues:lineIssues,ready:!marksProblem&&!outstanding.length&&!attention.length&&!lineIssues.length};
  });
  // Product policy: only per-item answers are requested. Retained shared answers are historical data.
  const paper:FieldState={outstanding:[],attention:[]};
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
  const sum=sumCompositions(lines.flatMap(l=>l.composition?[{marks:l.marks,composition:l.composition}]:[]));
  const cognitive=Object.fromEntries([...bloomKeys,UNLISTED].map(k=>[k,sum.categories[k]??{min:0,max:0}])) as Evaluation['cognitive'];
  const grouped=Object.fromEntries(Object.entries(sum.categories).filter(([k])=>k.includes('-or-')));
  const pendingLines=lines.flatMap(l=>l.composition?.status==='not-calculable'?[{id:l.id,reason:l.composition.reason!}]:[]);
  return {engine:ENGINE_VERSION,definitionsSha256:defs.sha256,paid:opts.paid,ready:status==='ready_to_generate',status,outstanding,
    totals:{target,allocated,complete,sections,sectionTargets,problems},cognitive,grouped,bands:sum.bands,
    composition:{exact:sum.exact,known:sum.known,pending:sum.pending,pendingLines},lines,paper,issues};
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
  return {schemaVersion:2,revision:defs.formRevision,items:Object.fromEntries(defs.lines.map(l=>[l.id,fill(l.fields,cfg.answers.items[l.id])])),paper:{}};
}

export type PlanLine = {teacherBrief?:Configuration['briefs'] extends Record<string,infer B>|undefined?B|null:never; id:string; entryId:string; identity:LineDefinition['identity']; kind:LineDefinition['legacyKind']; marks:number;
  parts:PlannedPart[]|null;
  facets:Record<string,Answer>; answers:Record<string,Answer>; classificationSha256:string|null; requirementsRef:string|null;
  diagram:{stimulus:string; learnerDrawn:string[]}|null; sourceBinding:SourceBinding};
export type GenerationPlan = {schema:'reviseit/configured-generation-plan@3'|'reviseit/configured-generation-plan@4'; order:string[]; orderId:string; module:string; release:string; formRevision:string;
  configurationRevision:number; definitionsSha256:string; targets:Configuration['targets']; lines:PlanLine[]};

/** Freeze the resolved configuration the worker and skill must consume. Refuses anything not ready. */
export function generationPlan(defs:Definitions, cfg:Configuration, e:Evaluation, orderId:string, revision:number):{plan:GenerationPlan; answers:QuestionnaireAnswers} {
  if(!e.ready || e.definitionsSha256!==defs.sha256) throw new Error('Configuration is not ready');
  const answers=submittedAnswers(defs,cfg);
  const lines=defs.lines.map((def,i):PlanLine=>{
    const r=e.lines[i];
    return {id:def.id,entryId:def.entryId,identity:def.identity,kind:def.legacyKind,marks:r.marks!,
      parts:r.classified?r.classified.plannedParts:null,facets:cfg.lines[def.id].facets,answers:answers.items[def.id],
      classificationSha256:def.classificationSha256,requirementsRef:def.requirementsRef,diagram:r.classified?.diagram??null,sourceBinding:def.sourceBinding,...(cfg.briefs?{teacherBrief:cfg.briefs[def.id]??null}:{})};
  });
  return {plan:{schema:cfg.briefs?'reviseit/configured-generation-plan@4':'reviseit/configured-generation-plan@3',order:lineOrder(defs,cfg),orderId,module:defs.module,release:defs.release,formRevision:defs.formRevision,
    configurationRevision:revision,definitionsSha256:defs.sha256,targets:cfg.targets,lines},answers};
}

/** The teacher's order of purchased occurrences; the default is checkout order. */
export function lineOrder(defs:Definitions, cfg:Configuration):string[] {
  const ids=defs.lines.map(l=>l.id);
  return cfg.order && cfg.order.length===ids.length && ids.every(id=>cfg.order!.includes(id))?[...cfg.order]:ids;
}
/** Paper numbering: multiple choice as question 1 (1.1, 1.2 …) then structured, each in the teacher's order. */
export function presentation(defs:Definitions, cfg:Configuration):{id:string; number:string}[] {
  const order=lineOrder(defs,cfg);const kind=new Map(defs.lines.map(l=>[l.id,l.identity.kind]));
  const mcq=order.filter(id=>kind.get(id)==='multiple_choice'),structured=order.filter(id=>kind.get(id)==='structured');
  return [...mcq.map((id,i)=>({id,number:`1.${i+1}`})),...structured.map((id,i)=>({id,number:String((mcq.length?2:1)+i)}))];
}

// ---------------------------------------------------------------- projection
/** Explicit allowlist for the browser. Before payment: marks, totals and safe labels only. */
export function project(defs:Definitions, cfg:Configuration, e:Evaluation, meta:{orderId:string; state:string; paymentStatus:string; revision:number; submitted:boolean}):ConfigurationView {
  const paid=e.paid;
  const shown=presentation(defs,cfg);const numbers=defs.lines.map(l=>shown.find(x=>x.id===l.id)!.number);
  const lines=defs.lines.map((def,i):LineView=>{
    const r=e.lines[i];
    const c=paid && r.classified ? r.classified : null;
    return {id:def.id,entryId:def.entryId,number:numbers[i],title:def.title,kind:def.identity.kind,configurable:def.classification?'classified':'authored',
      marks:{value:def.fixedMarks ?? cfg.lines[def.id].marks,min:def.range.min,max:def.range.max,fixed:def.fixedMarks!==null},
      parts:c?c.parts:[],facets:c?c.facets:[],fields:paid?def.fields:[],answers:paid?(cfg.answers.items[def.id]||{}):{},
      outstanding:paid?r.outstanding:[],attention:paid?r.attention:r.attention.filter(a=>a.scope==='marks'),issues:r.issues,ready:r.ready,
      diagram:c?c.diagramView:null,composition:c?compositionView(c.composition):null,outline:def.outline?{subquestions:def.outline.subquestions,rows:(def.outline.outline??[]).map(r=>({summary:r.summary,bloom:r.bloom,marks:r.marks??null}))}:null};
  });
  // Six categories, then unresolved groups as their own rows (never split), then unknown, then marks not yet
  // calculable. Each mark appears in exactly one row.
  const known=new Set(e.composition.known);
  const cognitive:CognitiveRow[]=[...bloomKeys.map(k=>({key:k,label:bloomLabels[k],known:known.has(k),...e.cognitive[k]})),
    ...Object.keys(e.grouped).sort().filter(g=>e.grouped[g].max>0||known.has(g)).map(g=>({key:g,label:groupLabel(g),grouped:true,known:known.has(g),...e.grouped[g]})),
    {key:UNLISTED,label:'Not yet classified',...e.cognitive.unclassified},
    ...(e.composition.pending?[{key:'pending',label:'Not yet calculable',min:e.composition.pending,max:e.composition.pending}]:[])];
  const remaining=e.totals.target===null?0:Math.max(0,e.totals.target-e.totals.allocated);
  const excess=e.totals.target===null?0:Math.max(0,e.totals.allocated-e.totals.target);
  return {orderId:meta.orderId,state:meta.state,paid,paymentStatus:meta.paymentStatus,revision:meta.revision,submitted:meta.submitted,
    status:e.status,statusLabel:readinessLabels[e.status],outstanding:e.outstanding,canSubmit:e.ready&&!meta.submitted&&meta.state==='awaiting_answers',
    totals:{target:e.totals.target,allocated:e.totals.allocated,remaining,excess,complete:e.totals.complete,
      sections:(['multiple_choice','structured'] as SectionKey[]).filter(k=>defs.lines.some(l=>l.identity.kind===k)).map(k=>({key:k,label:sectionLabels[k],allocated:e.totals.sections[k],target:e.totals.sectionTargets[k]??null}))},
    // Presentation order matches the paper: multiple choice as question 1, then structured.
    cognitive,composition:summary(e,shown),lines:shown.map(x=>lines.find(l=>l.id===x.id)!),paper:{fields:[],answers:{},outstanding:[]},
    issues:[...e.totals.problems,...e.issues],configuration:cfg};
}

const PENDING_REASONS:Record<CompositionReason,string>={
  'marks-not-set':'its marks are not set','invalid-configuration':'one of its choices needs attention','no-supported-allocation':'no split of its marks fits its subquestions',
  'choices-conflict-with-source':'its choices leave fewer or different subquestions than its specification states, so the source cannot say how its marks split',
  'definition-unreadable':'its definition could not be read'};
const categoryLabel=(k:string)=>k===UNLISTED?'Not yet classified':k.includes('-or-')?groupLabel(k):bloomLabels[k as BloomKey]??k;

function summary(e:Evaluation, shown:{id:string; number:string}[]):CompositionSummary {
  const counted=e.lines.reduce((n,l)=>n+(l.composition&&l.composition.status!=='not-calculable'?l.marks??0:0),0);
  // Settled: at least this many marks are in a known category in every permitted split. Unclassified: at least this many are not.
  const settled=[...bloomKeys.map(k=>e.cognitive[k]),...Object.values(e.grouped)].reduce((n,r)=>n+r.min,0), unclassified=e.cognitive.unclassified.min;
  const notes=e.composition.pendingLines.map(p=>`Question ${shown.find(x=>x.id===p.id)?.number??''}: not yet calculable because ${PENDING_REASONS[p.reason]}.`);
  const unknown=e.lines.filter(l=>l.composition&&l.composition.status!=='not-calculable'&&l.composition.status!=='unclassified'&&l.composition.coverage==='unknown').map(l=>shown.find(x=>x.id===l.id)?.number??'');
  if(unknown.length) notes.push(`${unknown.length===1?'Question':'Questions'} ${unknown.join(', ')}: ${unknown.length===1?'its definition does':'their definitions do'} not say whether subquestions beyond those listed may be written, so part of ${unknown.length===1?'its':'their'} marks may be not yet classified.`);
  return {exact:e.composition.exact,settled,unclassified,open:counted-settled-unclassified,pending:e.composition.pending,notes};
}

function compositionView(c:LineComposition):LineCompositionView {
  const rows=Object.entries(c.categories).filter(([k,r])=>r.max>0||c.known.includes(k)).map(([k,r])=>({key:k,label:categoryLabel(k),grouped:k.includes('-or-')||undefined,known:c.known.includes(k),...r}));
  for(const k of c.known) if(!rows.some(r=>r.key===k)) rows.push({key:k,label:categoryLabel(k),grouped:k.includes('-or-')||undefined,known:true,min:0,max:0});
  const order=(k:string)=>{const i=(bloomKeys as readonly string[]).indexOf(k);return i>=0?i:k===UNLISTED?99:50;};
  rows.sort((a,b)=>order(a.key)-order(b.key)||(a.key<b.key?-1:1));
  const alternatives=c.alternatives.length>1?` Your choices have not yet settled which of its ${c.alternatives.length} structures (${c.alternatives.join(', ')}) is used; the ranges cover each structure, never a mixture.`:'';
  const note=c.status==='not-calculable'?`Categories known; marks not yet calculable because ${PENDING_REASONS[c.reason!]}.`:
    c.status==='exact'?'Exact: the source and your choices fix every mark’s category.':
    c.status==='unclassified'?'This question’s subquestions are not yet classified, so its marks have no category yet.':
    (c.coverage==='unknown'?'This question’s definition lists its subquestions but does not say whether others may be written, so marks that could fall outside them are shown as not yet classified. ':
     c.open?`${c.alternatives.length>1?'At least one of its structures':'The specification'} allows subquestions it does not list; their marks count as not yet classified. `:'The subquestions are set by the specification and your choices. ')+
    'Each one included carries at least one mark; the source gives example marks, so the split between them is a range.'+alternatives;
  return {status:c.status,note,open:c.open,rows,alternatives:c.alternatives,
    examples:c.examples.map(x=>({label:x.label,marks:x.marks,parts:x.parts,rows:Object.entries(x.categories).map(([k,m])=>({key:k,label:categoryLabel(k),...m})).sort((a,b)=>order(a.key)-order(b.key))}))};
}

