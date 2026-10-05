// @vitest-environment node
import {readFileSync,existsSync} from 'node:fs';
import {test,expect,describe} from 'vitest';
import {interpretClassification,evaluateClassified} from '../../lib/configurator/classification';
// The application's own evaluation of the corrected Grade 11 circuit definition.
// Reads the private candidate registration package named by G11Q_CANDIDATE (never a
// public fixture); skipped when it is not supplied.
const path=process.env.G11Q_CANDIDATE??'';
const available=!!path && existsSync(path);
describe.skipIf(!available)('P1-CIRC-01 cost rule in the application evaluator',()=>{
  const row=available?JSON.parse(readFileSync(path,'utf8')).classifications.find((r:any)=>r.entryId==='structured:P1-CIRC-01'):null;
  const item=available?interpretClassification(row.envelope,row.fields,{range:row.catalogueMarks,fixedMarks:null,formRevision:row.formRevision,kind:'structured'}):null!;
  const answer=(power:string|null,cost:string|null)=>{
    const a:Record<string,any>={};
    for(const f of row.fields) a[f.id]=f.allowAutomatic?{kind:'automatic'}:f.required?(f.type==='choice'?{kind:'choice',choiceId:f.choices[0].id}:{kind:'text',text:'Synthetic'}):{kind:'omit'};
    if(power) a.power_calculation=power==='automatic'?{kind:'automatic'}:{kind:'choice',choiceId:power};
    if(cost) a.cost_calculation=cost==='automatic'?{kind:'automatic'}:{kind:'choice',choiceId:cost};
    return a;
  };
  const run=(power:string|null,cost:string|null)=>evaluateClassified(item,{marks:20,parts:null,facets:{}},20,answer(power,cost),{paid:true});
  test('electricity cost with no cost step is refused with a field message',()=>{
    const r=run('electricity_cost','no');
    expect(r.attention.some(a=>a.scope==='field'&&a.id==='cost_calculation')).toBe(true);
    expect(r.blockedFieldOptions.cost_calculation?.has('no')).toBe(true);
  });
  test('every other combination of the two circuit answers stays acceptable',()=>{
    for(const power of ['single_component','total_circuit','energy_over_time','electricity_cost','automatic'])
      for(const cost of ['yes','no','automatic',null]){
        if(power==='electricity_cost'&&cost==='no') continue;
        const r=run(power,cost);
        expect(r.attention.filter(a=>a.id==='cost_calculation'||a.id==='power_calculation'),`${power}/${cost}`).toEqual([]);
      }
  });
});
