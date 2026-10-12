// @vitest-environment node
// Paired Python code + real migrated DB/gateway. Local storage and synthetic recorded responses.
// No model, real paper, bank, R2 or hosted worker is contacted.
import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStudioGateway } from '../../lib/studio/gateway';
import { LocalStudioStorage } from '../../lib/studio/storage/local';
import { StudioDb, ids, MODULE, SKILL, PROFILE, sha, ok, refused, key, blob, verified, baseBank, importSnapshot, accept, gate, work, complete } from './studio-fixture';
import { installBudgetContract, grantBudget } from './studio-budget-fixture';
const WORKER=process.env.STUDIO_E2E_WORKER, PYTHON=process.env.STUDIO_EXECUTION_PYTHON;
const enabled=!!WORKER && !!PYTHON, TOKEN='r'.repeat(48);
const db=new StudioDb();let server:Server,origin='',dir:string,snapshot:string,store:LocalStudioStorage;
const ed=()=>db.rpc({kind:'user',id:ids.editor}),svc=()=>db.rpc({kind:'service'});
beforeAll(async()=>{
 if(!enabled)return;
 await db.init();await installBudgetContract(db,sha(readFileSync(join(WORKER!,'studio/execution/manifest.json'))));const op=db.rpc({kind:'operator'});
 await ok(op,'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});
 snapshot=(await importSnapshot(op,MODULE,baseBank)).snapshotId;await accept(op,MODULE,snapshot,null);
 dir=mkdtempSync(join(tmpdir(),'studio-recorded-'));store=new LocalStudioStorage(join(dir,'store'));
 server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(c as Buffer);
  const response=await handleStudioGateway(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers as Record<string,string>,body:Buffer.concat(chunks)}),
   {token:TOKEN,otherTokens:[],rpc:svc(),storage:store});
  res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();origin=`http://127.0.0.1:${typeof a==='object'&&a?a.port:0}`;
},60000);
beforeEach(async()=>{if(enabled){await db.begin();return ()=>db.rollback();}});
afterAll(async()=>{if(enabled){await new Promise<void>(r=>server.close(()=>r()));await db.close();rmSync(dir,{recursive:true,force:true});}});
function state(){const p=mkdtempSync(join(dir,'state-'));chmodSync(p,0o700);return p;}
async function run(funded=true){
 const b=await blob(ed(),MODULE,'recorded source');
 const source=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic recorded execution',p_files:[{blobId:b,role:'combined',filename:'p.pdf'}],p_identity:{},p_command:key()});
 const id=(await ok(ed(),'studio_start_run',{p_source:source.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()})).runId as string;
 if(funded)await grantBudget(db,id);return id;
}
function child(cfg:Record<string,unknown>){
 return new Promise<{code:number|null,out:string,err:string}>(resolve=>{
  const p=spawn(PYTHON!,['-m','studio.tests.execution_driver'],{cwd:WORKER,env:{NODE_ENV:'test',PATH:process.env.PATH||'',TEACHER_PLATFORM_URL:origin,STUDIO_WORKER_TOKEN:TOKEN,PYTHONDONTWRITEBYTECODE:'1'}});
  let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>resolve({code,out,err}));p.stdin.end(JSON.stringify(cfg));
 });
}
for(const invalid of [false,true])for(const crash of ['before_raw','after_raw','after_classification','before_settle','after_settle']){
 test.skipIf(!enabled)(`recorded ${invalid?'invalid':'successful'} response survives process death at ${crash} without resend`,async()=>{
  await run();const c=await ok(svc(),'studio_claim',{p_worker:'recorded-test'});
  const lease={attemptId:c.attemptId,lease:c.lease},root=state();
  const died=await child({mode:'exchange',state:root,lease,invalid,crash});expect(died.code,died.err).toBe(71);
  const rows=await db.sql('select * from private.studio_provider_attempts');expect(rows).toHaveLength(1);
  const attempt=rows[0].id;
  // Restore retained files to a fresh state directory, representing explicit state recovery.
  // This is local recovery evidence, not an R2 or cross-host replication claim.
  const restored=state();cpSync(root,restored,{recursive:true});
  const settled=await child({mode:'settle',state:restored,providerAttemptId:attempt});
  if(crash==='before_raw'){
   expect(settled.code).not.toBe(0);
   expect((await db.sql('select dispatch_state from private.studio_provider_attempts'))[0].dispatch_state).toBe('dispatched');
  }else{
   expect(settled.code,settled.err).toBe(0);
   const row=(await db.sql('select dispatch_state,usage from private.studio_provider_attempts'))[0];
   expect(row.dispatch_state).toBe(invalid?'failed':'succeeded');
   expect(row.usage.studioOutcome).toBe(invalid?'invalid_response':'succeeded');
   const again=await child({mode:'settle',state:restored,providerAttemptId:attempt});expect(again.code,again.err).toBe(0);
  }
  const replay=await child({mode:'exchange',state:restored,lease,invalid,replay:true});
  if(invalid||crash==='before_raw')expect(replay.code).not.toBe(0);
  else{expect(replay.code,replay.err).toBe(0);expect(JSON.parse(replay.out)).toMatchObject({calls:0,reused:true});}
  expect(await db.sql('select id from private.studio_provider_attempts')).toHaveLength(1);
  if(invalid && crash!=='before_raw'){
   expect(await refused(svc(),'studio_put_output',{p_attempt:c.attemptId,p_lease:c.lease,p_logical_key:'inventory',p_kind:'inventory',p_sha256:sha('{}'),p_size:2,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:attempt})).toMatch(/not the current settled attempt/);
  }
 });
}
test.skipIf(!enabled)('matching tool loop replays two recorded turns then submits evidence without approving G2',async()=>{
 const id=await run(false);const w=await work(svc(),[{key:'inventory',kind:'inventory',content:'{}'}],'S1_extract');await complete(svc(),w.claim,w.made);await gate(ed(),id,'G1_inventory');await grantBudget(db,id);
 const c=await ok(svc(),'studio_claim',{p_worker:'recorded-matcher'});expect(c.stageKey).toBe('S2_task_match');
 const lease={attemptId:c.attemptId,lease:c.lease},root=state();
 const first=await child({mode:'loop',state:root,lease});expect(first.code,first.err).toBe(0);expect(JSON.parse(first.out).calls).toBe(2);
 const restored=state();cpSync(root,restored,{recursive:true});
 const replay=await child({mode:'loop',state:restored,lease,replay:true,finish:true});expect(replay.code,replay.err).toBe(0);
 const r=JSON.parse(replay.out);expect(r.calls).toBe(0);expect(r.result.humanApproval).toBe(false);expect(r.result.completion.state).toBe('succeeded');
 expect(await db.sql('select id from private.studio_provider_attempts')).toHaveLength(2);
 expect((await ok(ed(),'studio_gate_view',{p_run:id,p_gate:'G2_matches'})).live).toBeNull();
});

