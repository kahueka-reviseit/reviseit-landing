import { isAnswer, type Answer, type QuestionField } from '../jobs/questionnaire';
import { isUuid } from '../jobs/contracts';

/**
 * Browser-safe configurator contract. The browser sends a teacher's choices and
 * receives a server projection. Private classifications, rules, forms, source
 * paths and provenance never belong in these types.
 */
export const bloomKeys = ['remember','understand','apply','analyse','evaluate','create'] as const;
export type BloomKey = typeof bloomKeys[number];
export const bloomLabels: Record<BloomKey,string> = {remember:'Remember',understand:'Understand',apply:'Apply',analyse:'Analyse',evaluate:'Evaluate',create:'Create'};
export type SectionKey = 'multiple_choice'|'structured';
export const sectionLabels: Record<SectionKey,string> = {multiple_choice:'Multiple choice',structured:'Structured'};

export type Targets = {paper:number|null; sections?:Partial<Record<SectionKey,number>>};
export type LineChoice = {marks:number|null; parts:string[]|null; facets:Record<string,Answer>};
export type TeacherBrief = {text:string; interpretedText:string|null; suggestions:Record<string,Answer>; resolutions:Record<string,'brief'|'choice'>};
export type Configuration = {
  briefs?:Record<string,TeacherBrief>;
  schemaVersion:1; targets:Targets; lines:Record<string,LineChoice>; order?:string[];
  answers:{items:Record<string,Record<string,Answer>>; paper:Record<string,Answer>};
};

export type ReadinessStatus = 'marks_needed'|'ready_for_payment'|'details_to_complete'|'ready_to_generate';
export const readinessLabels: Record<ReadinessStatus,string> = {
  marks_needed:'Marks needed', ready_for_payment:'Ready for payment', details_to_complete:'Details to complete', ready_to_generate:'Ready to generate',
};

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const record = (x:unknown):x is Record<string,unknown> => !!x && typeof x==='object' && !Array.isArray(x);
const identifier = (x:unknown):x is string => typeof x==='string' && idPattern.test(x) && !['__proto__','constructor','prototype'].includes(x);
const exact = (x:Record<string,unknown>,keys:string[],optional:string[]=[]) => keys.every(k=>Object.hasOwn(x,k)) && Object.keys(x).every(k=>keys.includes(k)||optional.includes(k));
const marksValue = (x:unknown) => x===null || (Number.isSafeInteger(x) && Number(x)>=1 && Number(x)<=100);
const total = (x:unknown,min:number) => Number.isSafeInteger(x) && Number(x)>=min && Number(x)<=3000;

function answers(section:unknown,max:number):section is Record<string,Answer> {
  return record(section) && Object.keys(section).length<=max && Object.entries(section).every(([k,a])=>identifier(k)&&isAnswer(a));
}

/** Closed shape only. Identities, ranges and rules are checked against pinned definitions on the server. */
export function isConfiguration(value:unknown):value is Configuration {
  if(!record(value) || !exact(value,['schemaVersion','targets','lines','answers'],['order','briefs']) || value.schemaVersion!==1) return false;
  if(Object.hasOwn(value,'order') && !(Array.isArray(value.order) && record(value.lines) && value.order.length===Object.keys(value.lines).length
    && new Set(value.order).size===value.order.length && value.order.every(id=>typeof id==='string' && Object.hasOwn(value.lines as object,id)))) return false;
  const t=value.targets;
  if(!record(t) || !exact(t,['paper'],['sections']) || !(t.paper===null || total(t.paper,1))) return false;
  if(Object.hasOwn(t,'sections') && !(record(t.sections) && Object.entries(t.sections).every(([k,v])=>(k==='multiple_choice'||k==='structured') && total(v,0)))) return false;
  if(!record(value.lines) || Object.keys(value.lines).length<1 || Object.keys(value.lines).length>30) return false;
  const linesOk=Object.entries(value.lines).every(([id,line])=>identifier(id) && record(line) && exact(line,['marks','parts','facets']) && marksValue(line.marks) &&
    (line.parts===null || (Array.isArray(line.parts) && line.parts.length<=40 && new Set(line.parts).size===line.parts.length && line.parts.every(identifier))) && answers(line.facets,40));
  if(!linesOk) return false;
  const a=value.answers;
  if(!record(a) || !exact(a,['items','paper']) || !record(a.items) || !answers(a.paper,20)) return false;
  if(!Object.entries(a.items).every(([id,s])=>Object.hasOwn(value.lines as object,id) && answers(s,30))) return false;
  if(value.briefs!==undefined && (!record(value.briefs)||Object.entries(value.briefs).some(([id,b])=>!Object.hasOwn(value.lines as object,id)||!isTeacherBrief(b)))) return false;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength<=180000;
}
export function isTeacherBrief(b:unknown):b is TeacherBrief {
  return record(b)&&exact(b,['text','interpretedText','suggestions','resolutions'])&&typeof b.text==='string'&&b.text.length<=4000&&
    (b.interpretedText===null||typeof b.interpretedText==='string'&&b.interpretedText.length<=4000)&&answers(b.suggestions,30)&&record(b.resolutions)&&
    Object.entries(b.resolutions).every(([id,v])=>identifier(id)&&Object.hasOwn(b.suggestions as object,id)&&(v==='brief'||v==='choice'));
}

