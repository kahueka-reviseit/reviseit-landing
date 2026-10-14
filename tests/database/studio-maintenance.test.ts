// @vitest-environment node
// Real database command path + local storage emulation. No remote content writes.
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StudioDb,ids,MODULE,OTHER,ok,refused,baseBank,importSnapshot,key,sha,blob,verified} from './studio-fixture';
import {LocalStudioStorage} from '../../lib/studio/storage/local';
import {saveMaintenanceDraft,readDraftText} from '../../lib/studio/maintenance-save';
import {blobKey} from '../../lib/studio/contracts';
import type {SaveDraftInput} from '../../lib/studio/maintenance-drafts';
let db:StudioDb,snapshot:string,dir:string,store:LocalStudioStorage;
const editor=()=>db.rpc({kind:'user',id:ids.editor});
beforeAll(async()=>{db=new StudioDb();await db.init();const op=db.rpc({kind:'operator'});for(const m of [MODULE,OTHER])await ok(op,'studio_enrol_module',{p_module:m,p_subject_adapter:'caps-physical-sciences@2'});snapshot=(await importSnapshot(op,MODULE,baseBank,{purpose:'rehearsal'})).snapshotId;},60000);
beforeEach(async()=>{await db.begin();dir=mkdtempSync(join(tmpdir(),'studio-draft-test-'));store=new LocalStudioStorage(dir);for(const f of baseBank)await store.put(blobKey(MODULE,sha(f.content)),Buffer.from(f.content),'text/markdown');return async()=>{await db.rollback();rmSync(dir,{recursive:true,force:true});};});
afterAll(async()=>db.close());
const input=(extra:Partial<SaveDraftInput>={}):SaveDraftInput=>({draftId:null,snapshotId:snapshot,path:baseBank[1].path,expectedRevision:0,expectedSha256:sha(baseBank[1].content),text:baseBank[1].content+'\nA synthetic edit.',reason:'Clarify the synthetic source.',restoredFrom:null,command:key(),...extra});
const save=async(i:SaveDraftInput)=>{const e=editor();return saveMaintenanceDraft(e,verified(e),store,i);};
const view=(id:string)=>ok(editor(),'studio_maintenance_draft_view',{p_draft:id});
test('verified bytes survive reads and command replay; the original snapshot, reviews and releases stay untouched',async()=>{
 const state=()=>db.sql("select (select jsonb_agg(to_jsonb(f)) from private.studio_snapshot_files f) files,(select jsonb_agg(to_jsonb(m)) from public.curriculum_modules m) modules,(select count(*) from private.studio_decisions) decisions,(select count(*) from private.paper_orders) orders,(select count(*) from private.studio_changesets) changesets");
 const before=await state(),i=input(),a=await save(i);expect(await save(i)).toEqual(a);
 await db.sql('set constraints all immediate'); // Exercise deferred head/revision references as at commit.
 const v=await view(a.draftId);expect(v).toMatchObject({state:'draft',revision:1,file:{purpose:'rehearsal',accepted:false}});expect(v.revisions).toHaveLength(1);
 expect(await readDraftText(editor(),store,v.revisions[0].blobId,a.sha256)).toBe(i.text);expect(await state()).toEqual(before);
 expect(JSON.stringify(v)).not.toContain('studio/blobs/');
 const gc=await ok(db.rpc({kind:'service'}),'studio_gc_claim',{p_key:blobKey(MODULE,a.sha256)});expect(gc).toBe(false);
});
test('competing first saves and stale edits cannot overwrite another editor; a previous command still replays',async()=>{
 const i=input(),a=await save(i);await expect(save(input({text:'A competing initial draft'}))).rejects.toThrow(/Another draft exists/);
 const b=await save(input({draftId:a.draftId,expectedRevision:1,expectedSha256:a.sha256,text:'Second revision',command:key()}));
 await expect(save(input({draftId:a.draftId,expectedRevision:1,expectedSha256:a.sha256,text:'Stale competing text'}))).rejects.toThrow(/newer revision/);
 expect(await save(i)).toEqual(a);expect((await view(a.draftId)).revision).toBe(b.revision);
 await expect(save({...i,text:'Reused command with different bytes'})).rejects.toThrow(/Command key reused/);
});
test('restore creates a fresh revision with exact retained bytes; discard is CAS-bound and keeps history',async()=>{
 const i=input(),a=await save(i),b=await save(input({draftId:a.draftId,expectedRevision:1,expectedSha256:a.sha256,text:'Second synthetic revision'}));
 const c=await save(input({draftId:a.draftId,expectedRevision:2,expectedSha256:b.sha256,text:i.text,restoredFrom:1}));expect(c.revision).toBe(3);
 const d=await save(input({draftId:a.draftId,expectedRevision:3,expectedSha256:c.sha256,text:baseBank[1].content,restoredFrom:0}));expect(d.revision).toBe(4);
 await expect(save(input({draftId:a.draftId,expectedRevision:4,expectedSha256:d.sha256,text:'Falsely claimed restore',restoredFrom:1}))).rejects.toThrow(/exact retained/);
 const args={p_draft:a.draftId,p_expected_revision:3,p_expected_sha256:c.sha256,p_reason:'This experiment is complete.',p_command:key()};
 expect(await refused(editor(),'studio_discard_maintenance_draft',args)).toMatch(/revision changed/);
 const discard={...args,p_expected_revision:4,p_expected_sha256:d.sha256,p_command:key()};const r=await ok(editor(),'studio_discard_maintenance_draft',discard);expect(await ok(editor(),'studio_discard_maintenance_draft',discard)).toEqual(r);
 const v=await view(a.draftId);expect(v.state).toBe('discarded');expect(v.revisions).toHaveLength(4);expect(v.revisions[0].restoredFrom).toBe(0);
 await expect(save(input({draftId:a.draftId,expectedRevision:4,expectedSha256:d.sha256}))).rejects.toThrow(/no longer editable/);
 expect((await save(input())).draftId).not.toBe(a.draftId);
 await expect(db.sql('delete from private.studio_maintenance_revisions where draft_id=$1',[a.draftId])).rejects.toThrow(/immutable/);
});
test('direct commands reject cross-module or unverified blobs, mismatched owners, archives and forged restoration',async()=>{
 const a=await save(input()),foreign=await blob(editor(),OTHER,'Foreign bytes','text/markdown','revision');
 const args={p_draft:a.draftId,p_snapshot:snapshot,p_path:baseBank[1].path,p_expected_revision:1,p_expected_sha256:a.sha256,p_blob:foreign,p_reason:'Synthetic direct RPC test.',p_restored_from:null,p_command:key()};
 expect(await refused(editor(),'studio_save_maintenance_draft',args)).toMatch(/same-module/);
 const v=await view(a.draftId);expect(await refused(editor(),'studio_save_maintenance_draft',{...args,p_blob:v.revisions[0].blobId,p_path:baseBank[2].path,p_command:key()})).toMatch(/does not belong/);
 expect(await refused(editor(),'studio_save_maintenance_draft',{...args,p_path:'data/archive/OLD_Synthetic.md',p_command:key()})).toMatch(/Only active/);
 const next=await blob(editor(),MODULE,'Another text','text/markdown','revision');
 expect(await refused(editor(),'studio_save_maintenance_draft',{...args,p_blob:next,p_restored_from:0,p_command:key()})).toMatch(/exact retained/);
 await db.sql("update private.studio_blobs set integrity='missing' where id=$1",[next]);
 expect(await refused(editor(),'studio_save_maintenance_draft',{...args,p_blob:next,p_command:key()})).toMatch(/Verified/);
});
test('all draft reads and commands require a Studio editor, including direct RPC and table access',async()=>{
 const a=await save(input());const calls=[['studio_maintenance_draft_view',{p_draft:a.draftId}],['studio_maintenance_drafts_view',{}],['studio_discard_maintenance_draft',{p_draft:a.draftId,p_expected_revision:1,p_expected_sha256:a.sha256,p_reason:'Unauthorised discard attempt.',p_command:key()}],['studio_save_maintenance_draft',{p_draft:null,p_snapshot:snapshot,p_path:baseBank[1].path,p_expected_revision:0,p_expected_sha256:sha(baseBank[1].content),p_blob:null,p_reason:'Unauthorised write attempt.',p_restored_from:null,p_command:key()}]] as const;
 for(const actor of [{kind:'anon'} as const,{kind:'service'} as const,{kind:'user',id:ids.outsider} as const,{kind:'user',id:ids.teacher} as const])for(const [name,args] of calls)expect(await refused(db.rpc(actor),name,args)).toMatch(/permission denied|editor access required/);
 await expect(db.sql('select * from private.studio_maintenance_revisions',[],'authenticated')).rejects.toThrow(/permission denied/);
});
test('storage corruption blocks saving before a revision is recorded',async()=>{
 await store.put(blobKey(MODULE,sha(baseBank[1].content)),Buffer.from('tampered'),'text/markdown');
 await expect(save(input())).rejects.toThrow(/integrity/i);expect(await ok(editor(),'studio_maintenance_drafts_view',{})).toEqual([]);
});
test('a storage interruption never produces a half-saved revision and explicit retry completes once',async()=>{
 const i=input();let failed=false;store.fault=(op,k)=>{if(!failed&&op==='put'&&k.includes('/blobs/')&&k.endsWith(sha(i.text))){failed=true;throw new Error('Synthetic storage interruption');}};
 await expect(save(i)).rejects.toThrow();expect(await ok(editor(),'studio_maintenance_drafts_view',{})).toEqual([]);
 store.fault=null;const a=await save(i);expect((await view(a.draftId)).revisions).toHaveLength(1);
});
