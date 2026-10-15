// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,SKILL,PROFILE,ok,refused,key,blob,baseBank,importSnapshot,accept,work,complete,gate} from './studio-fixture';
let db:StudioDb,snapshot:string;const ed=()=>db.rpc({kind:'user',id:ids.editor}),svc=()=>db.rpc({kind:'service'});
beforeAll(async()=>{db=new StudioDb();await db.init();const op=db.rpc({kind:'operator'});await ok(op,'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});snapshot=(await importSnapshot(op,MODULE,baseBank)).snapshotId;await accept(op,MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return ()=>db.rollback();});afterAll(()=>db.close());
async function fixture(){
 const b=await blob(ed(),MODULE,'synthetic combined PDF');const source=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Reuse fixture',p_files:[{blobId:b,role:'combined',filename:'paper.pdf'}],p_identity:{},p_command:key()});
 const start=async()=> (await ok(ed(),'studio_start_run',{p_source:source.sourceId,p_expected_source_revision:1,p_purpose:'rehearsal',p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()})).runId;
 const old=await start();const w=await work(svc(),[{key:'inventory',kind:'inventory',content:'{"reviewed":true}'},{key:'page:one',kind:'page_text',content:'{"page":1}'},{key:'evidence:source_pages',kind:'evidence',content:'{"pages":[1]}'}],'S1_extract');await complete(svc(),w.claim,w.made);await gate(ed(),old,'G1_inventory');
 const decision=(await ok(ed(),'studio_gate_view',{p_run:old,p_gate:'G1_inventory'})).live.id;const target=await start();
 return {old,target,w,args:{p_run:target,p_from_run:old,p_expected_decision:decision,p_reason:'Transport repair: reuse identical reviewed evidence without scanning again',p_command:key()}};
}
test('exact blobs and provenance survive; no invented calls or transferred approval; replay is idempotent',async()=>{
 const f=await fixture();const before=await db.sql('select * from private.studio_artifacts where run_id=$1 order by logical_key',[f.old]);
 const r=await ok(ed(),'studio_reuse_reviewed_intake',f.args);expect(await ok(ed(),'studio_reuse_reviewed_intake',f.args)).toEqual(r);
 const after=await db.sql('select * from private.studio_artifacts where run_id=$1 order by logical_key',[f.target]);expect(after).toHaveLength(3);
 for(let n=0;n<3;n++){expect(after[n].blob_id).toBe(before[n].blob_id);expect(after[n].sha256).toBe(before[n].sha256);expect(after[n].parent_id).toBe(before[n].id);expect(after[n].meta.reusedIntake.runId).toBe(f.old);expect(after[n].provider_attempt_id).toBeNull();}
 expect(await db.sql('select * from private.studio_artifacts where run_id=$1 order by logical_key',[f.old])).toEqual(before);
 const v=await ok(ed(),'studio_gate_view',{p_run:f.target,p_gate:'G1_inventory'});expect(v.live).toBeNull();expect(v.binding.artifacts).toHaveLength(3);
 expect(await db.sql('select stage_key,state,attempt_count from private.studio_stages where run_id=$1',[f.target])).toEqual([{stage_key:'S1_extract',state:'succeeded',attempt_count:0}]);
 await gate(ed(),f.target,'G1_inventory');expect((await db.sql('select stage_key from private.studio_stages where run_id=$1 order by seq',[f.target])).map(x=>x.stage_key)).toEqual(['S1_extract','S2_task_match','S3_spec_match']);
});
test('workers, operators and noneditors cannot import an inventory',async()=>{
 const f=await fixture();for(const rpc of [svc(),db.rpc({kind:'operator'}),db.rpc({kind:'anon'}),db.rpc({kind:'user',id:ids.teacher})])expect(await refused(rpc,'studio_reuse_reviewed_intake',f.args)).toMatch(/permission denied|editor access/);
});
test('stale or invalidated source approval is refused',async()=>{
 const f=await fixture();expect(await refused(ed(),'studio_reuse_reviewed_intake',{...f.args,p_expected_decision:key()})).toMatch(/decision changed/);
 await gate(ed(),f.old,'G1_inventory','returned');expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/decision changed/);
});
test('corrupt evidence, started destination and canonical destination are refused',async()=>{
 const f=await fixture();await db.sql("update private.studio_blobs set integrity='corrupt' where id=(select blob_id from private.studio_artifacts where id=$1)",[f.w.made[0]]);
 expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/Integrity blocked/);
 await db.sql("update private.studio_blobs set integrity='verified' where id=(select blob_id from private.studio_artifacts where id=$1)",[f.w.made[0]]);
 await db.sql('update private.studio_stages set attempt_count=1 where run_id=$1',[f.target]);expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/untouched/);
 await db.sql("update private.studio_runs set purpose='canonical' where id=$1",[f.target]);expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/compatible rehearsal/);
});
test('changed snapshot is refused',async()=>{
 const f=await fixture();const other=await importSnapshot(db.rpc({kind:'operator'}),MODULE,[...baseBank,{path:'data/reference/new.md',content:'new'}]);
 await ok(ed(),'studio_rebase_run',{p_run:f.target,p_expected_input_revision:1,p_source_revision:null,p_snapshot:other.snapshotId,p_skill_contract:null,p_profile:null,p_reason:'Changed bank for negative test',p_command:key()});
 expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/pins changed/);
});
test('prepared provider work must be resolved before copying its run evidence',async()=>{
 const f=await fixture();const claim=await ok(svc(),'studio_claim',{p_worker:'synthetic-matcher'});expect(claim.runId).toBe(f.old);
 await ok(svc(),'studio_provider_prepare',{p_attempt:claim.attemptId,p_lease:claim.lease,p_operation:'matching:turn:1',p_request_digest:'a'.repeat(64)});
 expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/unsettled execution/);
});
test('an inventory alone without a complete source ledger is insufficient',async()=>{
 const f=await fixture();await db.sql("update private.studio_artifacts set state='discarded' where run_id=$1 and kind='page_text'",[f.old]);
 expect(await refused(ed(),'studio_reuse_reviewed_intake',f.args)).toMatch(/decision changed|incomplete/);
});
