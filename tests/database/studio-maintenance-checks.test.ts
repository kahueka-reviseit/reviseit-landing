// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,OTHER,ok,refused,baseBank,importSnapshot,key,sha,blob} from './studio-fixture';
let db:StudioDb,snapshot:string;const editor=()=>db.rpc({kind:'user',id:ids.editor});const service=()=>db.rpc({kind:'service'});const validator='4c927946377193eca3b7f3558aa2abb590abae0771d5f498a97cb281df50cd7f';
beforeAll(async()=>{db=new StudioDb();await db.init();const op=db.rpc({kind:'operator'});for(const m of [MODULE,OTHER])await ok(op,'studio_enrol_module',{p_module:m,p_subject_adapter:'caps-physical-sciences@2'});snapshot=(await importSnapshot(op,MODULE,baseBank,{purpose:'rehearsal'})).snapshotId;},60000);
beforeEach(async()=>{await db.begin();return ()=>db.rollback();});afterAll(async()=>db.close());
async function draft(path=baseBank[1].path,id:string|null=null,revision=0,hash=sha(baseBank.find(f=>f.path===path)!.content),text='Synthetic replacement') {return ok(editor(),'studio_save_maintenance_draft',{p_draft:id,p_snapshot:snapshot,p_path:path,p_expected_revision:revision,p_expected_sha256:hash,p_blob:await blob(editor(),MODULE,text,'text/markdown','revision'),p_reason:'Synthetic validation change',p_restored_from:null,p_command:key()});}
const request=(ds:any[],command=key())=>ok(editor(),'studio_request_maintenance_check',{p_snapshot:snapshot,p_entries:ds.map(d=>({draftId:d.draftId,revision:d.revision,sha256:d.sha256})),p_command:command});
async function finish(c:any,passed=true){const report={schema:'reviseit/maintenance-check@1',checkId:c.checkId,candidateManifestSha256:c.candidateManifestSha256,validatorSha256:validator,structuralOk:passed,errors:passed?[]:[{kind:'missing_reference'}],warnings:[],fileCount:c.files.length,authoredFormCount:0,checks:['Synthetic structural check'],notChecked:['Scientific correctness'],humanReview:'pending',integrationOccurred:false};return ok(service(),'studio_finish_maintenance_check',{p_check:c.checkId,p_lease:c.lease,p_report:report,p_sha256:sha(JSON.stringify(report)),p_size:Buffer.byteLength(JSON.stringify(report))});}
const claim=()=>ok(service(),'studio_claim_maintenance_check',{p_worker:'synthetic-checker',p_validator:validator});
const view=(id:string)=>ok(editor(),'studio_maintenance_check_view',{p_check:id});
const review=async(id:string,over:Record<string,unknown>={})=>{const v=await view(id);return {p_check:id,p_version:v.reviewVersion,p_report_sha256:v.reportSha256,p_outcome:'approved',p_rationale:'Reviewed synthetic source and all findings',p_acknowledgements:{findings:true,sources:true,compatibility:true,content:true},p_command:key(),...over};};
test('candidate overlays exactly selected revisions on the complete bank; request replay and scope boundaries',async()=>{
 const a=await draft(),b=await draft(baseBank[2].path,null,0,sha(baseBank[2].content),'Other replacement'),command=key(),q=await request([a],command);expect(await request([a],command)).toEqual(q);
 const c=await claim();expect(c.files).toHaveLength(baseBank.length);expect(c.files.find((f:any)=>f.path===baseBank[1].path).sha256).toBe(a.sha256);expect(c.files.find((f:any)=>f.path===baseBank[2].path).sha256).toBe(sha(baseBank[2].content));
 const foreign=await blob(editor(),OTHER,'foreign bytes','text/markdown','revision');expect(await refused(service(),'studio_maintenance_check_read',{p_check:c.checkId,p_lease:c.lease,p_blob:foreign})).toMatch(/Input not available/);
 expect(await refused(service(),'studio_maintenance_check_read',{p_check:c.checkId,p_lease:key(),p_blob:c.files[0].blobId})).toMatch(/lease lost/);
 expect(await refused(editor(),'studio_request_maintenance_check',{p_snapshot:snapshot,p_entries:[a,a],p_command:key()})).toMatch(/Duplicate/);
 const before=await db.sql('select count(*) n from private.studio_changesets');await finish(c);expect((await view(q.checkId)).current).toBe(true);expect(await db.sql('select count(*) n from private.studio_changesets')).toEqual(before);
});
test('review binds exact report, has compare-and-save and explicit self-review; later edits invalidate it',async()=>{
 const a=await draft(),q=await request([a]),c=await claim();await finish(c);const args=await review(q.checkId);const approved=await ok(editor(),'studio_review_maintenance_check',args);expect(await ok(editor(),'studio_review_maintenance_check',args)).toEqual(approved);
 expect((await view(q.checkId)).reviews[0]).toMatchObject({outcome:'approved',selfReviewed:true});
 expect(await refused(editor(),'studio_review_maintenance_check',{...args,p_command:key()})).toMatch(/review changed/);
 await draft(baseBank[1].path,a.draftId,1,a.sha256,'A newer synthetic source');const v=await view(q.checkId);expect(v.current).toBe(false);expect(v.reviews).toHaveLength(1);
 expect(await refused(editor(),'studio_review_maintenance_check',await review(q.checkId))).toMatch(/fresh check/);
});
test('failed structures cannot be approved; missing acknowledgement and wrong evidence are refused',async()=>{
 const q=await request([await draft()]),c=await claim();await finish(c,false);
 expect(await refused(editor(),'studio_review_maintenance_check',await review(q.checkId))).toMatch(/Passing structural/);
 expect(await refused(editor(),'studio_review_maintenance_check',await review(q.checkId,{p_report_sha256:sha('forged')}))).toMatch(/report changed/);
 await ok(editor(),'studio_review_maintenance_check',await review(q.checkId,{p_outcome:'returned',p_acknowledgements:{}}));expect((await view(q.checkId)).reviews[0].outcome).toBe('returned');
});
test('discard fences the worker; no automatic retry; reviewer and worker cannot trade authority',async()=>{
 const a=await draft(),q=await request([a]),c=await claim();await ok(editor(),'studio_discard_maintenance_draft',{p_draft:a.draftId,p_expected_revision:1,p_expected_sha256:a.sha256,p_reason:'Discard this synthetic edit',p_command:key()});
 await expect(finish(c)).rejects.toThrow(/lease lost/);await ok(service(),'studio_fail_maintenance_check',{p_check:c.checkId,p_lease:c.lease});expect(await claim()).toBeNull();
 for(const actor of [{kind:'anon'} as const,{kind:'service'} as const,{kind:'user',id:ids.outsider} as const])expect(await refused(db.rpc(actor),'studio_maintenance_check_view',{p_check:q.checkId})).toMatch(/permission denied|editor access/);
 expect(await refused(editor(),'studio_claim_maintenance_check',{p_worker:'bad',p_validator:validator})).toMatch(/permission denied/);
 expect(await refused(service(),'studio_review_maintenance_check',await review(q.checkId))).toMatch(/permission denied/);
});

