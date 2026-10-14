// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,ok,refused,baseBank,importSnapshot,accept,key,sha,blob,snapshotPayload} from './studio-fixture';
let db:StudioDb,snapshot:string;const ed=()=>db.rpc({kind:'user',id:ids.editor}),op=()=>db.rpc({kind:'operator'}),svc=()=>db.rpc({kind:'service'});
const validator='4c927946377193eca3b7f3558aa2abb590abae0771d5f498a97cb281df50cd7f',content='# PHYS_01 revised synthetic motion';
beforeAll(async()=>{db=new StudioDb();await db.init();await ok(op(),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@2'});snapshot=(await importSnapshot(op(),MODULE,baseBank)).snapshotId;await accept(op(),MODULE,snapshot,null);},60000);
beforeEach(async()=>{await db.begin();return()=>db.rollback();});afterAll(async()=>db.close());
async function prepared(purpose='canonical'){
 const base=purpose==='canonical'?snapshot:(await importSnapshot(op(),MODULE,baseBank,{purpose})).snapshotId;
 const d=await ok(ed(),'studio_save_maintenance_draft',{p_draft:null,p_snapshot:base,p_path:baseBank[1].path,p_expected_revision:0,p_expected_sha256:sha(baseBank[1].content),p_blob:await blob(ed(),MODULE,content,'text/markdown','revision'),p_reason:'Synthetic integration change',p_restored_from:null,p_command:key()});
 const q=await ok(ed(),'studio_request_maintenance_check',{p_snapshot:base,p_entries:[d],p_command:key()});
 const c=await ok(svc(),'studio_claim_maintenance_check',{p_worker:'synthetic',p_validator:validator});const report={schema:'reviseit/maintenance-check@1',checkId:c.checkId,candidateManifestSha256:c.candidateManifestSha256,validatorSha256:validator,structuralOk:true,errors:[],warnings:[],fileCount:c.files.length,authoredFormCount:0,checks:['synthetic'],notChecked:['science'],humanReview:'pending',integrationOccurred:false};
 await ok(svc(),'studio_finish_maintenance_check',{p_check:c.checkId,p_lease:c.lease,p_report:report,p_sha256:sha(JSON.stringify(report)),p_size:Buffer.byteLength(JSON.stringify(report))});
 const review={p_check:q.checkId,p_version:0,p_report_sha256:sha(JSON.stringify(report)),p_outcome:'approved',p_rationale:'Reviewed the synthetic evidence',p_acknowledgements:{findings:true,sources:true,compatibility:true,content:true},p_command:key()};await ok(ed(),'studio_review_maintenance_check',review);
 return {d,q,c,review,args:{p_check:q.checkId,p_review_version:1,p_rationale:'Integrate synthetic correction',p_command:key()}};
}
const view=(id:string)=>ok(ed(),'studio_maintenance_integration_view',{p_changeset:id});
async function ready(){const p=await prepared(),i=await ok(ed(),'studio_prepare_maintenance_integration',p.args),v=await view(i.changesetId);const args={p_changeset:v.id,p_manifest_sha256:v.manifestSha256,p_rationale:'Approve exact synthetic bank changes',p_acknowledgements:{changes:true,impact:true,authority:true},p_command:key()};await ok(ed(),'studio_authorise_maintenance_integration',args);return {...p,v,args};}
const begin=(v:any,operation=key())=>({p_changeset:v.id,p_manifest_sha256:v.manifestSha256,p_operation:operation});
test('review binds exact changes, requires explicit acknowledgements, and refuses the old bypass',async()=>{
 const p=await prepared();const i=await ok(ed(),'studio_prepare_maintenance_integration',p.args);expect(await ok(ed(),'studio_prepare_maintenance_integration',p.args)).toEqual(i);const v=await view(i.changesetId);expect(v.entries).toHaveLength(1);expect(v.state).toBe('prepared');
 const args={p_changeset:v.id,p_manifest_sha256:v.manifestSha256,p_rationale:'Synthetic approval',p_acknowledgements:{},p_command:key()};expect(await refused(ed(),'studio_authorise_maintenance_integration',args)).toMatch(/Review exact/);
 expect(await refused(ed(),'studio_authorise_changeset',{p_changeset:v.id,p_expected_manifest_sha256:v.manifestSha256,p_rationale:'Bypass',p_authorisation:{},p_command:key()})).toMatch(/permission denied/);
 expect(await refused(svc(),'studio_begin_maintenance_handover',begin(v))).toMatch(/permission denied/);
 expect(await refused(db.rpc({kind:'user',id:ids.outsider}),'studio_maintenance_integration_view',{p_changeset:v.id})).toMatch(/editor access/);
});
test('rehearsal and superseded reviews cannot grant bank authority',async()=>{
 const p=await prepared('rehearsal');expect(await refused(ed(),'studio_prepare_maintenance_integration',p.args)).toMatch(/Rehearsal/);
 const r=await ready();await ok(ed(),'studio_review_maintenance_check',{...r.review,p_version:1,p_outcome:'returned',p_command:key()});expect((await view(r.v.id)).current).toBe(false);expect(await refused(op(),'studio_begin_maintenance_handover',begin(r.v))).toMatch(/Current authorised/);
});
test('later draft edits and a moved accepted bank invalidate an authorised handover',async()=>{
 const r=await ready();await ok(ed(),'studio_save_maintenance_draft',{p_draft:r.d.draftId,p_snapshot:snapshot,p_path:baseBank[1].path,p_expected_revision:1,p_expected_sha256:r.d.sha256,p_blob:await blob(ed(),MODULE,'new revision','text/markdown','revision'),p_reason:'Another synthetic correction',p_restored_from:null,p_command:key()});
 expect(await refused(op(),'studio_begin_maintenance_handover',begin(r.v))).toMatch(/Current authorised/);
 const moved=await importSnapshot(op(),MODULE,baseBank.map((f,i)=>i===2?{...f,content:f.content+' changed'}:f));await accept(op(),MODULE,moved.snapshotId,snapshot);expect((await view(r.v.id)).current).toBe(false);
});
test('operator locks exact authority; whole-bank acceptance is atomic, replayable and separate from releases',async()=>{
 const r=await ready(),args=begin(r.v),exported=await ok(op(),'studio_begin_maintenance_handover',args);expect(await ok(op(),'studio_begin_maintenance_handover',args)).toEqual(exported);
 expect(await refused(op(),'studio_begin_maintenance_handover',begin(r.v))).toMatch(/Another handover/);
 expect(await refused(ed(),'studio_review_maintenance_check',{...r.review,p_version:1,p_outcome:'returned',p_command:key()})).toMatch(/frozen/);
 expect(await refused(ed(),'studio_discard_maintenance_draft',{p_draft:r.d.draftId,p_expected_revision:1,p_expected_sha256:r.d.sha256,p_reason:'Discard attempted mid handover',p_command:key()})).toMatch(/handover in progress/);
 expect(await refused(op(),'studio_export_changeset',{p_changeset:r.v.id,p_purpose:'canonical'})).toMatch(/online maintenance/);
 const p=snapshotPayload(MODULE,baseBank.map((f,i)=>i===1?{...f,content}:f));const register={p_module:MODULE,p_manifest_sha256:p.manifest,p_files:p.files,p_records:p.records,p_links:p.links,p_origin:'operator_import',p_purpose:'canonical',p_parent:snapshot,p_changeset:r.v.id,p_created_by:'synthetic',p_subject_adapter:'caps-physical-sciences@2'};
 const next=await ok(op(),'studio_register_snapshot',register);
 expect(await refused(op(),'studio_accept_snapshot',{p_module:MODULE,p_snapshot:next.snapshotId,p_expected_previous:snapshot})).toMatch(/verified maintenance/);
 const receipt={schema:'reviseit/studio-apply-receipt@1',changesetId:r.v.id,manifestSha256:r.v.manifestSha256,moduleId:MODULE,purpose:'canonical',result:'applied',operationId:key(),targets:exported.entries.map((e:any)=>({path:e.path,before:e.before,after:e.after,observed:e.after}))};const finish={p_changeset:r.v.id,p_operation:args.p_operation,p_snapshot:next.snapshotId,p_receipt:receipt};
 expect(await refused(op(),'studio_complete_maintenance_handover',{...finish,p_snapshot:snapshot})).toMatch(/lineage/);
 expect(await refused(op(),'studio_complete_maintenance_handover',{...finish,p_receipt:{...receipt,targets:[]}})).toMatch(/exact replacements/);
 const teacher=await db.sql('select * from public.curriculum_modules order by id');expect(await ok(op(),'studio_complete_maintenance_handover',finish)).toMatchObject({acceptedSnapshotId:next.snapshotId,changed:true});expect(await ok(op(),'studio_complete_maintenance_handover',finish)).toMatchObject({changed:false});expect(await ok(op(),'studio_begin_maintenance_handover',args)).toMatchObject({state:'accepted',changed:false});
 expect((await view(r.v.id)).state).toBe('accepted');expect(await db.sql('select * from public.curriculum_modules order by id')).toEqual(teacher);
});
test('cancel before apply and recovery after verified rollback both revoke authority',async()=>{
 const r=await ready();await ok(ed(),'studio_cancel_maintenance_integration',{p_changeset:r.v.id,p_reason:'Cancel synthetic integration',p_command:key()});expect(await refused(op(),'studio_begin_maintenance_handover',begin(r.v))).toMatch(/Current authorised/);
 // A new content review creates a distinct binding; the cancelled approval is not revived.
 await ok(ed(),'studio_review_maintenance_check',{...r.review,p_version:1,p_command:key()});const i=await ok(ed(),'studio_prepare_maintenance_integration',{p_check:r.q.checkId,p_review_version:2,p_rationale:'New integration after cancellation',p_command:key()});const v=await view(i.changesetId);await ok(ed(),'studio_authorise_maintenance_integration',{...r.args,p_changeset:v.id,p_manifest_sha256:v.manifestSha256,p_command:key()});
 const a=begin(v);await ok(op(),'studio_begin_maintenance_handover',a);const abort={p_changeset:v.id,p_operation:a.p_operation,p_observed_manifest:sha('wrong'),p_reason:'Verified complete rollback'};expect(await refused(op(),'studio_abort_maintenance_handover',abort)).toMatch(/complete restored/);await ok(op(),'studio_abort_maintenance_handover',{...abort,p_observed_manifest:(await ok(ed(),'studio_maintenance_check_view',{p_check:r.q.checkId})).baseManifestSha256});expect((await view(v.id)).state).toBe('cancelled');
});

test('real database authority drives the Python online handover from temporary bank to accepted snapshot',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const {join,dirname,resolve}=await import('node:path');const {tmpdir}=await import('node:os');const {spawn}=await import('node:child_process');const {createInterface}=await import('node:readline');
 const r=await ready(),dir=mkdtempSync(join(tmpdir(),'studio-online-handover-'));
 try{
 for(const f of baseBank){const path=join(dir,'bank',f.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,f.content);}
 const path=join(dir,'store',`studio/blobs/${MODULE}/${sha(content)}`);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);
 const config={journalDir:join(dir,'journal'),modules:{[MODULE]:{root:join(dir,'bank'),purpose:'canonical'}}};writeFileSync(join(dir,'config.json'),JSON.stringify(config));
 const script=`import json,sys\nfrom pathlib import Path\nfrom studio.operator.handover import execute\nfrom studio.operator.storage import LocalStorage\ndef rpc(name,args):\n print(json.dumps({'rpc':name,'args':args}),flush=True)\n value=json.loads(sys.stdin.readline())\n if value.get('error'): raise RuntimeError(value['error'])\n return value['data']\nr=execute(json.loads(Path(sys.argv[1]).read_text()),sys.argv[2],sys.argv[3],LocalStorage(Path(sys.argv[4])),rpc)\nprint(json.dumps({'result':r}),flush=True)\n`;
 const child=spawn('python3',['-B','-c',script,join(dir,'config.json'),r.v.id,r.v.manifestSha256,join(dir,'store')],{cwd:process.env.STUDIO_WORKER_SOURCE||resolve('../worker'),stdio:['pipe','pipe','pipe']});let result:any,errors='';child.stderr.on('data',b=>errors+=b);const lines=createInterface({input:child.stdout});lines.on('line',async line=>{const message=JSON.parse(line);if(message.rpc){const reply=await op()(message.rpc,message.args);child.stdin.write(JSON.stringify({data:reply.data,error:reply.error?.message})+'\n');}else result=message.result;});
 const exit=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});expect(errors).toBe('');expect(exit).toBe(0);expect(result.acceptedSnapshotId).toBeTruthy();expect((await view(r.v.id)).state).toBe('accepted');expect(readFileSync(join(dir,'bank',baseBank[1].path),'utf8')).toBe(content);
 }finally{rmSync(dir,{recursive:true,force:true});}
},20000);
