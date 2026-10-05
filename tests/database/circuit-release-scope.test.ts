// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,test,expect} from 'vitest';
// Release-scoped admission of Grade 11 structured:P1-CIRC-01 (migration 202610050038).
// Synthetic identities and content only.
let db:PGlite;
const G11='caps-grade-11-physical-sciences',G10='caps-grade-10-physical-sciences',CIRC='structured:P1-CIRC-01';
const hash=(s:string)=>s.repeat(64);
const field=(id:string)=>({id,label:'Synthetic '+id,hint:'',required:false,allowAutomatic:true,type:'text',maxLength:100});
const registration=(module:string,release:string,id:string,manifest:string)=>({module,release,entryId:id,kind:'specification',canonicalId:id.split(':')[1],
 formRevision:hash('a'),bundleDigest:hash('b'),manifestSha256:manifest,sharedFormsSha256:hash('d'),fields:[field('power_calculation')],
 shared:{'paper-logistics':{revision:hash('e'),fields:[field('logistics')]},'multiple-choice-block':{revision:hash('f'),fields:[field('block')]}},
 sources:[{role:'specification',path:'sources/synthetic.md',sha256:hash('b')}],explicitlyNoInput:false});
const corrected={id:'form-power-electricity-cost',kind:'constraint',activation:'active',when:{facet:'power_calculation',is:'electricity_cost'},
 then:[{requireParts:['p7']},{excludeOptions:{facet:'cost_calculation',options:['no']}}],reason:'hint.form.power-calculation',origin:{type:'form',locators:[],heldBecause:null}};
