// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,ok,refused,baseBank,importSnapshot,accept,key,sha} from './studio-fixture';
let db:StudioDb,snapshot:string,manifest:string;const ed=()=>db.rpc({kind:'user',id:ids.editor}),op=()=>db.rpc({kind:'operator'}),view=()=>ok(ed(),'studio_release_preparations_view',{p_module:MODULE});
beforeAll(async()=>{db=new StudioDb();await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@2'});const s=await importSnapshot(op(),MODULE,baseBank);snapshot=s.snapshotId;manifest=s.manifest;await accept(op(),MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(async()=>db.close());
const request=()=>({p_snapshot:snapshot,p_expected_current:'1',p_command:key()});
async function build(){const r=await ok(ed(),'studio_request_release_preparation',request());const args={p_preparation:r.preparationId,p_operation:key(),p_toolchain:sha('toolchain')};const c=await ok(op(),'studio_begin_release_preparation',args);const files=[{path:'inputs/source-manifest.json',sha256:sha('synthetic source manifest'),size:25,mediaType:'application/json'}];const report={schema:'reviseit/release-preparation@1',preparationId:r.preparationId,moduleId:MODULE,release:'1',bankManifestSha256:manifest,toolchainSha256:args.p_toolchain,published:false,humanReview:'pending',checks:['catalogue','forms','workflow','classifications','registration','orderCompilation'].map(name=>({name,status:'passed',detail:'Synthetic check'})),items:[{id:'mcq:SYNTHETIC',form:'no-input',classification:'matches-reviewed-package',reasons:[],thumbnail:false}],notChecked:['Publication approval'],files};return {args,c,files,report,finish:{p_preparation:r.preparationId,p_operation:args.p_operation,p_report:report,p_report_sha256:sha(JSON.stringify(report)),p_report_size:JSON.stringify(report).length,p_files:files}};}
test('only editors request accepted banks; command replay is exact and producer is separately privileged',async()=>{
 const a=request(),r=await ok(ed(),'studio_request_release_preparation',a);expect(await ok(ed(),'studio_request_release_preparation',a)).toEqual(r);expect((await view()).preparations).toHaveLength(1);
 expect(await refused(ed(),'studio_request_release_preparation',{...a,p_expected_current:'wrong'})).toMatch(/command|reused/i);
 expect(await refused(db.rpc({kind:'user',id:ids.outsider}),'studio_request_release_preparation',request())).toMatch(/editor/);
 expect(await refused(ed(),'studio_begin_release_preparation',{p_preparation:r.preparationId,p_operation:key(),p_toolchain:sha('tools')})).toMatch(/permission denied/);
 const rehearsal=await importSnapshot(op(),MODULE,baseBank,{purpose:'rehearsal'});expect(await refused(ed(),'studio_request_release_preparation',{...request(),p_snapshot:rehearsal.snapshotId})).toMatch(/accepted/);
 expect(await refused(ed(),'studio_request_release_preparation',{...request(),p_expected_current:'old'})).toMatch(/release changed/);
});
test('one operation owns a build; successful completion is replayable and cannot publish or modify teacher rows',async()=>{
 const b=await build(),before=await db.sql('select * from public.curriculum_modules order by id');expect(await ok(op(),'studio_begin_release_preparation',b.args)).toEqual(b.c);
 expect(await refused(op(),'studio_begin_release_preparation',{...b.args,p_operation:key()})).toMatch(/owns/);
 const result=await ok(op(),'studio_finish_release_preparation',b.finish);expect(result.state).toBe('checked');expect(await ok(op(),'studio_finish_release_preparation',b.finish)).toEqual(result);expect((await ok(op(),'studio_begin_release_preparation',b.args)).state).toBe('checked');
 expect(await db.sql('select * from public.curriculum_modules order by id')).toEqual(before);expect((await view()).preparations[0]).toMatchObject({current:true,state:'checked',createdBy:'Studio editor'});
 expect(await refused(op(),'studio_finish_release_preparation',{...b.finish,p_files:[]})).toMatch(/current/);
});
test('stale bank, changed publication and cancellation fence late completions',async()=>{
 const b=await build();await db.sql("update public.curriculum_modules set current_release='2' where id=$1",[MODULE]);expect(await refused(op(),'studio_finish_release_preparation',b.finish)).toMatch(/changed during/);expect((await view()).preparations[0].current).toBe(false);
 await db.sql("update public.curriculum_modules set current_release='1' where id=$1",[MODULE]);const next=await importSnapshot(op(),MODULE,baseBank.map((f,i)=>i?f:{...f,content:'Revised policy'}));await accept(op(),MODULE,next.snapshotId,snapshot);expect(await refused(op(),'studio_finish_release_preparation',b.finish)).toMatch(/changed during/);
 await ok(ed(),'studio_cancel_release_preparation',{p_preparation:b.args.p_preparation});expect(await refused(op(),'studio_finish_release_preparation',b.finish)).toMatch(/not current/);
});
test('malformed reports, path traversal, duplicate files and altered bindings are rejected atomically',async()=>{
 const b=await build();
 for(const patch of [{published:true},{humanReview:'approved'},{bankManifestSha256:sha('other')},{checks:[]},{files:[]}])expect(await refused(op(),'studio_finish_release_preparation',{...b.finish,p_report:{...b.report,...patch}})).toMatch(/Invalid|differ/);
 for(const files of [[{...b.files[0],path:'inputs/../secret'}],[...b.files,...b.files]])expect(await refused(op(),'studio_finish_release_preparation',{...b.finish,p_files:files,p_report:{...b.report,files}})).toMatch(/Unsafe|duplicate/);
 expect((await db.sql('select * from private.studio_release_preparation_files')).length).toBe(0);
 const report={...b.report,checks:b.report.checks.map(c=>c.name==='classifications'?{...c,status:'blocked'}:c)};expect((await ok(op(),'studio_finish_release_preparation',{...b.finish,p_report:report,p_report_sha256:sha(JSON.stringify(report)),p_report_size:JSON.stringify(report).length})).state).toBe('blocked');
});
test('operator rehearsals keep their own attribution; corrupt retained files cease to be current',async()=>{
 const r=await ok(op(),'studio_operator_release_preparation',{p_snapshot:snapshot,p_expected_current:'1',p_command:key()});expect((await view()).preparations.find((p:any)=>p.id===r.preparationId).createdBy).toBe('Operator');
 const b=await build();await ok(op(),'studio_finish_release_preparation',b.finish);await db.sql("update private.studio_blobs set integrity='missing' where sha256=$1",[b.files[0].sha256]);expect((await view()).preparations.find((p:any)=>p.id===b.args.p_preparation).current).toBe(false);
});
