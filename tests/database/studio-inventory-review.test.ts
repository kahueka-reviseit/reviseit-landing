// @vitest-environment node
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioDb, ids, MODULE, SKILL, PROFILE, ok, refused, key, blob, importSnapshot, baseBank, accept, work, complete, gate, sha, verified } from './studio-fixture';
import { saveInventoryMark, correctInventoryMark, saveInventoryCognition, correctInventoryCognition, sourcePagePng, inventorySummary, type MarkCorrection } from '../../lib/studio/inventory-review';
import { LocalStudioStorage } from '../../lib/studio/storage/local';
const db = new StudioDb(), ed = () => db.rpc({kind:'user',id:ids.editor}), svc = () => db.rpc({kind:'service'});
let snapshot: string, dir: string, store: LocalStudioStorage;
const inventory = { meta:{last_updated:'2026-10-12',schema_version:'2.0'}, source_sha256:'a'.repeat(64), paper_metadata:{total_marks:2}, questions:[{number:'1',marks:2,type:'multiple_choice',source_content:{human_verified:false,fragments:[{original:true}]},sub_questions:[{id:'1.3',marks:null,source_id:'source',source_page:3,flags:['marks_unprinted'],curriculum_level:null,taxonomy_description:null,source_observations:[{marks:null,content:{source_text:'Original question'}}]}]}] };
beforeAll(async()=>{await db.init();const op=db.rpc({kind:'operator'});await ok(op,'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});snapshot=(await importSnapshot(op,MODULE,baseBank)).snapshotId;await accept(op,MODULE,snapshot,null);dir=mkdtempSync(join(tmpdir(),'studio-inventory-review-'));store=new LocalStudioStorage(dir);},60000);
beforeEach(async()=>{await db.begin();return ()=>db.rollback();});
afterAll(async()=>{await db.close();rmSync(dir,{recursive:true,force:true});});
async function prepared(){
 const editor=ed(), b=await blob(editor,MODULE,'synthetic source');
 const src=await ok(editor,'studio_create_source',{p_module:MODULE,p_title:'Review fixture',p_files:[{blobId:b,role:'question_paper',filename:'paper.pdf'}],p_identity:{},p_command:key()});
 const run=(await ok(editor,'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:snapshot,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()})).runId;
 const bytes=JSON.stringify(inventory), w=await work(svc(),[{key:'inventory',kind:'inventory',content:bytes}],'S1_extract');await complete(svc(),w.claim,w.made);
 await store.put(`studio/blobs/${MODULE}/${sha(bytes)}`,Buffer.from(bytes),'application/json');
 const input:MarkCorrection={runId:run,artifactId:w.made[0],expectedSha256:sha(bytes),partId:'1.3',marks:2,reason:'User confirmed the two-mark allocation.',command:key(),asOf:'2026-10-13'};
 return {editor,run,w,input};
}
test('save verifies stored bytes, preserves extraction, records editor revision, replays once and grants no approval',async()=>{
 const {editor,run,input}=await prepared();
 const before=await db.sql('select * from private.studio_artifacts where id=$1',[input.artifactId]);
 const result=await saveInventoryMark(editor,verified(editor),store,ids.editor,input);
 expect(await saveInventoryMark(editor,verified(editor),store,ids.editor,input)).toEqual(result);
 const rows=await db.sql('select * from private.studio_artifacts order by revision');expect(rows).toHaveLength(2);
 expect(rows[0].sha256).toBe(before[0].sha256);expect(rows[0].state).toBe('superseded');expect(rows[1].author_kind).toBe('user');expect(rows[1].author_id).toBe(ids.editor);expect(rows[1].parent_id).toBe(input.artifactId);
 const bytes=await store.get(`studio/blobs/${MODULE}/${rows[1].sha256}`);expect(sha(bytes!)).toBe(rows[1].sha256);
 const fixed=JSON.parse(Buffer.from(bytes!).toString());expect(fixed.questions[0].sub_questions[0].marks).toBe(2);expect(fixed.questions[0].source_content).toEqual(inventory.questions[0].source_content);
 expect(fixed.questions[0].sub_questions[0].source_observations).toEqual(inventory.questions[0].sub_questions[0].source_observations);
 expect(fixed.human_mark_corrections[0]).toMatchObject({previous_marks:null,corrected_marks:2,recorded_by:ids.editor,parent_sha256:input.expectedSha256});
 expect(inventorySummary(fixed)).toMatchObject({marks:2,unknownMarks:0,unresolvedClassifications:1});
 const review=await ok(editor,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});expect(review.live).toBeNull();expect(review.binding.artifacts[0].id).toBe(result.artifactId);
 expect(await ok(svc(),'studio_claim',{p_worker:'must-wait'})).toBeNull();expect(await db.sql('select * from private.studio_decisions')).toHaveLength(0);
});
test('a correction invalidates a reviewed inventory and fences downstream work; stale saves cannot overwrite it',async()=>{
 const {editor,run,input}=await prepared();await gate(editor,run,'G1_inventory');
 const before=await ok(editor,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});
 const c=await ok(svc(),'studio_claim',{p_worker:'matcher'});expect(c.stageKey).toBe('S2_task_match');
 await saveInventoryMark(editor,verified(editor),store,ids.editor,input);
 const after=await ok(editor,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});expect(after.live).toBeNull();expect(after.version).toBeGreaterThan(before.version);
 await expect(saveInventoryMark(editor,verified(editor),store,ids.editor,{...input,command:key(),marks:3})).rejects.toThrow(/revision changed/);
 expect(await refused(svc(),'studio_put_output',{p_attempt:c.attemptId,p_lease:c.lease,p_logical_key:'matches',p_kind:'task_matches',p_sha256:sha('{}'),p_size:2,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:null})).toMatch(/lease lost/);
 await gate(editor,run,'G1_inventory');const fresh=await ok(editor,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'});expect(fresh.live.self_reviewed).toBe(true);
});
test('wrong run, wrong digest, noneditor and corrupt originals fail before producing revisions',async()=>{
 const {editor,input}=await prepared();
 for(const change of [{runId:key()},{expectedSha256:'f'.repeat(64)}])await expect(saveInventoryMark(editor,verified(editor),store,ids.editor,{...input,...change})).rejects.toThrow(/binding changed/);
 const outsider=db.rpc({kind:'user',id:ids.outsider});await expect(saveInventoryMark(outsider,verified(outsider),store,ids.outsider,input)).rejects.toThrow();
 await store.put(`studio/blobs/${MODULE}/${input.expectedSha256}`,Buffer.from('wrong'),'application/json');await expect(saveInventoryMark(editor,verified(editor),store,ids.editor,input)).rejects.toThrow(/corrupt/);
 expect(await db.sql('select * from private.studio_artifacts')).toHaveLength(1);
});
test('invalid marks, missing rationale, unknown parts, identical values and ambiguous parts are refused',async()=>{
 const {input}=await prepared();
 for(const change of [{marks:-1},{marks:Infinity},{marks:1001},{reason:'x'},{partId:'bad'},{marks:null},{asOf:'2099-01-01'}])expect(()=>correctInventoryMark(inventory,{...input,...change},ids.editor)).toThrow();
 const duplicate=structuredClone(inventory);duplicate.questions.push(duplicate.questions[0]);expect(()=>correctInventoryMark(duplicate,input,ids.editor)).toThrow(/ambiguous/);
});
test('inline source rendering refuses arbitrary files and mismatched image digests',()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]), bytes=Buffer.from(JSON.stringify({render:png.toString('base64'),render_sha256:sha(png)}));
 expect(sourcePagePng({kind:'page_text'},bytes)).toEqual(png);
 expect(()=>sourcePagePng({kind:'inventory'},bytes)).toThrow();
 expect(()=>sourcePagePng({kind:'page_text'},Buffer.from(JSON.stringify({render:png.toString('base64'),render_sha256:'f'.repeat(64)})))).toThrow(/integrity/);
});

