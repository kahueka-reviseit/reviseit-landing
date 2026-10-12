// @vitest-environment node
// Real migrations and RPCs; synthetic bytes. No provider or hosted database.
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { StudioDb, ids, MODULE, SKILL, PROFILE, AUTH, ok, refused, key, blob, importSnapshot, baseBank, accept, work, complete, gate, sha } from './studio-fixture';
const db = new StudioDb();
const ed = () => db.rpc({kind:'user',id:ids.editor});
const svc = () => db.rpc({kind:'service'});
const op = () => db.rpc({kind:'operator'});
let snapshot: string;
beforeAll(async () => {
  await db.init();
  await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});
  snapshot = (await importSnapshot(op(),MODULE,baseBank)).snapshotId;
  await accept(op(),MODULE,snapshot,null);
},60000);
beforeEach(async () => { await db.begin(); return () => db.rollback(); });
afterAll(() => db.close());
async function start() {
  const b = await blob(ed(),MODULE,'source');
  const src = await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Output authority',p_files:[{blobId:b,role:'combined',filename:'paper.pdf'}],p_identity:{},p_command:key()});
  return (await ok(ed(),'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()})).runId as string;
}
const args = (c:any, kind='inventory', logical='inventory', content='{}') => ({p_attempt:c.attemptId,p_lease:c.lease,p_logical_key:logical,p_kind:kind,p_sha256:sha(content),p_size:Buffer.byteLength(content),p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:null});
async function inventory(run:string) {
  const w = await work(svc(),[{key:'inventory',kind:'inventory',content:'{}'}],'S1_extract');
  await complete(svc(),w.claim,w.made);
  await gate(ed(),run,'G1_inventory');
  return w;
}
const view = (run:string,g='G1_inventory') => ok(ed(),'studio_gate_view',{p_run:run,p_gate:g});

test('P02A: a matching stage cannot overwrite extraction evidence, even by changing its kind',async()=>{
  const run=await start(); const w=await inventory(run);
  const before=await view(run);
  const c=await ok(svc(),'studio_claim',{p_worker:'matcher'});
  expect(c.stageKey).toBe('S2_task_match');
  for(const kind of ['inventory','evidence','task_matches'])
    expect(await refused(svc(),'studio_put_output',args(c,kind,'inventory','{"changed":true}'))).toMatch(/Output ownership/);
  const after=await view(run);
  expect(after.live.id).toBe(before.live.id);
  expect(after.binding.artifacts.map((a:any)=>a.id)).toEqual(w.made);
});

test('fresh outputs are restricted to the owning stage for every non-evidence kind',async()=>{
  await start();const c=await ok(svc(),'studio_claim',{p_worker:'extractor'});
  for(const kind of ['task_matches','spec_matches','gap_list','draft_record','changeset_manifest','validation_result','package_file'])
    expect(await refused(svc(),'studio_put_output',args(c,kind,'foreign'))).toMatch(/Output ownership/);
});

test('same-attempt replay returns the same revision; changing bytes or metadata is refused',async()=>{
  await start();const c=await ok(svc(),'studio_claim',{p_worker:'extractor'});
  const a=args(c);const first=await ok(svc(),'studio_put_output',a);
  expect(await ok(svc(),'studio_put_output',a)).toEqual(first);
  expect(await refused(svc(),'studio_put_output',{...a,p_meta:{different:true}})).toMatch(/Output replay changed/);
  expect(await refused(svc(),'studio_put_output',args(c,'inventory','inventory','changed'))).toMatch(/Output replay changed/);
  expect((await db.sql('select count(*)::int n from private.studio_artifacts'))[0].n).toBe(1);
  await complete(svc(),c,[first.artifactId]);
});

test('read-time liveness rejects a historical binding whose current artifact was superseded',async()=>{
  const run=await start();const w=await inventory(run);
  // Simulate rows left by the pre-041 write defect, without invoking its now-refused RPC.
  await db.sql("update private.studio_artifacts set state='superseded' where id=$1",[w.made[0]]);
  const v=await view(run);
  expect(v.live).toBeNull();
  expect((await db.sql('select invalidated_at from private.studio_decisions where run_id=$1',[run]))[0].invalidated_at).toBeNull();
  expect((await db.sql("select private.studio_stage_upstream($1,'S2_task_match') value",[run]))[0].value).toBeNull();
});

test('an authorised editor revision invalidates the decision and fences already-claimed downstream work',async()=>{
  const run=await start();const w=await inventory(run);const before=await view(run);
  const c=await ok(svc(),'studio_claim',{p_worker:'matcher'});
  const b=await blob(ed(),MODULE,'{"corrected":true}','application/json','revision');
  const a={p_artifact:w.made[0],p_blob:b,p_rationale:'Correct source reading',p_command:key()};
  const revision=await ok(ed(),'studio_revise_artifact',a);
  expect(await ok(ed(),'studio_revise_artifact',a)).toEqual(revision);
  const after=await view(run);expect(after.live).toBeNull();expect(after.version).toBeGreaterThan(before.version);
  expect(await refused(svc(),'studio_put_output',args(c,'task_matches','task_matches'))).toMatch(/Studio lease lost/);
  expect(await refused(ed(),'studio_record_decision',{p_run:run,p_gate:'G1_inventory',p_expected_version:before.version,p_bound:w.made,p_outcome:'approved',p_rationale:'Stale screen',p_authorisation:AUTH,p_items:[],p_command:key()})).toMatch(/Gate changed/);
  await gate(ed(),run,'G1_inventory');
  expect((await view(run)).binding.artifacts[0].id).toBe(revision.artifactId);
});

test('permitted replacement by a new owning attempt invalidates bound approvals atomically',async()=>{
  const run=await start();const w=await inventory(run);
  // Exercise defence for an explicit future re-run. The public retry command still refuses succeeded stages.
  await db.sql("update private.studio_stages set state='queued',current_attempt_id=null where id=$1",[w.claim.stageId]);
  const c=await ok(svc(),'studio_claim',{p_worker:'new-extractor'});
  expect(c.stageId).toBe(w.claim.stageId);
  const r=await ok(svc(),'studio_put_output',args(c,'inventory','inventory','{"revised":true}'));
  expect(r.revision).toBe(2);
  const decision=(await db.sql('select invalidated_at from private.studio_decisions where run_id=$1',[run]))[0];
  expect(decision.invalidated_at).not.toBeNull();
  expect((await db.sql("select count(*)::int n from private.studio_stages where run_id=$1 and stage_key='S2_task_match' and state='queued'",[run]))[0].n).toBe(0);
  await complete(svc(),c,[r.artifactId]);
  expect((await view(run)).live).toBeNull();
  await gate(ed(),run,'G1_inventory');
  expect((await view(run)).binding.artifacts[0].id).toBe(r.artifactId);
});
