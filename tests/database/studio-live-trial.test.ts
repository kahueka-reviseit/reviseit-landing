// @vitest-environment node
// Synthetic authorisations only. No credential or model transport is involved.
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,SKILL,AUTH,sha,ok,refused,key,blob,importSnapshot,baseBank,accept} from './studio-fixture';
import {contract,grantArgs,manifest} from './studio-budget-fixture';
const db=new StudioDb(),ed=()=>db.rpc({kind:'user',id:ids.editor}),svc=()=>db.rpc({kind:'service'}),op=()=>db.rpc({kind:'operator'});
const c={...contract(),id:'synthetic-live',profile_id:'synthetic-live',mode:'openrouter',model:'synthetic/model',endpoint:'https://openrouter.ai/api/v1/chat/completions'};
let snapshot:string;
beforeAll(async()=>{
 await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});
 snapshot=(await importSnapshot(op(),MODULE,baseBank)).snapshotId;await accept(op(),MODULE,snapshot,null);
 await db.sql("insert into private.studio_provider_profiles values ('synthetic-live','live','synthetic','synthetic',true)");
 const fields=Object.keys(c);await db.sql(`insert into private.studio_budget_contracts(${fields.join(',')},evidence) values(${fields.map((_,i)=>'$'+(i+1)).join(',')},'{"synthetic":true}')`,Object.values(c));
},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(()=>db.close());
async function start(purpose='rehearsal',limits={}){
 const b=await blob(ed(),MODULE,'synthetic live source');const source=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic test only',p_files:[{blobId:b,role:'question_paper',filename:'s.pdf'}],p_identity:{},p_command:key()});
 const r=await ok(ed(),'studio_start_run',{p_source:source.sourceId,p_expected_source_revision:1,p_purpose:purpose,p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:c.profile_id,p_command:key()});
 await ok(op(),'studio_budget_grant',{...grantArgs(r.runId),p_contract:c.id,p_trial_limit:2000000,p_run_limit:1600000,p_stage_limit:1600000,p_operation_limit:600000,...limits});
 const i=(await db.sql('select * from private.studio_run_inputs where run_id=$1',[r.runId]))[0];
 const args={p_run:r.runId,p_plan_sha256:sha('reviewed-plan'),p_key_evidence_sha256:sha('synthetic-key-evidence'),p_expires:new Date(Date.now()+3600000).toISOString(),p_reference:'Explicit synthetic test authorisation',p_scope:{sourceDigest:i.source_digest,bankManifestSha256:i.bank_manifest_sha256,policySha256:i.policy_sha256,skillSha256:i.skill_sha256}};
 return {run:r.runId,args};
}
const claim=(run:string,extra={})=>ok(svc(),'studio_claim_live',{p_worker:'synthetic',p_run:run,p_bundle:c.bundle_sha256,p_plan:sha('reviewed-plan'),p_key_evidence:sha('synthetic-key-evidence'),...extra});
async function prepare(claim:any,name='turn:1'){
 const p=await ok(svc(),'studio_provider_prepare',{p_attempt:claim.attemptId,p_lease:claim.lease,p_operation:name,p_request_digest:sha(name)});
 const args={p_attempt:claim.attemptId,p_lease:claim.lease,p_provider_attempt:p.providerAttemptId};
 const m=manifest(sha(name),{contractId:c.id,model:c.model,endpoint:c.endpoint,mode:'openrouter'});
 return {p,args,m};
}

