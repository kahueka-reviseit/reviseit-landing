// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,SKILL,AUTH,sha,ok,refused,key,blob,importSnapshot,baseBank,accept} from './studio-fixture';
import {contract,grantArgs,manifest} from './studio-budget-fixture';
const db=new StudioDb(),ed=()=>db.rpc({kind:'user',id:ids.editor}),svc=()=>db.rpc({kind:'service'}),op=()=>db.rpc({kind:'operator'});
let snapshot:string;
beforeAll(async()=>{await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});
 snapshot=(await importSnapshot(op(),MODULE,baseBank)).snapshotId;await accept(op(),MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(()=>db.close());
async function start(pages=17,purpose='rehearsal',change:(p:any)=>void=()=>{},scanned=true){
 const id='paper-'+key();await db.sql('insert into private.studio_provider_profiles values ($1,$2,$3,$4,true)',[id,'live','synthetic','synthetic']);
 const b=await blob(ed(),MODULE,'synthetic paper');const src=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic paper trial',p_files:[{blobId:b,role:'question_paper',filename:'synthetic.pdf'}],p_identity:{},p_command:key()});
 const r=await ok(ed(),'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:purpose,p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:id,p_command:key()});
 const i=(await db.sql('select * from private.studio_run_inputs where run_id=$1',[r.runId]))[0];
 const source=(await db.sql('select * from private.studio_blobs where id=$1',[b]))[0];
 const plan={schema:'reviseit/studio-analysis-trial-plan@1',moduleId:MODULE,bankManifestSha256:i.bank_manifest_sha256,stages:['S1_extract','S2_task_match','S3_spec_match','S4_prioritise','S5_draft','S6_assemble_validate','S7_package'],inputManifest:{sourceSha256:source.sha256,sourceBytes:Number(source.size_bytes),policySha256:i.policy_sha256,skillSha256:i.skill_sha256,pageCount:pages,pages:Array.from({length:pages},(_,n)=>({filePage:n+1,renderSha256:sha('render'+n),textSha256:sha('text'+n)}))},
  phaseLimits:{page:{requestBytes:2097152,outputTokens:8192,images:1},reconcile:{requestBytes:262144,outputTokens:32768,images:0}},
  limits:{trialMicro:100000000,runMicro:90000000,stageMicro:30000000,operationMicro:9000000,maxDispatches:256,requiredBalanceMicro:9000000}};
 change(plan);
 const c={...contract(),id,profile_id:id,mode:'openrouter',model:'synthetic/model',endpoint:'https://openrouter.ai/api/v1/chat/completions',
  input_micro_per_million:2000000,output_micro_per_million:10000000,max_input_tokens:4259840,max_request_bytes:4194304,max_output_tokens:32768,max_images:16,image_token_ceiling:4096,
  evidence:{analysisWorkflow:plan,planDigest:sha('synthetic-plan')}};
 const fields=Object.keys(c);await db.sql(`insert into private.studio_budget_contracts(${fields.join(',')}) values(${fields.map((_,n)=>'$'+(n+1)).join(',')})`,Object.values(c).map(v=>typeof v==='object'?JSON.stringify(v):v));
 const trial=key();await ok(op(),'studio_budget_grant',{...grantArgs(r.runId),p_trial:trial,p_contract:id,p_trial_limit:100000000,p_run_limit:90000000,p_stage_limit:30000000,p_operation_limit:9000000});
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
  workflowStage:cl.stageKey,imageCount:page?1:0,inputTokenBound:page?4196:100,outputTokens:page?8192:32768});
 return {args,m,p};
}
async function settle(p:any,failed=false){await ok(svc(),'studio_provider_dispatched',p.args);
 await ok(svc(),'studio_provider_result',{...p.args,p_outcome:failed?'failed':'succeeded',p_provider_request_id:null,p_result_digest:sha('reply'),p_usage:{}});
 await ok(svc(),'studio_budget_settle',{p_provider_attempt:p.p.providerAttemptId,p_actual_micro:1,p_evidence_sha256:sha('reply')});}


