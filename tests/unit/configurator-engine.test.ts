// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {evaluate,generationPlan,project,readDefinitions,submittedAnswers,storedEvaluation} from '../../lib/configurator/engine';
import {isConfiguration,type Configuration} from '../../lib/configurator/contracts';
import type {QuestionField} from '../../lib/jobs/questionnaire';
// Synthetic, deliberately non-scientific definitions. No private source text.
const hash=(c:string)=>c.repeat(64);
const choice=(id:string,required=true,allowAutomatic=true):QuestionField=>({id,label:'Synthetic '+id,hint:'',required,allowAutomatic,type:'choice',allowOther:false,choices:[{id:'red',label:'Red'},{id:'blue',label:'Blue'}]});
const note:QuestionField={id:'note',label:'Synthetic note',hint:'',required:false,allowAutomatic:false,type:'text',maxLength:200};
const part=(id:string,bloom:string|null,min:number,max:number,inclusion='required',band:string|null='B1')=>({id,label:id,summary:'Synthetic part '+id,inclusion,locator:null,
 marks:{basis:'range',min,max},cognitive:{bloom,unknownReason:bloom?null:'synthetic-unclassified',curriculumBand:band,curriculumBandCandidates:[],sourceLabels:{band:null,bloom:null}}});
function classification(itemId:string,fields:QuestionField[],over:Record<string,unknown>={}){
 return {schemaVersion:1,moduleId:'synthetic-module',kind:'structured',itemId,release:'1',title:'Synthetic '+itemId,curriculumId:'synthetic-curriculum',
  curriculumRequirementsRef:{profileId:'synthetic-profile',version:1},marks:{mode:'range',min:6,max:12},
  parts:[part('p1','remember',2,2),part('p2','apply',2,4),part('p3',null,2,4,'required','B2'),part('p4','create',2,2,'optional','B2')],
  facets:[{id:'marks',type:'integer',stage:'pre',required:true,delegable:false,allowCustom:false,prompt:null,binding:{scope:'line-marks'},domain:{min:6,max:12}},
   {id:'parts',type:'parts',stage:'post',required:false,delegable:false,allowCustom:false,prompt:null,binding:{scope:'line-parts'},domain:{parts:['p4']}},
   ...fields.map(f=>f.type==='choice'?{id:f.id,type:'choice',stage:'post',required:f.required,delegable:f.allowAutomatic,allowCustom:f.allowOther,prompt:null,binding:{scope:'item-form',fieldId:f.id},domain:{options:f.choices}}:
    {id:f.id,type:'text',stage:'post',required:f.required,delegable:f.allowAutomatic,allowCustom:true,prompt:null,binding:{scope:'item-form',fieldId:f.id},domain:{maxLength:f.maxLength}})],
  rules:[{id:'r1',kind:'constraint',activation:'active',when:{facet:'colour',is:'blue'},then:[{excludeOptions:{facet:'shade',options:['red']}}],reason:'hint.blue',origin:{type:'synthetic',locators:[],heldBecause:null}},
   {id:'r2',kind:'constraint',activation:'active',when:{partSelected:'p4'},then:[{requireOption:{facet:'shade',option:'blue'}}],reason:'hint.p4',origin:{type:'synthetic',locators:[],heldBecause:null}}],
  diagramPolicy:{stimulus:'optional',stimulusFacet:null,learnerDrawnParts:['p2'],whenLeftOut:null,locators:[]},
  formBinding:{status:'bound',itemForm:{schema:'reviseit/authored-form@1',path:'forms/x.json',formRevision:hash('f'),fileSha256:hash('e'),acceptedSnapshotFileSha256:null,privateKind:'specification',fieldCount:fields.length,authoredStatus:'authored-ready',jointItemIds:[],unresolvedCount:0},
   fieldMap:fields.map(f=>({facetId:f.id,fieldId:f.id})),sharedForms:[]},
  provenance:{synthetic:true,sources:[],extractor:{name:'synthetic',version:'1'},labelNormalisations:[],requirementsProfileSha256:null},
  jevChecks:[],hints:{'hint.blue':'Synthetic: blue rules out red here.','hint.p4':'Synthetic: the fourth part needs blue.'},coverage:{status:'partial',gaps:[{code:'synthetic',detail:'Synthetic fixture',locator:null}]},...over};
}
const profile={profileId:'synthetic-profile',version:1,curriculumId:'synthetic-curriculum',bands:[{id:'B1',label:'Band one'},{id:'B2',label:'Band two'}],
 distributions:[{id:'bands',taxonomy:'curriculum-band',basis:'marks',targets:[{key:'B1',percent:60},{key:'B2',percent:40}]},{id:'counted',taxonomy:'curriculum-band',basis:'item-count',targets:[{key:'B1',percent:null}]}]};
