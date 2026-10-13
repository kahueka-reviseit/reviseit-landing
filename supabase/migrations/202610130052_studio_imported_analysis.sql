-- Preserve previously analysed papers without fabricating Studio runs, model calls or approvals.
create table private.studio_imported_analyses (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 import_key text not null check (length(import_key) between 1 and 255),
 title text not null check (length(trim(title)) between 3 and 300),
 evidence_status text not null check (evidence_status in ('reports_retained','source_only','reference_document')),
 provenance jsonb not null check (jsonb_typeof(provenance)='object'),
 manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz not null default now(),
 unique(module_id,import_key), unique(id,module_id)
);
-- Qualify both ownership links so an imported file cannot cross curriculum modules.
alter table private.studio_blobs add constraint studio_blobs_id_module_unique unique(id,module_id);
create table private.studio_imported_analysis_files (
 id uuid primary key default gen_random_uuid(),
 analysis_id uuid not null,
 module_id text not null,
 blob_id uuid not null,
 relative_path text not null check (length(relative_path) between 1 and 500 and relative_path !~ '(^/|(^|/)\.\.(/|$)|[\x01-\x1f])'),
 role text not null check (role in ('question_paper','memorandum','combined','source','reference','analysis_report')),
 foreign key(analysis_id,module_id) references private.studio_imported_analyses(id,module_id),
 foreign key(blob_id,module_id) references private.studio_blobs(id,module_id),
 unique(analysis_id,relative_path)
);
create index studio_imported_files_blob on private.studio_imported_analysis_files(blob_id);
alter table private.studio_imported_analyses enable row level security;
alter table private.studio_imported_analysis_files enable row level security;
revoke all on private.studio_imported_analyses,private.studio_imported_analysis_files from public,anon,authenticated,service_role,reviseit_studio_operator;
create trigger studio_imported_immutable before update or delete on private.studio_imported_analyses for each row execute function private.studio_immutable();
create trigger studio_imported_immutable before update or delete on private.studio_imported_analysis_files for each row execute function private.studio_immutable();

