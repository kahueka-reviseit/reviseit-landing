import { defaultFormatting, type CatalogueEntry, type CataloguePreview, type Workspace } from '../../lib/workspace/contracts';
/**
 * Entirely synthetic catalogue at realistic density for the paper-journey preview and
 * browser tests. Titles, codes, outlines and mark ranges are invented for layout and
 * interaction checks; nothing is copied from a private specification, questionnaire or
 * classification. Codes use an "S-" / "SMCQ_" prefix so they cannot be mistaken for real ones.
 */
const diagrams=['forces','motion','circuit','investigation','particles','quantities'];
const alt:Record<string,string>={forces:'A block with horizontal and upward force arrows',motion:'Velocity against time graph with a rising line followed by a horizontal line',
  circuit:'Simple battery circuit with two resistors',investigation:'Battery circuit with two resistors and an ammeter',particles:'Two containers showing closely packed and spread-out particles',quantities:'Three containers with different quantities'};
const outline=(n:number,marks:boolean):CataloguePreview['outline']=>{
  const rows:NonNullable<CataloguePreview['outline']>=[{summary:'State a synthetic principle',bloom:'Remember'},{summary:'Interpret a synthetic representation',bloom:'Understand'},
    {summary:'Calculate a synthetic quantity',bloom:'Apply'},{summary:'Apply a second synthetic relationship',bloom:'Apply'},{summary:'Compare two synthetic situations',bloom:'Analyse'},{summary:'Judge a synthetic claim',bloom:'Evaluate'}];
  return rows.slice(0,n).map((r,i)=>marks?{...r,marks:i===2?{min:2,max:4}:{min:2,max:2}}:r);
};
type Spec=[code:string,title:string,topic:string,min:number,max:number,ready:boolean,diagram:number|null,parts:number|null,withOutline:'marks'|'plain'|null];
const structured:Spec[]=[
  ['S-MECH-01','Forces in equilibrium on a hanging mass','Vectors and mechanics',9,18,true,0,5,'marks'],
  ['S-MECH-02','Block on a rough slope','Vectors and mechanics',12,18,true,0,6,'marks'],
  ['S-MECH-03','Work and energy on a track','Vectors and mechanics',15,18,true,1,5,'plain'],
  ['S-MECH-04','Reading an acceleration graph','Vectors and mechanics',13,17,true,1,4,'marks'],
  ['S-MECH-05','Two connected trolleys','Vectors and mechanics',10,18,false,0,5,null],
  ['S-MECH-06','Lift and apparent weight','Vectors and mechanics',8,14,false,null,4,null],
  ['S-WAVE-01','Wave properties on a string','Waves, sound and light',10,14,true,1,5,'marks'],
  ['S-WAVE-02','Light crossing a glass block','Waves, sound and light',13,20,true,null,6,'plain'],
  ['S-WAVE-03','Sound in two media','Waves, sound and light',8,12,false,null,null,null],
  ['S-ELEC-01','Charges and the field between them','Electrostatics',12,24,true,null,6,'marks'],
  ['S-ELEC-02','Field strength at a point','Electrostatics',10,14,false,null,4,null],
  ['S-CIRC-01','Series and parallel resistors','Electric circuits',16,27,true,2,5,'marks'],
  ['S-CIRC-02','Investigating a lamp circuit','Electric circuits',8,12,true,3,4,'plain'],
  ['S-EMAG-01','Magnet moving through a coil','Electromagnetism',12,16,false,null,4,null],
  ['S-GRAV-01','Gravity between two planets','Universal gravitation',7,12,true,null,3,'marks'],
  ['S-MATT-01','Particle model and changes of state','Matter and materials',10,15,true,4,5,'marks'],
  ['S-MATT-02','Intermolecular forces and boiling points','Matter and materials',12,18,false,4,5,null],
  ['S-QUAN-01','Moles in a reaction mixture','Quantitative chemistry',14,22,true,5,6,'marks'],
  ['S-QUAN-02','Limiting reagent in a synthetic reaction','Quantitative chemistry',12,20,false,5,5,null],
  ['S-ENER-01','Energy profile of a reaction','Energy and chemical change',8,14,true,null,4,'plain'],
  ['S-ACID-01','Neutralising a synthetic acid','Acids and bases',10,16,false,null,4,null],
  ['S-REDX-01','Tracking electron transfer','Redox reactions',8,12,false,null,null,null],
];
type Mcq=[code:string,title:string,topic:string,ready:boolean];
const mcq:Mcq[]=[
  ['SMCQ_01','Choosing the correct force diagram','Vectors and mechanics',true],['SMCQ_02','Mass compared with weight','Vectors and mechanics',true],
  ['SMCQ_03','Reading a force-acceleration graph','Vectors and mechanics',true],['SMCQ_04','Action and reaction pairs','Vectors and mechanics',true],
  ['SMCQ_05','Apparent weight while accelerating','Vectors and mechanics',false],['SMCQ_06','Scalar or vector','Vectors and mechanics',true],
  ['SMCQ_07','Wavelength from a diagram','Waves, sound and light',true],['SMCQ_08','Refraction direction','Waves, sound and light',false],
  ['SMCQ_09','Direction of a net electric force','Electrostatics',true],['SMCQ_10','Field line spacing','Electrostatics',true],
  ['SMCQ_11','Opening a switch in a circuit','Electric circuits',true],['SMCQ_12','Comparing power in two lamps','Electric circuits',true],
  ['SMCQ_13','Induced current direction','Electromagnetism',true],['SMCQ_14','Inverse-square reasoning','Universal gravitation',true],
  ['SMCQ_15','Particle spacing in phases','Matter and materials',true],['SMCQ_16','Molar mass comparison','Quantitative chemistry',true],
  ['SMCQ_17','Exothermic or endothermic','Energy and chemical change',false],['SMCQ_18','Strong or weak acid','Acids and bases',true],
];
export const paperEntries:CatalogueEntry[]=[
  ...structured.map(([code,title,topic,min,max,ready,d,parts,o])=>({id:`structured:${code}`,title,topic,description:`Synthetic ${topic.toLowerCase()} question for the demonstration.`,marks:{min,max},orderable:ready,
    ...(parts?{preview:{subquestions:{min:Math.max(1,parts-1),max:parts},...(o?{outline:outline(Math.max(1,parts-1),o==='marks')}:{})}}:{}),
    ...(d!==null?{thumbnail:{src:`/sample-diagrams/${diagrams[d]}.png`,alt:alt[diagrams[d]]}}:{})})),
  ...mcq.map(([code,title,topic,ready],i)=>({id:`mcq:${code}`,title,topic,description:'Synthetic two-mark multiple-choice type.',marks:{min:2,max:2},orderable:ready,
    preview:{subquestions:{min:1,max:1},...(i%3===0?{outline:[{summary:'Select the synthetic answer',bloom:i%2?'Understand' as const:'Apply' as const}]}:{})},
    ...(i%4===0?{thumbnail:{src:`/sample-diagrams/${diagrams[i%diagrams.length]}.png`,alt:alt[diagrams[i%diagrams.length]]}}:{})})),
];
export const paperWorkspace:Workspace={
  schoolName:'Example Secondary School',
  curricula:[{id:'synthetic-grade-11-physical-sciences',name:'Grade 11 Physical Sciences',release:'demo-2',isDemo:false},{id:'synthetic-grade-10-physical-sciences',name:'Grade 10 Physical Sciences',release:'demo-2',isDemo:false}],
  module:{id:'synthetic-grade-11-physical-sciences',name:'Grade 11 Physical Sciences',release:'demo-2',isDemo:false},
  entries:paperEntries,
  formatting:{revision:1,preferences:defaultFormatting},
  selection:{revision:0,release:'demo-2',entryIds:[]},
  purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true,maxQuestions:20,maxStructured:10,maxMultipleChoice:10},
};
/** A smaller second curriculum so curriculum search and switching can be exercised. */
export function paperCurriculum(moduleId:string):Workspace {
  if(moduleId===paperWorkspace.curricula[1].id) return {...paperWorkspace,module:paperWorkspace.curricula[1],
    entries:paperEntries.filter((_,i)=>i%3===0).map(e=>({...e,id:e.id.replace('S-','T-').replace('SMCQ_','TMCQ_'),title:`${e.title} (Grade 10 demonstration)`}))};
  return paperWorkspace;
}