const classifiedFields=[choice('colour'),choice('shade'),note];
function definitions(opts:{classified?:boolean;repeat?:boolean;badMap?:boolean}={}){
 const lines=[
  {id:'q1',entryId:'structured:S1',kind:'specification',identity:{moduleId:'synthetic-module',kind:'structured',itemId:'S1',release:'1'},title:'Synthetic one',range:{min:6,max:12},fixedMarks:null,checkoutMarks:8,
   binding:{formRevision:hash('f'),fields:classifiedFields},classification:opts.classified?{sha256:hash('c'),requirementsRef:'synthetic-profile@1',payload:classification('S1',opts.badMap?[choice('colour')]:classifiedFields)}:null},
  {id:'q2',entryId:'structured:S2',kind:'specification',identity:{moduleId:'synthetic-module',kind:'structured',itemId:'S2',release:'1'},title:'Synthetic two',range:{min:4,max:10},fixedMarks:null,checkoutMarks:6,
   binding:{formRevision:hash('a'),fields:[choice('setting',true,false)]},classification:null},
  {id:'q3',entryId:'mcq:M1',kind:'multiple-choice',identity:{moduleId:'synthetic-module',kind:'multiple_choice',itemId:'M1',release:'1'},title:'Synthetic choice',range:{min:2,max:2},fixedMarks:2,checkoutMarks:2,binding:{formRevision:hash('b'),fields:[]},classification:null},
  ...(opts.repeat?[{id:'q4',entryId:'mcq:M1',kind:'multiple-choice',identity:{moduleId:'synthetic-module',kind:'multiple_choice',itemId:'M1',release:'1'},title:'Synthetic choice',range:{min:2,max:2},fixedMarks:2,checkoutMarks:2,binding:{formRevision:hash('b'),fields:[]},classification:null}]:[]),
 ];
 const form={schemaVersion:2,revision:hash('d'),items:lines.map(l=>({id:l.id,title:l.title,marks:l.checkoutMarks,fields:l.binding.fields})),paperFields:[choice('logistics',true,false),{...note,id:'paper_note'}]};
 const snapshot={schema:'reviseit/configured-authored-inputs@1',module:'synthetic-module',release:'1',formRevision:hash('d'),lines,requirements:opts.classified?{'synthetic-profile@1':{sha256:hash('7'),payload:profile}}:{}};
 return readDefinitions(snapshot,form,hash('9'));
}
function config(marks:(number|null)[],target:number|null=16,extra:Partial<Configuration>={}):Configuration{
 const ids=['q1','q2','q3','q4'].slice(0,marks.length);
 return {schemaVersion:1,targets:{paper:target},lines:Object.fromEntries(ids.map((id,i)=>[id,{marks:marks[i],parts:null,facets:{}}])),answers:{items:{},paper:{}},...extra};
}
const paidAnswers=(over:Record<string,any>={})=>({items:{q1:{colour:{kind:'choice' as const,choiceId:'red'},shade:{kind:'automatic' as const}},q2:{setting:{kind:'choice' as const,choiceId:'blue'}},q3:{},...over},paper:{logistics:{kind:'choice' as const,choiceId:'red'}}});