-- Operator-only, immutable, repeatable registration after private object read-back verification.
create function public.studio_import_analysis(p_module text,p_import_key text,p_title text,p_status text,p_provenance jsonb,p_files jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.studio_imported_analyses; v_file jsonb; v_blob private.studio_blobs; manifest text;
begin
 if p_module is null or p_import_key is null or p_title is null or p_status is null or
    jsonb_typeof(p_provenance) is distinct from 'object' or jsonb_typeof(p_files) is distinct from 'array' then raise exception 'Invalid imported analysis'; end if;
 if jsonb_array_length(p_files) not between 1 and 200 then raise exception 'Invalid imported file count'; end if;
 if exists(select 1 from jsonb_array_elements(p_files) x group by x->>'path' having count(*)>1) then raise exception 'Duplicate imported path'; end if;
 for v_file in select * from jsonb_array_elements(p_files) loop
  if jsonb_typeof(v_file) is distinct from 'object' or v_file->>'sha256' is null or v_file->>'size' is null or v_file->>'mediaType' is null or v_file->>'path' is null or v_file->>'role' is null then raise exception 'Invalid imported file'; end if;
  if v_file->>'sha256' !~ '^[a-f0-9]{64}$' or (v_file->>'size')::bigint not between 1 and 52428800 or v_file->>'mediaType' not in ('application/pdf','application/json','text/markdown','text/plain') then raise exception 'Invalid imported file metadata'; end if;
  insert into private.studio_blobs(module_id,sha256,size_bytes,media_type,immutable_key)
   values(p_module,v_file->>'sha256',(v_file->>'size')::bigint,v_file->>'mediaType','studio/blobs/'||p_module||'/'||(v_file->>'sha256')) on conflict(module_id,sha256) do nothing;
  select * into v_blob from private.studio_blobs where module_id=p_module and sha256=v_file->>'sha256';
  if v_blob.size_bytes<>(v_file->>'size')::bigint or v_blob.media_type<>v_file->>'mediaType' or v_blob.integrity<>'verified' then raise exception 'Imported blob metadata or integrity conflict'; end if;
 end loop;
 if p_status='reports_retained' and not exists(select 1 from jsonb_array_elements(p_files) f where f->>'role'='analysis_report') then raise exception 'Retained reports require a report file'; end if;
 manifest:=private.studio_sha(jsonb_build_object('title',p_title,'status',p_status,'provenance',p_provenance,'files',(select jsonb_agg(f order by f->>'path') from jsonb_array_elements(p_files) f))::text);
 perform pg_advisory_xact_lock(hashtextextended('studio-import:'||p_module||':'||p_import_key,0));
 select * into a from private.studio_imported_analyses where module_id=p_module and import_key=p_import_key;
 if found then
  if a.manifest_sha256<>manifest then raise exception 'Imported analysis identity conflict; retain the original and use a new dated import key'; end if;
  return jsonb_build_object('id',a.id,'created',false,'manifestSha256',manifest);
 end if;
 insert into private.studio_imported_analyses(module_id,import_key,title,evidence_status,provenance,manifest_sha256)
  values(p_module,p_import_key,p_title,p_status,p_provenance,manifest) returning * into a;
 insert into private.studio_imported_analysis_files(analysis_id,module_id,blob_id,relative_path,role)
  select a.id,p_module,b.id,f->>'path',f->>'role' from jsonb_array_elements(p_files) f join private.studio_blobs b on b.module_id=p_module and b.sha256=f->>'sha256';
 perform private.studio_event(p_module,null,'operator','operator','historical_analysis_imported',jsonb_build_object('analysisId',a.id,'manifestSha256',manifest,'fileCount',jsonb_array_length(p_files)));
 return jsonb_build_object('id',a.id,'created',true,'manifestSha256',manifest);
end $$;
create function public.studio_imported_analyses() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();
begin
 return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'moduleId',a.module_id,'title',a.title,'status',a.evidence_status,'provenance',a.provenance,'importedAt',a.imported_at,'fileCount',(select count(*) from private.studio_imported_analysis_files f where f.analysis_id=a.id)) order by a.module_id,a.title),'[]'::jsonb) from private.studio_imported_analyses a);
end $$;
create function public.studio_imported_analysis(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); a private.studio_imported_analyses;
begin
 select * into a from private.studio_imported_analyses where id=p_id;
 if not found then raise exception 'Imported analysis not found'; end if;
 return jsonb_build_object('id',a.id,'moduleId',a.module_id,'title',a.title,'status',a.evidence_status,'provenance',a.provenance,'importedAt',a.imported_at,'manifestSha256',a.manifest_sha256,'files',
  (select jsonb_agg(jsonb_build_object('id',f.id,'path',f.relative_path,'role',f.role,'sha256',b.sha256,'size',b.size_bytes,'integrity',b.integrity) order by f.role,f.relative_path) from private.studio_imported_analysis_files f join private.studio_blobs b on b.id=f.blob_id where f.analysis_id=a.id));
end $$;
create function public.studio_read_imported_file(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); result jsonb;
begin
 select jsonb_build_object('blobId',b.id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes,'filename',f.relative_path,'integrity',b.integrity) into result
 from private.studio_imported_analysis_files f join private.studio_blobs b on b.id=f.blob_id where f.id=p_id;
 if result is null then raise exception 'Imported file not found'; end if;
 if result->>'integrity'<>'verified' then raise exception 'Integrity blocked'; end if;
 return result;
end $$;
revoke all on function public.studio_import_analysis(text,text,text,text,jsonb,jsonb),public.studio_imported_analyses(),public.studio_imported_analysis(uuid),public.studio_read_imported_file(uuid) from public,anon,authenticated,service_role,reviseit_studio_operator;
grant execute on function public.studio_import_analysis(text,text,text,text,jsonb,jsonb) to reviseit_studio_operator;
grant execute on function public.studio_imported_analyses(),public.studio_imported_analysis(uuid),public.studio_read_imported_file(uuid) to authenticated;
