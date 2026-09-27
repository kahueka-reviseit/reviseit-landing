import { defaultFormatting, type CatalogueEntry, type Workspace } from '../../lib/workspace/contracts';
/**
 * Entirely synthetic catalogue with the density the pilot's Grade 11 curriculum
 * actually has (C05A): 89 entries, 81 exact topic labels, 73 of them used once,
 * 43 orderable, many without a published outline or diagram, and realistically
 * long topic labels. Labels are invented word combinations, not curriculum text.
 */
const subjects=['forces','motion','energy transfer','waves','light','charges','fields','current','resistance','induction','particles','bonding',
  'gases','moles','solutions','reaction rates','energy change','acids','redox','vectors','momentum','gravity','optics','sound'];
const settings=['in everyday contexts','on inclined surfaces with friction','in connected systems','from graphs and tables','in closed containers',
  'with measured data from an investigation','in series and parallel arrangements','at the particle level','using ratio reasoning','over time'];
const label=(i:number)=>{const s=subjects[i%subjects.length],t=settings[Math.floor(i/subjects.length)%settings.length];
  const long=i%5===0?' and the reasoning learners use to compare two situations':'';
  return `Synthetic ${s} ${t}${long}`.replace(/^./,c=>c.toUpperCase());};
// 8 labels used twice (16 entries) and 73 used once: 81 labels, 89 entries.
const topics:string[]=[...Array.from({length:8},(_,i)=>[label(i),label(i)]).flat(),...Array.from({length:73},(_,i)=>label(i+8))];
const diagrams=['forces','motion','circuit','investigation','particles','quantities'];
export const denseEntries:CatalogueEntry[]=topics.map((topic,i)=>{
  const mcq=i%2===1&&i<84; // 42 multiple-choice types, 47 structured
  const code=mcq?`DMCQ_${String(i).padStart(2,'0')}`:`D-${String(i).padStart(2,'0')}`;
  const min=mcq?2:6+(i%9),max=mcq?2:min+4+(i%7);
  const orderable=(i*43)%89<43; // exactly 43 orderable, spread through the list (89 is prime)
  const outline=i%3===0; // two thirds have no published outline
  const parts=mcq?1:3+(i%4);
  return {id:`${mcq?'mcq':'structured'}:${code}`,title:`Synthetic ${mcq?'type':'question'} ${i+1}: ${topic.toLowerCase()}`,topic,description:'Synthetic entry for the density check.',
    marks:{min,max},orderable,
    preview:{subquestions:{min:parts,max:parts},...(outline?{outline:mcq?[{summary:'Select the synthetic answer',bloom:'Understand' as const}]:
      Array.from({length:parts},(_,k)=>({summary:`Synthetic part ${k+1}`,bloom:(['Remember','Apply','Apply','Analyse','Evaluate','Apply'] as const)[k]}))}:{})},
    ...(i%4===0?{thumbnail:{src:`/sample-diagrams/${diagrams[i%diagrams.length]}.png`,alt:'Synthetic diagram preview'}}:{})};
});
export const denseWorkspace:Workspace={
  schoolName:'Example Secondary School',
  curricula:[{id:'synthetic-dense-grade-11',name:'Grade 11 Physical Sciences',release:'dense-1',isDemo:false}],
  module:{id:'synthetic-dense-grade-11',name:'Grade 11 Physical Sciences',release:'dense-1',isDemo:false},
  entries:denseEntries,formatting:{revision:1,preferences:defaultFormatting},selection:{revision:0,release:'dense-1',entryIds:[]},
  purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true,maxQuestions:20,maxStructured:10,maxMultipleChoice:10},
};