describe('marks, totals and readiness',()=>{
 it('asks for marks early and never assigns them',()=>{
  const d=definitions();const e=evaluate(d,config([null,6,null]),{paid:false});
  expect(e.status).toBe('marks_needed');expect(e.lines[0].marksProblem).toBe('Set the marks for this question.');
  expect(e.lines[2].marks).toBe(2);expect(e.totals.allocated).toBe(8);
 });
 it('shows remaining and excess marks and keeps an imbalanced draft as a draft',()=>{
  const d=definitions();
  expect(evaluate(d,config([8,5,2]),{paid:false}).totals.problems).toEqual(['1 marks still to allocate.']);
  expect(evaluate(d,config([9,6,2]),{paid:false}).totals.problems).toEqual(['1 marks over the paper total.']);
  expect(evaluate(d,config([8,6,2]),{paid:false}).status).toBe('ready_for_payment');
  expect(evaluate(d,config([8,6,2],16,{targets:{paper:16,sections:{structured:13}}}),{paid:false}).totals.problems).toEqual(['Structured section: 14 of 13 marks.']);
 });
 it('refuses out-of-range and changed fixed marks',()=>{
  const d=definitions();
  expect(evaluate(d,config([13,1,2],16),{paid:false}).lines.map(l=>l.marksProblem)).toEqual(['Choose between 6 and 12 marks.','Choose between 4 and 10 marks.',null]);
  expect(evaluate(d,config([8,5,3]),{paid:false}).lines[2].marksProblem).toBe('This question type is fixed at 2 marks.');
 });
 it('redistributes marks across purchased questions without other changes',()=>{
  const d=definitions();const before=evaluate(d,config([8,6,2]),{paid:false}),after=evaluate(d,config([10,4,2]),{paid:false});
  expect([before.status,after.status]).toEqual(['ready_for_payment','ready_for_payment']);expect(after.totals.allocated).toBe(16);
 });
});

describe('authored decisions after payment',()=>{
 it('counts only required unresolved decisions; optional blanks stay valid',()=>{
  const d=definitions();
  const partial=evaluate(d,config([8,6,2],16,{answers:{items:{q1:{colour:{kind:'choice',choiceId:'red'}}},paper:{}}}),{paid:true});
  expect(partial.status).toBe('details_to_complete');expect(partial.lines[0].outstanding).toEqual(['shade']);expect(partial.lines[1].outstanding).toEqual(['setting']);
  expect(partial.paper.outstanding).toEqual(['logistics']);
  const done=evaluate(d,config([8,6,2],16,{answers:paidAnswers()}),{paid:true});
  expect(done.status).toBe('ready_to_generate');expect(done.ready).toBe(true);
 });
 it('keeps an answer that no longer fits and asks for attention instead of deleting it',()=>{
  const d=definitions();const cfg=config([8,6,2],16,{answers:paidAnswers({q2:{setting:{kind:'automatic'}}})});
  const e=evaluate(d,cfg,{paid:true});
  expect(e.status).toBe('details_to_complete');expect(e.lines[1].attention[0]).toMatchObject({scope:'field',id:'setting'});
  expect(cfg.answers.items.q2.setting).toEqual({kind:'automatic'});
 });
 it('submits exact answers with explicit omissions and a plan carrying the final marks',()=>{
  const d=definitions();const cfg=config([10,4,2],16,{answers:paidAnswers()});const e=evaluate(d,cfg,{paid:true});
  expect(submittedAnswers(d,cfg).items.q1.note).toEqual({kind:'omit'});expect(submittedAnswers(d,cfg).paper.paper_note).toEqual({kind:'omit'});
  const {plan}=generationPlan(d,cfg,e,'00000000-0000-4000-8000-000000000001',7);
  expect(plan).toMatchObject({schema:'reviseit/configured-generation-plan@1',configurationRevision:7,definitionsSha256:hash('9'),targets:{paper:16}});
  expect(plan.lines.map(l=>[l.id,l.marks,l.kind])).toEqual([['q1',10,'specification'],['q2',4,'specification'],['q3',2,'multiple-choice']]);
  expect(()=>generationPlan(d,config([8,6,2]),evaluate(d,config([8,6,2]),{paid:true}),'x',1)).toThrow(/not ready/);
 });
 it('isolates repeated occurrences of the same item by line',()=>{
  const d=definitions({repeat:true});
  const cfg=config([8,4,2,2],16,{answers:{...paidAnswers(),items:{...paidAnswers().items,q4:{}}}});
  const e=evaluate(d,cfg,{paid:true});expect(e.ready).toBe(true);
  expect(project(d,cfg,e,{orderId:'o',state:'awaiting_answers',paymentStatus:'paid',revision:1,submitted:false}).lines.map(l=>[l.id,l.number])).toEqual([['q1','2'],['q2','3'],['q3','1.1'],['q4','1.2']]);
  const bad={...cfg,answers:{...cfg.answers,items:{...cfg.answers.items,q4:{colour:{kind:'choice' as const,choiceId:'red'}}}}};
  expect(evaluate(d,bad,{paid:true}).lines[3].attention[0]).toMatchObject({id:'colour'});
 });
});

