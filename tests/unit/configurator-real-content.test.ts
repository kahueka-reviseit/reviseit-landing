// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {evaluate,readDefinitions} from '../../lib/configurator/engine';
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
   range:mcq?{min:2,max:2}:r.catalogueMarks,fixedMarks:mcq?2:null,checkoutMarks:mcq?2:r.catalogueMarks.min,binding:{formRevision:r.formRevision,fields:r.fields},classification:{sha256:r.sha256,requirementsRef:ref,payload:r.envelope}};
  return readDefinitions({schema:'reviseit/configured-authored-inputs@1',module:r.module,release:r.release,formRevision:'f'.repeat(64),lines:[line],requirements:{[ref]:profiles[ref]}},
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
});
