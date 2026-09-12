// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll,beforeEach,afterEach,afterAll,test,expect } from 'vitest';
let db:PGlite;
const teacher='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',colleague='00000000-0000-4000-8000-000000000004';
const school='00000000-0000-4000-8000-000000000010',second='00000000-0000-4000-8000-000000000020';
const module='demo-grade-10-sciences';
const settings={font:'Arial',fontSize:12,spacing:'normal',header:'Synthetic school',answerLines:true};
async function asUser(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function format(revision=0,value:unknown=settings){return db.query('select public.save_school_formatting($1,$2,$3) as revision',[module,revision,JSON.stringify(value)]);}
async function select(ids:unknown=['DEMO_01'],revision:number|null=0,release='demo-1',m=module){return db.query('select public.save_paper_selection($1,$2,$3,$4) as revision',[m,release,revision,ids]);}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of ['supabase/migrations/202609120001_teacher_accounts.sql','supabase/migrations/202609120002_teacher_workspace.sql','tests/fixtures/workspace.sql']) await db.exec(readFileSync(f,'utf8'));
 for(const id of [teacher,other,colleague]) await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id,`${id}@synthetic.example`]);
 for(const [id,name] of [[school,'First'],[second,'Second']]){
  await db.query('insert into public.schools(id,slug,name) values($1,$2,$3)',[id,name.toLowerCase(),name]);
  await db.query("insert into public.departments(id,school_id,name) values($1,$1,'Sciences')",[id]);
  await db.query('insert into public.school_curriculum_access(school_id,module_id) select $1,id from public.curriculum_modules',[id]);
 }
 for(const [id,s] of [[teacher,school],[colleague,school],[other,second]]) await db.query("update public.teacher_accounts set status='approved',school_id=$2,department_id=$2,reviewed_by=$1,reviewed_at=now() where user_id=$1",[id,s]);
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});afterAll(async()=>{await db.close();});
test('anonymous direct catalogue access is denied',async()=>{await db.exec('set role anon');await expect(db.query('select * from public.catalogue_summaries')).rejects.toThrow(/permission denied/);});
test.each(['pending','suspended','rejected'])('%s account cannot save or read catalogue data',async status=>{await db.query('update public.teacher_accounts set status=$1 where user_id=$2',[status,teacher]);await asUser(teacher);expect((await db.query('select * from public.catalogue_summaries')).rows).toHaveLength(0);await expect(format()).rejects.toThrow(/access required/);});
test('email confirmation remains required by the database',async()=>{await db.query('update auth.users set email_confirmed_at=null where id=$1',[teacher]);await asUser(teacher);await expect(select()).rejects.toThrow(/access required/);});
test('same-school colleagues share formatting, another school cannot read or overwrite it',async()=>{
 await asUser(teacher);await format();await asUser(colleague);expect((await db.query<{preferences:typeof settings}>('select preferences from public.school_formatting')).rows[0].preferences).toEqual(settings);
 await asUser(other);expect((await db.query('select * from public.school_formatting')).rows).toHaveLength(0);await format(0,{...settings,header:'Second school'});
 await asUser(teacher);expect((await db.query<{preferences:typeof settings}>('select preferences from public.school_formatting')).rows[0].preferences.header).toBe('Synthetic school');
});
test('paper drafts are personal even within the same school',async()=>{await asUser(teacher);await select();await asUser(colleague);expect((await db.query('select * from public.paper_selections')).rows).toHaveLength(0);await select(['DEMO_02']);await asUser(teacher);expect((await db.query<{entry_ids:string[]}>('select entry_ids from public.paper_selections')).rows[0].entry_ids).toEqual(['DEMO_01']);});
test('teachers cannot bypass validators with direct writes',async()=>{await asUser(teacher);await expect(db.query("insert into public.school_formatting(school_id,module_id,preferences,updated_by) values($1,$2,'{}',$3)",[school,module,teacher])).rejects.toThrow(/permission denied/);});
test('curriculum revocation blocks existing settings and draft writes',async()=>{await asUser(teacher);await format();await db.exec('reset role');await db.query('update public.school_curriculum_access set active=false where school_id=$1',[school]);await asUser(teacher);expect((await db.query('select * from public.school_formatting')).rows).toHaveLength(0);await expect(select()).rejects.toThrow(/access required/);});
test.each([{...settings,fontSize:99},{...settings,prompt:'private data'},{...settings,header:null},{...settings,font:null}])('rejects unsupported formatting %j',async value=>{await asUser(teacher);await expect(format(0,value)).rejects.toThrow(/Invalid formatting/);});
test('stale formatting cannot silently overwrite a colleague’s update',async()=>{await asUser(teacher);await format();await asUser(colleague);await format(1,{...settings,font:'Times New Roman'});await asUser(teacher);await expect(format(1)).rejects.toThrow(/Formatting changed/);});
test('second initial save cannot overwrite an existing profile',async()=>{await asUser(teacher);await format();await expect(format()).rejects.toThrow(/Formatting changed/);});
test('question identities and marks are qualified by curriculum and release',async()=>{await asUser(teacher);await select();await select(['DEMO_01'],0,'demo-1','demo-grade-11-sciences');const rows=(await db.query<{marks:number}>('select marks from public.catalogue_summaries where entry_id=\'DEMO_01\' order by module_id')).rows;expect(rows.map(r=>r.marks)).toEqual([10,15]);expect((await db.query('select * from public.paper_selections')).rows).toHaveLength(2);});
test.each([['missing'],['DEMO_01','DEMO_01'],[null],Array(31).fill('DEMO_01')].map(ids=>({ids})))('rejects invalid selection $ids',async ({ids})=>{await asUser(teacher);await expect(select(ids)).rejects.toThrow(/Invalid question selection/);});
test('cannot save against an outdated catalogue release',async()=>{await asUser(teacher);await expect(select(['DEMO_01'],0,'old-release')).rejects.toThrow(/Catalogue changed/);});
test('stale selection cannot overwrite a newer save',async()=>{await asUser(teacher);await select();await select(['DEMO_02'],1);await expect(select(['DEMO_01'],1)).rejects.toThrow(/Selection changed/);});
test('can clear a saved selection and refresh preserves that empty draft',async()=>{await asUser(teacher);await select();await select([],1);expect((await db.query<{entry_ids:string[];revision:number}>('select entry_ids,revision from public.paper_selections')).rows[0]).toEqual({entry_ids:[],revision:2});});
test('cannot omit the expected revision',async()=>{await asUser(teacher);await expect(select(['DEMO_01'],null)).rejects.toThrow(/Refresh/);});
