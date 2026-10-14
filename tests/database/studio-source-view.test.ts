// @vitest-environment node
import {beforeAll,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,ok,refused,blob,key} from './studio-fixture';
let db:StudioDb, source:string, first:string, second:string;
const editor=()=>db.rpc({kind:'user',id:ids.editor});
beforeAll(async()=>{
 db=new StudioDb();await db.init();await ok(db.rpc({kind:'operator'}),'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@2'});
 first=await blob(editor(),MODULE,'source one');second=await blob(editor(),MODULE,'source two');
 const created=await ok(editor(),'studio_create_source',{p_module:MODULE,p_title:'Synthetic source',p_files:[{blobId:first,role:'question_paper',filename:'paper.pdf'}],p_identity:{year:2099},p_command:key()});source=created.id||created.sourceId;
 await ok(editor(),'studio_revise_source',{p_source:source,p_expected_revision:1,p_files:[{blobId:second,role:'combined',filename:'better.pdf'}],p_identity:{year:2099},p_reason:'Better synthetic scan',p_command:key()});
},60000);
afterAll(async()=>{await db.close();});
test('source details preserve every revision, filename and file binding without exposing object keys',async()=>{
 const v=await ok(editor(),'studio_source_view',{p_source:source});expect(v.revision).toBe(2);expect(v.revisions.map((r:any)=>r.revision)).toEqual([2,1]);
 expect(v.revisions[0].files[0]).toMatchObject({blobId:second,filename:'better.pdf',integrity:'verified'});expect(v.revisions[1].files[0].blobId).toBe(first);
 expect(JSON.stringify(v)).not.toContain('studio/blobs/');expect(v.revisions[0].identity).toEqual({year:2099});
});
test('sources are visible only to editors, not ordinary reviewers, teachers or service callers',async()=>{
 for(const actor of [{kind:'anon'} as const,{kind:'service'} as const,{kind:'user',id:ids.outsider} as const,{kind:'user',id:ids.teacher} as const])expect(await refused(db.rpc(actor),'studio_source_view',{p_source:source})).toMatch(/permission denied|editor access required/);
 expect(await refused(editor(),'studio_source_view',{p_source:key()})).toMatch(/Source not found/);
});
