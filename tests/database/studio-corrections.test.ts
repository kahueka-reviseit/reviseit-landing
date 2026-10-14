// @vitest-environment node
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { StudioDb, ids, MODULE, SKILL, PROFILE, AUTH, ok, refused, key, blob, importSnapshot, baseBank, accept, work, complete, sha } from './studio-fixture';
const s = new StudioDb();
const ed = () => s.rpc({kind:'user',id:ids.editor}), op = () => s.rpc({kind:'operator'}), svc = () => s.rpc({kind:'service'});
beforeAll(async()=>{await s.init()},60000);
beforeEach(async()=>{await s.begin();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});return async()=>{await s.rollback()}});
afterAll(async()=>{await s.close()});
test('browser roles cannot attest verified bytes even with a forged actor; server checks editor and owner',async()=>{
 const args={p_module:MODULE,p_sha256:sha('x'),p_size:1,p_media_type:'application/pdf',p_filename:'x.pdf',p_purpose:'source',p_command:key()};
 const u=await ok(ed(),'studio_create_upload',args);
 const prep={p_session:u.sessionId,p_sha256:args.p_sha256,p_size:1,p_detected_type:'application/pdf',p_actor:ids.editor};
 for(const actor of [{kind:'user',id:ids.editor},{kind:'anon'}] as const){
  expect(await refused(s.rpc(actor),'studio_prepare_commit',prep)).toMatch(/permission denied/);
  expect(await refused(s.rpc(actor),'studio_commit_upload',{p_session:u.sessionId,p_actor:ids.editor})).toMatch(/permission denied/);
 }
 expect(await refused(svc(),'studio_prepare_commit',{...prep,p_actor:ids.outsider})).toMatch(/editor access/);
 expect(await refused(svc(),'studio_prepare_commit',{...prep,p_actor:ids.editor2})).toMatch(/not found/);
 expect((await s.sql('select state from private.studio_upload_sessions where id=$1',[u.sessionId]))[0].state).toBe('open');
 const b=await blob(ed(),MODULE,'recover');
 await ok(svc(),'studio_worker_report_integrity',{p_blob:b,p_state:'missing',p_detail:'synthetic loss'});
 await ok(ed(),'studio_begin_recovery',{p_blob:b,p_reason:'Restore original scan bytes'});
 expect(await refused(ed(),'studio_complete_recovery',{p_blob:b,p_actor:ids.editor})).toMatch(/permission denied/);
 expect((await s.sql('select integrity from private.studio_blobs where id=$1',[b]))[0].integrity).toBe('recovering');
});
test('completion refuses output integrity loss after registration and unknown blob references',async()=>{
 const base=await importSnapshot(op(),MODULE,baseBank);await accept(op(),MODULE,base.snapshotId,null);
 const b=await blob(ed(),MODULE,'source');
 const src=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic',p_files:[{blobId:b,role:'combined',filename:'paper.pdf'}],p_identity:{},p_command:key()});
 await ok(ed(),'studio_start_run',{p_source:src.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:base.snapshotId,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()});
 const w=await work(svc(),[{key:'inventory',kind:'inventory',content:'{"leaves":[]}'}],'S1_extract');
 const a=await s.sql('select blob_id from private.studio_artifacts where id=$1',[w.made[0]]);
 await ok(svc(),'studio_worker_report_integrity',{p_blob:a[0].blob_id,p_state:'missing',p_detail:'Lost after registration'});
 await expect(complete(svc(),w.claim,w.made)).rejects.toThrow(/Integrity blocked.*missing/);
 expect((await s.sql('select state from private.studio_stages where id=$1',[w.claim.stageId]))[0].state).toBe('running');
 await expect(s.sql('select private.studio_require_blobs(array[$1::uuid])',[key()])).rejects.toThrow(/absent/);
 await ok(ed(),'studio_begin_recovery',{p_blob:a[0].blob_id,p_reason:'Synthetic verified byte restoration'});
 await ok(svc(),'studio_complete_recovery',{p_blob:a[0].blob_id,p_actor:ids.editor});
 expect(await complete(svc(),w.claim,w.made)).toMatchObject({state:'succeeded'});
});
test('a historical pre-062 authorised export still applies through the Python operator with identical bank bytes',async()=>{
 const base=await importSnapshot(op(),MODULE,baseBank);await accept(op(),MODULE,base.snapshotId,null);
 const changed='# PHYS_02 revised synthetic force', path=baseBank[2].path;
 const b=await blob(ed(),MODULE,changed,'text/markdown','revision');
 const c=await ok(ed(),'studio_create_maintenance_changeset',{p_module:MODULE,p_base_snapshot:base.snapshotId,p_entries:[{action:'replace',path,recordKind:'task_type',recordId:'PHYS_02',blobId:b}],p_rationale:'Synthetic correction',p_command:key()});
 // Seed a historical authorisation, as an owner fixture, to retain legacy export compatibility.
 await s.sql("update private.studio_changesets set state='authorised' where id=$1",[c.changesetId]);
 const ex=await ok(op(),'studio_export_changeset',{p_changeset:c.changesetId,p_purpose:'canonical'});
 expect(JSON.parse(ex.manifestText)).toMatchObject({changesetId:c.changesetId,purpose:'canonical',baseManifestSha256:base.manifest});
 const d=mkdtempSync(join(tmpdir(),'studio-export-'));
 try {
  for(const f of baseBank){const dest=join(d,'bank',f.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,f.content)}
  const bk=join(d,'store',ex.entries[0].key);mkdirSync(dirname(bk),{recursive:true});writeFileSync(bk,changed);
  writeFileSync(join(d,'export.json'),JSON.stringify(ex));
  writeFileSync(join(d,'config.json'),JSON.stringify({journalDir:join(d,'journal'),modules:{[MODULE]:{root:join(d,'bank'),purpose:'canonical'}}}));
  const result=execFileSync('python3',['-B','-m','studio.operator.apply_changeset','apply','--config',join(d,'config.json'),'--export',join(d,'export.json'),'--blobs','local:'+join(d,'store'),'--expected-manifest',c.manifestSha256],{cwd:process.env.STUDIO_WORKER_SOURCE||resolve('../worker'),encoding:'utf8'});
  expect(result).toContain('applied');expect(readFileSync(join(d,'bank',path),'utf8')).toBe(changed);
 } finally {rmSync(d,{recursive:true,force:true})}
});
