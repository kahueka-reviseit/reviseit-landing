import {readDefinitions} from '../../lib/configurator/engine';
import type {Configuration} from '../../lib/configurator/contracts';
import type {QuestionField} from '../../lib/jobs/questionnaire';
// Synthetic, deliberately non-scientific configurator fixture for the local preview only.
const h=(c:string)=>c.repeat(64);
const choice=(id:string,label:string,options:[string,string][],required=true,allowAutomatic=true):QuestionField=>({id,label,hint:'',required,allowAutomatic,type:'choice',allowOther:false,choices:options.map(([id,label])=>({id,label}))});
const note=(id:string):QuestionField=>({id,label:'Anything else',hint:'Optional. It can stay blank.',required:false,allowAutomatic:false,type:'text',maxLength:400});
const structuredFields=[choice('setting','Synthetic setting',[['one','Setting one'],['two','Setting two'],['three','Setting three']]),choice('shade','Synthetic shade',[['red','Red'],['blue','Blue']]),note('note')];
const mcqFields=[choice('emphasis','Emphasis (synthetic)',[['accessible','Accessible'],['balanced','Balanced'],['stretching','Stretching']]),
 choice('stimulus','Stimulus diagram (synthetic)',[['include','Include'],['leave_out','No diagram']]),choice('focus','Focus (synthetic)',[['focus_a','Synthetic focus A'],['focus_b','Synthetic focus B']])];
const part=(id:string,summary:string,bloom:string|null,min:number,max:number,inclusion='required',band='B1')=>({id,label:id,summary,inclusion,locator:null,marks:{basis:'range',min,max},
 cognitive:{bloom,unknownReason:bloom?null:'synthetic-unclassified',curriculumBand:band,curriculumBandCandidates:[],sourceLabels:{band:null,bloom:null}}});
const facetsFor=(fields:QuestionField[],marks:[number,number],parts?:string[])=>[{id:'marks',type:'integer',stage:'pre',required:true,delegable:false,allowCustom:false,prompt:null,binding:{scope:'line-marks'},domain:{min:marks[0],max:marks[1]}},
 ...(parts?[{id:'parts',type:'parts',stage:'post',required:false,delegable:false,allowCustom:false,prompt:null,binding:{scope:'line-parts'},domain:{parts}}]:[]),
 ...fields.map(f=>f.type==='choice'?{id:f.id,type:'choice',stage:'post',required:f.required,delegable:f.allowAutomatic,allowCustom:f.allowOther,prompt:null,binding:{scope:'item-form',fieldId:f.id},domain:{options:f.choices}}:
  {id:f.id,type:'text',stage:'post',required:f.required,delegable:f.allowAutomatic,allowCustom:true,prompt:null,binding:{scope:'item-form',fieldId:f.id},domain:{maxLength:f.maxLength}})];
const envelope=(itemId:string,kind:string,fields:QuestionField[],marks:[number,number],parts:any[],rules:any[],hints:Record<string,string>,drawn:string[]=[])=>({schemaVersion:1,moduleId:'synthetic-module',kind,itemId,release:'1',title:itemId,curriculumId:'synthetic-curriculum',
 curriculumRequirementsRef:{profileId:'synthetic-profile',version:1},marks:marks[0]===marks[1]?{mode:'fixed',value:marks[0]}:{mode:'range',min:marks[0],max:marks[1]},parts,facets:facetsFor(fields,marks,parts.filter(p=>p.inclusion==='optional').map(p=>p.id).length?parts.filter(p=>p.inclusion==='optional').map(p=>p.id):undefined),rules,
 diagramPolicy:{stimulus:kind==='multiple_choice'?'optional':'unspecified',stimulusFacet:kind==='multiple_choice'?'stimulus':null,learnerDrawnParts:drawn,whenLeftOut:null,locators:[]},
 formBinding:{status:'bound',itemForm:{schema:'reviseit/authored-form@1',path:'forms/x.json',formRevision:h('f'),fileSha256:h('e'),acceptedSnapshotFileSha256:null,privateKind:kind==='structured'?'specification':'multiple-choice',fieldCount:fields.length,authoredStatus:'authored-ready',jointItemIds:[],unresolvedCount:0},
  fieldMap:fields.map(f=>({facetId:f.id,fieldId:f.id})),sharedForms:[]},provenance:{synthetic:true,sources:[],extractor:{name:'synthetic',version:'1'},labelNormalisations:[],requirementsProfileSha256:null},
 jevChecks:[],hints,coverage:{status:'partial',gaps:[{code:'synthetic',detail:'Synthetic preview fixture',locator:null}]}});
