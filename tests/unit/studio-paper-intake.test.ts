import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {paperIntakeManifest} from '../../lib/studio/paper-intake';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const page={file_page:1,source_sha256:sha('pdf'),render_sha256:sha('image'),text_sha256:sha('page text'),text:'page text'};
 const inputManifest={sourceSha256:sha('pdf'),policySha256:sha('policy'),pageCount:1,pages:[{filePage:1,renderSha256:sha('image'),textSha256:sha('page text')}]};
 const contract={evidence:{paperIntake:{moduleId:'synthetic-module',inputManifest,phaseLimits:{page:{requestBytes:786432,outputTokens:8192,images:1},reconcile:{requestBytes:262144,outputTokens:32768,images:0}}}}};
 const request={pins:{phase:'page',module:'synthetic-module'},max_tokens:8192,
  tools:[{function:{name:'submit_source_page'}}],messages:[{role:'system',content:'skill'},
   {role:'user',content:[{type:'text',text:JSON.stringify({sourceRole:'question_paper',page})},{type:'image_url',image_url:{url:'data:image/png;base64,'+Buffer.from('image').toString('base64')}}]}]};
 return {request,contract};
}
test('paper requests require the exact image, text, source and phase',()=>{
 const {request:r,contract:c}=fixture();expect(paperIntakeManifest(r,1000,1,c)).toEqual({intakePhase:'page',sourcePage:1});
 for(const change of [(r:any)=>r.pins.module='other',(r:any)=>r.max_tokens=32768,(r:any)=>r.tools[0].function.name='hosted_tool',
  (r:any)=>{r.messages[1].content[1].image_url.url='data:image/png;base64,eA==';}]){
  const {request,contract}=fixture();change(request);
  expect(()=>paperIntakeManifest(request,1000,1,contract)).toThrow(/Budget/);
 }
 const f=fixture();expect(()=>paperIntakeManifest(f.request,786433,1,f.contract)).toThrow();
 expect(()=>paperIntakeManifest(f.request,1000,0,f.contract)).toThrow();
});
test('reconciliation requires one observation per page and the pinned policy',()=>{
 const {contract:c}=fixture();const context={module_id:'synthetic-module',source_sha256:sha('pdf'),primary_source_id:'s',
  source_files:[{id:'s',sha256:sha('pdf'),role:'question_paper',pages:1}],curriculum_policy:{sha256:sha('policy'),text:'policy'},observations:[{source_id:'s',file_page:1}]};
 const r={pins:{phase:'reconcile',module:'synthetic-module'},max_tokens:32768,tools:[{function:{name:'submit_inventory'}}],
  messages:[{role:'system',content:'skill'},{role:'user',content:[{type:'text',text:JSON.stringify(context)}]}]};
 expect(paperIntakeManifest(r,1000,0,c)).toEqual({intakePhase:'reconcile',sourcePage:0});
 context.observations.push({source_id:'s',file_page:1});(r.messages[1].content as any)[0].text=JSON.stringify(context);
 expect(()=>paperIntakeManifest(r,1000,0,c)).toThrow();
});
test('old contracts retain their prior admission path',()=>expect(paperIntakeManifest({},1,0,{evidence:{}})).toEqual({}));


test('v2 full workflow admits only two bounded correction turns and preserves pinned source checks',()=>{
 const f=fixture();const c=f.contract as any;c.evidence.paperIntake.schema='reviseit/studio-analysis-trial-plan@2';
 const r=f.request as any;
 const pair=(id:string)=>[{role:'assistant',tool_calls:[{id,type:'function',function:{name:'submit_source_page',arguments:'{}'}}]},
  {role:'tool',tool_call_id:id,content:JSON.stringify({error:'Missing required field: notes'})}];
 expect(paperIntakeManifest(r,1000,1,c)).toMatchObject({intakeTurn:1});
 r.messages.push(...pair('a'));expect(paperIntakeManifest(r,1000,1,c)).toMatchObject({intakeTurn:2});
 r.messages.push(...pair('b'));expect(paperIntakeManifest(r,1000,1,c)).toMatchObject({intakeTurn:3});
 r.messages.push(...pair('c'));expect(()=>paperIntakeManifest(r,1000,1,c)).toThrow();r.messages.splice(6);
 for(const change of [(x:any)=>x.messages[3].tool_call_id='wrong',(x:any)=>x.messages[3].content='{}',
  (x:any)=>x.messages[2].role='system',(x:any)=>x.messages[2].tool_calls[0].function.name='other',
  (x:any)=>x.messages[1].content[1].image_url.url='data:image/png;base64,QQ==']){
  const copy=structuredClone(r);change(copy);expect(()=>paperIntakeManifest(copy,1000,1,c)).toThrow();
 }
 c.evidence.paperIntake.schema='reviseit/studio-analysis-trial-plan@1';expect(()=>paperIntakeManifest(r,1000,1,c)).toThrow();
});
