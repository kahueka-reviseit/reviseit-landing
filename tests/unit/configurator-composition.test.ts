// @vitest-environment node
// C10: cognitive composition from supported facts. Synthetic, deliberately non-scientific definitions.
import {describe,it,expect} from 'vitest';
import {evaluate,generationPlan,project} from '../../lib/configurator/engine';
import {evaluateLine} from '../../lib/configurator/contract-v1';
import {lineComposition} from '../../lib/configurator/composition';
import {brute,ch,closed,closedItem,config,definitions,example,exampleItem,legacy,legacyItem,mcq,noPartsItem,open,openItem,variant,variantItem} from '../fixtures/composition';
import type {Classification} from '../../lib/configurator/contract-v1';

const meta={orderId:'o',state:'awaiting_answers',paymentStatus:'paid',revision:1,submitted:false};
const r=(min:number,max=min)=>({min,max});

describe('source to choice to aggregate',()=>{
 it('a question with example marks shows supported bounds over its listed subquestions, never all marks as unclassified',()=>{
  const d=definitions([example]);const e=evaluate(d,config([10]),{paid:false});
  // Example marks do not make the structure open: no allowance for unlisted subquestions.
  expect(e.cognitive).toMatchObject({remember:r(0,9),apply:r(0,8),analyse:r(0,8),understand:r(0),unclassified:r(0)});
  expect(e.grouped).toEqual({'apply-or-analyse':r(0,8)});
  expect(e.composition).toMatchObject({exact:false,pending:0,known:['analyse','apply','apply-or-analyse','remember']});
 });
 it('teacher choices linked to subquestions raise lower bounds and remove excluded categories',()=>{
  const d=definitions([example]);
  const both=evaluate(d,config([10],{answers:{items:{q1:{statements:ch('both'),comparison:ch('yes')}},paper:{}}}),{paid:true});
  expect(both.cognitive).toMatchObject({remember:r(2,9),analyse:r(1,8),apply:r(0,7),unclassified:r(0)});
  const one=evaluate(d,config([10],{answers:{items:{q1:{statements:ch('one'),comparison:ch('no')}},paper:{}}}),{paid:true});
  // Three listed subquestions remain and the stated count is at least three, so all three stay.
  expect(one.cognitive).toMatchObject({remember:r(1,8),apply:r(1,8),analyse:r(0)});expect(one.composition.known).not.toContain('analyse');
  // Leaving an answer to Revise It records no link, so nothing narrows.
  const auto=evaluate(d,config([10],{answers:{items:{q1:{statements:{kind:'automatic'}}},paper:{}}}),{paid:true});
  expect(auto.cognitive.remember).toEqual(r(0,9));
  const view=project(d,config([10],{answers:{items:{q1:{statements:ch('both'),comparison:ch('yes')}},paper:{}}}),both,meta);
  expect(view.lines[0].parts.filter(p=>p.included).map(p=>[p.id,p.reason])).toEqual([['p1','Synthetic: set by your statement choice.'],['p3','Synthetic: set by your statement choice.'],['p4','Synthetic: included because you asked for the comparison.']]);
  expect(view.lines[0].parts.filter(p=>p.possible).map(p=>[p.id,p.exampleMarks])).toEqual([['p2',r(3)],['p5',r(2)]]);
 });
 it('the paper sums its lines, and generation receives the same parts, inclusion and categories',()=>{
  const d=definitions([mcq,closed,example]);const cfg=config([2,6,10],{answers:{items:{q2:{},q3:{statements:ch('both'),comparison:ch('yes')}},paper:{}}});
  const e=evaluate(d,cfg,{paid:true});
  const lines=e.lines.map(l=>l.composition!.categories);
  for(const k of ['remember','apply','analyse','unclassified']) expect(e.cognitive[k as 'remember']).toEqual(lines.reduce((a,c)=>r(a.min+(c[k]?.min??0),a.max+(c[k]?.max??0)),r(0)));
  expect(e.cognitive.understand).toEqual(r(2));
  const plan=generationPlan(d,cfg,e,'o',1).plan.lines[2].parts!;
  expect(plan.map(p=>[p.label,p.inclusion,p.bloom??p.bloomOptions.join('-or-')])).toEqual([['X.1','rule-required','remember'],['X.2','flexible','apply'],['X.3','rule-required','remember'],['X.4','rule-required','analyse'],['X.5','flexible','apply-or-analyse']]);
  const shown=project(d,cfg,e,meta).lines.find(l=>l.id==='q3')!.parts;
  expect(plan.map(p=>p.id)).toEqual(shown.filter(p=>p.included||p.possible).map(p=>p.id));
 });
});

