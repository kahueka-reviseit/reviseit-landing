import {test,expect} from 'vitest';
import {workflowManifest} from '../../lib/studio/workflow-request';
const c={evidence:{analysisWorkflow:{schema:'reviseit/studio-analysis-trial-plan@1',moduleId:'synthetic'}}};
const request=(stage:string,tool:string)=>({pins:{module:'synthetic',stage},tools:[{type:'function',function:{name:tool}}]});
test('matching and drafting admit only local tools for the claimed workflow stage',()=>{
 for(const [stage,tool] of [['S2_task_match','submit_task_matches'],['S3_spec_match','submit_spec_matches'],['S5_draft','submit_draft_record']]){
  expect(workflowManifest(request(stage,tool),100,0,c)).toEqual({workflowStage:stage});
  expect(()=>workflowManifest(request(stage,'web_search'),100,0,c)).toThrow(/local tools/);
 }
 for(const [stage,tool] of [['S2_task_match','submit_draft_record'],['S7_package','read_record'],['S1_extract','submit_task_matches']])expect(()=>workflowManifest(request(stage,tool),100,0,c)).toThrow(/Budget/);
 expect(()=>workflowManifest({...request('S2_task_match','read_record'),pins:{stage:'S2_task_match',module:'other'}},100,0,c)).toThrow(/identity/);
 expect(()=>workflowManifest({...request('S2_task_match','read_record'),pins:{stage:'S2_task_match',module:'synthetic',phase:'page'}},100,0,c)).toThrow(/stage/);
});
