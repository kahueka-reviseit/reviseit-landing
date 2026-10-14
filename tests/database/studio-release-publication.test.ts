// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,ok,refused,baseBank,importSnapshot,accept,key,sha} from './studio-fixture';
import {publication} from '../fixtures/publication';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
let db:StudioDb,snapshot:string,manifest:string;const ed=()=>db.rpc({kind:'user',id:ids.editor}),op=()=>db.rpc({kind:'operator'}),svc=()=>db.rpc({kind:'service'});
beforeAll(async()=>{db=new StudioDb();await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@2'});const s=await importSnapshot(op(),MODULE,baseBank);snapshot=s.snapshotId;manifest=s.manifest;await accept(op(),MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(async()=>db.close());
async function candidate(release='2',previous='1',bad=false,availability?:{orderable:string[];unavailable:string[]}){
 const pub=publication(release,MODULE),entry=pub.entries[0].id,bh=sha('bundle '+release),wh=sha('workflow '+release);
 const registration={module:MODULE,release,entryId:entry,kind:'specification',canonicalId:entry.split(':')[1],formRevision:sha('form'),bundleDigest:sha('digest'),manifestSha256:bh,sharedFormsSha256:sha('shared'),fields:[],explicitlyNoInput:true,
 shared:{'paper-logistics':{revision:sha('logistics'),fields:[]},'multiple-choice-block':{revision:sha('block'),fields:[]}},sources:[{role:'specification',path:'sources/test.md',sha256:sha('source')}]};
 const binding=(await db.sql('select private.line_source_binding($1::jsonb,$2) b',[JSON.stringify(registration),wh]))[0].b;
 const sources=[{...registration.sources[0],originalPath:`our content/${MODULE}/data/test.md`}];
 const envelope={schemaVersion:4,moduleId:MODULE,release:bad?'wrong':release,itemId:entry.split(':')[1],kind:'structured',parts:[],formBinding:{itemForm:{formRevision:registration.formRevision}},provenance:{sources:[{role:'specification',path:sources[0].originalPath,sha256:sha('source')}]}};
 const rows={classifications:[{module:MODULE,release,entryId:entry,registration,binding,bundleSources:sources,envelope,sha256:sha(JSON.stringify(envelope)),catalogueContentDigest:pub.contentDigest}]};
 const rawPub=JSON.stringify(pub),rawRows=JSON.stringify(rows),files=[{path:`export/public/${MODULE}/publication-input.json`,sha256:sha(rawPub),size:rawPub.length,mediaType:'application/json'},
 {path:'registrations/verified-bindings.json',sha256:sha(rawRows),size:rawRows.length,mediaType:'application/json'},
 {path:`export/private/${MODULE}/bundle-manifest.json`,sha256:bh,size:15,mediaType:'application/json'},
 {path:`bundle/${MODULE}/manifest.json`,sha256:wh,size:15,mediaType:'application/json'}].sort((a,b)=>a.path.localeCompare(b.path));
 const prep=await ok(ed(),'studio_request_release_preparation',{p_snapshot:snapshot,p_expected_current:previous,p_command:key()}),operation=key(),toolchain=sha('tools');
 await ok(op(),'studio_begin_release_preparation',{p_preparation:prep.preparationId,p_operation:operation,p_toolchain:toolchain});
 const report={schema:'reviseit/release-preparation@1',preparationId:prep.preparationId,moduleId:MODULE,release,bankManifestSha256:manifest,toolchainSha256:toolchain,published:false,humanReview:'pending',checks:['catalogue','forms','workflow','classifications','registration','orderCompilation'].map(name=>({name,status:'passed',detail:'Synthetic check'})),rehearsal:availability??{orderable:[entry],unavailable:[]},items:[{id:entry}],notChecked:['Human review'],files},rh=sha(JSON.stringify(report));
 await ok(op(),'studio_finish_release_preparation',{p_preparation:prep.preparationId,p_operation:operation,p_report:report,p_report_sha256:rh,p_report_size:JSON.stringify(report).length,p_files:files});
 const stage={p_preparation:prep.preparationId,p_report_sha256:rh,p_publication:rawPub,p_registrations:rawRows,p_command:key()};
 const c=await ok(ed(),'studio_stage_release',stage);return {id:c.candidateId,stage,rh,bh,wh,pub,files};
}
async function approve(c:Awaited<ReturnType<typeof candidate>>){return (await ok(ed(),'studio_review_release',{p_candidate:c.id,p_report_sha256:c.rh,p_decision:'approved',p_reason:'Reviewed synthetic package',p_command:key()})).reviewId;}
const confirm=(c:any,a:string)=>({p_candidate:c.id,p_approval:a,p_report_sha256:c.rh,p_bundle:c.bh,p_workflow:c.wh,p_worker:'synthetic-teacher-worker'});
const activate=(c:any,a:string,previous='1',last:string|null=null,kind='publish')=>({p_candidate:c.id,p_approval:a,p_expected_release:previous,p_expected_activation:last,p_kind:kind,p_reason:'Activate reviewed synthetic release',p_command:key()});
const current=async()=>(await db.sql('select current_release r from public.curriculum_modules where id=$1',[MODULE]))[0].r;
test('roles, immutable bytes and idempotency are enforced before review',async()=>{
 const c=await candidate();expect(await ok(ed(),'studio_stage_release',c.stage)).toEqual({candidateId:c.id});
 expect(await refused(ed(),'studio_stage_release',{...c.stage,p_command:key(),p_publication:c.stage.p_publication+' '})).toMatch(/bytes differ/);
 expect(await refused(op(),'studio_review_release',{p_candidate:c.id,p_report_sha256:c.rh,p_decision:'approved',p_reason:'Operator cannot approve',p_command:key()})).toMatch(/permission denied/);
 expect(await refused(ed(),'studio_release_worker_queue',{})).toMatch(/permission denied/);
 expect(await refused(svc(),'studio_activate_release',activate(c,key()))).toMatch(/permission denied/);
 expect(await refused(db.rpc({kind:'user',id:ids.outsider}),'studio_release_publication_view',{})).toMatch(/editor/);
 expect(await current()).toBe('1');
});
test('activation needs current human approval and a fresh exact worker receipt; then commits all registrations together',async()=>{
 const c=await candidate(),a=await approve(c),cmd=activate(c,a);
 expect(await refused(ed(),'studio_activate_release',cmd)).toMatch(/worker confirmation/);
 expect(await refused(svc(),'studio_confirm_release_worker',{...confirm(c,a),p_bundle:sha('different')})).toMatch(/not current/);
 await ok(svc(),'studio_confirm_release_worker',confirm(c,a));
 const result=await ok(ed(),'studio_activate_release',cmd);expect(result.orderable).toBe(1);expect(await current()).toBe('2');expect(await ok(ed(),'studio_activate_release',cmd)).toEqual(result);
 expect((await db.sql('select * from private.studio_release_activations')).length).toBe(1);
 expect((await db.sql('select * from private.catalogue_authored_forms where module_id=$1',[MODULE])).length).toBe(1);
});
test('revocation invalidates receipts and reapproval needs a new worker confirmation',async()=>{
 const c=await candidate(),a=await approve(c);await ok(svc(),'studio_confirm_release_worker',confirm(c,a));
 await ok(ed(),'studio_review_release',{p_candidate:c.id,p_report_sha256:c.rh,p_decision:'revoked',p_reason:'Synthetic correction required',p_command:key()});
 expect(await refused(ed(),'studio_activate_release',activate(c,a))).toMatch(/approval/);
 const again=await approve(c);expect(again).not.toBe(a);expect(await refused(ed(),'studio_activate_release',activate(c,again))).toMatch(/worker/);
 await ok(svc(),'studio_confirm_release_worker',confirm(c,again));await db.sql("update private.studio_release_worker_receipts set checked_at=now()-interval '3 minutes'");expect(await refused(ed(),'studio_activate_release',activate(c,again))).toMatch(/worker/);
});
test('a registration failure rolls back the catalogue pointer and every new platform row',async()=>{
 const c=await candidate('2','1',true),a=await approve(c);await ok(svc(),'studio_confirm_release_worker',confirm(c,a));
 expect(await refused(ed(),'studio_activate_release',activate(c,a))).toMatch(/identity mismatch/);
 expect(await current()).toBe('1');expect(await db.sql('select * from private.catalogue_published_releases where module_id=$1',[MODULE])).toHaveLength(0);expect(await db.sql('select * from private.catalogue_authored_forms where module_id=$1',[MODULE])).toHaveLength(0);
});
test('rollback preserves both releases and command replay never reactivates an old release',async()=>{
 const c=await candidate(),a=await approve(c);await ok(svc(),'studio_confirm_release_worker',confirm(c,a));const first=activate(c,a),r=await ok(ed(),'studio_activate_release',first);
 const next=await candidate('3','2'),b=await approve(next);await ok(svc(),'studio_confirm_release_worker',confirm(next,b));const second=await ok(ed(),'studio_activate_release',activate(next,b,'2',r.activationId));
 expect(await ok(ed(),'studio_activate_release',first)).toEqual(r);expect(await current()).toBe('3');
 expect(await refused(ed(),'studio_activate_release',activate(c,a,'3',r.activationId,'rollback'))).toMatch(/activation changed/);
 await ok(svc(),'studio_confirm_release_worker',confirm(c,a));await ok(ed(),'studio_activate_release',activate(c,a,'3',second.activationId,'rollback'));expect(await current()).toBe('2');
 expect(await db.sql('select * from private.catalogue_published_releases where module_id=$1',[MODULE])).toHaveLength(2);
 expect(await db.sql('select * from private.catalogue_authored_forms where module_id=$1',[MODULE])).toHaveLength(2);
 expect((await ok(ed(),'studio_release_publication_view',{p_module:MODULE})).activations).toHaveLength(3);
});
test('changed bank, corrupt artifacts and wrong report cannot borrow an approval',async()=>{
 const c=await candidate(),a=await approve(c);await ok(svc(),'studio_confirm_release_worker',confirm(c,a));
 expect(await refused(ed(),'studio_review_release',{p_candidate:c.id,p_report_sha256:sha('different'),p_decision:'approved',p_reason:'Wrong report identity',p_command:key()})).toMatch(/Exact/);
 await db.sql("update private.studio_blobs set integrity='corrupt' where sha256=$1",[c.bh]);expect(await refused(ed(),'studio_activate_release',activate(c,a))).toMatch(/intact/);
 await db.sql("update private.studio_blobs set integrity='verified' where sha256=$1",[c.bh]);
 const next=await importSnapshot(op(),MODULE,baseBank.map((f,i)=>i?f:{...f,content:'Revised policy'}));await accept(op(),MODULE,next.snapshotId,snapshot);
 expect(await refused(ed(),'studio_activate_release',activate(c,a))).toMatch(/superseded/);expect(await ok(svc(),'studio_release_worker_queue',{})).toEqual([]);
});

test.skipIf(!process.env.STUDIO_RELEASE_REHEARSAL_PACKAGE)('actual retained Grade 11 package establishes an exact baseline in an isolated database',async()=>{
 const root=process.env.STUDIO_RELEASE_REHEARSAL_PACKAGE!,module='caps-grade-11-physical-sciences';
 const rawPub=readFileSync(join(root,'export/public',module,'publication-input.json'),'utf8'),rawRows=readFileSync(join(root,'registrations/verified-bindings.json'),'utf8'),pub=JSON.parse(rawPub),rows=JSON.parse(rawRows).classifications;
 await db.sql('select public.publish_catalogue_release($1::jsonb,null)',[rawPub]);
 for(const r of rows)await db.sql('select public.register_catalogue_authored_form($1::jsonb)',[JSON.stringify(r.registration)]);
 const bh=rows[0].binding.privateManifestSha256,wh=rows[0].binding.workflowManifestSha256;
 await db.sql('select public.register_catalogue_execution($1,$2,$3,$4)',[module,pub.release,bh,wh]);
 for(const r of rows)await db.sql('select public.register_bloom_classification($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)',[module,pub.release,r.entryId,r.sha256,JSON.stringify(r.envelope),JSON.stringify(r.binding),JSON.stringify(r.bundleSources),r.catalogueContentDigest]);
 await db.sql('select public.sync_supported_catalogue_readiness($1)',[module]);
 await ok(op(),'studio_enrol_module',{p_module:module,p_subject_adapter:'caps-physical-sciences@2'});const bank=await importSnapshot(op(),module,baseBank);await accept(op(),module,bank.snapshotId,null);
 const prep=await ok(ed(),'studio_request_release_preparation',{p_snapshot:bank.snapshotId,p_expected_current:pub.release,p_command:key()}),operation=key(),tc=sha('private rehearsal tools');
 await ok(op(),'studio_begin_release_preparation',{p_preparation:prep.preparationId,p_operation:operation,p_toolchain:tc});
 const files=[`export/public/${module}/publication-input.json`,'registrations/verified-bindings.json',`export/private/${module}/bundle-manifest.json`,`bundle/${module}/manifest.json`].sort().map(path=>{const raw=readFileSync(join(root,path));return {path,sha256:sha(raw),size:raw.length,mediaType:'application/json'};});
 const report={schema:'reviseit/release-preparation@1',preparationId:prep.preparationId,moduleId:module,release:pub.release,bankManifestSha256:bank.manifest,toolchainSha256:tc,published:false,humanReview:'pending',checks:['catalogue','forms','workflow','classifications','registration','orderCompilation'].map(name=>({name,status:'passed',detail:'Private package rehearsal'})),items:pub.entries.map((e:any)=>({id:e.id})),notChecked:['Synthetic review, not a real approval'],files},rh=sha(JSON.stringify(report));
 await ok(op(),'studio_finish_release_preparation',{p_preparation:prep.preparationId,p_operation:operation,p_report:report,p_report_sha256:rh,p_report_size:JSON.stringify(report).length,p_files:files});
 const c=await ok(ed(),'studio_stage_release',{p_preparation:prep.preparationId,p_report_sha256:rh,p_publication:rawPub,p_registrations:rawRows,p_command:key()});
 const context={id:c.candidateId,rh,bh,wh} as any,a=await approve(context);await ok(svc(),'studio_confirm_release_worker',confirm(context,a));
 const result=await ok(ed(),'studio_activate_release',activate(context,a,pub.release,null,'confirm_current'));expect(result.orderable).toBe(89);
 expect((await db.sql('select current_release r from public.curriculum_modules where id=$1',[module]))[0].r).toBe(pub.release);
});

test('availability must match the approved item identities, including retained exclusions',async()=>{
 const c=await candidate('2','1',false,{orderable:[],unavailable:['structured:P1-EXAMPLE-01']}),a=await approve(c);
 await ok(svc(),'studio_confirm_release_worker',confirm(c,a));
 expect(await refused(ed(),'studio_activate_release',activate(c,a))).toMatch(/availability differs/);
 expect(await current()).toBe('1');expect(await db.sql('select * from private.catalogue_authored_forms where module_id=$1',[MODULE])).toHaveLength(0);
});
test('equal availability counts cannot substitute an unreviewed item',async()=>{
 const c=await candidate('2','1',false,{orderable:['structured:P1-OTHER-01'],unavailable:[]}),a=await approve(c);
 await ok(svc(),'studio_confirm_release_worker',confirm(c,a));
 expect(await refused(ed(),'studio_activate_release',activate(c,a))).toMatch(/availability differs/);expect(await current()).toBe('1');
});

test.skipIf(!process.env.STUDIO_GRADE10_RELEASE_PACKAGE)('actual approved Grade 10 package publishes with exactly its two retained exclusions in an isolated database',async()=>{
 const root=process.env.STUDIO_GRADE10_RELEASE_PACKAGE!,module='caps-grade-10-physical-sciences';
 const rawPub=readFileSync(join(root,'export/public',module,'publication-input.json'),'utf8'),rawRows=readFileSync(join(root,'registrations/verified-bindings.json'),'utf8'),pub=JSON.parse(rawPub),rows=JSON.parse(rawRows).classifications;
 const prior={...pub,release:'16.0.2'};await db.sql('select public.publish_catalogue_release($1::jsonb,null)',[JSON.stringify(prior)]);
 const bh=rows[0].binding.privateManifestSha256,wh=rows[0].binding.workflowManifestSha256;
 await ok(op(),'studio_enrol_module',{p_module:module,p_subject_adapter:'caps-physical-sciences@2'});const bank=await importSnapshot(op(),module,baseBank);await accept(op(),module,bank.snapshotId,null);
 const prep=await ok(ed(),'studio_request_release_preparation',{p_snapshot:bank.snapshotId,p_expected_current:prior.release,p_command:key()}),operation=key(),tc=sha('private rehearsal tools');
 await ok(op(),'studio_begin_release_preparation',{p_preparation:prep.preparationId,p_operation:operation,p_toolchain:tc});
 const files=[`export/public/${module}/publication-input.json`,'registrations/verified-bindings.json',`export/private/${module}/bundle-manifest.json`,`bundle/${module}/manifest.json`].sort().map(path=>{const raw=readFileSync(join(root,path));return {path,sha256:sha(raw),size:raw.length,mediaType:'application/json'};});
 const report={schema:'reviseit/release-preparation@1',preparationId:prep.preparationId,moduleId:module,release:pub.release,bankManifestSha256:bank.manifest,toolchainSha256:tc,published:false,humanReview:'pending',checks:['catalogue','forms','workflow','classifications','registration','orderCompilation'].map(name=>({name,status:'passed',detail:'Private package rehearsal'})),rehearsal:{orderable:pub.entries.map((e:any)=>e.id).filter((id:string)=>!['structured:P2-CHEM-04','structured:P2-CHEM-05'].includes(id)),unavailable:['structured:P2-CHEM-04','structured:P2-CHEM-05']},items:pub.entries.map((e:any)=>({id:e.id})),notChecked:['Synthetic review, not a real approval'],files},rh=sha(JSON.stringify(report));
 await ok(op(),'studio_finish_release_preparation',{p_preparation:prep.preparationId,p_operation:operation,p_report:report,p_report_sha256:rh,p_report_size:JSON.stringify(report).length,p_files:files});
 const c=await ok(ed(),'studio_stage_release',{p_preparation:prep.preparationId,p_report_sha256:rh,p_publication:rawPub,p_registrations:rawRows,p_command:key()});
 const context={id:c.candidateId,rh,bh,wh} as any,a=await approve(context);await ok(svc(),'studio_confirm_release_worker',confirm(context,a));
 const result=await ok(ed(),'studio_activate_release',activate(context,a,prior.release,null,'publish'));expect(result.orderable).toBe(129);
 expect((await db.sql("select entry_id from public.catalogue_ordering_readiness where module_id=$1 and release=$2 and not orderable order by entry_id",[module,pub.release])).map((x:any)=>x.entry_id)).toEqual(['structured:P2-CHEM-04','structured:P2-CHEM-05']);
 expect((await db.sql('select current_release r from public.curriculum_modules where id=$1',[module]))[0].r).toBe(pub.release);
});
