// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,SKILL,sha,ok,refused,key,blob,importSnapshot,baseBank,accept} from './studio-fixture';
import {contract,grantArgs,manifest} from './studio-budget-fixture';
const db=new StudioDb(),ed=()=>db.rpc({kind:'user',id:ids.editor}),svc=()=>db.rpc({kind:'service'}),op=()=>db.rpc({kind:'operator'});
let snapshot:string;
beforeAll(async()=>{await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});
 snapshot=(await importSnapshot(op(),MODULE,baseBank)).snapshotId;await accept(op(),MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(()=>db.close());
async function start(pages=17,purpose='rehearsal',change:(p:any)=>void=()=>{}){
 const id='paper-'+key();await db.sql('insert into private.studio_provider_profiles values ($1,$2,$3,$4,true)',[id,'live','synthetic','synthetic']);
 const b=await blob(ed(),MODULE,'synthetic paper');const src=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic paper trial',p_files:[{blobId:b,role:'question_paper',filename:'synthetic.pdf'}],p_identity:{},p_command:key()});
 const r=await ok(ed(),'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:purpose,p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:id,p_command:key()});
 const i=(await db.sql('select * from private.studio_run_inputs where run_id=$1',[r.runId]))[0];
 const source=(await db.sql('select * from private.studio_blobs where id=$1',[b]))[0];
 const plan={schema:'reviseit/studio-paper-intake-plan@1',moduleId:MODULE,inputManifest:{sourceSha256:source.sha256,sourceBytes:Number(source.size_bytes),policySha256:i.policy_sha256,skillSha256:i.skill_sha256,pageCount:pages,pages:Array.from({length:pages},(_,n)=>({filePage:n+1,renderSha256:sha('render'+n),textSha256:sha('text'+n)}))},
  phaseLimits:{page:{requestBytes:786432,outputTokens:8192,images:1},reconcile:{requestBytes:262144,outputTokens:32768,images:0}},
  limits:{trialMicro:12000000,runMicro:10000000,stageMicro:10000000,operationMicro:2000000,maxDispatches:pages+1,requiredBalanceMicro:10000000}};
 change(plan);
 const c={...contract(),id,profile_id:id,mode:'openrouter',model:'synthetic/model',endpoint:'https://openrouter.ai/api/v1/chat/completions',
  input_micro_per_million:2000000,output_micro_per_million:10000000,max_input_tokens:790528,max_request_bytes:786432,max_output_tokens:32768,max_images:1,image_token_ceiling:4096,
  evidence:{paperIntake:plan,planDigest:sha('synthetic-plan')}};
 const fields=Object.keys(c);await db.sql(`insert into private.studio_budget_contracts(${fields.join(',')}) values(${fields.map((_,n)=>'$'+(n+1)).join(',')})`,Object.values(c).map(v=>typeof v==='object'?JSON.stringify(v):v));
 const trial=key();await ok(op(),'studio_budget_grant',{...grantArgs(r.runId),p_trial:trial,p_contract:id,p_trial_limit:12000000,p_run_limit:10000000,p_stage_limit:10000000,p_operation_limit:2000000});
 const args={p_run:r.runId,p_plan_sha256:sha('synthetic-plan'),p_key_evidence_sha256:sha('synthetic-proof'),p_expires:new Date(Date.now()+3600000).toISOString(),p_reference:'Synthetic paper trial explicit authorisation',p_scope:{sourceDigest:i.source_digest,bankManifestSha256:i.bank_manifest_sha256,policySha256:i.policy_sha256,skillSha256:i.skill_sha256}};
 return {run:r.runId,args,c,trial};
}
const claim=(run:string,c:any)=>ok(svc(),'studio_claim_live',{p_worker:'synthetic-paper',p_run:run,p_bundle:c.bundle_sha256,p_plan:sha('synthetic-plan'),p_key_evidence:sha('synthetic-proof')});
async function prepared(cl:any,c:any,page:number,name=''){
 const operation=name||'s1:page:'+page,digest=sha(operation);
 const p=await ok(svc(),'studio_provider_prepare',{p_attempt:cl.attemptId,p_lease:cl.lease,p_operation:operation,p_request_digest:digest});
 const args={p_attempt:cl.attemptId,p_lease:cl.lease,p_provider_attempt:p.providerAttemptId};
 const m=manifest(digest,{contractId:c.id,mode:'openrouter',model:c.model,endpoint:c.endpoint,
  pricingDigest:c.pricing_sha256,capabilityDigest:c.capability_sha256,intakePhase:page?'page':'reconcile',sourcePage:page,
  imageCount:page?1:0,inputTokenBound:page?4196:100,outputTokens:page?8192:32768});
 return {args,m,p};
}
async function settle(p:any,failed=false){await ok(svc(),'studio_provider_dispatched',p.args);
 await ok(svc(),'studio_provider_result',{...p.args,p_outcome:failed?'failed':'succeeded',p_provider_request_id:null,p_result_digest:sha('reply'),p_usage:{}});
 await ok(svc(),'studio_budget_settle',{p_provider_attempt:p.p.providerAttemptId,p_actual_micro:1,p_evidence_sha256:sha('reply')});}

test('only operator can authorise exact real-paper scope; old authorisation cannot expand',async()=>{
 const {run,args,c}=await start();expect(await claim(run,c)).toBeNull();
 for(const actor of [ed(),svc()])expect(await refused(actor,'studio_live_authorise_paper',args)).toMatch(/permission/);
 expect(await refused(op(),'studio_live_authorise',args)).toMatch(/contract refused/);
 expect(await refused(op(),'studio_live_authorise_paper',{...args,p_plan_sha256:sha('other')})).toMatch(/contract refused/);
 const a=await ok(op(),'studio_live_authorise_paper',args);expect(a.max_dispatches).toBe(18);expect(a.trial_kind).toBe('question_paper');
 await ok(op(),'studio_live_authorise_paper',args);
 expect(await refused(op(),'studio_live_authorise_paper',{...args,p_reference:'different approval'})).toMatch(/immutable/);
 const cl=await claim(run,c);expect(cl.stageKey).toBe('S1_extract');
 const context=await ok(svc(),'studio_budget_context',{p_attempt:cl.attemptId,p_lease:cl.lease});
 expect(context.contract.evidence.paperIntake.inputManifest.pages).toHaveLength(17);
 expect(context.contract.evidence.paperIntake).not.toHaveProperty('limits');
});
test('source, module, limits, expiry and canonical purpose cannot be substituted',async()=>{
 for(const change of [(p:any)=>p.moduleId='other',(p:any)=>p.inputManifest.sourceSha256=sha('other'),
  (p:any)=>p.inputManifest.pageCount=99,(p:any)=>p.phaseLimits.page.outputTokens=32768,(p:any)=>p.limits.maxDispatches=21]){
  const r=await start(17,'rehearsal',change);expect(await refused(op(),'studio_live_authorise_paper',r.args)).toMatch(/refused/);
 }
 const r=await start(17,'canonical');expect(await refused(op(),'studio_live_authorise_paper',r.args)).toMatch(/refused/);
 const s=await start();expect(await refused(op(),'studio_live_authorise_paper',{...s.args,p_expires:'2020-01-01T00:00:00Z'})).toMatch(/expiry/);
});
test('seventeen settled pages permit one reconciliation, with no duplicate or out-of-range page',async()=>{
 const r=await start();await ok(op(),'studio_live_authorise_paper',r.args);const cl=await claim(r.run,r.c);
 const final=await prepared(cl,r.c,0);expect(await refused(svc(),'studio_budget_reserve',{...final.args,p_request_manifest:final.m})).toMatch(/every settled page/);
 const wrong=await prepared(cl,r.c,18);expect(await refused(svc(),'studio_budget_reserve',{...wrong.args,p_request_manifest:wrong.m})).toMatch(/page phase/);
 for(let n=1;n<=17;n++){
  const p=await prepared(cl,r.c,n);await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m});await settle(p);
 }
 const dup=await prepared(cl,r.c,1,'duplicate-page');expect(await refused(svc(),'studio_budget_reserve',{...dup.args,p_request_manifest:dup.m})).toMatch(/already reserved/);
 await ok(svc(),'studio_budget_reserve',{...final.args,p_request_manifest:final.m});await settle(final);
 expect(await db.sql('select id from private.studio_provider_attempts where possible_charge')).toHaveLength(18);
 const extra=await prepared(cl,r.c,0,'extra-final');expect(await refused(svc(),'studio_budget_reserve',{...extra.args,p_request_manifest:extra.m})).toMatch(/already reserved/);
});
test('failed page cannot be silently retried or counted as a settled successful page',async()=>{
 const r=await start(1);await ok(op(),'studio_live_authorise_paper',r.args);const cl=await claim(r.run,r.c),p=await prepared(cl,r.c,1);
 await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m});await settle(p,true);
 const retry=await prepared(cl,r.c,1,'new-page-operation');expect(await refused(svc(),'studio_budget_reserve',{...retry.args,p_request_manifest:retry.m})).toMatch(/already reserved/);
 const final=await prepared(cl,r.c,0);expect(await refused(svc(),'studio_budget_reserve',{...final.args,p_request_manifest:final.m})).toMatch(/every settled page/);
});
test('revocation between reserve and dispatch still prevents charge; stage changes stay out of scope',async()=>{
 const r=await start();await ok(op(),'studio_live_authorise_paper',r.args);const cl=await claim(r.run,r.c),p=await prepared(cl,r.c,1);
 await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m});
 await ok(op(),'studio_live_revoke',{p_run:r.run,p_reason:'Stop this synthetic paper trial'});
 expect(await refused(svc(),'studio_provider_dispatched',p.args)).toMatch(/disabled/);
 expect(await refused(op(),'studio_live_authorise_paper',r.args)).toMatch(/immutable/);
});
