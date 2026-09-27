import {test,expect} from 'vitest';
import {applyFilters,bloomSpan,codeOf,emptyFilters,highlight,kindOf,optionCount,outlineMix,topicGroups} from '../../lib/workspace/paper';
import {paperEntries} from '../fixtures/paper-catalogue';

test('kind and code come from the catalogue identifier only',()=>{
 expect(kindOf({id:'mcq:SMCQ_01'})).toBe('multiple_choice');expect(kindOf({id:'structured:S-MECH-02'})).toBe('structured');
 expect(codeOf('structured:S-MECH-02')).toBe('S-MECH-02');expect(codeOf('DEMO_01')).toBe('DEMO_01');
});
test('values within a filter are alternatives; different filters must all hold',()=>{
 const f={...emptyFilters(),topics:['Vectors and mechanics','Electric circuits']};
 const both=applyFilters(paperEntries,f);expect(both.every(e=>f.topics.includes(e.topic))).toBe(true);
 expect(both.length).toBe(paperEntries.filter(e=>f.topics.includes(e.topic)).length);
 const structured=applyFilters(paperEntries,{...f,kinds:['structured']});
 expect(structured.every(e=>kindOf(e)==='structured'&&f.topics.includes(e.topic))).toBe(true);
});
test('mark bands match when the permitted range overlaps the band',()=>{
 const r=applyFilters(paperEntries,{...emptyFilters(),marks:['1-5']});
 expect(r.every(e=>e.marks.min<=5)).toBe(true);expect(r.some(e=>kindOf(e)==='multiple_choice')).toBe(true);
 expect(applyFilters(paperEntries,{...emptyFilters(),marks:['21+']}).every(e=>e.marks.max>=21)).toBe(true);
});
test('Bloom’s, diagram and availability use only published fields',()=>{
 const analyse=applyFilters(paperEntries,{...emptyFilters(),bloom:['Analyse']});
 expect(analyse.length).toBeGreaterThan(0);expect(analyse.every(e=>e.preview?.outline?.some(r=>r.bloom==='Analyse'))).toBe(true);
 expect(applyFilters(paperEntries,{...emptyFilters(),diagram:['without']}).every(e=>!e.thumbnail)).toBe(true);
 expect(applyFilters(paperEntries,{...emptyFilters(),availability:['unavailable']}).every(e=>!e.orderable)).toBe(true);
});
test('option counts reflect every other active filter and the search, before ticking',()=>{
 const f={...emptyFilters(),kinds:['structured' as const]};
 const n=optionCount(paperEntries,f,'topics','Vectors and mechanics');
 expect(n).toBe(paperEntries.filter(e=>kindOf(e)==='structured'&&e.topic==='Vectors and mechanics').length);
 expect(optionCount(paperEntries,{...f,topics:['Electrostatics']},'topics','Vectors and mechanics')).toBe(n);
 expect(optionCount(paperEntries,emptyFilters(),'topics','Vectors and mechanics','slope')).toBe(1);
});
test('summaries are never invented when outlines are absent',()=>{
 const none=paperEntries.find(e=>!e.preview?.outline)!;expect(bloomSpan(none)).toBeNull();expect(outlineMix(none)).toEqual([]);
 const withMarks=paperEntries.find(e=>e.id==='structured:S-MECH-02')!;expect(bloomSpan(withMarks)).toBe('Remember to Analyse');
 expect(outlineMix(withMarks).reduce((t,r)=>t+r.min,0)).toBe(withMarks.preview!.outline!.reduce((t,r)=>t+r.marks!.min,0));
 const plain=paperEntries.find(e=>e.id==='structured:S-MECH-03')!;expect(outlineMix(plain)).toEqual([]);
});
test('topics are counted from the catalogue and highlight is case-insensitive',()=>{
 const g=topicGroups(paperEntries);expect(g.reduce((t,x)=>t+x.total,0)).toBe(paperEntries.length);expect(g[0].total).toBeGreaterThanOrEqual(g[g.length-1].total);
 expect(highlight('Block on a rough Slope','slope')).toEqual([{text:'Block on a rough ',match:false},{text:'Slope',match:true}]);
});