test('full workflow keeps inventory review mandatory before live matching',async()=>{
 const r=await start(1);expect(await claim(r.run,r.c)).toBeNull();
 for(const actor of [ed(),svc()])expect(await refused(actor,'studio_live_authorise_workflow',r.args)).toMatch(/permission/);
 await ok(op(),'studio_live_authorise_workflow',r.args);
 const cl=await claim(r.run,r.c);expect(cl.stageKey).toBe('S1_extract');
 for(const n of [1,0]){const p=await prepared(cl,r.c,n);await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m});await settle(p);}
 const paid=(await db.sql('select id from private.studio_provider_attempts where dispatch_state=$1 order by created_at desc limit 1',['succeeded']))[0];
 const out=await ok(svc(),'studio_put_output',{p_attempt:cl.attemptId,p_lease:cl.lease,p_logical_key:'inventory',p_kind:'inventory',p_sha256:sha('synthetic inventory'),p_size:19,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:paid.id});
 await ok(svc(),'studio_complete',{p_attempt:cl.attemptId,p_lease:cl.lease,p_outputs:[out.artifactId]});
 expect(await claim(r.run,r.c)).toBeNull();
 const gate=await ok(ed(),'studio_gate_view',{p_run:r.run,p_gate:'G1_inventory'});
 await ok(ed(),'studio_record_decision',{p_run:r.run,p_gate:'G1_inventory',p_expected_version:gate.version,p_bound:[out.artifactId],p_outcome:'approved',p_rationale:'Synthetic inventory explicitly reviewed',p_authorisation:AUTH,p_items:[],p_command:key()});
 const match=await claim(r.run,r.c);expect(match.stageKey).toBe('S2_task_match');
 const p=await prepared(match,r.c,0,'match-turn-1');const {intakePhase,sourcePage,...m}=p.m as typeof p.m & {intakePhase?:string;sourcePage?:number};
 expect(await refused(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:{...m,workflowStage:'S5_draft'}})).toMatch(/stage identity/);
 await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:m});await settle(p);
 await ok(op(),'studio_live_revoke',{p_run:r.run,p_reason:'Synthetic complete workflow stop'});
 const next=await prepared(match,r.c,0,'match-turn-2');expect(await refused(svc(),'studio_budget_reserve',{...next.args,p_request_manifest:{...m,requestDigest:next.m.requestDigest}})).toMatch(/disabled/);
});
test('bank, stage set, caps and rehearsal purpose must match separately approved workflow',async()=>{
 for(const change of [(p:any)=>p.bankManifestSha256=sha('other'),(p:any)=>p.stages=['S1_extract'],(p:any)=>p.limits.trialMicro=200000000,(p:any)=>p.inputManifest.sourceSha256=sha('other')]){
  const r=await start(1,'rehearsal',change);expect(await refused(op(),'studio_live_authorise_workflow',r.args)).toMatch(/refused/);
 }
 const canonical=await start(1,'canonical');expect(await refused(op(),'studio_live_authorise_workflow',canonical.args)).toMatch(/refused/);
 const r=await start(1);expect(await refused(op(),'studio_live_authorise_paper',r.args)).toMatch(/refused/);
});
test('fresh key evidence is operator-only and cannot change plan, revive revocation or enlarge caps',async()=>{
 const r=await start(1);await ok(op(),'studio_live_authorise_workflow',r.args);
 const args={p_run:r.run,p_plan:r.args.p_plan_sha256,p_previous:r.args.p_key_evidence_sha256,p_new:sha('fresh proof'),p_reference:'Fresh same-key metadata, synthetic test'};
 for(const actor of [ed(),svc()])expect(await refused(actor,'studio_live_refresh_key_evidence',args)).toMatch(/permission/);
 expect(await refused(op(),'studio_live_refresh_key_evidence',{...args,p_plan:sha('other')})).toMatch(/Exact active/);
 await ok(op(),'studio_live_refresh_key_evidence',args);expect(await claim(r.run,r.c)).toBeNull();
 expect((await ok(svc(),'studio_claim_live',{p_worker:'synthetic-paper',p_run:r.run,p_bundle:r.c.bundle_sha256,p_plan:r.args.p_plan_sha256,p_key_evidence:args.p_new})).stageKey).toBe('S1_extract');
 expect(await refused(op(),'studio_live_refresh_key_evidence',args)).toMatch(/Exact active/);
 await ok(op(),'studio_live_revoke',{p_run:r.run,p_reason:'Synthetic complete workflow stop'});
 expect(await refused(op(),'studio_live_refresh_key_evidence',{...args,p_previous:args.p_new})).toMatch(/Exact active/);
});
