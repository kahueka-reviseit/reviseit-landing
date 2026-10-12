import { createHash } from 'node:crypto';
const hash=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const fail=():never=>{throw new Error('Budget paper intake request differs from approved phase or source');};

/** Additional admission only for separately registered question-paper contracts. */
export function paperIntakeManifest(request:any,bytes:number,images:number,contract:any){
 const plan=contract.evidence?.paperIntake;
 if(!plan)return {};
 const phase=request.pins?.phase,limit=plan.phaseLimits?.[phase];
 if(!['page','reconcile'].includes(phase)||!limit||bytes>limit.requestBytes||images!==limit.images
    ||request.max_tokens!==limit.outputTokens||request.pins.module!==plan.moduleId
    ||request.messages.length!==2||request.messages[0].role!=='system'||request.messages[1].role!=='user'
    ||request.tools.length!==1||request.tools[0].function?.name!==(phase==='page'?'submit_source_page':'submit_inventory'))fail();
 const content=request.messages[1].content;
 if(!Array.isArray(content)||content.length!==(phase==='page'?2:1)||content[0]?.type!=='text')fail();
 let context:any;try{context=JSON.parse(content[0].text);}catch{fail();}
 if(phase==='page'){
  const page=context.page,n=page?.file_page,expected=plan.inputManifest.pages?.[n-1];
  if(!Number.isInteger(n)||!expected||expected.filePage!==n||context.sourceRole!=='question_paper'
    ||page.source_sha256!==plan.inputManifest.sourceSha256||page.render_sha256!==expected.renderSha256
    ||page.text_sha256!==expected.textSha256||typeof page.text!=='string'||hash(page.text)!==expected.textSha256)fail();
  const url=content[1]?.image_url?.url;
  if(typeof url!=='string'||!url.startsWith('data:image/png;base64,')||hash(Buffer.from(url.slice(22),'base64'))!==expected.renderSha256)fail();
  return {intakePhase:phase,sourcePage:n};
 }
 if(context.module_id!==plan.moduleId||context.source_sha256!==plan.inputManifest.sourceSha256
   ||!Array.isArray(context.source_files)||context.source_files.length!==1
   ||context.source_files[0].sha256!==plan.inputManifest.sourceSha256||context.source_files[0].role!=='question_paper'
   ||context.source_files[0].id!==context.primary_source_id
   ||context.source_files[0].pages!==plan.inputManifest.pageCount
   ||context.curriculum_policy?.sha256!==plan.inputManifest.policySha256
   ||typeof context.curriculum_policy?.text!=='string'||hash(context.curriculum_policy.text)!==plan.inputManifest.policySha256
   ||!Array.isArray(context.observations)||context.observations.length!==plan.inputManifest.pageCount)fail();
 const pages=context.observations.map((o:any)=>o.file_page).sort((a:number,b:number)=>a-b);
 if(pages.some((n:number,i:number)=>n!==i+1)||context.observations.some((o:any)=>o.source_id!==context.primary_source_id))fail();
 return {intakePhase:phase,sourcePage:0};
}
