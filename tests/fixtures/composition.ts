// C10 synthetic composition fixtures: deliberately non-scientific. One example-instance item whose
// form choices are linked to its listed subquestions, one fully specified item, one multiple-choice
// item and one item without a parts table.
import {readDefinitions} from '../../lib/configurator/engine';
import type {Configuration} from '../../lib/configurator/contracts';
import type {QuestionField} from '../../lib/jobs/questionnaire';

const hash=(c:string)=>c.repeat(64);
export const choice=(id:string,options:string[],required=true):QuestionField=>({id,label:'Synthetic '+id,hint:'',required,allowAutomatic:true,type:'choice',allowOther:false,choices:options.map(o=>({id:o,label:o}))});
const part=(id:string,cognitive:{bloom?:string;options?:string[]},marks:{basis:'range'|'typical';min:number;max:number},inclusion='unspecified',band='B1')=>({id,label:'X.'+id.slice(1),summary:'Synthetic part '+id,inclusion,locator:null,marks,
 cognitive:{bloom:cognitive.bloom??null,unknownReason:cognitive.bloom?null:'grouped-band-unresolved',curriculumBand:band,curriculumBandCandidates:[],sourceLabels:{band:null,bloom:null},
  bloomBasis:cognitive.bloom?'source-label':null,bloomCandidates:cognitive.options??[]}});
const rule=(id:string,when:any,then:any[],reason='hint.form')=>({id,kind:'constraint',activation:'active',when,then,reason,origin:{type:'form',locators:[],heldBecause:null}});
export function classification(itemId:string,kind:string,marks:[number,number],parts:any[],fields:QuestionField[],rules:any[],partsFacet:string[]=[]){
 return {schemaVersion:2,moduleId:'synthetic-module',kind,itemId,release:'1',title:'Synthetic '+itemId,curriculumId:'synthetic-curriculum',curriculumRequirementsRef:{profileId:'synthetic-profile',version:1},
  marks:marks[0]===marks[1]?{mode:'fixed',value:marks[0]}:{mode:'range',min:marks[0],max:marks[1]},parts,
  facets:[{id:'marks',type:'integer',stage:'pre',required:true,delegable:false,allowCustom:false,prompt:null,binding:{scope:'line-marks'},domain:{min:marks[0],max:marks[1]}},
   ...(partsFacet.length?[{id:'parts',type:'parts',stage:'post',required:false,delegable:false,allowCustom:false,prompt:null,binding:{scope:'line-parts'},domain:{parts:partsFacet}}]:[]),
   ...fields.map(f=>({id:f.id,type:'choice',stage:'post',required:f.required,delegable:f.allowAutomatic,allowCustom:false,prompt:null,binding:{scope:'item-form',fieldId:f.id},domain:{options:(f as any).choices}}))],
  rules,diagramPolicy:{stimulus:'unspecified',stimulusFacet:null,learnerDrawnParts:[],whenLeftOut:null,locators:[]},
  formBinding:{status:'bound',itemForm:{schema:'reviseit/authored-form@1',path:'forms/x.json',formRevision:hash('f'),fileSha256:hash('e'),acceptedSnapshotFileSha256:null,privateKind:kind==='structured'?'specification':'multiple-choice',fieldCount:fields.length,authoredStatus:'authored-ready',jointItemIds:[],unresolvedCount:0},
   fieldMap:fields.map(f=>({facetId:f.id,fieldId:f.id})),sharedForms:[]},
  provenance:{synthetic:true,sources:[],extractor:{name:'synthetic',version:'1'},labelNormalisations:[],requirementsProfileSha256:null},jevChecks:[],
  hints:{'hint.form':'Synthetic: set by your statement choice.','hint.compare':'Synthetic: included because you asked for the comparison.'},coverage:{status:'partial',gaps:[]}};
}
// An example-instance item: the source lists five subquestions with example marks only.
export const openFields=[choice('statements',['one','other','both']),choice('comparison',['yes','no'],false)];
export const openItem=()=>classification('OPEN','structured',[8,12],[
 part('p1',{bloom:'remember'},{basis:'typical',min:2,max:2}),part('p2',{bloom:'apply'},{basis:'typical',min:3,max:3},'unspecified','B3'),
 part('p3',{bloom:'remember'},{basis:'typical',min:2,max:2}),part('p4',{bloom:'analyse'},{basis:'typical',min:1,max:1},'unspecified','B4'),
 part('p5',{options:['apply','analyse']},{basis:'typical',min:2,max:2},'unspecified','B3')],openFields,[
 {...rule('src-count',{always:true},[{partCount:{min:3,max:5}}]),origin:{type:'source',locators:[],heldBecause:null}},
 rule('form-one',{facet:'statements',is:'one'},[{requireParts:['p1']},{excludeParts:['p3']}]),rule('form-other',{facet:'statements',is:'other'},[{requireParts:['p3']},{excludeParts:['p1']}]),
 rule('form-both',{facet:'statements',is:'both'},[{requireParts:['p1','p3']}]),rule('form-compare',{facet:'comparison',is:'yes'},[{requireParts:['p4']}],'hint.compare'),
 rule('form-no-compare',{facet:'comparison',is:'no'},[{excludeParts:['p4']}],'hint.compare')]);
