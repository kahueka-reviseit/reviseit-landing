// @vitest-environment node
import {readFileSync,existsSync} from 'node:fs';
import {test,expect,describe} from 'vitest';
import {interpretClassification,evaluateClassified} from '../../lib/configurator/classification';
// Private candidate input is supplied locally; no question source or paid form is
// committed to the application. These regressions exercise the actual evaluator.
const path=process.env.G11Q_CANDIDATE??'';
const available=!!path&&existsSync(path);
const rows=available?JSON.parse(readFileSync(path,'utf8')).classifications:[];
describe.skipIf(!available)('source restrictions remain consistent through configuration',()=>{
 for(const [id,part,count] of [['P2-CHEM-01','p6',5],['P1-WAVE-01','p4',4]] as const){
  test(id+' omits forbidden content at every purchased total and answer choice',()=>{
   const row=rows.find((r:any)=>r.module==='caps-grade-11-physical-sciences'&&r.entryId==='structured:'+id);
   const item=interpretClassification(row.envelope,row.fields,{range:row.catalogueMarks,fixedMarks:null,formRevision:row.formRevision,kind:'structured'});
   const answers=Object.fromEntries(row.fields.map((f:any)=>[f.id,f.allowAutomatic?{kind:'automatic'}:f.required?(f.type==='choice'?{kind:'choice',choiceId:f.choices[0].id}:{kind:'text',text:'Synthetic'}):{kind:'omit'}]));
   const sets=[answers,...row.fields.flatMap((f:any)=>(f.choices??[]).map((c:any)=>({...answers,[f.id]:{kind:'choice',choiceId:c.id}})))];
   for(let marks=row.catalogueMarks.min;marks<=row.catalogueMarks.max;marks++) for(const chosen of sets){
    const result=evaluateClassified(item,{marks,parts:null,facets:{}},marks,chosen,{paid:true});
    expect(result.feasible).toBe(true);
    expect(result.attention).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.parts.find(p=>p.id===part)?.possible).toBe(false);
    expect(result.parts.find(p=>p.id===part)?.included).toBe(false);
    expect(result.composition.parts[part]).toBe('excluded');
    expect(result.plannedParts.some(p=>p.id===part)).toBe(false);
    expect(result.plannedParts).toHaveLength(count);
    expect(result.composition.status).not.toBe('not-calculable');
    const unpaid=evaluateClassified(item,{marks,parts:null,facets:{}},marks,{}, {paid:false});
    expect(unpaid.composition.parts[part]).toBe('excluded');
   }
   const marks=row.catalogueMarks.min;
   const invalid=evaluateClassified(item,{marks,parts:[part],facets:{}},marks,answers,{paid:true});
   expect(invalid.issues.length+invalid.attention.length).toBeGreaterThan(0);
  });
 }
 test('the restricted acid-base calculation has no pH promise in its part summary',()=>{
  const row=rows.find((r:any)=>r.module==='caps-grade-11-physical-sciences'&&r.entryId==='structured:P2-CHEM-02');
  expect(row.envelope.parts.find((p:any)=>p.label==='X.4').summary).toBe('Calculate concentration or neutralisation volume');
 });
});
