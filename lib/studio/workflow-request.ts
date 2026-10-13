import {paperIntakeManifest} from './paper-intake';
/** Full rehearsal adds stage-bound local tools; it never turns an intake grant into workflow authority. */
export function workflowManifest(request:any,bytes:number,images:number,contract:any){
 const plan=contract.evidence?.analysisWorkflow;
 if(!plan)return paperIntakeManifest(request,bytes,images,contract);
 const stage=request.pins?.stage;
 if(plan.schema!=='reviseit/studio-analysis-trial-plan@1'||request.pins?.module!==plan.moduleId)
  throw new Error('Budget workflow identity differs from its plan');
 if(stage==='S1_extract')return {...paperIntakeManifest(request,bytes,images,{...contract,evidence:{paperIntake:plan}}),workflowStage:stage};
 const terminal:Record<string,string[]>= {S2_task_match:['submit_task_matches'],S3_spec_match:['submit_spec_matches'],S5_draft:['submit_draft_plan','submit_draft_record','submit_draft_index']};
 if(!terminal[stage]||request.pins.phase!==undefined||!request.tools.length||request.tools.some((t:any)=>!['read_record','read_source_page_text',...terminal[stage]].includes(t.function?.name)))
  throw new Error('Budget workflow stage or local tools refused');
 return {workflowStage:stage};
}
