// @vitest-environment node
import {beforeAll,beforeEach,afterAll,test,expect} from 'vitest';
import {StudioDb,ids,MODULE,OTHER,ok,refused,sha} from './studio-fixture';
import {readImportedFile} from '../../lib/studio/imported-analysis';
let s:StudioDb;
const editor=()=>s.rpc({kind:'user',id:ids.editor}),operator=()=>s.rpc({kind:'operator'});
const file=(path='source.pdf',content='%PDF-1.7 synthetic')=>({path,sha256:sha(content),size:Buffer.byteLength(content),mediaType:'application/pdf',role:'source'});
const input=(extra={})=>({p_module:MODULE,p_import_key:'historical:2099-test',p_title:'Synthetic historical paper',p_status:'source_only',p_provenance:{origin:'existing_collection',analysedOn:null},p_files:[file()],...extra});
beforeAll(async()=>{s=new StudioDb();await s.init();for(const module of [MODULE,OTHER])await ok(operator(),'studio_enrol_module',{p_module:module,p_subject_adapter:'caps-physical-sciences@2'});},60000);
afterAll(async()=>{await s.close();});
beforeEach(async()=>{await s.begin();return async()=>{await s.rollback();};});
test('import repeats without fabricating execution, decisions or acceptance',async()=>{
 const args=input({p_files:[file(),file('duplicate.pdf')]});const a=await ok(operator(),'studio_import_analysis',args),b=await ok(operator(),'studio_import_analysis',args);expect(a.id).toBe(b.id);expect(b.created).toBe(false);
 const v=await ok(editor(),'studio_imported_analysis',{p_id:a.id});expect(v.files).toHaveLength(2);expect(new Set(v.files.map((x:any)=>x.sha256)).size).toBe(1);expect(v.provenance.analysedOn).toBeNull();
 expect((await s.sql('select (select count(*) from private.studio_runs)::int runs,(select count(*) from private.studio_decisions)::int decisions,(select count(*) from private.studio_provider_attempts)::int attempts,(select count(*) from private.studio_modules where accepted_snapshot_id is not null)::int accepted'))[0]).toEqual({runs:0,decisions:0,attempts:0,accepted:0});
});
test('changed history cannot overwrite an existing import',async()=>{await ok(operator(),'studio_import_analysis',input());expect(await refused(operator(),'studio_import_analysis',input({p_title:'Changed identity'}))).toMatch(/identity conflict/);expect((await ok(editor(),'studio_imported_analyses',{}))[0].title).toBe('Synthetic historical paper');});
test('operator writes and editor reads only, including downloads',async()=>{
 const a=await ok(operator(),'studio_import_analysis',input());const v=await ok(editor(),'studio_imported_analysis',{p_id:a.id});
 for(const who of [s.rpc({kind:'anon'}),s.rpc({kind:'service'}),s.rpc({kind:'user',id:ids.teacher}),s.rpc({kind:'user',id:ids.outsider})]){
  expect(await refused(who,'studio_imported_analyses',{})).toMatch(/permission denied|editor access required/);
  expect(await refused(who,'studio_read_imported_file',{p_id:v.files[0].id})).toMatch(/permission denied|editor access required/);
  expect(await refused(who,'studio_import_analysis',input())).toMatch(/permission denied/);
 }
 expect(await refused(editor(),'studio_import_analysis',input())).toMatch(/permission denied/);
 for(const role of ['authenticated','service_role','reviseit_studio_operator'])await expect(s.sql('select * from private.studio_imported_analysis_files',[],role)).rejects.toThrow(/permission denied/);
});
test('invalid manifests, fake report status, traversal and contradictory blobs are refused atomically',async()=>{
 for(const extra of [{p_files:[]},{p_files:[file(),file()]},{p_files:[file('../escape.pdf')]},{p_status:'reports_retained'},{p_files:[{...file(),size:0}]}])expect(await refused(operator(),'studio_import_analysis',input(extra))).toBeTruthy();
 expect(await s.sql('select * from private.studio_imported_analyses')).toHaveLength(0);
 await ok(operator(),'studio_import_analysis',input());expect(await refused(operator(),'studio_import_analysis',input({p_import_key:'other',p_files:[{...file(),size:999}]}))).toMatch(/metadata or integrity conflict/);
});
test('file links cannot point across modules',async()=>{
 const a=await ok(operator(),'studio_import_analysis',input());await ok(operator(),'studio_import_analysis',input({p_module:OTHER}));const b=(await s.sql('select id from private.studio_blobs where module_id=$1',[OTHER]))[0];
 await expect(s.sql("insert into private.studio_imported_analysis_files(analysis_id,module_id,blob_id,relative_path,role) values($1,$2,$3,'cross.pdf','source')",[a.id,MODULE,b.id])).rejects.toThrow(/foreign key/);
});
test('downloads verify bytes and block corrupt storage',async()=>{
 const a=await ok(operator(),'studio_import_analysis',input());const v=await ok(editor(),'studio_imported_analysis',{p_id:a.id});const id=v.files[0].id;
 const storage:any={get:async()=>Buffer.from('%PDF-1.7 synthetic')};expect((await readImportedFile(editor(),storage,id)).bytes.length).toBe(file().size);
 storage.get=async()=>Buffer.from('tampered');await expect(readImportedFile(editor(),storage,id)).rejects.toThrow(/Integrity blocked/);expect(await refused(editor(),'studio_read_imported_file',{p_id:id})).toMatch(/Integrity blocked/);
});
