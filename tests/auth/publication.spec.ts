import {test,expect} from '@playwright/test';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {publication,recordReceipt} from '../fixtures/publication';
import {importCatalogue} from '../../scripts/catalogue-import.mjs';
const database=process.env.AUTH_TEST_DATABASE_URL||'';
function client(name:string){
 if(!database || !['localhost','127.0.0.1'].includes(new URL(database).hostname))throw Error('Disposable local PostgreSQL required');
 return new Client({connectionString:database,application_name:name});
}
test('concurrent publications serialize without exposing incomplete rows or regressing the release',async()=>{
 const owner=client('publication-test-owner'),a=client('publication-test-a'),b=client('publication-test-b');
 await Promise.all([owner.connect(),a.connect(),b.connect()]);
 const module='synthetic-concurrency-'+Date.now(),r1=publication('1',module),r2=publication('2',module),r3=publication('3',module);
 const id1=randomUUID(),id2=randomUUID(),id3=randomUUID();
 try{
  await recordReceipt(owner,id1,r1);await recordReceipt(owner,id2,r2,'1');await recordReceipt(owner,id3,r3,'1');
  await a.query('set role reviseit_catalogue_publisher');await b.query('set role reviseit_catalogue_publisher');
  await importCatalogue(a,id1,r1,{apply:true});
  await a.query('begin');await a.query('select public.import_catalogue_release($1,$2::jsonb)',[id2,JSON.stringify(r2)]);
  const pending=importCatalogue(b,id3,r3,{apply:true}).then(()=>({accepted:true}),()=>({accepted:false}));
  await expect.poll(async()=>Number((await owner.query("select count(*) from pg_stat_activity where application_name='publication-test-b' and wait_event_type='Lock'")).rows[0].count)).toBe(1);
  // A's new rows and pointer are still uncommitted. A separate reader sees the old complete state.
  expect((await owner.query('select current_release from public.curriculum_modules where id=$1',[module])).rows[0].current_release).toBe('1');
  expect((await owner.query('select distinct release from public.catalogue_summaries where module_id=$1',[module])).rows).toEqual([{release:'1'}]);
  await a.query('commit');expect(await pending).toEqual({accepted:false});
  expect((await owner.query('select current_release from public.curriculum_modules where id=$1',[module])).rows[0].current_release).toBe('2');
  expect((await owner.query('select release from private.catalogue_imported_releases where module_id=$1 order by release',[module])).rows).toEqual([{release:'1'},{release:'2'}]);
 }finally{await Promise.allSettled([a.query('rollback'),b.query('rollback')]);await Promise.allSettled([owner.end(),a.end(),b.end()]);}
});
test('command-line delivery defaults to rollback using a restricted publisher login',async()=>{
 const owner=client('publication-dry-run-owner');await owner.connect();
 const manifest=publication('1','synthetic-dry-run-'+Date.now()),id=randomUUID();
 const login='synthetic_publisher_'+randomUUID().replaceAll('-',''),password=randomUUID();
 const directory=await mkdtemp(join(tmpdir(),'catalogue-publication-'));
 try{
  await recordReceipt(owner,id,manifest);
  const ddl=await owner.query("select format('create role %I login password %L in role reviseit_catalogue_publisher',$1::text,$2::text) as sql",[login,password]);
  await owner.query(ddl.rows[0].sql);
  const connection=new URL(database);connection.username=login;connection.password=password;
  const file=join(directory,'synthetic.json');await writeFile(file,JSON.stringify(manifest),{mode:0o600});
  const {stdout}=await promisify(execFile)(process.execPath,['scripts/import-catalogue.mjs',file,id],{env:{...process.env,CATALOGUE_DATABASE_URL:connection.toString()},timeout:15000});
  expect(JSON.parse(stdout)).toMatchObject({mode:'dry-run',status:'imported'});
  expect((await owner.query('select * from public.curriculum_modules where id=$1',[manifest.module.id])).rows).toHaveLength(0);
  expect((await owner.query('select * from private.catalogue_imported_releases where approval_id=$1',[id])).rows).toHaveLength(0);
 }finally{
  try{await owner.query(`drop role if exists ${login}`);}finally{await Promise.allSettled([owner.end(),rm(directory,{recursive:true,force:true})]);}
 }
});