test('profile enablement and allowance alone never authorise live dispatch; editor/worker cannot grant',async()=>{
 const {run,args}=await start();expect(await claim(run)).toBeNull();
 for(const who of [ed(),svc()])expect(await refused(who,'studio_live_authorise',args)).toMatch(/permission denied/);
 const unsafe=await ok(svc(),'studio_claim',{p_worker:'legacy-test'}),p=await prepare(unsafe);
 expect(await refused(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m})).toMatch(/disabled/);
 expect(await refused(svc(),'studio_provider_dispatched',p.args)).toMatch(/disabled/);
 expect(await db.sql('select * from private.studio_live_authorisations')).toHaveLength(0);
});
test('exact plan, key evidence, scope and short expiry required; grant replay is immutable',async()=>{
 const {run,args}=await start();
 for(const patch of [{p_scope:{}},{p_plan_sha256:'bad'},{p_key_evidence_sha256:'bad'},{p_expires:'2020-01-01T00:00:00Z'},{p_expires:new Date(Date.now()+172800000).toISOString()}])
  expect(await refused(op(),'studio_live_authorise',{...args,...patch})).toMatch(/requires/);
 await ok(op(),'studio_live_authorise',args);await ok(op(),'studio_live_authorise',args);
 expect(await refused(op(),'studio_live_authorise',{...args,p_reference:'A different authorisation'})).toMatch(/immutable/);
 expect(await claim(run,{p_plan:sha('other')})).toBeNull();expect(await claim(run,{p_key_evidence:sha('other')})).toBeNull();
 expect(await ok(svc(),'studio_claim_recorded',{p_worker:'wrong-mode',p_run:run,p_bundle:c.bundle_sha256})).toBeNull();
 expect((await claim(run)).stageKey).toBe('S1_extract');
});
test('canonical runs and oversized trial grants cannot be authorised',async()=>{
 const canonical=await start('canonical');expect(await refused(op(),'studio_live_authorise',canonical.args)).toMatch(/contract refused/);
 const big=await start('rehearsal',{p_trial_limit:3000000});expect(await refused(op(),'studio_live_authorise',big.args)).toMatch(/contract refused/);
});
test('human inventory approval does not extend the trial to matching or later stages',async()=>{
 const {run,args}=await start();await ok(op(),'studio_live_authorise',args);const cl=await claim(run);
 const paid=await prepare(cl);await ok(svc(),'studio_budget_reserve',{...paid.args,p_request_manifest:paid.m});
 await ok(svc(),'studio_provider_dispatched',paid.args);
 await ok(svc(),'studio_provider_result',{...paid.args,p_outcome:'succeeded',p_provider_request_id:null,p_result_digest:sha('synthetic reply'),p_usage:{}});
 await ok(svc(),'studio_budget_settle',{p_provider_attempt:paid.p.providerAttemptId,p_actual_micro:1,p_evidence_sha256:sha('synthetic reply')});
 const out=await ok(svc(),'studio_put_output',{p_attempt:cl.attemptId,p_lease:cl.lease,p_logical_key:'inventory',p_kind:'inventory',p_sha256:sha('synthetic inventory'),p_size:19,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:paid.p.providerAttemptId});
 await ok(svc(),'studio_complete',{p_attempt:cl.attemptId,p_lease:cl.lease,p_outputs:[out.artifactId]});
 const gate=await ok(ed(),'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});
 expect(gate.live).toBeNull();
 await ok(ed(),'studio_record_decision',{p_run:run,p_gate:'G1_inventory',p_expected_version:gate.version,p_bound:[out.artifactId],p_outcome:'approved',p_rationale:'Synthetic inventory reviewed',p_authorisation:AUTH,p_items:[],p_command:key()});
 expect(await claim(run)).toBeNull();
 const unsafe=await ok(svc(),'studio_claim',{p_worker:'legacy-test'}),p=await prepare(unsafe);
 expect(unsafe.stageKey).toBe('S2_task_match');
 expect(await refused(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m})).toMatch(/disabled/);
});
test('revocation after reservation prevents dispatch and cannot be undone by worker or regrant',async()=>{
 const {run,args}=await start();await ok(op(),'studio_live_authorise',args);const cl=await claim(run),p=await prepare(cl);
 expect(await refused(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:{...p.m,mode:'recorded'}})).toMatch(/verified wire/);
 await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m});
 expect(await refused(svc(),'studio_live_revoke',{p_run:run,p_reason:'Stop the synthetic test'})).toMatch(/permission denied/);
 await ok(op(),'studio_live_revoke',{p_run:run,p_reason:'Stop the synthetic test'});
 expect(await refused(svc(),'studio_provider_dispatched',p.args)).toMatch(/disabled/);
 expect(await refused(op(),'studio_live_authorise',args)).toMatch(/immutable/);
 expect((await db.sql('select possible_charge from private.studio_provider_attempts'))[0].possible_charge).toBe(false);
});
test('expiry and revised inputs invalidate an already granted trial',async()=>{
 for(const reason of ['expired','revision']){
  const {run,args}=await start();await ok(op(),'studio_live_authorise',args);const cl=await claim(run),p=await prepare(cl,reason);
  if(reason==='expired')await db.sql("update private.studio_live_authorisations set expires_at=now()-interval '1 second' where run_id=$1",[run]);
  else await db.sql('update private.studio_live_authorisations set input_revision=input_revision+1 where run_id=$1',[run]);
  expect(await refused(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m})).toMatch(/disabled/);
  await ok(svc(),'studio_fail',{p_attempt:cl.attemptId,p_lease:cl.lease,p_error:'Synthetic stop',p_retryable:false});
 }
});
test('two-call ceiling includes failures and numbered operations even when money remains',async()=>{
 const {run,args}=await start();await ok(op(),'studio_live_authorise',args);const cl=await claim(run);
 for(let n=1;n<=3;n++){
  const p=await prepare(cl,'turn:'+n);await ok(svc(),'studio_budget_reserve',{...p.args,p_request_manifest:p.m});
  if(n===3){expect(await refused(svc(),'studio_provider_dispatched',p.args)).toMatch(/ceiling reached/);break;}
  await ok(svc(),'studio_provider_dispatched',p.args);
  await ok(svc(),'studio_provider_result',{p_provider_attempt:p.p.providerAttemptId,p_outcome:n===1?'failed':'succeeded',p_provider_request_id:null,p_result_digest:sha('reply'+n),p_usage:{},p_attempt:cl.attemptId,p_lease:cl.lease});
  await ok(svc(),'studio_budget_settle',{p_provider_attempt:p.p.providerAttemptId,p_actual_micro:1,p_evidence_sha256:sha('reply'+n)});
 }
 expect(await db.sql('select id from private.studio_provider_attempts where possible_charge')).toHaveLength(2);
});