test('cognitive corrections save the Bloom’s level, reason and reviewer provenance without changing marks or source evidence', async()=>{
 const {editor,run,input}=await prepared();
 const change={...input,category:'Apply',reason:'The learner must apply a familiar method to the given numerical situation.'};
 const result=await saveInventoryCognition(editor,verified(editor),store,ids.editor,change);
 expect(await saveInventoryCognition(editor,verified(editor),store,ids.editor,change)).toEqual(result);
 const rows=await db.sql('select * from private.studio_artifacts order by revision');expect(rows).toHaveLength(2);
 const fixed=JSON.parse(Buffer.from((await store.get(`studio/blobs/${MODULE}/${rows[1].sha256}`))!).toString());
 const part=fixed.questions[0].sub_questions[0];expect(part).toMatchObject({marks:null,taxonomy_description:'Apply',classification_provenance:'reviewer_judgement',classification_reason:change.reason});
 expect(part.source_observations).toEqual(inventory.questions[0].sub_questions[0].source_observations);expect(fixed.questions[0].source_content).toEqual(inventory.questions[0].source_content);
 expect(fixed.human_cognitive_corrections[0]).toMatchObject({previous:{taxonomy_description:null},corrected:{taxonomy_description:'Apply'},recorded_by:ids.editor,parent_artifact_id:input.artifactId});
 expect(inventorySummary(fixed).unresolvedClassifications).toBe(0);
 expect((await ok(editor,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'})).live).toBeNull();expect(await ok(svc(),'studio_claim',{p_worker:'must-wait'})).toBeNull();
});
test('cognitive edits invalidate prior approval and fence matching; a stale mark edit cannot overwrite the classification',async()=>{
 const {editor,run,input}=await prepared();await gate(editor,run,'G1_inventory');
 const claim=await ok(svc(),'studio_claim',{p_worker:'matcher'});
 await saveInventoryCognition(editor,verified(editor),store,ids.editor,{...input,category:'Analyse'});
 expect((await ok(editor,'studio_gate_view',{p_run:run,p_gate:'G1_inventory'})).live).toBeNull();
 await expect(saveInventoryMark(editor,verified(editor),store,ids.editor,{...input,command:key()})).rejects.toThrow(/revision changed/);
 expect(await refused(svc(),'studio_put_output',{p_attempt:claim.attemptId,p_lease:claim.lease,p_logical_key:'matches',p_kind:'task_matches',p_sha256:sha('{}'),p_size:2,p_media_type:'application/json',p_schema:null,p_record:null,p_meta:{},p_provider_attempt:null})).toMatch(/lease lost/);
});
test('a reviewer can return a classification to unresolved while retaining both judgments',()=>{
 const input={runId:key(),artifactId:key(),expectedSha256:'a'.repeat(64),partId:'1.3',command:key(),asOf:'2026-10-13',reason:'Applying the learned method is needed.',category:'Apply'};
 const first=correctInventoryCognition(inventory,input,ids.editor);
 const second=correctInventoryCognition(first,{...input,command:key(),category:null,reason:'More source context is needed before making this judgement.'},ids.editor);
 expect(second.questions[0].sub_questions[0]).toMatchObject({curriculum_level:null,taxonomy_description:null,classification_provenance:'unresolved'});
 expect(second.human_cognitive_corrections).toHaveLength(2);expect(second.human_cognitive_corrections[1].previous.taxonomy_description).toBe('Apply');expect(inventorySummary(second).unresolvedClassifications).toBe(1);
});
test('Bloom’s classification works without a curriculum band and never infers or overwrites legacy bands',()=>{
 const input={runId:key(),artifactId:key(),expectedSha256:'a'.repeat(64),partId:'1.3',command:key(),asOf:'2026-10-13',reason:'The reasoning involves applying a known method.',category:'Apply'};
 for(const category of ['Remember','Understand','Apply','Analyse','Evaluate','Create']) {
  const fixed=correctInventoryCognition(inventory,{...input,category},ids.editor);
  expect(fixed.questions[0].sub_questions[0].curriculum_level).toBeNull();
  expect(fixed.questions[0].sub_questions[0].classification_provenance).toBe('reviewer_judgement');
  expect(inventorySummary(fixed).unresolvedClassifications).toBe(0);
 }
 const legacy=structuredClone(inventory);(legacy.questions[0].sub_questions[0] as any).curriculum_level=4;
 const corrected=correctInventoryCognition(legacy,{...input,category:'Remember'},ids.editor);
 expect(corrected.questions[0].sub_questions[0].curriculum_level).toBe(4); // Historical evidence is not an active requirement.
 expect(corrected.human_cognitive_corrections[0].corrected).not.toHaveProperty('curriculum_level');
 expect(inventorySummary(corrected).unresolvedClassifications).toBe(0);
 for(const change of [{category:'3'},{category:'Invented'},{reason:'bad'},{partId:'missing'},{level:3}])expect(()=>correctInventoryCognition(inventory,{...input,...change},ids.editor)).toThrow();
 const same=correctInventoryCognition(inventory,input,ids.editor);expect(()=>correctInventoryCognition(same,input,ids.editor)).toThrow(/unchanged/);
});
test('unauthorised, foreign-run and corrupt-source cognitive writes fail before creating a revision',async()=>{
 const {editor,input}=await prepared(),change={...input,category:'Apply'};
 const outsider=db.rpc({kind:'user',id:ids.outsider});await expect(saveInventoryCognition(outsider,verified(outsider),store,ids.outsider,change)).rejects.toThrow();
 await expect(saveInventoryCognition(editor,verified(editor),store,ids.editor,{...change,runId:key()})).rejects.toThrow(/binding changed/);
 await store.put(`studio/blobs/${MODULE}/${input.expectedSha256}`,Buffer.from('wrong'),'application/json');await expect(saveInventoryCognition(editor,verified(editor),store,ids.editor,change)).rejects.toThrow(/corrupt/);
 expect(await db.sql('select * from private.studio_artifacts')).toHaveLength(1);
});