describe('valid ranges narrow to exact values',()=>{
 it('selecting a total and consequential parts narrows a specified question to an exact split',()=>{
  const d=definitions([closed]);
  const at6=evaluate(d,config([6]),{paid:false});expect(at6.lines[0].composition!.status).toBe('bounded');
  expect(at6.cognitive).toMatchObject({remember:r(2),apply:r(2,4),analyse:r(0,2),unclassified:r(0)});
  const at8=evaluate(d,config([8]),{paid:false});expect(at8.lines[0].composition!.status).toBe('exact');
  expect(at8.cognitive).toMatchObject({remember:r(2),apply:r(4),analyse:r(2)});
  const left=evaluate(d,config([6]),{paid:true});expect(left.cognitive).toMatchObject({apply:r(4),analyse:r(0)});expect(left.composition.exact).toBe(true);
  const chosen=config([6]);chosen.lines.q1.parts=['p3'];
  const withPart=evaluate(d,chosen,{paid:true});expect(withPart.cognitive).toMatchObject({apply:r(2),analyse:r(2)});
  const view=project(d,chosen,withPart,meta);expect(view.composition).toMatchObject({exact:true,settled:6,open:0,unclassified:0,pending:0});
  expect(view.lines[0].composition).toMatchObject({status:'exact'});
 });
 it('specified questions agree with the producer evaluator for every total and part selection',()=>{
  const doc=closedItem() as any;
  for(let m=6;m<=8;m++) for(const parts of [null,[],['p3']]) {
   const {result,structure}=evaluateLine(doc,{lineId:'l',identity:{moduleId:'synthetic-module',kind:'structured',itemId:'CLOSED',release:'1'},marks:m,parts,answers:{}});
   const c=lineComposition(doc,structure,m);
   if(result.cognitive.determinable) for(const [k,v] of Object.entries(result.cognitive.ranges!)) expect(c.categories[k]??r(0)).toEqual(v);
   else expect(c.status).toBe('not-calculable');
  }
 });
});

describe('honest treatment of insufficient information',()=>{
 it('unknown, unclassified and not-yet-calculable marks stay apart, each mark once',()=>{
  const d=definitions([{doc:noPartsItem(),fields:[],range:[10,14]},null,example,closed]);
  const cfg=config([12,6,10,6],{answers:{items:{q3:{statements:ch('not-an-option')}},paper:{}}});
  const e=evaluate(d,cfg,{paid:true});
  expect(e.lines.map(l=>l.composition!.status)).toEqual(['unclassified','unclassified','not-calculable','exact']);
  expect(e.lines[2].composition!.known).toEqual(['analyse','apply','apply-or-analyse','remember']);
  expect(e.composition).toMatchObject({pending:10,pendingLines:[{id:'q3',reason:'invalid-configuration'}]});
  expect(e.cognitive.unclassified).toEqual(r(18));
  const view=project(d,cfg,e,meta);
  expect(view.cognitive.find(x=>x.key==='pending')).toMatchObject({label:'Not yet calculable',min:10,max:10});
  expect(view.composition.notes).toEqual(['Question 3: not yet calculable because one of its choices needs attention.']);
  const rows=view.cognitive;const lo=rows.reduce((n,x)=>n+x.min,0),hi=rows.reduce((n,x)=>n+x.max,0);
  expect([lo,hi]).toEqual([34,34]);
  expect(view.composition.settled+view.composition.open+view.composition.unclassified+view.composition.pending).toBe(34);
 });
 it('an unreadable definition is not calculable rather than unclassified',()=>{
  const d=definitions([example,closed],{badMap:0});const e=evaluate(d,config([10,6]),{paid:true});
  expect(e.composition.pendingLines).toEqual([{id:'q1',reason:'definition-unreadable'}]);expect(e.cognitive.unclassified).toEqual(r(0));
 });
 it('grouped categories stay one bucket, and category extremes are not jointly possible',()=>{
  const e=evaluate(definitions([example]),config([10]),{paid:false});
  expect(e.cognitive.apply.max+e.cognitive.analyse.max+e.grouped['apply-or-analyse'].max).toBeGreaterThan(10);
  expect(Object.keys(e.cognitive)).not.toContain('apply-or-analyse');
 });
 it('source examples are reported separately and never used as bounds',()=>{
  const plain=exampleItem() as any;plain.parts=plain.parts.map((p:any)=>({...p,marks:{basis:'unknown',min:null,max:null}}));
  const withExample=evaluate(definitions([example]),config([10]),{paid:true}), without=evaluate(definitions([{...example,doc:plain}]),config([10]),{paid:true});
  expect(without.cognitive).toEqual(withExample.cognitive);expect(without.lines[0].composition!.examples).toEqual([]);
  const view=project(definitions([example]),config([10]),withExample,meta);
  expect(view.lines[0].composition!.examples).toEqual([{label:'',marks:r(10),parts:5,rows:[{key:'remember',label:'Remember',...r(4)},{key:'apply',label:'Apply',...r(3)},{key:'analyse',label:'Analyse',...r(1)},{key:'apply-or-analyse',label:'Apply or Analyse',...r(2)}]}]);
 });
 it('before payment no question-level composition or part is exposed',()=>{
  const d=definitions([example]);const view=project(d,config([10]),evaluate(d,config([10]),{paid:false}),{...meta,state:'awaiting_payment',paymentStatus:'open'});
  expect(view.lines[0].composition).toBeNull();expect(JSON.stringify(view)).not.toContain('Synthetic part');
 });
});

