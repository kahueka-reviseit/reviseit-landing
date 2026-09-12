import { defaultFormatting, type Workspace } from '../../lib/workspace/contracts';
// Entirely synthetic. This file is used by tests and the isolated local preview only.
export const workspace:Workspace={
 schoolName:'Example Secondary School',
 curricula:[{id:'demo-grade-10-sciences',name:'Grade 10 Physical Sciences · demonstration',release:'demo-1',isDemo:true},{id:'demo-grade-11-sciences',name:'Grade 11 Physical Sciences · demonstration',release:'demo-1',isDemo:true}],
 module:{id:'demo-grade-10-sciences',name:'Grade 10 Physical Sciences · demonstration',release:'demo-1',isDemo:true},
 entries:[{id:'DEMO_01',title:'Reading a motion graph',topic:'Mechanics',description:'Interpret a simple graph showing an object’s motion.',marks:10},{id:'DEMO_02',title:'Comparing circuit measurements',topic:'Electricity',description:'Use a set of measurements to compare simple circuits.',marks:15},{id:'DEMO_03',title:'Explaining a change of state',topic:'Matter and materials',description:'Connect observations with a particle model of matter.',marks:5}],
 formatting:{revision:0,preferences:defaultFormatting},selection:{revision:0,release:'demo-1',entryIds:[]},
};
