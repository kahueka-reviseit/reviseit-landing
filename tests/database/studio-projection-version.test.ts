// @vitest-environment node
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { StudioDb, MODULE, ids, SKILL, PROFILE, baseBank, snapshotPayload, ok, refused, key, blob, accept } from './studio-fixture';
const db=new StudioDb();const op=()=>db.rpc({kind:'operator'}),ed=()=>db.rpc({kind:'user',id:ids.editor});
beforeAll(async()=>{await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@1'});},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(()=>db.close());
const payload=snapshotPayload(MODULE,baseBank);
const registration=(adapter?:string)=>({p_module:MODULE,p_manifest_sha256:payload.manifest,p_files:payload.files,p_records:payload.records,p_links:payload.links,p_origin:'operator_import',p_purpose:'canonical',p_parent:null,p_changeset:null,p_created_by:'synthetic',...(adapter?{p_subject_adapter:adapter}:{})});

test('same source bytes can have a new adapter projection without modifying an earlier run pin',async()=>{
  const old=await ok(op(),'studio_register_snapshot',registration());await accept(op(),MODULE,old.snapshotId,null);
  const b=await blob(ed(),MODULE,'versioned source');
  const source=await ok(ed(),'studio_create_source',{p_module:MODULE,p_title:'Versioned bank',p_files:[{blobId:b,role:'combined',filename:'p.pdf'}],p_identity:{},p_command:key()});
  const run=await ok(ed(),'studio_start_run',{p_source:source.sourceId,p_expected_source_revision:1,p_purpose:'canonical',p_snapshot:old.snapshotId,p_skill_contract:SKILL,p_profile:PROFILE,p_command:key()});
  const parent=payload.records.find(r=>r.recordId==='PHYS_01')!;
  const extra={...parent,recordKind:'task_variant',recordId:'1B',parentRecordId:'PHYS_01'};
  const nextArgs={...registration('caps-physical-sciences@2'),p_records:[...payload.records,extra]};
  const next=await ok(op(),'studio_register_snapshot',nextArgs);
  expect(next.snapshotId).not.toBe(old.snapshotId);expect(next.manifestSha256).toBe(old.manifestSha256);
  expect((await ok(op(),'studio_register_snapshot',nextArgs)).snapshotId).toBe(next.snapshotId);
  expect((await ok(op(),'studio_register_snapshot',registration())).snapshotId).toBe(old.snapshotId);
  expect((await db.sql('select snapshot_id,subject_adapter from private.studio_run_inputs where run_id=$1',[run.runId]))[0]).toEqual({snapshot_id:old.snapshotId,subject_adapter:'caps-physical-sciences@1'});
  expect((await db.sql("select count(*)::int n from private.studio_record_index where snapshot_id=$1 and record_id='1B'",[old.snapshotId]))[0].n).toBe(0);
  expect((await db.sql('select accepted_snapshot_id from private.studio_modules where module_id=$1',[MODULE]))[0].accepted_snapshot_id).toBe(old.snapshotId);
});

test('a projection rebuild must be semantically identical, including an empty original index',async()=>{
  const original=await ok(op(),'studio_register_snapshot',registration());
  expect(await ok(op(),'studio_replace_snapshot_index',{p_snapshot:original.snapshotId,p_records:[...payload.records].reverse(),p_links:payload.links})).toMatchObject({records:payload.records.length});
  expect(await refused(op(),'studio_replace_snapshot_index',{p_snapshot:original.snapshotId,p_records:[],p_links:[]})).toMatch(/projection is immutable/);
  expect(await refused(op(),'studio_register_snapshot',{...registration(),p_records:[]})).toMatch(/projection is immutable/);
  const empty=await ok(op(),'studio_register_snapshot',{...registration('caps-physical-sciences@2'),p_records:[],p_links:[]});
  expect(await refused(op(),'studio_replace_snapshot_index',{p_snapshot:empty.snapshotId,p_records:payload.records,p_links:payload.links})).toMatch(/projection is immutable/);
});

test('variants require the matching parent file; only the operator can select a known adapter',async()=>{
  const parent=payload.records.find(r=>r.recordId==='PHYS_01')!;
  const wrong={...parent,recordKind:'task_variant',recordId:'2B',parentRecordId:'PHYS_02'};
  expect(await refused(op(),'studio_register_snapshot',{...registration('caps-physical-sciences@2'),p_records:[...payload.records,wrong]})).toMatch(/Variant parent/);
  expect(await refused(op(),'studio_register_snapshot',registration('caps-geography@1'))).toMatch(/Unsupported subject adapter/);
  expect(await refused(ed(),'studio_register_snapshot',registration('caps-physical-sciences@2'))).toMatch(/permission denied/);
});