const rule=(id:string,when:any,then:any[],reason:string)=>({id,kind:'constraint',activation:'active',when,then,reason,origin:{type:'synthetic',locators:[],heldBecause:null}});
const profile={profileId:'synthetic-profile',version:1,curriculumId:'synthetic-curriculum',bands:[{id:'B1',label:'Band one'},{id:'B2',label:'Band two'}],distributions:[{id:'bands',taxonomy:'curriculum-band',basis:'marks',targets:[{key:'B1',percent:60},{key:'B2',percent:40}]}]};
export function previewDefinitions(){
 const s1=envelope('SYN-01','structured',structuredFields,[10,16],[part('p1','State a synthetic definition','remember',2,2),part('p2','Draw a synthetic sketch','apply',3,5,'optional'),part('p3','Calculate a synthetic value','apply',3,5),part('p4','Explain a synthetic change','analyse',2,4,'required','B2')],
  [rule('r1',{facet:'setting',is:'three'},[{requireParts:['p2']}],'hint.three'),rule('r2',{facet:'setting',is:'two'},[{excludeOptions:{facet:'shade',options:['red']}}],'hint.two')],
  {'hint.three':'Synthetic: setting three needs the sketch part.','hint.two':'Synthetic: setting two rules out red.'},['p2']);
 const m1=envelope('SYN-MCQ-01','multiple_choice',mcqFields,[2,2],[part('p1','Synthetic option item','understand',2,2)],[rule('m1',{facet:'emphasis',is:'stretching'},[{excludeOptions:{facet:'stimulus',options:['leave_out']}}],'hint.m1')],{'hint.m1':'Synthetic: the stretching version needs its diagram.'});
 const lines=[
  {id:'q1',entryId:'structured:SYN-01',kind:'specification',identity:{moduleId:'synthetic-module',kind:'structured',itemId:'SYN-01',release:'1'},title:'Synthetic structured question',range:{min:10,max:16},fixedMarks:null,checkoutMarks:14,binding:{formRevision:h('f'),fields:structuredFields},classification:{sha256:h('1'),requirementsRef:'synthetic-profile@1',payload:s1}},
  {id:'q2',entryId:'structured:SYN-02',kind:'specification',identity:{moduleId:'synthetic-module',kind:'structured',itemId:'SYN-02',release:'1'},title:'Synthetic authored question',range:{min:8,max:14},fixedMarks:null,checkoutMarks:12,binding:{formRevision:h('a'),fields:[structuredFields[0]]},classification:null,
   preview:{subquestions:{min:3,max:4},outline:[{summary:'Recall a synthetic idea',bloom:'Remember',marks:{min:2,max:2}},{summary:'Use a synthetic relationship',bloom:'Apply',marks:{min:3,max:6}},{summary:'Compare two synthetic cases',bloom:'Analyse'}]}},
  {id:'q3',entryId:'mcq:SYN-MCQ-01',kind:'multiple-choice',identity:{moduleId:'synthetic-module',kind:'multiple_choice',itemId:'SYN-MCQ-01',release:'1'},title:'Synthetic option item',range:{min:2,max:2},fixedMarks:2,checkoutMarks:2,binding:{formRevision:h('f'),fields:mcqFields},classification:{sha256:h('2'),requirementsRef:'synthetic-profile@1',payload:m1}},
  {id:'q4',entryId:'mcq:SYN-MCQ-01',kind:'multiple-choice',identity:{moduleId:'synthetic-module',kind:'multiple_choice',itemId:'SYN-MCQ-01',release:'1'},title:'Synthetic option item',range:{min:2,max:2},fixedMarks:2,checkoutMarks:2,binding:{formRevision:h('f'),fields:mcqFields},classification:{sha256:h('2'),requirementsRef:'synthetic-profile@1',payload:m1}},
 ];
 const form={schemaVersion:2 as const,revision:h('d'),items:lines.map(l=>({id:l.id,title:l.title,marks:l.checkoutMarks,fields:l.binding.fields})),paperFields:[choice('occasion','Synthetic paper setting',[['x','Option X'],['y','Option Y']],true,false)]};
 return readDefinitions({schema:'reviseit/configured-authored-inputs@1',module:'synthetic-module',release:'1',formRevision:h('d'),lines,requirements:{'synthetic-profile@1':{sha256:h('7'),payload:profile}}},form,h('9'));
}
export const previewConfiguration:Configuration={schemaVersion:1,targets:{paper:30,sections:{multiple_choice:4}},lines:{q1:{marks:14,parts:null,facets:{}},q2:{marks:12,parts:null,facets:{}},q3:{marks:2,parts:null,facets:{}},q4:{marks:2,parts:null,facets:{}}},answers:{items:{},paper:{}}};
