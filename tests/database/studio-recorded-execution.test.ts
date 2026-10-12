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