describe('classified questions (contract v1, synthetic)',()=>{
 it('attributes marks once across all six Bloom categories plus explicit unknowns',()=>{
  const d=definitions({classified:true});const e=evaluate(d,config([8,6,2]),{paid:false});
  expect(Object.keys(e.cognitive).sort()).toEqual(['analyse','apply','create','evaluate','remember','understand','unclassified'].sort());
  // Parts p1..p3 are required (2 + 2..4 + 2..4); 8 marks leaves p2+p3 = 6.
  expect(e.cognitive.remember).toEqual({min:2,max:2});expect(e.cognitive.apply).toEqual({min:2,max:4});
  // Unknown Bloom stays unclassified and the unclassified structured and MCQ lines add their whole marks.
  expect(e.cognitive.unclassified).toEqual({min:2+8,max:4+8});
  const sumMin=Object.values(e.cognitive).reduce((n,r)=>n+r.min,0),sumMax=Object.values(e.cognitive).reduce((n,r)=>n+r.max,0);
  expect(sumMin).toBeLessThanOrEqual(16);expect(sumMax).toBeGreaterThanOrEqual(16);
  expect(e.cognitive.evaluate).toEqual({min:0,max:0});
 });
 it('refuses marks no permitted part combination can reach, before and after payment',()=>{
  const d=definitions({classified:true});
  // 12 is reachable only with the optional fourth part: possible before payment, not after unless selected.
  expect(evaluate(d,config([12,2,2],16),{paid:false}).lines[0].marksProblem).toBeNull();
  const paid=evaluate(d,config([12,2,2],16,{answers:paidAnswers()}),{paid:true});
  expect(paid.status).toBe('marks_needed');expect(paid.lines[0].attention.some(a=>a.scope==='marks')).toBe(true);
  const withPart={...config([12,2,2],16,{answers:paidAnswers({q1:{colour:{kind:'choice',choiceId:'red'},shade:{kind:'choice',choiceId:'blue'}}})})};
  withPart.lines.q1.parts=['p4'];
  const e=evaluate(d,withPart,{paid:true});expect(e.lines[0].classified!.feasible).toBe(true);expect(e.cognitive.create).toEqual({min:2,max:2});
 });
 it('reports rule effects with authored wording, keeps excluded answers and never auto-edits',()=>{
  const d=definitions({classified:true});
  const cfg=config([8,6,2],16,{answers:paidAnswers({q1:{colour:{kind:'choice',choiceId:'blue'},shade:{kind:'choice',choiceId:'red'}}})});
  const e=evaluate(d,cfg,{paid:true});
  expect(e.lines[0].attention).toEqual([{scope:'field',id:'shade',message:'Synthetic: blue rules out red here.'}]);
  expect(cfg.answers.items.q1.shade).toEqual({kind:'choice',choiceId:'red'});expect(e.ready).toBe(false);
  const view=project(d,cfg,e,{orderId:'o',state:'awaiting_answers',paymentStatus:'paid',revision:3,submitted:false});
  expect(view.lines[0].facets.find(f=>f.id==='shade')!.options.find(o=>o.id==='red')).toMatchObject({disabled:true,reason:'Synthetic: blue rules out red here.'});
 });
 it('compares curriculum bands separately from Bloom, and item-count targets are not compared by marks',()=>{
  const d=definitions({classified:true});const cfg=config([8,6,2],16,{answers:paidAnswers()});
  const view=project(d,cfg,evaluate(d,cfg,{paid:true}),{orderId:'o',state:'awaiting_answers',paymentStatus:'paid',revision:1,submitted:false});
  expect(view.curriculum.map(c=>c.note)).toEqual(['Some marks are not yet classified, so this comparison is incomplete.','This requirement is not measured in marks, so it is not compared here.']);
  expect(view.curriculum[0].rows.map(r=>[r.label,r.target])).toEqual([['Band one','60%'],['Band two','40%']]);
  expect(view.cognitive.map(r=>r.label)).toEqual(['Remember','Understand','Apply','Analyse','Evaluate','Create','Not yet classified']);
 });
 it('a classification that does not match the pinned form is reported, and other lines keep working',()=>{
  const d=definitions({classified:true,badMap:true});
  expect(d.lines[0].classification).toBeNull();expect(d.lines[0].classificationProblem).toMatch(/field map/);
  const e=evaluate(d,config([8,6,2],16,{answers:paidAnswers()}),{paid:true});
  expect(e.lines[0].issues.length).toBe(1);expect(e.lines[1].ready).toBe(true);expect(e.lines[2].ready).toBe(true);
 });
});

