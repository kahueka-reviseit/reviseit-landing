import type {AuthoredForm} from '../../lib/studio/form-authoring';
import {fileDetail} from './studio-library';
export const authoredForm:AuthoredForm={schema:'reviseit/authored-form@1',identity:{module:fileDetail.moduleId,kind:'specification',id:'P1-SYNTH-01'},title:'Synthetic teacher form',status:'authored-ready',meta:{last_updated:'2026-10-01'},
 fields:[{id:'quantity',label:'Which quantity should learners calculate?',hint:'Choose the assessed quantity.',type:'choice',required:true,allowAutomatic:false,allowOther:false,choices:[{id:'speed',label:'Speed'},{id:'distance',label:'Distance'}]},
 {id:'context',label:'Any preferred context?',hint:'Leave unanswered if you have no preference.',type:'text',maxLength:1200,required:false,allowAutomatic:false}],
 field_provenance:{quantity:{changes:[],authored_from_source:[{path:`our content/${fileDetail.moduleId}/data/task-types/physics/PHYS_01.md`,sha256:'c'.repeat(64),line:7,quote:'Ask for speed or distance.'}]},context:{changes:[],authored_from_source:[]}},
 current_source_matches:[{path:`our content/${fileDetail.moduleId}/data/task-types/physics/PHYS_01.md`,sha256:'c'.repeat(64)}],
 unresolved:[{code:'synthetic-review-note',detail:'Retain this observation for human review.'}],notes:['Synthetic fixture only.'],excluded_source_questions:[],recovered_record:null,recovered_sources:[],binding_status:'authored-from-current-source',joint_item_ids:[],form_revision:'a'.repeat(64)};
export const formFile={...fileDetail,path:'data/forms/authored/specification/P1-SYNTH-01.json',mediaType:'application/json'};
export const formText=JSON.stringify(authoredForm,null,2)+'\n';
