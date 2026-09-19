/** Prepare, never execute, the reviewed development-project migration batch. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=[
 '202609120002_teacher_workspace.sql','202609120003_catalogue_discovery.sql',
 '202609120004_catalogue_mark_ranges.sql','202609130005_catalogue_preview.sql',
 '202609130006_catalogue_publication.sql','202609130007_render_formatting.sql',
 '202609190008_teacher_jobs.sql',
];
const literal=value=>"'"+value.replaceAll("'","''")+"'";
export function prepare(){
 const migrations=files.map(file=>{
  const source=readFileSync(resolve(root,'supabase/migrations',file),'utf8');
  if(!source.startsWith('begin;\n')||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected migration transaction wrapper: '+file);
  const body=source.slice('begin;\n'.length,source.lastIndexOf('commit;'));
  const [version,...name]=file.replace(/\.sql$/,'').split('_');
  return {file,version,name:name.join('_'),source,body,sha256:createHash('sha256').update(source).digest('hex')};
 });
 const guard=`begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
lock table supabase_migrations.schema_migrations in exclusive mode;
do $guard$ begin
 if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations) is distinct from array['202609120001']::text[] then
  raise exception 'Migration baseline changed; inspect before applying';
 end if;
 if to_regclass('public.teacher_accounts') is null or to_regclass('public.curriculum_modules') is not null then
  raise exception 'Schema does not match the reviewed account-only baseline';
 end if;
end $guard$;
`;
 const sql=guard+migrations.map(m=>`\n-- ${m.file}; source SHA256 ${m.sha256}\n${m.body}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values (${literal(m.version)},${literal(m.name)},array[${literal(m.source)}]);\n`).join('')+'\ncommit;\n';
 return {sql,manifest:{targetProject:'tgaganmgccvrphpfipgy',expectedVersions:['202609120001'],migrations:migrations.map(({file,version,sha256})=>({file,version,sha256})),sqlSha256:createHash('sha256').update(sql).digest('hex')}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw new Error('Usage: node scripts/prepare-hosted-migrations.mjs NEW_OUTPUT_DIRECTORY');
 const out=resolve(process.argv[2]);mkdirSync(out,{recursive:false,mode:0o700});
 const {sql,manifest}=prepare();writeFileSync(resolve(out,'apply.sql'),sql,{mode:0o600});
 writeFileSync(resolve(out,'manifest.json'),JSON.stringify({...manifest,meta:{last_updated:new Date().toISOString()}},null,2)+'\n',{mode:0o600});
 console.log('Prepared seven migrations. Nothing executed. SQL SHA256: '+manifest.sqlSha256);
}