test('gateway verifies scoped bytes, retains a report in immutable storage and replays completion safely',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {LocalStudioStorage}=await import('../../lib/studio/storage/local');const {handleStudioGateway}=await import('../../lib/studio/gateway');const {blobKey}=await import('../../lib/studio/contracts');const {manifestSha}=await import('./studio-fixture');
 const dir=mkdtempSync(join(tmpdir(),'studio-maintenance-gateway-'));const store=new LocalStudioStorage(dir),token='s'.repeat(40);
 const post=async(body:unknown,auth='Bearer '+token)=>{const r=await handleStudioGateway(new Request('http://local.test/api/internal/studio',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)}),{token,rpc:service(),storage:store});return {status:r.status,body:await r.json() as any};};
 try {
  const a=await draft(),q=await request([a]);for(const f of baseBank)await store.put(blobKey(MODULE,sha(f.content)),Buffer.from(f.content),'text/markdown');await store.put(blobKey(MODULE,a.sha256),Buffer.from('Synthetic replacement'),'text/markdown');
  expect((await post({action:'maintenance_claim',worker:'test',validatorSha256:validator},'Bearer wrong')).status).toBe(401);
  const c=(await post({action:'maintenance_claim',worker:'test',validatorSha256:validator})).body.result;expect(c.candidateManifestSha256).toBe(manifestSha(MODULE,c.files));
  const ref=c.files[0],read=await post({action:'maintenance_read',checkId:c.checkId,lease:c.lease,blobId:ref.blobId,offset:0});expect(read.status).toBe(200);expect(sha(Buffer.from(read.body.result.content,'base64'))).toBe(ref.sha256);
  const report={schema:'reviseit/maintenance-check@1',checkId:c.checkId,candidateManifestSha256:c.candidateManifestSha256,validatorSha256:validator,structuralOk:true,errors:[],warnings:[],fileCount:c.files.length,authoredFormCount:0,checks:['Synthetic structural check'],notChecked:['Scientific correctness'],humanReview:'pending',integrationOccurred:false};const done={action:'maintenance_complete',checkId:c.checkId,lease:c.lease,report};expect((await post(done)).status).toBe(200);expect((await post(done)).status).toBe(200);
  const v=await view(q.checkId);expect(Buffer.from((await store.get(blobKey(MODULE,v.reportSha256)))!)).toEqual(Buffer.from(JSON.stringify(report)));expect((await post({...done,report:{...report,structuralOk:false}})).status).not.toBe(200);
  expect(await refused(editor(),'studio_review_maintenance_check',await review(q.checkId,{p_acknowledgements:{findings:true}}))).toMatch(/acknowledgements/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('expired leases cannot read or complete and require an explicit fresh request',async()=>{
 const a=await draft(),q=await request([a]),c=await claim();
 await db.sql(`update private.studio_maintenance_checks set lease_until=now()-interval '1 second' where id='${q.checkId}'`);
 expect((await view(q.checkId)).expired).toBe(true);
 expect(await refused(service(),'studio_maintenance_check_read',{p_check:c.checkId,p_lease:c.lease,p_blob:c.files[0].blobId})).toMatch(/lease lost/);
 await expect(finish(c)).rejects.toThrow(/lease lost/);expect(await claim()).toBeNull();
 const next=await request([a]);expect(next.checkId).not.toBe(q.checkId);expect((await claim()).checkId).toBe(next.checkId);
});