// A specified item: every part's marks are stated, one part is optional.
export const closedItem=()=>classification('CLOSED','structured',[6,8],[part('p1',{bloom:'remember'},{basis:'range',min:2,max:2},'required'),
 part('p2',{bloom:'apply'},{basis:'range',min:2,max:4},'required','B3'),part('p3',{bloom:'analyse'},{basis:'range',min:2,max:2},'optional','B4')],[],[],['p3']);
export const mcqItem=()=>classification('MCQ','multiple_choice',[2,2],[part('p1',{bloom:'understand'},{basis:'range',min:2,max:2},'required','B2')],[],[]);
export const noPartsItem=()=>classification('VARIANTS','structured',[10,14],[],[],[]);
const profile={profileId:'synthetic-profile',version:1,curriculumId:'synthetic-curriculum',bands:[{id:'B1',label:'Band one'},{id:'B2',label:'Band two'},{id:'B3',label:'Band three'},{id:'B4',label:'Band four'}],
 distributions:[{id:'bands',taxonomy:'curriculum-band',basis:'marks',targets:[{key:'B1',percent:20},{key:'B2',percent:30},{key:'B3',percent:40},{key:'B4',percent:10}]}]};

export type Item={doc:any;fields:QuestionField[];range:[number,number]}|null;
export function definitions(items:Item[],opts:{badMap?:number}={}){
 const lines=items.map((it,i)=>{const mcq=it?.doc.kind==='multiple_choice';const range=it?it.range:[6,10];
  return {id:`q${i+1}`,entryId:`${mcq?'mcq':'structured'}:${it?.doc.itemId??'AUTH'}${i}`,kind:mcq?'multiple-choice':'specification',identity:{moduleId:'synthetic-module',kind:mcq?'multiple_choice':'structured',itemId:it?.doc.itemId??'AUTH',release:'1'},
   title:'Synthetic '+(it?.doc.itemId??'authored'),range:{min:range[0],max:range[1]},fixedMarks:mcq?2:null,checkoutMarks:range[0],binding:{formRevision:hash('f'),fields:it?.fields??[]},
   classification:it?{sha256:hash(String(i)),requirementsRef:'synthetic-profile@1',payload:opts.badMap===i?{...it.doc,formBinding:{...it.doc.formBinding,fieldMap:[]}}:it.doc}:null};});
 const form={schemaVersion:2,revision:hash('d'),items:lines.map(l=>({id:l.id,title:l.title,marks:l.checkoutMarks,fields:l.binding.fields})),paperFields:[]};
 return readDefinitions({schema:'reviseit/configured-authored-inputs@1',module:'synthetic-module',release:'1',formRevision:hash('d'),lines,requirements:{'synthetic-profile@1':{sha256:hash('7'),payload:profile}}},form,hash('9'));
}
export const open={doc:openItem(),fields:openFields,range:[8,12] as [number,number]}, closed={doc:closedItem(),fields:[],range:[6,8] as [number,number]}, mcq={doc:mcqItem(),fields:[],range:[2,2] as [number,number]};
export const ch=(id:string)=>({kind:'choice' as const,choiceId:id});
export function config(marks:(number|null)[],over:Partial<Configuration>={}):Configuration{
 return {schemaVersion:1,targets:{paper:marks.reduce<number>((n,m)=>n+(m??0),0)},lines:Object.fromEntries(marks.map((m,i)=>[`q${i+1}`,{marks:m,parts:null,facets:{}}])),answers:{items:{},paper:{}},...over};
}