test.skipIf(!enabled)('registered whole-paper matching loads approved sources and bank; 62 leaves in 12 replayable batches, then 11 independent spec batches',async()=>{
 const syntheticSkill='# Synthetic skill fixture: review proposals; never publish.';
 await db.sql("insert into private.studio_skill_contracts(id,contract_sha256,skill_sha256,validator_sha256,files) select 'synthetic-matching@1',contract_sha256,$1,validator_sha256,files from private.studio_skill_contracts where id=$2",[sha(syntheticSkill),SKILL]);
 for(const f of baseBank)await store.put(`studio/blobs/${MODULE}/${sha(f.content)}`,Buffer.from(f.content),'text/markdown');
 const manifest=JSON.stringify({files:Object.fromEntries([...baseBank].sort((a,b)=>a.path<b.path?-1:1).map(f=>[f.path,sha(f.content)])),module:MODULE,schema:'reviseit/studio-bank-manifest@1'});
 await store.put(`studio/blobs/${MODULE}/${sha(manifest)}`,Buffer.from(manifest),'application/json');
 const sourceBytes='%PDF-1.7 synthetic registered source',b=await blob(ed(),MODULE,'registered source');
 await store.put(`studio/blobs/${MODULE}/${sha(sourceBytes)}`,Buffer.from(sourceBytes),'application/pdf');
 const src=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic full paper',p_files:[{blobId:b,role:'question_paper',filename:'fixture.pdf'}],p_identity:{},p_command:key()});
 const runId=(await ok(ed(),'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:snapshot,p_skill_contract:'synthetic-matching@1',p_profile:PROFILE,p_command:key()})).runId;
 const c1=await ok(svc(),'studio_claim',{p_worker:'intake'}),lease={attemptId:c1.attemptId,lease:c1.lease};
 expect(await refused(svc(),'studio_matching_inputs',{p_attempt:c1.attemptId,p_lease:c1.lease})).toMatch(/unavailable/);
 const revision=(await db.sql('select source_revision_id from private.studio_run_inputs where run_id=$1',[runId]))[0].source_revision_id;
 const intake=await child({mode:'prepare_intake',state:state(),lease,moduleId:MODULE,sourceSha256:sha(sourceBytes),sourceRevision:revision});expect(intake.code,intake.err).toBe(0);
 expect(await ok(svc(),'studio_claim',{p_worker:'before-approval'})).toBeNull();
 await gate(ed(),runId,'G1_inventory');await grantBudget(db,runId);
 const c=await ok(svc(),'studio_claim',{p_worker:'registered'});expect(c.stageKey).toBe('S2_task_match');
 const inputArgs={p_attempt:c.attemptId,p_lease:c.lease};
 expect(await refused(ed(),'studio_matching_inputs',inputArgs)).toMatch(/permission denied/);
 expect(await refused(svc(),'studio_matching_inputs',{...inputArgs,p_lease:key()})).toMatch(/lease lost/);
 const meta=await ok(svc(),'studio_matching_inputs',inputArgs);expect(meta.snapshotId).toBe(snapshot);expect(meta.records.length).toBeGreaterThan(3);
 const root=state();const first=await child({mode:'registered_batches',state:root,claim:c});expect(first.code,first.err).toBe(0);
 const f=JSON.parse(first.out);expect(f.calls).toBe(12);expect(f.report.result.leaves).toHaveLength(62);expect(f.report.humanApproval).toBe(false);
 const restored=state();cpSync(root,restored,{recursive:true});
 const replay=await child({mode:'registered_batches',state:restored,claim:c,replay:true,finish:true});expect(replay.code,replay.err).toBe(0);
 const r=JSON.parse(replay.out);expect(r.calls).toBe(0);expect(r.report).toEqual(f.report);expect(r.completed.state).toBe('succeeded');
 const c3=await ok(svc(),'studio_claim',{p_worker:'specification'});expect(c3.stageKey).toBe('S3_spec_match');
 const spec=await child({mode:'registered_batches',state:state(),claim:c3,finish:true});expect(spec.code,spec.err).toBe(0);
 expect(JSON.parse(spec.out).report.result.questions).toHaveLength(11);
 expect(await db.sql('select id from private.studio_provider_attempts')).toHaveLength(23);
 const g2=await ok(ed(),'studio_gate_view',{p_run:runId,p_gate:'G2_matches'});expect(g2.live).toBeNull();expect(g2.binding.artifacts).toHaveLength(25);
},60000);

test.skipIf(!enabled)('automatic PDF intake binds page evidence and final inventory to settled attempts; G1 blocks matching until editor approval',async()=>{
 await db.sql("insert into private.studio_skill_contracts(id,contract_sha256,skill_sha256,validator_sha256,files) select 'synthetic-intake@1',contract_sha256,$1,validator_sha256,files from private.studio_skill_contracts where id=$2",[sha('# Synthetic skill fixture: review proposals; never publish.'),SKILL]);
 for(const f of baseBank)await store.put(`studio/blobs/${MODULE}/${sha(f.content)}`,Buffer.from(f.content),'text/markdown');
 const manifest=JSON.stringify({files:Object.fromEntries([...baseBank].sort((a,b)=>a.path<b.path?-1:1).map(f=>[f.path,sha(f.content)])),module:MODULE,schema:'reviseit/studio-bank-manifest@1'});
 await store.put(`studio/blobs/${MODULE}/${sha(manifest)}`,Buffer.from(manifest),'application/json');
 const made=await child({mode:'fixture_pdf'});expect(made.code,made.err).toBe(0);
 const source=Buffer.from(JSON.parse(made.out).content,'base64'),digest=sha(source.toString('utf8')),editor=ed();
 const upload=await ok(editor,'studio_create_upload',{p_module:MODULE,p_sha256:digest,p_size:source.length,p_media_type:'application/pdf',p_filename:'misleading-name.pdf',p_purpose:'source',p_command:key()});
 await store.put(`studio/blobs/${MODULE}/${digest}`,source,'application/pdf');
 await ok(verified(editor),'studio_prepare_commit',{p_session:upload.sessionId,p_sha256:digest,p_size:source.length,p_detected_type:'application/pdf'});
 const b=await ok(verified(editor),'studio_commit_upload',{p_session:upload.sessionId});
 const src=await ok(editor,'studio_create_source',{p_module:MODULE,p_title:'Synthetic automatic intake',p_files:[{blobId:b.blobId,role:'question_paper',filename:'misleading-name.pdf'}],p_identity:{},p_command:key()});
 const runId=(await ok(editor,'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:snapshot,p_skill_contract:'synthetic-intake@1',p_profile:PROFILE,p_command:key()})).runId;
 await grantBudget(db,runId);
 const c=await ok(svc(),'studio_claim',{p_worker:'automatic-intake'}),args={p_attempt:c.attemptId,p_lease:c.lease};
 expect(await refused(editor,'studio_intake_inputs',args)).toMatch(/permission denied/);
 expect(await refused(svc(),'studio_intake_inputs',{...args,p_lease:key()})).toMatch(/lease lost/);
 const inputs=await ok(svc(),'studio_intake_inputs',args);expect(inputs.sources).toHaveLength(1);expect(inputs.sources[0].sha256).toBe(digest);
 const root=state(),first=await child({mode:'automatic_intake',state:root,claim:c});expect(first.code,first.err).toBe(0);
 const f=JSON.parse(first.out);expect(f.calls).toBe(5);expect(f.report.leafCount).toBe(2);expect(f.report.pageCount).toBe(4);
 expect(f.report.checks.reconciliation).toMatchObject({inventoriedMarks:'3',unknownMarkLeaves:1,memoComparison:'not_performed'});
 const restored=state();cpSync(root,restored,{recursive:true});
 const replay=await child({mode:'automatic_intake',state:restored,claim:c,replay:true,finish:true});expect(replay.code,replay.err).toBe(0);
 const r=JSON.parse(replay.out);expect(r.calls).toBe(0);expect(r.report).toEqual(f.report);expect(r.completed.state).toBe('succeeded');
 expect(await db.sql("select id from private.studio_provider_attempts where dispatch_state='succeeded'")).toHaveLength(5);
 expect(await db.sql("select provider_attempt_id from private.studio_budget_reservations where state='settled'")).toHaveLength(5);
 const artifacts=await db.sql("select kind,provider_attempt_id from private.studio_artifacts where run_id=$1",[runId]);
 expect(artifacts.find((a:any)=>a.kind==='inventory')?.provider_attempt_id).toBe(f.report.inventoryProviderAttemptId);
 const gateBefore=await ok(editor,'studio_gate_view',{p_run:runId,p_gate:'G1_inventory'});expect(gateBefore.live).toBeNull();expect(gateBefore.binding.artifacts).toHaveLength(11);
 expect(await ok(svc(),'studio_claim',{p_worker:'before-human'})).toBeNull();
 await gate(editor,runId,'G1_inventory');
 const next=await ok(svc(),'studio_claim',{p_worker:'after-human'});expect(next.stageKey).toBe('S2_task_match');
 expect(await refused(svc(),'studio_intake_inputs',{p_attempt:next.attemptId,p_lease:next.lease})).toMatch(/unavailable/);
 const match=await child({mode:'registered_batches',state:state(),claim:next,finish:true});expect(match.code,match.err).toBe(0);
 expect(JSON.parse(match.out).report.result.leaves).toHaveLength(2);
},60000);

for(const newRecords of [false,true])test.skipIf(!enabled)(`complete recorded S1-S7 ${newRecords?'empty-bank proposals':'deferred no-change'} preserves all review checkpoints and thirteen-file package`,async()=>{
 const ac=await child({mode:'analysis_authority'});expect(ac.code,ac.err).toBe(0);const hashes=JSON.parse(ac.out);
 await db.sql("insert into private.studio_skill_contracts(id,contract_sha256,skill_sha256,validator_sha256,files) values('synthetic-analysis@1',$1,$2,$3,$4)",[sha(JSON.stringify(hashes)),hashes['SKILL.md'],hashes['scripts/validate_bank.py'],hashes]);
 let bank=newRecords?[baseBank[0]]:baseBank.map(f=>f.record?.kind==='specification'?{...f,content:f.content+'\n**Spec ID:** P1-PHYS-01\n'}:f);
 const op=db.rpc({kind:'operator'}),pinned=(await importSnapshot(op,MODULE,bank)).snapshotId;await accept(op,MODULE,pinned,snapshot);
 for(const f of bank)await store.put(`studio/blobs/${MODULE}/${sha(f.content)}`,Buffer.from(f.content),'text/markdown');
 const manifest=JSON.stringify({files:Object.fromEntries([...bank].sort((a,b)=>a.path<b.path?-1:1).map(f=>[f.path,sha(f.content)])),module:MODULE,schema:'reviseit/studio-bank-manifest@1'});
 await store.put(`studio/blobs/${MODULE}/${sha(manifest)}`,Buffer.from(manifest),'application/json');
 const made=await child({mode:'fixture_pdf'});expect(made.code,made.err).toBe(0);
 const source=Buffer.from(JSON.parse(made.out).content,'base64'),digest=sha(source.toString('utf8')),editor=ed();
 const upload=await ok(editor,'studio_create_upload',{p_module:MODULE,p_sha256:digest,p_size:source.length,p_media_type:'application/pdf',p_filename:'synthetic.pdf',p_purpose:'source',p_command:key()});
 await store.put(`studio/blobs/${MODULE}/${digest}`,source,'application/pdf');
 await ok(verified(editor),'studio_prepare_commit',{p_session:upload.sessionId,p_sha256:digest,p_size:source.length,p_detected_type:'application/pdf'});
 const b=await ok(verified(editor),'studio_commit_upload',{p_session:upload.sessionId});
 const src=await ok(editor,'studio_create_source',{p_module:MODULE,p_title:'Synthetic complete analysis',p_files:[{blobId:b.blobId,role:'question_paper',filename:'synthetic.pdf'}],p_identity:{},p_command:key()});
 const runId=(await ok(editor,'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:pinned,p_skill_contract:'synthetic-analysis@1',p_profile:PROFILE,p_command:key()})).runId;
 await grantBudget(db,runId);
 const execute=async(stage:string,finish=true,replay=false,c?:any,root?:string)=>{
  c??=await ok(svc(),'studio_claim',{p_worker:'analysis-test'});expect(c.stageKey).toBe(stage);
  const mode=stage==='S1_extract'?'automatic_intake':stage==='S2_task_match'||stage==='S3_spec_match'?'analysis_match':'analysis_stage';
  const p=await child({mode,state:root||state(),claim:c,newRecords,replay,finish});expect(p.code,p.err).toBe(0);
  return JSON.parse(p.out);
 };
 await execute('S1_extract');expect(await ok(svc(),'studio_claim',{p_worker:'before-G1'})).toBeNull();await gate(editor,runId,'G1_inventory');
 await execute('S2_task_match');await execute('S3_spec_match');expect(await ok(svc(),'studio_claim',{p_worker:'before-G2'})).toBeNull();await gate(editor,runId,'G2_matches');
 const c4=await ok(svc(),'studio_claim',{p_worker:'gaps'});
 expect(await refused(editor,'studio_analysis_inputs',{p_attempt:c4.attemptId,p_lease:c4.lease})).toMatch(/permission denied/);
 expect(await refused(svc(),'studio_analysis_inputs',{p_attempt:c4.attemptId,p_lease:key()})).toMatch(/lease lost/);
 const gaps=await execute('S4_prioritise',true,false,c4);expect(gaps.report.gaps.length).toBeGreaterThan(0);
 const c5=await ok(svc(),'studio_claim',{p_worker:'author'}),s5=state();
 const draft=await execute('S5_draft',false,false,c5,s5);expect(draft.report.drafts).toHaveLength(newRecords?4:0);expect(draft.report.deferred.length).toBeGreaterThan(0);
 const afterDraft=(await db.sql('select count(*)::int n from private.studio_provider_attempts'))[0].n;
 const dr=await execute('S5_draft',true,true,c5,state());expect(dr.report).toEqual(draft.report);expect((await db.sql('select count(*)::int n from private.studio_provider_attempts'))[0].n).toBe(afterDraft);
 const c6=await ok(svc(),'studio_claim',{p_worker:'validator'}),s6=state();
 const checked=await execute('S6_assemble_validate',false,false,c6,s6);expect(checked.report.bankStructuralOk,JSON.stringify(checked.report.recordContractErrors)).toBe(true);expect(checked.report.legacyInventoryCompatible).toBe(false);
 const changeset=await db.sql("select id from private.studio_changesets where run_id=$1 and state='draft'",[runId]);expect(changeset).toHaveLength(1);
 const cr=await execute('S6_assemble_validate',true,true,c6,state());expect(cr.report).toEqual(checked.report);
 expect(await db.sql("select id from private.studio_changesets where run_id=$1 and state='draft'",[runId])).toEqual(changeset);
 expect(await ok(svc(),'studio_claim',{p_worker:'before-G3'})).toBeNull();await gate(editor,runId,'G3_records');
 expect(await ok(svc(),'studio_claim',{p_worker:'before-G4'})).toBeNull();
 const g4=await ok(editor,'studio_gate_view',{p_run:runId,p_gate:'G4_content'});
 const judgments=g4.changeset.records.map((r:any)=>({recordKind:r.kind,recordId:r.id,aspect:'method',verdict:'unresolved',reason:'Synthetic protocol test, not scientific acceptance',disposition:'scoped_exception',exceptionRationale:'Synthetic fixtures only; no bank write or publication'}));
 await gate(editor,runId,'G4_content','approved',judgments);
 const c7=await ok(svc(),'studio_claim',{p_worker:'package'}),s7=state();
 const packaged=await execute('S7_package',false,false,c7,s7);expect(packaged.report.requiredFiles).toHaveLength(13);
 expect(packaged.report.files.length).toBe(newRecords?22:13);expect(packaged.report.integrationOccurred).toBe(false);
 expect(packaged.report.sourceAttachments).toHaveLength(1);
 const again=await execute('S7_package',true,true,c7,state());expect(again.report).toEqual(packaged.report);
 const g5=await ok(editor,'studio_gate_view',{p_run:runId,p_gate:'G5_integration'});expect(g5.live).toBeNull();expect(g5.changeset.state).toBe('draft');
 expect((await db.sql('select accepted_snapshot_id from private.studio_modules where module_id=$1',[MODULE]))[0].accepted_snapshot_id).toBe(pinned);
},120000);

for(const invalid of [false,true])test.skipIf(!enabled)(`fresh worker restores remote ${invalid?'failure':'success'} after response upload and before settlement`,async()=>{
 await run();const c=await ok(svc(),'studio_claim',{p_worker:'remote-crash'}),lease={attemptId:c.attemptId,lease:c.lease},old=state();
 const died=await child({mode:'exchange',state:old,lease,invalid,crash:'after_remote'});expect(died.code,died.err).toBe(71);
 const a=(await db.sql('select id,dispatch_state from private.studio_provider_attempts'))[0];expect(a.dispatch_state).toBe('dispatched');
 const copies=await db.sql('select kind,state from private.studio_provider_evidence');expect(copies).toHaveLength(2);expect(copies.every((r:any)=>r.state==='verified')).toBe(true);
 rmSync(old,{recursive:true});const fresh=state();
 const restored=await child({mode:'settle',state:fresh,providerAttemptId:a.id});expect(restored.code,restored.err).toBe(0);
 expect((await db.sql('select dispatch_state,usage from private.studio_provider_attempts'))[0]).toMatchObject({dispatch_state:invalid?'failed':'succeeded',usage:{evidenceLocation:'remote_verified'}});
 const replay=await child({mode:'exchange',state:fresh,lease,invalid,replay:true});
 if(invalid)expect(replay.code).not.toBe(0);else{expect(replay.code,replay.err).toBe(0);expect(JSON.parse(replay.out).calls).toBe(0);}
 expect(await db.sql('select id from private.studio_provider_attempts')).toHaveLength(1);
});
test.skipIf(!enabled)('lost local reply before remote copy stays visible and cannot settle or dispatch again',async()=>{
 await run();const c=await ok(svc(),'studio_claim',{p_worker:'missing-evidence'}),lease={attemptId:c.attemptId,lease:c.lease},old=state();
 expect((await child({mode:'exchange',state:old,lease,crash:'before_remote'})).code).toBe(71);
 const a=(await db.sql('select id from private.studio_provider_attempts'))[0];rmSync(old,{recursive:true});const fresh=state();
 expect((await child({mode:'settle',state:fresh,providerAttemptId:a.id})).code).not.toBe(0);
 expect((await child({mode:'exchange',state:fresh,lease,replay:true})).code).not.toBe(0);
 expect(await ok(svc(),'studio_evidence_pending',{})).toMatchObject([{providerAttemptId:a.id,dispatchState:'dispatched',exchangeState:'missing'}]);
 expect(await refused(svc(),'studio_provider_result',{p_provider_attempt:a.id,p_outcome:'succeeded',p_result_digest:sha('unretained'),p_provider_request_id:null,p_usage:{},p_attempt:c.attemptId,p_lease:c.lease})).toMatch(/not durable/);
});
test.skipIf(!enabled)('large remote envelope is chunked, immutable, protected from cleanup and inaccessible to editors',async()=>{
 await run();const c=await ok(svc(),'studio_claim',{p_worker:'large-evidence'}),lease={attemptId:c.attemptId,lease:c.lease},old=state();
 const first=await child({mode:'exchange',state:old,lease,large:true});expect(first.code,first.err).toBe(0);
 const aid=JSON.parse(first.out).attempt,info=await ok(svc(),'studio_evidence_info',{p_provider_attempt:aid,p_kind:'exchange'});expect(info.parts.length).toBeGreaterThan(1);
 expect(await refused(ed(),'studio_evidence_info',{p_provider_attempt:aid,p_kind:'exchange'})).toMatch(/permission denied/);
 expect(await ok(svc(),'studio_gc_claim',{p_key:info.parts[0].key})).toBe(false);
 expect(await refused(svc(),'studio_evidence_begin',{p_provider_attempt:aid,p_kind:'exchange',p_sha256:sha('tampered'),p_size:info.size,p_parts:info.parts.map((p:any)=>({ordinal:p.ordinal,sha256:p.sha256,size:p.size})),p_attempt:null,p_lease:null})).toMatch(/replay changed/);
 rmSync(old,{recursive:true});const replay=await child({mode:'exchange',state:state(),lease,large:true,replay:true});expect(replay.code,replay.err).toBe(0);expect(JSON.parse(replay.out).calls).toBe(0);
 await store.put(info.parts[0].key,Buffer.from('corrupt'),'application/octet-stream');
 const corrupt=await child({mode:'settle',state:state(),providerAttemptId:aid});expect(corrupt.code).not.toBe(0);
 expect(await ok(svc(),'studio_evidence_pending',{})).toMatchObject([{providerAttemptId:aid,integrityBlocked:true}]);
 expect((await db.sql('select count(*)::int n from private.studio_provider_attempts'))[0].n).toBe(1);
});
