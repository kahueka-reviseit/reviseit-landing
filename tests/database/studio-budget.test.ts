// @vitest-environment node
// Integer-microdollar ledger, real migration/RPCs. Synthetic allowances only.
import { beforeAll,beforeEach,afterAll,test,expect } from 'vitest';
import { StudioDb,ids,MODULE,SKILL,PROFILE,sha,ok,refused,key,blob,importSnapshot,baseBank,accept } from './studio-fixture';
import { CONTRACT,installBudgetContract,grantBudget,grantArgs,manifest } from './studio-budget-fixture';
const db=new StudioDb(),ed=()=>db.rpc({kind:'user',id:ids.editor}),svc=()=>db.rpc({kind:'service'}),op=()=>db.rpc({kind:'operator'});let snapshot:string;
beforeAll(async()=>{await db.init();await installBudgetContract(db);await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});snapshot=(await importSnapshot(op(),MODULE,baseBank)).snapshotId;await accept(op(),MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return ()=>db.rollback();});afterAll(()=>db.close());
async function start(limit=1000,trial=key(),scopes:Record<string,number>={}){
 const b=await blob(ed(),MODULE,'budget source');const src=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Budget fixture',p_files:[{blobId:b,role:'combined',filename:'p.pdf'}],p_identity:{},p_command:key()});
 const id=(await ok(ed(),'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()})).runId;
 await ok(op(),'studio_budget_grant',{...grantArgs(id,limit,trial),...scopes});return id;
}
async function prepared(c:any,name='turn:1'){
 return ok(svc(),'studio_provider_prepare',{p_attempt:c.attemptId,p_lease:c.lease,p_operation:name,p_request_digest:sha(name)});
}
const reservation=(c:any,p:any,extra={})=>({p_attempt:c.attemptId,p_lease:c.lease,p_provider_attempt:p.providerAttemptId,p_request_manifest:manifest(sha(p.name||'turn:1'),extra)});
const dispatch=(c:any,p:any)=>ok(svc(),'studio_provider_dispatched',{p_attempt:c.attemptId,p_lease:c.lease,p_provider_attempt:p.providerAttemptId});
const result=(c:any,p:any)=>ok(svc(),'studio_provider_result',{p_provider_attempt:p.providerAttemptId,p_outcome:'succeeded',p_provider_request_id:null,p_result_digest:sha('reply'),p_usage:{},p_attempt:c.attemptId,p_lease:c.lease});
const settle=(p:any,actual:number|null)=>ok(svc(),'studio_budget_settle',{p_provider_attempt:p.providerAttemptId,p_actual_micro:actual,p_evidence_sha256:sha('reply')});
const reconcile=(p:any,actual:number,release=false,rev=0)=>ok(op(),'studio_budget_reconcile',{p_provider_attempt:p.providerAttemptId,p_expected_revision:rev,p_actual_micro:actual,p_evidence_sha256:sha('billing-evidence'),p_reason:'Verified synthetic cost',p_release_unsent:release});
const output=(c:any,p:any)=>({p_attempt:c.attemptId,p_lease:c.lease,p_logical_key:'inventory',p_kind:'inventory',p_sha256:sha('{}'),p_size:2,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:p.providerAttemptId});

test('only the operator can grant; allowances and pricing pins cannot be rewritten',async()=>{
 const id=await start();expect(await refused(ed(),'studio_budget_grant',grantArgs(id))).toMatch(/permission denied/);
 expect(await refused(svc(),'studio_budget_grant',grantArgs(id))).toMatch(/permission denied/);
 await expect(db.sql("update private.studio_budget_contracts set model='different' where id=$1",[CONTRACT])).rejects.toThrow(/immutable/);
 expect(await refused(op(),'studio_budget_grant',grantArgs(id,2000))).toMatch(/identity conflict/);
 await expect(db.sql('select * from private.studio_budget_reservations',[],'service_role')).rejects.toThrow(/permission denied/);
});

test('dispatch needs prior atomic reservation; identical reservation is a no-op',async()=>{
 await start();const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 expect(await refused(svc(),'studio_provider_dispatched',{p_attempt:c.attemptId,p_lease:c.lease,p_provider_attempt:p.providerAttemptId})).toMatch(/reservation required/);
 const first=await ok(svc(),'studio_budget_reserve',reservation(c,p));expect(first.reservedMicro).toBe(200);
 expect(await ok(svc(),'studio_budget_reserve',reservation(c,p))).toMatchObject({reservedMicro:200,reused:true});
 expect(await db.sql('select * from private.studio_budget_reservations')).toHaveLength(1);
 await dispatch(c,p);await result(c,p);expect(await settle(p,125)).toMatchObject({halted:false,actualMicro:125});
 expect(await settle(p,125)).toMatchObject({halted:false,actualMicro:125});
 expect(await db.sql('select * from private.studio_budget_receipts')).toHaveLength(1);
 const reused=await prepared(c);expect(reused.action).toBe('reuse');
 expect(await db.sql('select * from private.studio_budget_reservations')).toHaveLength(1);
 await ok(svc(),'studio_put_output',output(c,p));
});

test('input, output, profile, bundle, capability and pricing pins are checked before admission',async()=>{
 await start();const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 for(const extra of [{outputTokens:0},{outputTokens:null},{outputTokens:32769},{requestBytes:200,inputTokenBound:100},
  {imageCount:1,inputTokenBound:100},{inputTokenBound:10000001},{bundleDigest:sha('wrong')},{capabilityDigest:sha('wrong')},{pricingDigest:sha('wrong')},{model:'other'}]){
  expect(await refused(svc(),'studio_budget_reserve',reservation(c,p,extra))).toMatch(/required|exceeds|mismatch/);
 }
 await db.sql("update private.studio_provider_profiles set enabled=false where id='mock-v0'");
 expect(await refused(svc(),'studio_budget_reserve',reservation(c,p))).toMatch(/profile unavailable/);
 expect(await db.sql('select * from private.studio_budget_reservations')).toHaveLength(0);
});

test('shared trial, run and stage ceilings account for held reservations',async()=>{
 const trial=key();await start(300,trial);const a=await ok(svc(),'studio_claim',{p_worker:'budget-a'}),pa=await prepared(a);
 await ok(svc(),'studio_budget_reserve',reservation(a,pa));
 await start(300,trial);const b=await ok(svc(),'studio_claim',{p_worker:'budget-b'}),pb=await prepared(b);
 expect(pb.operationId).not.toBe(pa.operationId);expect(pb.providerAttemptId).not.toBe(pa.providerAttemptId);
 expect(await refused(svc(),'studio_budget_reserve',reservation(b,pb))).toMatch(/exhausted/);
 expect((await db.sql('select sum(reserved_micro)::int n from private.studio_budget_reservations'))[0].n).toBe(200);
});

test('the stage ceiling cannot be bypassed by a second operation within a larger run allowance',async()=>{
 await start(1000,key(),{p_stage_limit:300,p_operation_limit:300});const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 await ok(svc(),'studio_budget_reserve',reservation(c,p));const next={...await prepared(c,'turn:2'),name:'turn:2'};
 expect(await refused(svc(),'studio_budget_reserve',reservation(c,next))).toMatch(/exhausted/);
});

for(const operationLimit of [300,400])test(`explicit retry keeps original charges within operation allowance ${operationLimit}`,async()=>{
 await start(1000,key(),{p_operation_limit:operationLimit});const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 await ok(svc(),'studio_budget_reserve',reservation(c,p));await dispatch(c,p);
 await ok(svc(),'studio_mark_uncertain',{p_attempt:c.attemptId,p_lease:c.lease,p_reason:'Lost response'});
 await ok(ed(),'studio_retry_stage',{p_stage:c.stageId,p_expected_attempts:1,p_reason:'Explicit retry after response loss',p_command:key()});
 const nextClaim=await ok(svc(),'studio_claim',{p_worker:'retry'}),next=await prepared(nextClaim);
 expect(next.attemptNumber).toBe(2);expect(next.providerAttemptId).not.toBe(p.providerAttemptId);
 expect(await refused(svc(),'studio_budget_reserve',reservation(nextClaim,next))).toMatch(/reconciliation required/);
 await reconcile(p,150);
 if(operationLimit===300){
  expect(await refused(svc(),'studio_budget_reserve',reservation(nextClaim,next))).toMatch(/exhausted/);
  expect(await db.sql('select * from private.studio_budget_reservations')).toHaveLength(1);
  return;
 }
 await ok(svc(),'studio_budget_reserve',reservation(nextClaim,next));
 expect((await db.sql('select sum(coalesce(actual_micro,reserved_micro))::int n from private.studio_budget_reservations'))[0].n).toBe(350);
 await result(c,p);expect(await settle(p,150)).toMatchObject({halted:false,actualMicro:150});
 expect(await refused(svc(),'studio_put_output',output(nextClaim,p))).toMatch(/not the current settled attempt/);
 await dispatch(nextClaim,next);await result(nextClaim,next);await settle(next,70);
 expect((await db.sql('select sum(actual_micro)::int n from private.studio_budget_reservations'))[0].n).toBe(220);
 expect(await db.sql('select * from private.studio_budget_receipts')).toHaveLength(2);
});

test('unknown usage holds its full reservation and blocks output and further admission until explicit reconciliation',async()=>{
 await start();const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 await ok(svc(),'studio_budget_reserve',reservation(c,p));await dispatch(c,p);await result(c,p);
 expect(await settle(p,null)).toMatchObject({halted:true,actualMicro:null});
 expect(await refused(svc(),'studio_put_output',output(c,p))).toMatch(/not cleared/);
 const next={...await prepared(c,'turn:2'),name:'turn:2'};
 expect(await refused(svc(),'studio_budget_reserve',reservation(c,next))).toMatch(/reconciliation required/);
 await reconcile(p,120);expect(await settle(p,null)).toMatchObject({halted:false,actualMicro:120});
 await ok(svc(),'studio_budget_reserve',reservation(c,next));
 expect((await db.sql('select sum(coalesce(actual_micro,reserved_micro))::int n from private.studio_budget_reservations'))[0].n).toBe(320);
});

test('actual cost above reservation is recorded truthfully and prevents terminal acceptance',async()=>{
 await start();const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 await ok(svc(),'studio_budget_reserve',reservation(c,p));await dispatch(c,p);await result(c,p);
 expect(await settle(p,800)).toMatchObject({halted:true,actualMicro:800,reservedMicro:200});
 expect(await refused(svc(),'studio_put_output',output(c,p))).toMatch(/not cleared/);
 const next={...await prepared(c,'turn:2'),name:'turn:2'};
 expect(await refused(svc(),'studio_budget_reserve',reservation(c,next))).toMatch(/reconciliation required/);
});

test('unsent reservations can be released, but dispatched or uncertain requests cannot be refunded automatically',async()=>{
 await start(300);const c=await ok(svc(),'studio_claim',{p_worker:'budget'}),p=await prepared(c);
 await ok(svc(),'studio_budget_reserve',reservation(c,p));await reconcile(p,0,true);
 expect(await refused(svc(),'studio_provider_dispatched',{p_attempt:c.attemptId,p_lease:c.lease,p_provider_attempt:p.providerAttemptId})).toMatch(/not dispatchable/);
 const next={...await prepared(c,'turn:2'),name:'turn:2'};await ok(svc(),'studio_budget_reserve',reservation(c,next));await dispatch(c,next);
 expect(await refused(op(),'studio_budget_reconcile',{p_provider_attempt:next.providerAttemptId,p_expected_revision:0,p_actual_micro:0,p_evidence_sha256:sha('x'),p_reason:'Cancel after send',p_release_unsent:true})).toMatch(/possibly charged/);
 await ok(svc(),'studio_mark_uncertain',{p_attempt:c.attemptId,p_lease:c.lease,p_reason:'Response lost'});
 expect((await db.sql('select reserved_micro,actual_micro,state from private.studio_budget_reservations where provider_attempt_id=$1',[next.providerAttemptId]))[0]).toMatchObject({reserved_micro:200,actual_micro:null,state:'held'});
});
