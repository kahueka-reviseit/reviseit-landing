begin;
-- Version the derived index independently of source bytes. Prior snapshots and run pins stay intact.
insert into private.studio_subject_adapters values
 ('caps-physical-sciences@2','skill-snapshot scripts/validate_bank.py','Version 1 identities plus parent-qualified table variants. Structural only.');
alter table private.studio_snapshots drop constraint studio_snapshots_module_id_manifest_sha256_origin_purpose_key;
alter table private.studio_snapshots add constraint studio_snapshot_projection_identity
 unique(module_id,manifest_sha256,origin,purpose,subject_adapter);
alter table private.studio_snapshots add column projection_sha256 text check(projection_sha256 ~ '^[a-f0-9]{64}$');

create function private.studio_projection_digest(p_records jsonb,p_links jsonb) returns text
language sql immutable set search_path='' as $$
 select private.studio_sha(jsonb_build_object(
 'records',(select coalesce(jsonb_agg(v order by v::text collate "C"),'[]'::jsonb) from
  (select jsonb_build_object('recordKind',r->>'recordKind','recordId',r->>'recordId','parentRecordId',coalesce(r->>'parentRecordId',''),
   'path',r->>'path','sha256',r->>'sha256','status',coalesce(r->>'status','active')) v from jsonb_array_elements(p_records) r) q),
 'links',(select coalesce(jsonb_agg(v order by v::text collate "C"),'[]'::jsonb) from
  (select distinct jsonb_build_object('fromKind',r->>'fromKind','fromId',r->>'fromId','toKind',r->>'toKind','toId',r->>'toId',
   'required',coalesce((r->>'required')::boolean,false)) v from jsonb_array_elements(coalesce(p_links,'[]'::jsonb)) r) q))::text);
$$;
revoke all on function private.studio_projection_digest(jsonb,jsonb) from public,anon,authenticated,service_role,reviseit_studio_operator;
-- Backfill from saved projections, never silently reparse previously pinned source bytes.
update private.studio_snapshots s set projection_sha256=private.studio_projection_digest(
 (select coalesce(jsonb_agg(jsonb_build_object('recordKind',record_kind,'recordId',record_id,'parentRecordId',parent_record_id,
  'path',path,'sha256',sha256,'status',status)),'[]'::jsonb) from private.studio_record_index where snapshot_id=s.id),
 (select coalesce(jsonb_agg(jsonb_build_object('fromKind',from_kind,'fromId',from_id,'toKind',to_kind,'toId',to_id,'required',required)),'[]'::jsonb)
  from private.studio_record_links where snapshot_id=s.id));
-- The new optional argument preserves old callers and defaults to the module's existing adapter.
drop function public.studio_register_snapshot(text,text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text);

