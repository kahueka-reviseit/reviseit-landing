// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,test,expect} from 'vitest';
import {publication,recordReceipt} from '../fixtures/publication';
let db:PGlite;
const first='00000000-0000-4000-8000-000000000101',second='00000000-0000-4000-8000-000000000102';
async function asPublisher(){await db.exec('set role reviseit_catalogue_publisher');}
async function deliver(payload:unknown=publication(),id=first){return db.query<{result:{status:string}}>('select public.import_catalogue_release($1,$2::jsonb) as result',[id,JSON.stringify(payload)]);}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});
test.each(['anon','authenticated','service_role'])('%s cannot call the publication function',async role=>{await db.exec(`set role ${role}`);await expect(deliver()).rejects.toThrow(/permission denied/);});
test('publisher cannot grant its own approval or school access',async()=>{
 await asPublisher();await expect(recordReceipt(db,first,publication())).rejects.toThrow(/permission denied/);
});
test.each(['school_curriculum_access','catalogue_summaries','curriculum_modules'])('publisher cannot directly mutate %s',async table=>{await asPublisher();await expect(db.query(`delete from public.${table}`)).rejects.toThrow(/permission denied/);});
test('published flag without a gate receipt grants nothing',async()=>{await asPublisher();await expect(deliver()).rejects.toThrow(/approval required/);});
test('receipt binds the exact payload',async()=>{await recordReceipt(db,first,publication());await asPublisher();const changed=publication();changed.entries[0].description='Changed after approval';await expect(deliver(changed)).rejects.toThrow(/approval required/);});
test('revoked approvals cannot deliver',async()=>{await recordReceipt(db,first,publication());await db.query('update private.catalogue_gate_receipts set revoked_at=now() where id=$1',[first]);await asPublisher();await expect(deliver()).rejects.toThrow(/approval required/);});
test.each([
 {...publication(),status:'draft'}, {...publication(),status:null}, {...publication(),schema:null}, {...publication(),schema:'unknown'},
 {...publication(),parameter_questions:['PRIVATE_FORM']},
 {...publication(),entries:[]},
 {...publication(),entries:[publication().entries[0],publication().entries[0]]},
 {...publication(),entries:[{...publication().entries[0],description:''}]},
 {...publication(),entries:[{...publication().entries[0],marks:{min:12,max:8}}]},
 {...publication(),entries:[{...publication().entries[0],preview:{subquestions:{min:1,max:2},outline:[{summary:'Example',bloom:'L4'}]}}]},
 {...publication(),entries:[{...publication().entries[0],thumbnail:{src:'file:///private/spec.svg',alt:'Diagram'}}]},
 {...publication(),entries:[{...publication().entries[0],thumbnail:{png:'iVBORw0KGgo====',alt:'Diagram'}}]},
 {...publication(),entries:[{...publication().entries[0],id:'OTHER_ID'}]},
])('rejects invalid, draft or leaking manifests even with a receipt: %j',async payload=>{await recordReceipt(db,first,payload);await asPublisher();await expect(deliver(payload)).rejects.toThrow(/Invalid published catalogue/);});
test('one approved release activates all rows and does not grant school access',async()=>{
 await recordReceipt(db,first,publication());await asPublisher();expect((await deliver()).rows[0].result.status).toBe('imported');
 await db.exec('reset role');expect((await db.query('select current_release from public.curriculum_modules')).rows).toEqual([{current_release:'1.0'}]);
 expect((await db.query('select entry_id from public.catalogue_summaries')).rows).toHaveLength(1);expect((await db.query('select * from public.school_curriculum_access')).rows).toHaveLength(0);
});
test('retry is idempotent and never rolls back the current release',async()=>{
 await recordReceipt(db,first,publication());await recordReceipt(db,second,publication('2.0'),'1.0');
 await asPublisher();await deliver();expect((await deliver()).rows[0].result.status).toBe('already-imported');await deliver(publication('2.0'),second);
 expect((await deliver()).rows[0].result.status).toBe('already-imported');await db.exec('reset role');
 expect((await db.query('select current_release from public.curriculum_modules')).rows).toEqual([{current_release:'2.0'}]);expect((await db.query('select * from private.catalogue_imported_releases')).rows).toHaveLength(2);
});
test('out-of-order publication is rejected against the approved predecessor',async()=>{await recordReceipt(db,first,publication());await recordReceipt(db,second,publication('3.0'),'2.0');await asPublisher();await deliver();await expect(deliver(publication('3.0'),second)).rejects.toThrow(/predecessor changed/);});
test('an existing version cannot be replaced under another approval',async()=>{await recordReceipt(db,first,publication());await recordReceipt(db,second,publication(),'1.0');await asPublisher();await deliver();await expect(deliver(publication(),second)).rejects.toThrow(/immutable/);});
test('committed catalogue rows are immutable even to an accidental administrative update',async()=>{await recordReceipt(db,first,publication());await asPublisher();await deliver();await db.exec('reset role');await expect(db.query("update public.catalogue_summaries set title='Changed'" )).rejects.toThrow(/immutable/);});
test('failure after an inserted row rolls the entire import back',async()=>{
 const payload=publication();payload.entries.push({...payload.entries[0],id:'structured:P1-EXAMPLE-02',code:'P1-EXAMPLE-02'});
 await recordReceipt(db,first,payload);
 await db.exec(`create function public.synthetic_import_failure() returns trigger language plpgsql as $$begin if new.entry_id='structured:P1-EXAMPLE-02' then raise exception 'Synthetic storage failure'; end if; return new; end $$;
 create trigger synthetic_import_failure before insert on public.catalogue_summaries for each row execute function public.synthetic_import_failure();`);
 await db.exec('savepoint attempt');await asPublisher();await expect(deliver(payload)).rejects.toThrow(/Synthetic storage failure/);await db.exec('rollback to savepoint attempt;reset role');
 expect((await db.query('select * from public.curriculum_modules')).rows).toHaveLength(0);expect((await db.query('select * from public.catalogue_summaries')).rows).toHaveLength(0);expect((await db.query('select * from private.catalogue_imported_releases')).rows).toHaveLength(0);
});

test('approved PNG and preview metadata survive import intact',async()=>{
 const thumbnail={png:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',alt:'Synthetic diagram'};
 const payload={...publication(),entries:[{...publication().entries[0],thumbnail}]};
 await recordReceipt(db,first,payload);await asPublisher();await deliver(payload);await db.exec('reset role');
 expect((await db.query('select thumbnail_png,thumbnail_alt,preview from public.catalogue_summaries')).rows).toEqual([{thumbnail_png:thumbnail.png,thumbnail_alt:thumbnail.alt,preview:payload.entries[0].preview}]);
});
