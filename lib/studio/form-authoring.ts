import {isQuestionFields as validFields,type QuestionField} from '../jobs/questionnaire';
import type {FileDetail} from './library';
import type {SaveDraftInput} from './maintenance-drafts';

export type AuthoredForm={schema:'reviseit/authored-form@1';identity:{module:string;kind:string;id?:string;scope?:string};title:string;fields:QuestionField[];field_provenance:Record<string,Record<string,unknown>>;meta:Record<string,unknown>;form_revision:string;[key:string]:unknown};
export type FormSaveInput=Omit<SaveDraftInput,'text'|'restoredFrom'>&{fields:QuestionField[];asOf:string};
export function parseAuthoredForm(file:Pick<FileDetail,'moduleId'|'path'>,text:string):AuthoredForm|null {
 try {
  const d=JSON.parse(text),match=/^data\/forms\/authored\/(specification|multiple-choice)\/([A-Z0-9_-]+)\.json$/.exec(file.path);
  if(!match||d.schema!=='reviseit/authored-form@1'||d.identity?.module!==file.moduleId||d.identity?.kind!==match[1]||d.identity?.id!==match[2]||Object.keys(d.identity).sort().join(',')!=='id,kind,module'
   ||!validFields(d.fields,30)||!d.meta||typeof d.meta!=='object'||Array.isArray(d.meta)||!d.field_provenance||typeof d.field_provenance!=='object'||Array.isArray(d.field_provenance)
   ||!d.fields.every((f:QuestionField)=>d.field_provenance[f.id]&&Array.isArray(d.field_provenance[f.id].changes))||typeof d.title!=='string'||typeof d.form_revision!=='string'||!/^[a-f0-9]{64}$/.test(d.form_revision))return null;
  return d;
 }catch{return null;}
}
/** The existing consumer contract is the field-shape authority. This slice preserves bindings. */
export function formEditProblem(original:AuthoredForm,proposed:unknown):string|null {
 if(!validFields(proposed,30))return 'Check field labels, hints, choices and text limits against the teacher form format.';
 const unpaired=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
 if(proposed.some(f=>[f.label,f.hint,...(f.type==='choice'?f.choices.map(c=>c.label):[])].some(t=>unpaired.test(t))))return 'A field contains an invalid Unicode character.';
 if(proposed.length!==original.fields.length)return 'Adding or removing fields requires dependency and source review. Keep the existing fields in this editor.';
 for(let n=0;n<proposed.length;n++) {
  const a=original.fields[n],b=proposed[n];
  if(a.id!==b.id||a.type!==b.type)return 'Field identifiers, types and order must stay stable in this editor.';
  if(a.type==='choice'&&b.type==='choice'&&(a.choices.length!==b.choices.length||a.choices.some((c,j)=>c.id!==b.choices[j].id)))return 'Choice identifiers and order must stay stable. Adding or removing choices needs dependency and source review.';
 }
 return null;
}
/** Canonical encoding used by the content producer: sorted keys, compact UTF-8 JSON. */
export function canonicalFormJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalFormJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalFormJson((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function changedFormFields(original:AuthoredForm,proposed:QuestionField[]) {
 return proposed.filter((f,i)=>canonicalFormJson(f)!==canonicalFormJson(original.fields[i])).map(f=>f.id);
}
export type FormSource={path:string;sha256:string;url:string|null;verified:boolean};
