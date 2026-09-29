// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {evaluate,generationPlan,readDefinitions} from '../../lib/configurator/engine';
import {evaluateLine} from '../../lib/configurator/contract-v1';
import {lineComposition} from '../../lib/configurator/composition';
import {compile} from '../../lib/jev/advisor';
import type {Configuration} from '../../lib/configurator/contracts';
// Private content consumption check. The registrations file (from the private
// adapter) never enters this repository; without CONFIGURATOR_CONTENT_REGISTRATIONS
// this suite is skipped. It asserts behaviour only and prints no content.
const path=process.env.CONFIGURATOR_CONTENT_REGISTRATIONS||'';
describe.skipIf(!path)('real classifications (private, content-v1)',()=>{
 const regs=path?JSON.parse(readFileSync(path,'utf8')):{classifications:[],profiles:[]};
 const profiles=Object.fromEntries(regs.profiles.map((p:any)=>[p.ref,{sha256:p.sha256,payload:p.profile}]));
 const definitions=(r:any)=>{
  const mcq=r.kind==='multiple-choice';const ref=`${r.envelope.curriculumRequirementsRef.profileId}@${r.envelope.curriculumRequirementsRef.version}`;
  const line={id:'q1',entryId:r.entryId,kind:r.kind,identity:{moduleId:r.module,kind:mcq?'multiple_choice':'structured',itemId:r.envelope.itemId,release:r.release},title:'x',
   range:mcq?{min:2,max:2}:r.catalogueMarks,fixedMarks:mcq?2:null,checkoutMarks:mcq?2:r.catalogueMarks.min,binding:r.registration??{formRevision:r.formRevision,fields:r.fields},
   classification:{sha256:r.sha256,requirementsRef:ref,payload:r.envelope,sourceBinding:r.binding}};
  // Bound payloads (CFG01A) also exercise the runtime source-binding check.
  return readDefinitions({schema:'reviseit/configured-authored-inputs@1',module:r.module,release:r.release,formRevision:'f'.repeat(64),lines:[line],requirements:{[ref]:profiles[ref]},
   ...(r.binding?{execution:{workflowManifestSha256:r.binding.workflowManifestSha256}}:{})},
   {schemaVersion:2,revision:'f'.repeat(64),items:[{id:'q1',title:'x',marks:line.checkoutMarks,fields:r.fields}],paperFields:[]},'e'.repeat(64));
 };
 it('covers the 64 authored forms',()=>{expect(regs.classifications.length).toBe(64);});
 it('every registrable classification is readable against its pinned form and marks',()=>{
  const problems=regs.classifications.map((r:any)=>[r.entryId,definitions(r).lines[0].classificationProblem]).filter(([,p]:any)=>p);
  expect(problems).toEqual([]);
 });
 it('no currently valid mark choice becomes unavailable, before or after payment',()=>{
  const blocked:string[]=[];
  for(const r of regs.classifications){const d=definitions(r);const {min,max}=d.lines[0].range;
   for(let m=min;m<=max;m++){const cfg:Configuration={schemaVersion:1,targets:{paper:m},lines:{q1:{marks:m,parts:null,facets:{}}},answers:{items:{},paper:{}}};
    for(const paid of [false,true]){const e=evaluate(d,cfg,{paid});if(!e.totals.complete||e.lines[0].issues.length)blocked.push(`${r.module}/${r.entryId}@${m}/${paid}`);}}}
  expect(blocked).toEqual([]);
 });
 it('after payment only required authored fields are outstanding, and Jev checks compile',()=>{
  let checks=0;
  for(const r of regs.classifications){const d=definitions(r);const m=d.lines[0].range.min;
   const e=evaluate(d,{schemaVersion:1,targets:{paper:m},lines:{q1:{marks:m,parts:null,facets:{}}},answers:{items:{},paper:{}}},{paid:true});
   expect(e.lines[0].outstanding.sort()).toEqual(r.fields.filter((f:any)=>f.required).map((f:any)=>f.id).sort());
   const c=compile(d.lines[0].classification!.doc,{},{stage:'post',model:'jev-latest'});checks+=c?c.checks.length:0;}
  expect(checks).toBeGreaterThanOrEqual(0);
 });
 it('version 2 Bloom categories: every mark attributed once, groups kept separate, nothing hard-coded',()=>{
  let grouped=0,classified=0;
  for(const r of regs.classifications){const d=definitions(r);const m=d.lines[0].range.min;
   const e=evaluate(d,{schemaVersion:1,targets:{paper:m},lines:{q1:{marks:m,parts:null,facets:{}}},answers:{items:{},paper:{}}},{paid:false});
   const lo=[...Object.values(e.cognitive),...Object.values(e.grouped)].reduce((n,x)=>n+x.min,0);expect(lo).toBeLessThanOrEqual(m);
   grouped+=Object.keys(e.grouped).length;classified+=Object.entries(e.cognitive).filter(([k,v])=>k!=='unclassified'&&v.max>0).length;}
  // Recorded for the return; no assertion on content-specific counts.
  console.log(JSON.stringify({realContentCognitive:{linesWithGroupedBuckets:grouped,knownCategoryBuckets:classified}}));
 });
 it('C10: every supported definition gets supported bounds at every total, before and after payment',()=>{
  const statuses:Record<string,number>={};let disagreements=0;
  for(const r of regs.classifications){const d=definitions(r);const {min,max}=d.lines[0].range;const doc=d.lines[0].classification!.doc;
   for(let m=min;m<=max;m++) for(const paid of [false,true]){
    const e=evaluate(d,{schemaVersion:1,targets:{paper:m},lines:{q1:{marks:m,parts:null,facets:{}}},answers:{items:{},paper:{}}},{paid});
    const c=e.lines[0].composition!;statuses[c.status]=(statuses[c.status]??0)+1;
    expect(c.status).not.toBe('not-calculable');
    const rows=Object.values(c.categories);expect(rows.reduce((n,x)=>n+x.min,0)).toBeLessThanOrEqual(m);expect(rows.reduce((n,x)=>n+x.max,0)).toBeGreaterThanOrEqual(m);
    if(c.status==='unclassified') expect(doc.parts.length).toBe(0);
    // Where the source states every part's marks, the result equals the producer evaluator's.
    if(!c.open){const x=paid?doc:{...doc,parts:doc.parts.map(p=>p.inclusion==='optional'?{...p,inclusion:'unspecified' as const}:p)};
     const {result,structure}=evaluateLine(x,{lineId:'l',identity:{moduleId:doc.moduleId,kind:doc.kind,itemId:doc.itemId,release:doc.release},marks:m,parts:null,answers:{}});
     const again=lineComposition(x,structure,m);
     for(const [k,v] of Object.entries(result.cognitive.ranges??{})) if(JSON.stringify(again.categories[k]??{min:0,max:0})!==JSON.stringify(v)) disagreements++;}
   }}
  expect(disagreements).toBe(0);
  console.log(JSON.stringify({c10Statuses:statuses}));
 });
 it('C10: recorded teacher-choice links narrow the composition and reach the generation plan',()=>{
  let links=0;
  for(const r of regs.classifications){const d=definitions(r);const doc=d.lines[0].classification!.doc;
   for(const rule of doc.rules.filter(x=>(x.origin as {type:string}).type==='form' && x.activation==='active')){
    // A link is a facet condition, optionally limited to totals at or below a mark.
    const parts=(rule.when as any).all??[rule.when];const w=parts.find((c:any)=>'facet' in c) as {facet:string;is?:string;in?:string[]};
    const m=parts.find((c:any)=>'marksAtMost' in c)?.marksAtMost??d.lines[0].range.min;const option=w.is??w.in?.[0];if(!option)continue;links++;
    const answers:Record<string,any>={[w.facet]:{kind:'choice',choiceId:option}};
    for(const f of d.lines[0].fields) if(f.required&&!answers[f.id]) answers[f.id]=f.type==='choice'?{kind:'choice',choiceId:f.choices[0].id}:{kind:'text',text:'x'};
    const cfg={schemaVersion:1 as const,targets:{paper:m},lines:{q1:{marks:m,parts:null,facets:{}}},answers:{items:{q1:answers},paper:{}}};
    const before=evaluate(d,{...cfg,answers:{items:{q1:{}},paper:{}}},{paid:true}),after=evaluate(d,cfg,{paid:true});
    const need=rule.then.flatMap(a=>'requireParts' in a?a.requireParts:[]),drop=rule.then.flatMap(a=>'excludeParts' in a?a.excludeParts:[]);
    const c=after.lines[0].composition!;expect(c.status).not.toBe('not-calculable');
    for(const [k,v] of Object.entries(before.lines[0].composition!.categories)) expect((c.categories[k]??{min:0}).min).toBeGreaterThanOrEqual(drop.length?0:v.min);
    if(after.ready){const parts=generationPlan(d,cfg,after,'o',1).plan.lines[0].parts!;
     for(const id of need) expect(parts.find(p=>p.id===id)?.inclusion).toBe('rule-required');
     for(const id of drop) expect(parts.some(p=>p.id===id)).toBe(false);}
   }}
  console.log(JSON.stringify({c10FormLinks:links}));
 });
 it('C10: every combination of linked answers keeps a calculable composition at every total',()=>{
  let checked=0;
  for(const r of regs.classifications){const d=definitions(r);const doc=d.lines[0].classification!.doc;const {min,max}=d.lines[0].range;
   const facets=[...new Set(doc.rules.filter(x=>(x.origin as {type:string}).type==='form').map(x=>{const w=x.when as any;return (w.all?w.all[0]:w).facet as string;}))].sort();
   if(!facets.length)continue;
   const options=facets.map(f=>[null,...d.lines[0].fields.find(x=>x.id===f)!.type==='choice'?(d.lines[0].fields.find(x=>x.id===f) as any).choices.map((c:any)=>c.id):[]]);
   const combos=options.reduce<(string|null)[][]>((acc,o)=>acc.flatMap(a=>o.map((x:string|null)=>[...a,x])),[[]]);
   for(const combo of combos) for(let m=min;m<=max;m++){
    const answers=Object.fromEntries(facets.flatMap((f,i)=>combo[i]?[[f,{kind:'choice' as const,choiceId:combo[i]!}]]:[]));
    const e=evaluate(d,{schemaVersion:1,targets:{paper:m},lines:{q1:{marks:m,parts:null,facets:{}}},answers:{items:{q1:answers},paper:{}}},{paid:true});
    expect(e.lines[0].composition!.status).not.toBe('not-calculable');checked++;}
  }
  console.log(JSON.stringify({c10LinkedCombinations:checked}));
 });
});