const asPairs=(c:Record<string,{min:number;max:number}>)=>Object.fromEntries(Object.entries(c).filter(([,v])=>v.max>0).map(([k,v])=>[k,[v.min,v.max]]));

describe('structure: variants, stated counts and genuinely open questions',()=>{
 it('a selected alternative shows its own example, keeps its named tasks and count, and nothing else',()=>{
  const d=definitions([variant]);const cfg=config([9],{answers:{items:{q1:{shape:ch('compressed')}},paper:{}}});
  const e=evaluate(d,cfg,{paid:true});const c=e.lines[0].composition!;
  expect(c.examples).toEqual([{label:'Compressed',parts:3,marks:r(9),categories:{remember:r(2),apply:r(7)}}]);
  expect(e.cognitive).toMatchObject({remember:r(1,7),apply:r(2,8),analyse:r(0),unclassified:r(0)});
  expect(c.alternatives).toEqual(['Compressed']);expect(c.open).toBe(false);
  const plan=generationPlan(d,cfg,e,'o',1).plan.lines[0].parts!;
  expect(plan.map(p=>[p.label,p.inclusion,p.alternative])).toEqual([['X.5','structure-required','Compressed'],['X.6','structure-required','Compressed'],['X.7','structure-required','Compressed']]);
  const view=project(d,cfg,e,meta).lines[0];
  expect(view.parts.filter(p=>p.included).map(p=>p.id)).toEqual(['p5','p6','p7']);expect(view.parts.filter(p=>!p.included&&!p.possible).map(p=>p.id)).toEqual(['p1','p2','p3','p4']);
  expect(view.composition!.examples.map(x=>x.label)).toEqual(['Compressed']);
 });
 it('an unresolved choice is calculated per alternative, never over a mixture, with separate examples',()=>{
  const d=definitions([variant]);const e=evaluate(d,config([12]),{paid:true});const c=e.lines[0].composition!;
  expect(c.alternatives).toEqual(['Full','Compressed']);
  expect(c.examples.map(x=>[x.label,x.parts,x.marks.min])).toEqual([['Full',4,14],['Compressed',3,9]]);
  // Both alternatives contain a remember task and two apply tasks, so those minima hold whichever is written.
  expect(e.cognitive).toMatchObject({remember:r(1,10),apply:r(2,11),analyse:r(0,9),unclassified:r(0,8)});
  expect(c.open).toBe(true);expect(Object.values(c.parts)).toEqual(Array(7).fill('possible'));
  const plan=generationPlan(d,config([12]),e,'o',1).plan.lines[0].parts!;
  expect(plan.map(p=>[p.inclusion,p.alternative])).toEqual([...Array(4).fill(['flexible','Full']),...Array(3).fill(['flexible','Compressed'])]);
 });
 it('a stated count above the listed rows is a genuinely open structure; example marks alone are not',()=>{
  const e=evaluate(definitions([open]),config([10]),{paid:false});const c=e.lines[0].composition!;
  expect(c.open).toBe(true);expect(e.cognitive).toMatchObject({remember:r(0,8),apply:r(0,8),analyse:r(0,8),unclassified:r(0,9)});
  expect(evaluate(definitions([example]),config([10]),{paid:false}).lines[0].composition!.open).toBe(false);
  // The same rows with no allowance above them: the stated minimum needs every row, so each is in, and generation is told so.
  const fixed=openItem() as any;fixed.structure.alternatives[0].additional={min:0,max:0};
  const df=definitions([{...open,doc:fixed}]);const ef=evaluate(df,config([10]),{paid:true});
  expect(Object.values(ef.lines[0].composition!.parts)).toEqual(['included','included','included']);
  expect(generationPlan(df,config([10]),ef,'o',1).plan.lines[0].parts!.map(p=>p.inclusion)).toEqual(Array(3).fill('structure-required'));
 });
 it('a choice that conflicts with the source structure is kept and shown as not calculable, without blocking the paper',()=>{
  const d=definitions([variant]);const cfg=config([9],{answers:{items:{q1:{shape:ch('compressed'),trim:ch('drop')}},paper:{}}});
  const e=evaluate(d,cfg,{paid:true});
  expect(e.lines[0].composition).toMatchObject({status:'not-calculable',reason:'choices-conflict-with-source'});expect(e.lines[0].ready).toBe(true);
  expect(project(d,cfg,e,meta).composition.notes[0]).toMatch(/leave fewer or different subquestions than its specification states/);
  // Without the shape answer the same effect only rules out the compressed alternative.
  const open=evaluate(d,config([12],{answers:{items:{q1:{trim:ch('drop')}},paper:{}}}),{paid:true}).lines[0].composition!;
  expect(open.alternatives).toEqual(['Full']);
 });
 it('bounds equal an independent enumeration of every permitted structure and allocation',()=>{
  const cases:[Classification,number,{must?:string[];out?:string[]},Record<string,any>][]=[
   [variantItem() as any,9,{},{}],[variantItem() as any,12,{},{}],[variantItem() as any,11,{out:['p1','p2','p3','p4']},{shape:ch('compressed')}],
   [(definitions([open]).lines[0].classification!.doc),10,{},{}],[exampleItem() as any,10,{},{}],[exampleItem() as any,9,{must:['p1','p3','p4']},{statements:ch('both'),comparison:ch('yes')}],
   [legacyItem() as any,10,{},{}],[legacyItem() as any,9,{must:['p1','p3','p4']},{statements:ch('both'),comparison:ch('yes')}],[legacyItem() as any,9,{must:['p1'],out:['p3','p4']},{statements:ch('one'),comparison:ch('no')}]];
  for(const [doc,m,opts,answers] of cases){
   const {structure}=evaluateLine(doc,{lineId:'l',identity:{moduleId:doc.moduleId,kind:doc.kind,itemId:doc.itemId,release:doc.release},marks:m,parts:null,answers});
   expect(asPairs(lineComposition(doc,structure,m).categories)).toEqual(brute(doc,m,{...opts,count:structure.countRules}));
  }
 });
});

