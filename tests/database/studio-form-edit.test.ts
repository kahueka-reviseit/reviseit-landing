// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {StudioDb,ids,MODULE,ok,baseBank,importSnapshot,key,sha,verified} from './studio-fixture';
import {LocalStudioStorage} from '../../lib/studio/storage/local';
import {saveFormDraft} from '../../lib/studio/form-save';
import {canonicalFormJson,type FormSaveInput} from '../../lib/studio/form-authoring';
import {readDraftText} from '../../lib/studio/maintenance-save';
import {blobKey} from '../../lib/studio/contracts';
import {authoredForm,formFile} from '../fixtures/studio-form';
let db:StudioDb,snapshot:string,dir:string,storage:LocalStudioStorage,source:string;
const original=structuredClone(authoredForm);original.identity.module=MODULE;original.form_revision=sha(canonicalFormJson({fields:original.fields,identity:original.identity}));
const ed=()=>db.rpc({kind:'user',id:ids.editor});
beforeAll(async()=>{db=new StudioDb();await db.init();const op=db.rpc({kind:'operator'});await ok(op,'studio_enrol_module',{p_module:MODULE,p_subject_adapter:'caps-physical-sciences@2'});
 source=JSON.stringify(original,null,2)+'\n';snapshot=(await importSnapshot(op,MODULE,[...baseBank,{path:formFile.path,content:source}],{purpose:'rehearsal'})).snapshotId;
},60000);
beforeEach(async()=>{await db.begin();dir=mkdtempSync(join(tmpdir(),'studio-form-'));storage=new LocalStudioStorage(dir);await storage.put(blobKey(MODULE,sha(source)),Buffer.from(source),'application/json');return async()=>{await db.rollback();rmSync(dir,{recursive:true,force:true});};});
afterAll(async()=>db.close());
const input=(extra:Partial<FormSaveInput>={}):FormSaveInput=>({draftId:null,snapshotId:snapshot,path:formFile.path,expectedRevision:0,expectedSha256:sha(source),fields:original.fields.map((f,i)=>i===0?{...f,label:'What should learners calculate?'}:f),reason:'Make the question easier to read.',asOf:'2026-10-14',command:key(),...extra});
const save=(i:FormSaveInput)=>{const rpc=ed();return saveFormDraft(rpc,verified(rpc),storage,i);};
test('structured saves recompute the producer fingerprint and preserve original evidence; retries create one revision',async()=>{
 const i=input(),a=await save(i);expect(await save(i)).toEqual(a);
 const v=await ok(ed(),'studio_maintenance_draft_view',{p_draft:a.draftId}),r=v.revisions[0];expect(v.revisions).toHaveLength(1);
 const d=JSON.parse(await readDraftText(ed(),storage,r.blobId,r.sha256));
 expect(d.form_revision).toBe(sha(canonicalFormJson({fields:i.fields,identity:original.identity})));expect(d.form_revision).not.toBe(original.form_revision);expect(d.meta.last_updated).toBe(i.asOf);
 expect(d.field_provenance.quantity.authored_from_source).toEqual(original.field_provenance.quantity.authored_from_source);expect(d.field_provenance.quantity.changes).toEqual([`Studio private revision (${i.asOf}): ${i.reason}`]);expect(d.field_provenance.context).toEqual(original.field_provenance.context);
 for(const k of ['identity','current_source_matches','unresolved','notes','excluded_source_questions','status'])expect(d[k]).toEqual(original[k]);
 expect((await db.sql('select count(*)::int n from private.studio_decisions'))[0].n).toBe(0);expect((await db.sql('select count(*)::int n from private.studio_changesets'))[0].n).toBe(0);
});
test('renamed identifiers, changed types, removed choices and malformed fields are rejected before any revision is written',async()=>{
 const bad=[original.fields.map((f,i)=>i===0?{...f,id:'new_name'}:f),original.fields.slice(1),original.fields.map((f,i)=>i===0?{...f,choices:[]}:f),original.fields.map((f,i)=>i===0?{...f,choices:[{id:'new_choice',label:'New'}]}:f),original.fields.map((f,i)=>i===0?{...f,label:''}:f)];
 for(const fields of bad)await expect(save(input({fields:fields as any}))).rejects.toThrow(/field|Choice|Field|format/);
 expect(await ok(ed(),'studio_maintenance_drafts_view',{})).toEqual([]);
});
test('answer flags and limits are private edits; stale competing form saves preserve the latest revision',async()=>{
 const i=input(),a=await save(i);const fields=structuredClone(i.fields);fields[0].allowAutomatic=true;if(fields[0].type==='choice')fields[0].allowOther=true;if(fields[1].type==='text')fields[1].maxLength=500;
 const second=input({draftId:a.draftId,expectedRevision:1,expectedSha256:a.sha256,fields}),b=await save(second);
 await expect(save({...second,fields:original.fields,command:key()})).rejects.toThrow(/newer revision/);expect((await ok(ed(),'studio_maintenance_draft_view',{p_draft:a.draftId})).revision).toBe(b.revision);
});
test('source identity and binding, reason, date and unchanged fields are checked on the server',async()=>{
 await expect(save(input({fields:original.fields}))).rejects.toThrow(/unchanged/);await expect(save(input({reason:'short'}))).rejects.toThrow(/reason/);await expect(save(input({asOf:'2026-02-30'}))).rejects.toThrow(/date/);await expect(save(input({expectedSha256:'d'.repeat(64)}))).rejects.toThrow(/revision changed/);
 const rpc=db.rpc({kind:'user',id:ids.teacher});await expect(saveFormDraft(rpc,verified(rpc),storage,input())).rejects.toThrow(/editor access/);
});
