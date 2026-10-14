// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,OTHER,ok,refused,baseBank,snapshotPayload,importSnapshot,key,sha,blob} from './studio-fixture';
let db:StudioDb,snapshot:string,other:string;
const formPath='data/forms/authored/specification/P1-PHYS-01.json';
const bank=[...baseBank,{path:'data/task-types/chemistry/CHEM_01.md',content:'Chemistry family',record:{kind:'task_type',id:'CHEM_01'}},{path:formPath,content:'{}',record:{kind:'form_source',id:'FORM_01'}}];
const editor=()=>db.rpc({kind:'user',id:ids.editor});
const args=(path=baseBank[1].path)=>({p_snapshot:snapshot,p_path:path,p_sha256:sha(bank.find(f=>f.path===path)!.content)});
const read=(extra={})=>ok(editor(),'studio_file_impact_view',{...args(),...extra});
async function register(module:string,release:string,entry='structured:P1-PHYS-01',digest=sha(baseBank[1].content)) {
 await db.sql("insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values($1,$2,$3,'Synthetic dependency item','Waves','Synthetic',2,2) on conflict do nothing",[module,release,entry]);
 const payload={module,release,entryId:entry,kind:'specification',canonicalId:entry.split(':')[1],formRevision:sha('form'),bundleDigest:sha('bundle'),manifestSha256:sha(module+release+digest),sharedFormsSha256:sha('shared'),fields:[],explicitlyNoInput:true,shared:{'paper-logistics':{revision:sha('logistics'),fields:[]},'multiple-choice-block':{revision:sha('mcq'),fields:[]}},sources:[{role:'task-type',path:'sources/renamed.md',sha256:digest},{role:'specification',path:'sources/also-same-bytes.md',sha256:digest}]};
 await db.sql('select public.register_catalogue_authored_form($1::jsonb)',[JSON.stringify(payload)],'reviseit_catalogue_publisher');return payload;
}
beforeAll(async()=>{
 db=new StudioDb();await db.init();const op=db.rpc({kind:'operator'});for(const m of [MODULE,OTHER])await ok(op,'studio_enrol_module',{p_module:m,p_subject_adapter:'caps-physical-sciences@2'});
 const p=snapshotPayload(MODULE,bank);const links=[...p.links,
 {fromKind:'form_source',fromId:'FORM_01',toKind:'specification',toId:'P1-PHYS-01',required:false},
 {fromKind:'task_type',fromId:'PHYS_01',toKind:'form_source',toId:'FORM_01',required:true}, // cycle must terminate
 {fromKind:'specification',fromId:'P1-PHYS-01',toKind:'task_variant',toId:'1A',required:true}, // two parents
 {fromKind:'specification',fromId:'P1-PHYS-01',toKind:'task_type',toId:'ABSENT',required:true}];
 snapshot=(await ok(op,'studio_register_snapshot',{p_module:MODULE,p_manifest_sha256:p.manifest,p_files:p.files,p_records:p.records,p_links:links,p_origin:'operator_import',p_purpose:'rehearsal',p_parent:null,p_changeset:null,p_created_by:'synthetic-test'})).snapshotId;
 other=(await importSnapshot(op,OTHER,bank,{purpose:'rehearsal'})).snapshotId;
},60000);
beforeEach(async()=>{await db.begin();return ()=>db.rollback();});afterAll(async()=>db.close());
test('reverse traversal terminates cycles, includes optional/transitive links and never guesses variant parents',async()=>{
 const v=await read();expect(v.dependentRecords.map((r:any)=>r.id).sort()).toEqual(['FORM_01','P1-PHYS-01']);expect(v.unresolvedLinkCount).toBe(2);
 expect(v.file.records.map((r:any)=>[r.id,r.parentId])).toContainEqual(['1A','PHYS_01']);expect(v.dependentRecords.some((r:any)=>r.id==='CHEM_01')).toBe(false);
 expect(v.binding).toEqual({draftId:null,revision:0,sha256:sha(baseBank[1].content)});expect(v.projectionSha256).toMatch(/^[a-f0-9]{64}$/);
});
test('exact bytes, release state and module scope are distinct; obsolete registered bindings are not current uses',async()=>{
 await register(MODULE,'1');await register(MODULE,'0');await register(OTHER,'1');
 await register(MODULE,'1','structured:UNBOUND',sha('different bytes'));
 await db.sql("insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values($1,'1','structured:NOFORM','No form','Waves','Synthetic',2,2)",[MODULE]);
 let v=await read();expect(v.catalogueUses).toHaveLength(2);expect(v.catalogueUses.map((x:any)=>x.current).sort()).toEqual([false,true]);expect(v.catalogueUses[0].sources).toHaveLength(2);expect(v.coverage).toEqual({currentCatalogueItems:3,currentItemsWithoutBindings:1});
 await register(MODULE,'1','structured:P1-PHYS-01',sha('new release bytes'));v=await read();expect(v.catalogueUses).toHaveLength(1);expect(v.catalogueUses[0].release).toBe('0');
 const form=await read(args(formPath));expect(form.formItems).toHaveLength(2);expect(form.catalogueUses).toHaveLength(0);
 const unrelated=await read(args(baseBank[2].path));expect(unrelated.formItems).toEqual([]);expect(unrelated.catalogueUses).toEqual([]);
});
test('orders are counted distinctly from frozen evidence, including repeated lines; unknown formats are explicit',async()=>{
 const payload=await register(MODULE,'1'),school=key();await db.sql("insert into public.schools(id,slug,name) values($1,'dependency-school','Synthetic')",[school]);
 const line={id:'q1',entryId:'structured:P1-PHYS-01',binding:payload};
 const order=async(module:string,snapshot:unknown)=>db.sql("insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot) values($1,$2,$3,$4,'1','Synthetic','internal_test','test-adapter','[{\"id\":\"axes\",\"label\":\"Choose axes\",\"options\":[\"V\",\"I\"]}]',$5::jsonb)",[key(),ids.teacher,school,module,JSON.stringify(snapshot)]);
 await order(MODULE,{schema:'reviseit/frozen-authored-inputs@1',lines:[line,{...line,id:'q2'}]});await order(OTHER,{schema:'reviseit/frozen-authored-inputs@1',lines:[line]});await order(MODULE,{schema:'unknown',lines:[line]});
 expect((await read()).orders).toEqual({pinningSourceBytes:1,containingFormItem:0,unrecognisedSnapshots:1});
 expect((await read(args(formPath))).orders).toEqual({pinningSourceBytes:0,containingFormItem:1,unrecognisedSnapshots:1});
});
test('saved draft reports bind exact revision, owner and hash; superseded/discarded reports fail closed',async()=>{
 // Verify the starting source as the trusted importer would before allowing editing.
 await db.sql("update private.studio_blobs set integrity='verified' where module_id=$1",[MODULE]);
 const save=async(draft:string|null,rev:number,hash:string,text:string)=>ok(editor(),'studio_save_maintenance_draft',{p_draft:draft,p_snapshot:snapshot,p_path:baseBank[1].path,p_expected_revision:rev,p_expected_sha256:hash,p_blob:await blob(editor(),MODULE,text,'text/markdown','revision'),p_reason:'Synthetic dependency edit',p_restored_from:null,p_command:key()});
 const d=await save(null,0,args().p_sha256,'First edited source');const bound={...args(),p_draft:d.draftId,p_revision:1,p_sha256:d.sha256};
 expect((await read(bound)).binding).toEqual({draftId:d.draftId,revision:1,sha256:d.sha256});
 expect(await refused(editor(),'studio_file_impact_view',{...bound,p_snapshot:other})).toMatch(/Draft changed/);
 expect(await refused(editor(),'studio_file_impact_view',{...bound,p_sha256:sha('forged')})).toMatch(/Source revision changed/);
 const second=await save(d.draftId,1,d.sha256,'Second edited source');expect(await refused(editor(),'studio_file_impact_view',bound)).toMatch(/Draft changed/);
 await ok(editor(),'studio_discard_maintenance_draft',{p_draft:d.draftId,p_expected_revision:2,p_expected_sha256:second.sha256,p_reason:'Discard synthetic draft',p_command:key()});
 expect(await refused(editor(),'studio_file_impact_view',{...bound,p_revision:2,p_sha256:second.sha256})).toMatch(/Draft changed/);
});
test('read authority and binding checks hold and the report performs no writes',async()=>{
 for(const actor of [{kind:'anon'} as const,{kind:'service'} as const,{kind:'user',id:ids.outsider} as const,{kind:'user',id:ids.teacher} as const])expect(await refused(db.rpc(actor),'studio_file_impact_view',args())).toMatch(/permission denied|editor access required/);
 expect(await refused(editor(),'studio_file_impact_view',{...args(),p_sha256:null})).toMatch(/Source revision changed/);
 expect(await refused(editor(),'studio_file_impact_view',{...args(),p_revision:1})).toMatch(/saved draft/);
 const state=()=>db.sql("select (select count(*) from private.studio_events) events,(select count(*) from private.studio_decisions) decisions,(select count(*) from private.studio_maintenance_drafts) drafts,(select jsonb_agg(to_jsonb(m)) from public.curriculum_modules m) modules,(select jsonb_agg(to_jsonb(o)) from private.paper_orders o) orders");
 const before=await state();const v=await read();expect(await state()).toEqual(before);expect(JSON.stringify(v)).not.toContain('studio/blobs/');expect(JSON.stringify(v)).not.toContain(ids.teacher);
});