describe('older definitions without a structure (C10B)',()=>{
 it('do not claim their listed parts are complete: an unresolved allowance, known categories and the example stay visible',()=>{
  const d=definitions([legacy]);const cfg=config([10],{answers:{items:{q1:{statements:ch('both'),comparison:ch('yes')}},paper:{}}});
  const e=evaluate(d,cfg,{paid:true});const c=e.lines[0].composition!;
  expect(c).toMatchObject({coverage:'unknown',open:true,status:'bounded'});
  // Choices still narrow the listed categories; up to two further subquestions (stated count 3 to 5) may carry marks.
  expect(e.cognitive).toMatchObject({remember:r(2,9),analyse:r(1,8),unclassified:r(0,7)});
  expect(c.known).toEqual(['analyse','apply','apply-or-analyse','remember']);expect(c.examples).toHaveLength(1);
  // The same definition with a confirmed structure is closed.
  expect(evaluate(definitions([example]),cfg,{paid:true}).lines[0].composition).toMatchObject({coverage:'complete',open:false});
  const view=project(d,cfg,e,meta);
  expect(view.lines[0].composition!.note).toMatch(/does not say whether others may be written/);
  expect(view.composition.notes).toEqual(['Question 1: its definition does not say whether subquestions beyond those listed may be written, so part of its marks may be not yet classified.']);
 });
 it('never invent required generation parts, and never claim unlisted parts exist',()=>{
  const d=definitions([legacy]);const cfg=config([10],{answers:{items:{q1:{statements:ch('both'),comparison:ch('yes')}},paper:{}}});const e=evaluate(d,cfg,{paid:true});
  expect(e.cognitive.unclassified.min).toBe(0);
  expect(generationPlan(d,cfg,e,'o',1).plan.lines[0].parts!.map(p=>[p.id,p.inclusion])).toEqual([['p1','rule-required'],['p2','flexible'],['p3','rule-required'],['p4','rule-required'],['p5','flexible']]);
 });
 it('keep exact results where every part has source-stated marks, including multiple choice',()=>{
  const d=definitions([mcq,closed]);const cfg=config([2,6]);cfg.lines.q2.parts=['p3'];const e=evaluate(d,cfg,{paid:true});
  expect(e.lines.map(l=>[l.composition!.status,l.composition!.coverage])).toEqual([['exact','complete'],['exact','complete']]);
  expect(e.composition.exact).toBe(true);expect(project(d,cfg,e,meta).composition.notes).toEqual([]);
 });
});