const parts=[{id:'p7',label:'X.7'}];
const legacyRules=[{id:'form-cost-no',kind:'constraint',activation:'active',when:{facet:'cost_calculation',is:'no'},then:[{excludeParts:['p7']}],reason:'r',origin:{type:'form',locators:[],heldBecause:null}}];
async function owner(){await db.exec('reset role');}
async function publisher(sql:string,args:unknown[]){await owner();await db.exec('set role reviseit_catalogue_publisher');await db.query(sql,args);await owner();}
async function refuse(run:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint refusal');await expect(run()).rejects.toThrow(pattern);await db.exec('rollback to savepoint refusal');}
async function setup(module:string,release:string,entry:string,manifest:string,workflow:string){
 await publisher('select public.register_catalogue_authored_form($1)',[JSON.stringify(registration(module,release,entry,manifest))]);
 await publisher('select public.register_catalogue_execution($1,$2,$3,$4)',[module,release,manifest,workflow]);
}
// A classification row pinned like register_bloom_classification pins it (owner insert; the
// registration function's own checks are covered by the bloom contract tests).
async function classify(module:string,release:string,entry:string,rules:unknown[],sha:string,workflow?:string){
 await owner();
 const f=(await db.query<any>('select payload from private.catalogue_authored_forms where module_id=$1 and release=$2 and entry_id=$3',[module,release,entry])).rows.at(-1).payload;
 const w=workflow??(await db.query<any>('select workflow_sha256 from private.catalogue_executions where module_id=$1 and release=$2 and manifest_sha256=$3',[module,release,f.manifestSha256])).rows[0].workflow_sha256;
 const binding=(await db.query<any>('select private.line_source_binding($1,$2) as b',[JSON.stringify(f),w])).rows[0].b;
 await db.query('insert into private.catalogue_classifications(module_id,release,entry_id,sha256,schema_version,payload,source_binding) values($1,$2,$3,$4,4,$5,$6)',
  [module,release,entry,sha,JSON.stringify({schemaVersion:4,parts,rules}),JSON.stringify(binding)]);
 await db.query('insert into private.catalogue_classification_bindings(module_id,release,entry_id,sha256) values($1,$2,$3,$4) on conflict(module_id,release,entry_id) do update set sha256=excluded.sha256',[module,release,entry,sha]);
}
async function orderable(module:string,release:string,entry:string){
 await owner();await db.query('select public.sync_supported_catalogue_readiness($1)',[module]);
 const r=(await db.query<any>('select private.catalogue_item_supported($1,$2,$3) as s',[module,release,entry])).rows[0].s;
 return r as boolean;
}

beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into public.curriculum_modules(id,name,current_release) values('${G11}','Grade 11','5.6.0'),('${G10}','Grade 10','16.0.2');
 insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max) values
 ('${G11}','5.5.2','${CIRC}','Circuit','Synthetic','',16,27),('${G11}','5.6.0','${CIRC}','Circuit','Synthetic','',16,27),
 ('${G10}','16.0.2','structured:P2-CHEM-04','Joint','Synthetic','',10,20);`);
 // Older release: registered, connected, classified without the corrected rule.
 await setup(G11,'5.5.2',CIRC,hash('1'),hash('8'));await classify(G11,'5.5.2',CIRC,legacyRules,hash('5'));
 await setup(G11,'5.6.0',CIRC,hash('2'),hash('9'));
 await setup(G10,'16.0.2','structured:P2-CHEM-04',hash('3'),hash('7'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});

test('an older circuit definition without the corrected rule stays unavailable',async()=>{
 expect(await orderable(G11,'5.5.2',CIRC)).toBe(false);
 await refuse(()=>publisher('select public.set_catalogue_form_binding($1,$2,$3,$4,$5,$6,true)',[G11,'5.5.2',CIRC,hash('a'),hash('b'),hash('d')]),/Connected execution required/);
});
test('the corrected release is unavailable until its corrected classification is bound',async()=>{
 expect(await orderable(G11,'5.6.0',CIRC)).toBe(false);
 await classify(G11,'5.6.0',CIRC,legacyRules,hash('6'));
 expect(await orderable(G11,'5.6.0',CIRC)).toBe(false);
});
test('a corrected classification bound to the exact form, bundle and workflow admits the circuit',async()=>{
 await classify(G11,'5.6.0',CIRC,[...legacyRules,corrected],hash('4'));
 expect(await orderable(G11,'5.6.0',CIRC)).toBe(true);
 // The older release is still refused in the same database.
 expect(await orderable(G11,'5.5.2',CIRC)).toBe(false);
});
test('a corrected rule pinned to a different workflow does not admit the circuit',async()=>{
 await classify(G11,'5.6.0',CIRC,[corrected],hash('4'),hash('0'));
 expect(await orderable(G11,'5.6.0',CIRC)).toBe(false);
});
test('a weakened rule (no cost-option exclusion) does not count as corrected',async()=>{
 await classify(G11,'5.6.0',CIRC,[{...corrected,then:[{requireParts:['p7']}]}],hash('4'));
 expect(await orderable(G11,'5.6.0',CIRC)).toBe(false);
});
test('the Grade 10 joint-section exclusion is unchanged',async()=>{
 await classify(G10,'16.0.2','structured:P2-CHEM-04',[corrected],hash('4'));
 expect(await orderable(G10,'16.0.2','structured:P2-CHEM-04')).toBe(false);
});
test('the order freeze trigger admits only a corrected, exactly pinned circuit line',async()=>{
 await owner();
 await db.exec(`create temporary table frozen_probe(adapter_key text,module_id text,release text,school_id uuid,snapshot jsonb);
  create trigger probe before insert on frozen_probe for each row execute function private.freeze_new_catalogue_execution();
  insert into public.schools(id,slug,name) values('00000000-0000-4000-8000-000000000010','synthetic-school','Synthetic School');`);
 const f=(await db.query<any>("select payload from private.catalogue_authored_forms where release='5.6.0' and entry_id=$1",[CIRC])).rows[0].payload;
 const good=(await db.query<any>('select private.line_source_binding($1,$2) as b',[JSON.stringify(f),hash('9')])).rows[0].b;
 const snap=(cls:unknown,adapter='configured-bundle-v1')=>[adapter,G11,'5.6.0','00000000-0000-4000-8000-000000000010',
  JSON.stringify({schema:adapter==='configured-bundle-v1'?'reviseit/configured-authored-inputs@1':'reviseit/frozen-authored-inputs@1',module:G11,release:'5.6.0',manifestSha256:hash('2'),
   lines:[{id:'q1',entryId:CIRC,binding:f,classification:cls}]})];
 const insert='insert into frozen_probe values($1,$2,$3,$4,$5)';
 await refuse(()=>db.query(insert,snap({sha256:hash('6'),payload:{parts,rules:legacyRules},sourceBinding:good})),/input mapping remains unresolved/);
 await refuse(()=>db.query(insert,snap({sha256:hash('4'),payload:{parts,rules:[corrected]},sourceBinding:{...good,workflowManifestSha256:hash('0')}})),/input mapping remains unresolved/);
 await refuse(()=>db.query(insert,snap(null)),/input mapping remains unresolved/);
 await refuse(()=>db.query(insert,snap({sha256:hash('4'),payload:{parts,rules:[corrected]}})),/input mapping remains unresolved/);
 await refuse(()=>db.query(insert,snap({sha256:hash('4'),payload:{parts,rules:[corrected]},sourceBinding:null})),/input mapping remains unresolved/);
 await refuse(()=>db.query(insert,snap({sha256:hash('4'),payload:{parts,rules:[corrected]},sourceBinding:good},'authored-bundle-v1')),/input mapping remains unresolved/);
 await db.query(insert,snap({sha256:hash('4'),payload:{parts,rules:[corrected]},sourceBinding:good}));
 const row=(await db.query<any>('select snapshot from frozen_probe')).rows[0];
 expect(row.snapshot.execution.workflowManifestSha256).toBe(hash('9'));
});

test('a correction must require the unique cost part, not merely any part',async()=>{
 const valid={parts,rules:[corrected]};
 const invalid=[
  {...valid,parts:[]},
  {...valid,parts:[...parts,{id:'p8',label:'X.7'}]},
  {...valid,rules:[{...corrected,kind:'preference'}]},
  ...[[],['p1'],['p1','p7']].map(targets=>({...valid,rules:[{...corrected,then:[{requireParts:targets},{excludeOptions:{facet:'cost_calculation',options:['no']}}]}]})),
 ];
 for(const value of invalid){
  const result=await db.query<any>('select private.corrected_circuit_rule($1) as corrected',[JSON.stringify(value)]);
  expect(result.rows[0].corrected,JSON.stringify(value)).toBe(false);
 }
 await classify(G11,'5.6.0',CIRC,[{...corrected,then:[{requireParts:['p1']},{excludeOptions:{facet:'cost_calculation',options:['no']}}]}],hash('4'));
 expect(await orderable(G11,'5.6.0',CIRC)).toBe(false);
});