create or replace function public.studio_replace_snapshot_index(p_snapshot uuid, p_records jsonb, p_links jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_snapshots; rec jsonb; n integer; digest text;
begin
 select * into s from private.studio_snapshots where id=p_snapshot for update;
 if not found then raise exception 'Snapshot not found'; end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_typeof(coalesce(p_links,'[]'::jsonb)) <> 'array' then raise exception 'Invalid record projection'; end if;
 digest := private.studio_projection_digest(p_records,p_links);
 if s.projection_sha256 is not null then
  if s.projection_sha256 <> digest then raise exception 'Snapshot projection is immutable; register a new adapter version'; end if;
  return jsonb_build_object('snapshotId',s.id,'records',jsonb_array_length(p_records),'links',jsonb_array_length(coalesce(p_links,'[]'::jsonb)));
 end if;
 for rec in select * from jsonb_array_elements(p_records) loop
  if rec->>'recordKind' = 'task_variant' and not exists(
   select 1 from jsonb_array_elements(p_records) p where p->>'recordKind'='task_type'
    and p->>'recordId'=rec->>'parentRecordId' and p->>'path'=rec->>'path' and p->>'sha256'=rec->>'sha256'
  ) then raise exception 'Variant parent must be a task type in the same source file'; end if;
  if not exists(select 1 from private.studio_snapshot_files where snapshot_id=s.id and path=rec->>'path' and sha256=rec->>'sha256') then
   raise exception 'Record % does not match a snapshot file', rec->>'recordId';
  end if;
 end loop;
 delete from private.studio_record_links where snapshot_id=s.id;
 delete from private.studio_record_index where snapshot_id=s.id;
 insert into private.studio_record_index(snapshot_id,record_kind,record_id,parent_record_id,path,sha256,status)
  select s.id,x->>'recordKind',x->>'recordId',coalesce(x->>'parentRecordId',''),x->>'path',x->>'sha256',coalesce(x->>'status','active') from jsonb_array_elements(p_records) x;
 insert into private.studio_record_links(snapshot_id,from_kind,from_id,to_kind,to_id,required)
  select distinct on (x->>'fromKind',x->>'fromId',x->>'toKind',x->>'toId') s.id,x->>'fromKind',x->>'fromId',x->>'toKind',x->>'toId',coalesce((x->>'required')::boolean,false)
  from jsonb_array_elements(coalesce(p_links,'[]'::jsonb)) x;
 get diagnostics n = row_count;
 update private.studio_snapshots set projection_sha256=digest where id=s.id;
 return jsonb_build_object('snapshotId',s.id,'records',jsonb_array_length(p_records),'links',n);
end $$;

create or replace function public.studio_register_snapshot(p_module text, p_manifest_sha256 text, p_files jsonb, p_records jsonb, p_links jsonb, p_origin text, p_purpose text,
 p_parent uuid, p_changeset uuid, p_created_by text, p_subject_adapter text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.studio_modules; s private.studio_snapshots; mb private.studio_blobs; mt text; fe jsonb; adapter text;
begin
 select * into m from private.studio_modules where module_id=p_module for update;
 if not found then raise exception 'Module not enrolled in Studio'; end if;
 adapter := coalesce(p_subject_adapter,m.subject_adapter);
 if not exists(select 1 from private.studio_subject_adapters where id=adapter)
  or split_part(adapter,'@',1) <> split_part(m.subject_adapter,'@',1) then
  raise exception 'Unsupported subject adapter for this module: %',adapter;
 end if;
 if p_origin not in ('operator_import','candidate') or p_purpose not in ('canonical','rehearsal') then raise exception 'Invalid snapshot origin or purpose'; end if;
 if p_origin = 'candidate' and p_purpose <> 'rehearsal' then raise exception 'Candidate snapshots are valid for rehearsal only'; end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then raise exception 'Snapshot needs files'; end if;
 for fe in select * from jsonb_array_elements(p_files) loop
  if not private.studio_safe_path(fe->>'path') and fe->>'path' !~ '^data/archive/[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$' then raise exception 'Unsafe snapshot path: %', left(fe->>'path',120); end if;
  if coalesce(fe->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid snapshot digest'; end if;
 end loop;
 mt := private.studio_manifest_text(p_module,p_files);
 if private.studio_sha(mt) <> p_manifest_sha256 then raise exception 'Manifest digest does not match the file list'; end if;
 select * into s from private.studio_snapshots where module_id=p_module and manifest_sha256=p_manifest_sha256 and origin=p_origin and purpose=p_purpose and subject_adapter=adapter;
 if found then
  perform public.studio_replace_snapshot_index(s.id,p_records,p_links);
  return jsonb_build_object('snapshotId',s.id,'created',false,'manifestSha256',s.manifest_sha256);
 end if;
 for fe in select * from jsonb_array_elements(p_files) loop
  perform private.studio_register_blob(p_module,fe->>'sha256',(fe->>'size')::bigint,coalesce(fe->>'mediaType','application/octet-stream'));
 end loop;
 mb := private.studio_register_blob(p_module,p_manifest_sha256,octet_length(convert_to(mt,'UTF8')),'application/json');
 insert into private.studio_snapshots(module_id,manifest_sha256,manifest_blob_id,origin,purpose,subject_adapter,parent_snapshot_id,changeset_id,file_count,created_by)
  values(p_module,p_manifest_sha256,mb.id,p_origin,p_purpose,adapter,p_parent,p_changeset,jsonb_array_length(p_files),coalesce(p_created_by,session_user)) returning * into s;
 insert into private.studio_snapshot_files(snapshot_id,path,sha256,blob_id)
  select s.id,f->>'path',f->>'sha256',b.id from jsonb_array_elements(p_files) f join private.studio_blobs b on b.module_id=p_module and b.sha256=f->>'sha256';
 perform public.studio_replace_snapshot_index(s.id,p_records,p_links);
 perform private.studio_event(p_module,null,'operator',session_user,'snapshot_registered',jsonb_build_object('snapshot',s.id,'manifest',p_manifest_sha256,'origin',p_origin,'purpose',p_purpose));
 return jsonb_build_object('snapshotId',s.id,'created',true,'manifestSha256',s.manifest_sha256);
end $$;
revoke all on function public.studio_register_snapshot(text,text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_register_snapshot(text,text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text,text) to reviseit_studio_operator;
commit;