describe('safe projection',()=>{
 it('before payment exposes marks and totals only',()=>{
  const d=definitions({classified:true});const cfg=config([8,6,2]);
  const view=project(d,cfg,evaluate(d,cfg,{paid:false}),{orderId:'o',state:'awaiting_payment',paymentStatus:'open',revision:1,submitted:false});
  const text=JSON.stringify(view);
  for(const secret of ['Synthetic part','hint.','r1','r2','Synthetic: ','Synthetic colour','formRevision',hash('f'),'synthetic-profile'])expect(text).not.toContain(secret);
  expect(view.lines.every(l=>l.fields.length===0 && l.parts.length===0 && l.facets.length===0)).toBe(true);
  expect(view).toMatchObject({status:'ready_for_payment',statusLabel:'Ready for payment',canSubmit:false,totals:{target:16,allocated:16,remaining:0,excess:0}});
 });
 it('the stored verdict is compact and bound to the definitions',()=>{
  const d=definitions();const e=evaluate(d,config([8,6,2]),{paid:false});
  expect(storedEvaluation(e)).toEqual({engine:'cfg01-engine@1',definitionsSha256:hash('9'),ready:false,status:'ready_for_payment',outstanding:0,totals:{allocated:16,target:16},lines:[{id:'q1',marks:8,ready:true},{id:'q2',marks:6,ready:true},{id:'q3',marks:2,ready:true}]});
 });
 it('accepts only the closed configuration shape from a browser',()=>{
  expect(isConfiguration(config([8,6,2]))).toBe(true);
  expect(isConfiguration({...config([8,6,2]),extra:1})).toBe(false);
  expect(isConfiguration({...config([8,6,2]),lines:{q1:{marks:8,parts:null,facets:{},rules:[]}}})).toBe(false);
  expect(isConfiguration({...config([8,6,2]),answers:{items:{other:{}},paper:{}}})).toBe(false);
  expect(isConfiguration({...config([8.5,6,2])})).toBe(false);
 });
});