export type ConfigurationSave = {revision:number; configuration:Configuration};
export function isConfigurationSave(value:unknown):value is ConfigurationSave {
  return record(value) && exact(value,['revision','configuration']) && Number.isSafeInteger(value.revision) && Number(value.revision)>=1 && isConfiguration(value.configuration);
}
export type ConfigurationSubmit = {requestKey:string; revision:number};
export function isConfigurationSubmit(value:unknown):value is ConfigurationSubmit {
  return record(value) && exact(value,['requestKey','revision']) && isUuid(value.requestKey) && Number.isSafeInteger(value.revision) && Number(value.revision)>=1;
}

/** Checkout for the configurable path: marks for every saved item and the teacher's paper target. */
export type ConfiguredCheckoutRequest = {requestKey:string; moduleId:string; selectionRevision:number; allocations:Record<string,number>; targets:{paper:number; sections?:Partial<Record<SectionKey,number>>}};

// ---------------------------------------------------------------- projection
export type OptionView = {id:string; label:string; disabled:boolean; reason?:string; preferred?:boolean};
export type FacetView = {id:string; label:string; hint:string; type:'choice'; required:boolean; allowAutomatic:boolean; options:OptionView[]; value:Answer|null; forced?:string; reason?:string};
export type PartView = {id:string; number:string; summary:string; bloom:BloomKey|null; bloomOptions:BloomKey[]; bloomBasis:'source-label'|'profile-single-mapping'|'profile-authorised-fallback'|null; bloomUnknownReason?:string; band:string|null; marks:{min:number;max:number}|null;
  inclusion:'required'|'optional'; included:boolean; locked:boolean; reason?:string; learnerDrawn:boolean};
export type Attention = {scope:'field'|'facet'|'part'|'marks'; id:string; message:string};
export type LineView = {
  id:string; entryId?:string; number:string; title:string; kind:SectionKey; configurable:'classified'|'authored';
  marks:{value:number|null; min:number; max:number; fixed:boolean};
  parts:PartView[]; facets:FacetView[]; fields:QuestionField[]; answers:Record<string,Answer>;
  outstanding:string[]; attention:Attention[]; issues:string[]; ready:boolean;
  diagram:{stimulus:'required'|'optional'|'not_applicable'|'unknown'; learnerDrawn:string[]; locked?:string}|null;
  /** Reviewed public catalogue outline only (one example structure), or null when none was published. */
  outline:{subquestions:{min:number;max:number}; rows:{summary:string; bloom:string; marks:{min:number;max:number}|null}[]}|null;
};
export type CognitiveRow = {key:string; label:string; min:number; max:number; grouped?:boolean};
/** 'apply-or-analyse' -> 'Apply or Analyse' */
export const groupLabel=(key:string)=>key.split('-or-').map(k=>bloomLabels[k as BloomKey]??k).join(' or ');
export type CurriculumComparison = {profile:string; basis:'marks'|'item-count'; rows:{key:string; label:string; min:number; max:number; target:string}[]; note:string};
export type ConfigurationView = {
  briefEnabled?:boolean;
  advice?:{enabled:boolean;lineIds:string[]};
  orderId:string; state:string; paid:boolean; paymentStatus:string; revision:number; submitted:boolean;
  status:ReadinessStatus; statusLabel:string; outstanding:number; canSubmit:boolean;
  totals:{target:number|null; allocated:number; remaining:number; excess:number; complete:boolean;
    sections:{key:SectionKey; label:string; allocated:number; target:number|null}[]};
  cognitive:CognitiveRow[]; curriculum:CurriculumComparison[];
  lines:LineView[]; paper:{fields:QuestionField[]; answers:Record<string,Answer>; outstanding:string[]};
  issues:string[]; configuration:Configuration;
};
