// @vitest-environment node
import {beforeAll,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,OTHER,ok,refused,baseBank,importSnapshot,key,sha} from './studio-fixture';
let db:StudioDb,snapshot:string,otherSnapshot:string;
const editor=()=>db.rpc({kind:'user',id:ids.editor});
beforeAll(async()=>{
 db=new StudioDb();await db.init();const op=db.rpc({kind:'operator'});
 for(const m of [MODULE,OTHER])await ok(op,'studio_enrol_module',{p_module:m,p_subject_adapter:'caps-physical-sciences@2'});
 snapshot=(await importSnapshot(op,MODULE,[...baseBank,{path:'data/task-types/chemistry/CHEM_01.md',content:'Other family',record:{kind:'task_type',id:'CHEM_01'}}],{purpose:'rehearsal'})).snapshotId;
 otherSnapshot=(await importSnapshot(op,OTHER,baseBank,{purpose:'rehearsal'})).snapshotId;
 for(const [release,id] of [['1','mcq:MCQ_01'],['0','structured:OLD_01']])await db.sql("insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values($1,$2,$3,'Synthetic item','Waves','Safe summary',2,2)",[MODULE,release,id]);
 const payload={module:MODULE,release:'1',entryId:'mcq:MCQ_01',kind:'multiple-choice',canonicalId:'MCQ_01',formRevision:sha('form'),bundleDigest:sha('bundle'),manifestSha256:sha('manifest'),sharedFormsSha256:sha('shared'),fields:[],explicitlyNoInput:true,shared:{'paper-logistics':{revision:sha('logistics'),fields:[]},'multiple-choice-block':{revision:sha('mcq'),fields:[]}},sources:[{role:'task-type',path:'sources/task.md',sha256:sha('source')}]};
 await db.sql('select public.register_catalogue_authored_form($1::jsonb)',[JSON.stringify(payload)],'reviseit_catalogue_publisher');
},60000);
afterAll(async()=>{await db.close();});
test('never silently selects a rehearsal as the accepted bank or includes historical releases in current items',async()=>{
 const v=await ok(editor(),'studio_library_view',{p_module:MODULE});expect(v.selectedSnapshotId).toBeNull();expect(v.records).toEqual([]);expect(v.items).toHaveLength(1);expect(v.items[0]).toMatchObject({entryId:'mcq:MCQ_01',orderable:false,supported:false});
 expect(v.snapshots).toHaveLength(1);expect(v.snapshots[0].purpose).toBe('rehearsal');
});
test('same variant labels retain their parent and all returned files resolve in the chosen snapshot',async()=>{
 const v=await ok(editor(),'studio_library_view',{p_module:MODULE,p_snapshot:snapshot});
 expect(v.records.filter((r:any)=>r.id==='1A').map((r:any)=>r.parentId).sort()).toEqual(['CHEM_01','PHYS_01']);
 const f=await ok(editor(),'studio_bank_file_view',{p_snapshot:snapshot,p_path:baseBank[1].path});expect(f.accepted).toBe(false);expect(f.sha256).toBe(sha(baseBank[1].content));expect(f.records.some((r:any)=>r.parentId==='PHYS_01')).toBe(true);
 expect(JSON.stringify([v,f])).not.toContain('studio/blobs/');
 expect(await refused(editor(),'studio_library_view',{p_module:MODULE,p_snapshot:otherSnapshot})).toMatch(/does not belong/);
 expect(await refused(editor(),'studio_bank_file_view',{p_snapshot:snapshot,p_path:'../../secrets'})).toMatch(/File not found/);
});
test('explicitly no-input forms are complete but do not imply enabled ordering or worker readiness',async()=>{
 const v=await ok(editor(),'studio_catalogue_item_view',{p_module:MODULE,p_release:'1',p_entry:'mcq:MCQ_01'});expect(v.form).toMatchObject({explicitlyNoInput:true,fields:[]});expect(v.workflowSha256).toBeNull();expect(v.orderable).toBe(false);
 const releases=await ok(editor(),'studio_releases_view',{p_module:MODULE});expect(releases.releases.find((r:any)=>r.current)).toMatchObject({entries:1,forms:1,executions:0,ready:0});
 expect(releases.releases.find((r:any)=>!r.current)).toMatchObject({release:'0',publishedAt:null,importedAt:null});
});
test('all read surfaces enforce Studio editor authority, including direct RPC calls',async()=>{
 const calls=[['studio_library_view',{p_module:MODULE}],['studio_bank_file_view',{p_snapshot:snapshot,p_path:baseBank[1].path}],['studio_catalogue_item_view',{p_module:MODULE,p_release:'1',p_entry:'mcq:MCQ_01'}],['studio_releases_view',{}]] as const;
 for(const actor of [{kind:'anon'} as const,{kind:'service'} as const,{kind:'user',id:ids.outsider} as const,{kind:'user',id:ids.teacher} as const])for(const [name,args] of calls)expect(await refused(db.rpc(actor),name,args)).toMatch(/permission denied|editor access required/);
 expect(await refused(editor(),'studio_library_view',{p_module:'unknown'})).toMatch(/not enrolled/);
 expect(await refused(editor(),'studio_catalogue_item_view',{p_module:OTHER,p_release:'1',p_entry:'mcq:MCQ_01'})).toMatch(/not found/);
});
test('all reads leave approvals, release selection, readiness and order records unchanged',async()=>{
 const before=await db.sql("select (select count(*) from private.studio_decisions) decisions,(select count(*) from private.paper_orders) orders,(select jsonb_agg(to_jsonb(m)) from public.curriculum_modules m) modules,(select jsonb_agg(to_jsonb(r)) from public.catalogue_ordering_readiness r) readiness");
 await ok(editor(),'studio_library_view',{});await ok(editor(),'studio_releases_view',{});await ok(editor(),'studio_catalogue_item_view',{p_module:MODULE,p_release:'1',p_entry:'mcq:MCQ_01'});
 expect(await db.sql("select (select count(*) from private.studio_decisions) decisions,(select count(*) from private.paper_orders) orders,(select jsonb_agg(to_jsonb(m)) from public.curriculum_modules m) modules,(select jsonb_agg(to_jsonb(r)) from public.catalogue_ordering_readiness r) readiness")).toEqual(before);
});
