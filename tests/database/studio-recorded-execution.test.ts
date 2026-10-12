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
import { StudioDb, ids, MODULE, SKILL, PROFILE, sha, ok, refused, key, blob, baseBank, importSnapshot, accept, gate, work, complete } from './studio-fixture';
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
