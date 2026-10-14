-- Private, single-file maintenance drafts. The snapshot owns module/purpose/base bytes;
-- each revision has exactly one draft owner. These are not analysis-run artifacts,
-- approvals, accepted bank changes or teacher definitions. Promotion is a later command.
create table private.studio_maintenance_drafts (
 id uuid primary key default gen_random_uuid(),
 snapshot_id uuid not null,
 path text not null,
 revision integer not null check(revision >= 1),
 state text not null default 'draft' check(state in ('draft','discarded')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 discarded_by uuid references auth.users(id),
 discarded_reason text,
 foreign key(snapshot_id,path) references private.studio_snapshot_files(snapshot_id,path),
 check((state='discarded')=(discarded_by is not null and discarded_reason is not null))
);
create unique index studio_one_open_maintenance_draft on private.studio_maintenance_drafts(snapshot_id,path) where state='draft';
create table private.studio_maintenance_revisions (
 draft_id uuid not null references private.studio_maintenance_drafts(id),
 revision integer not null check(revision >= 1),
 blob_id uuid not null references private.studio_blobs(id),
 reason text not null check(length(btrim(reason)) between 10 and 2000),
 restored_from integer check(restored_from >= 0 and restored_from < revision),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(draft_id,revision)
);
alter table private.studio_maintenance_drafts add foreign key(id,revision) references private.studio_maintenance_revisions(draft_id,revision) deferrable initially deferred;
alter table private.studio_maintenance_drafts enable row level security;
alter table private.studio_maintenance_revisions enable row level security;
revoke all on private.studio_maintenance_drafts,private.studio_maintenance_revisions from public,anon,authenticated,service_role,reviseit_studio_operator;
create trigger studio_immutable before update or delete on private.studio_maintenance_revisions for each row execute function private.studio_immutable();
create function private.studio_maintenance_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'revision'-'state'-'updated_at'-'discarded_by'-'discarded_reason')
  is distinct from (to_jsonb(old)-'revision'-'state'-'updated_at'-'discarded_by'-'discarded_reason')
  or old.state='discarded' then raise exception 'Maintenance identity and history are immutable'; end if;
 return new;
end $$;
create trigger studio_maintenance_identity before update or delete on private.studio_maintenance_drafts for each row execute function private.studio_maintenance_identity();

create function public.studio_save_maintenance_draft(p_draft uuid,p_snapshot uuid,p_path text,p_expected_revision integer,p_expected_sha256 text,
 p_blob uuid,p_reason text,p_restored_from integer,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); req jsonb:=jsonb_build_array(p_draft,p_snapshot,p_path,p_expected_revision,p_expected_sha256,p_blob,p_reason,p_restored_from);
 res jsonb; s private.studio_snapshots; f private.studio_snapshot_files; d private.studio_maintenance_drafts; b private.studio_blobs; previous_hash text; restore_blob uuid;
begin
 res:=private.studio_replay(me::text,p_command,'save_maintenance_draft',req); if res is not null then return res; end if;
 if p_reason is null or length(btrim(p_reason)) not between 10 and 2000 then raise exception 'Give a reason of 10 to 2000 characters'; end if;
 if not private.studio_safe_path(p_path) or p_path !~ '\.(md|json)$' then raise exception 'Only active Markdown and JSON bank files can be drafted here'; end if;
 select * into s from private.studio_snapshots where id=p_snapshot;
 if not found then raise exception 'Snapshot not found'; end if;
 select * into f from private.studio_snapshot_files where snapshot_id=s.id and path=p_path;
 if not found then raise exception 'File not found in this snapshot'; end if;
 -- Serialises first saves as well as competing revisions of the same file.
 perform pg_advisory_xact_lock(hashtextextended('studio-maintenance:'||p_snapshot::text||':'||p_path,0));
 if p_draft is null then
  if p_expected_revision is distinct from 0 or p_expected_sha256 is distinct from f.sha256 then raise exception 'Starting file changed. Reload before saving'; end if;
  if exists(select 1 from private.studio_maintenance_drafts where snapshot_id=p_snapshot and path=p_path and state='draft') then
   raise exception 'Another draft exists for this file. Open its current revision before saving'; end if;
  previous_hash:=f.sha256;
 else
  select * into d from private.studio_maintenance_drafts where id=p_draft for update;
  if not found or d.snapshot_id<>p_snapshot or d.path<>p_path then raise exception 'Draft does not belong to this snapshot and file'; end if;
  if d.state<>'draft' then raise exception 'This draft was discarded. Its history is retained'; end if;
  select x.sha256 into previous_hash from private.studio_maintenance_revisions r join private.studio_blobs x on x.id=r.blob_id where r.draft_id=d.id and r.revision=d.revision;
  if p_expected_revision is distinct from d.revision or p_expected_sha256 is distinct from previous_hash then
   raise exception 'Another editor saved a newer revision. Your text is retained in this screen; compare before saving again'; end if;
 end if;
 if not private.studio_blob_ok(f.blob_id) then raise exception 'Starting file failed its integrity check'; end if;
 select * into b from private.studio_blobs where id=p_blob;
 if not found or b.module_id<>s.module_id or b.integrity<>'verified' or b.size_bytes not between 1 and 262144
  or b.media_type<>(case when p_path ~ '\.json$' then 'application/json' else 'text/markdown' end) then raise exception 'Verified, same-module text bytes required (maximum 256 KB)'; end if;
 if b.sha256=previous_hash then raise exception 'The text is unchanged'; end if;
 if p_restored_from is not null then
  if d.id is null or p_restored_from<0 or p_restored_from>d.revision then raise exception 'Unknown revision to restore'; end if;
  if p_restored_from=0 then restore_blob:=f.blob_id;
  else select blob_id into restore_blob from private.studio_maintenance_revisions where draft_id=d.id and revision=p_restored_from; end if;
  if restore_blob is distinct from p_blob then raise exception 'Restoration must use the exact retained revision'; end if;
 end if;
 if d.id is null then
  insert into private.studio_maintenance_drafts(snapshot_id,path,revision,created_by) values(p_snapshot,p_path,1,me) returning * into d;
 else
  update private.studio_maintenance_drafts set revision=revision+1,updated_at=now() where id=d.id returning * into d;
 end if;
 insert into private.studio_maintenance_revisions(draft_id,revision,blob_id,reason,restored_from,created_by) values(d.id,d.revision,p_blob,btrim(p_reason),p_restored_from,me);
 res:=jsonb_build_object('draftId',d.id,'revision',d.revision,'sha256',b.sha256);
 perform private.studio_event(s.module_id,null,'editor',me::text,'maintenance_draft_saved',res||jsonb_build_object('snapshot',s.id,'path',d.path,'baseSha256',f.sha256,'restoredFrom',p_restored_from));
 return private.studio_remember(me::text,p_command,'save_maintenance_draft',req,res);
end $$;

create function public.studio_discard_maintenance_draft(p_draft uuid,p_expected_revision integer,p_expected_sha256 text,p_reason text,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); req jsonb:=jsonb_build_array(p_draft,p_expected_revision,p_expected_sha256,p_reason); res jsonb; d private.studio_maintenance_drafts; h text; m text;
begin
 res:=private.studio_replay(me::text,p_command,'discard_maintenance_draft',req); if res is not null then return res; end if;
 if p_reason is null or length(btrim(p_reason)) not between 10 and 2000 then raise exception 'Give a reason of 10 to 2000 characters'; end if;
 select * into d from private.studio_maintenance_drafts where id=p_draft for update;
 if not found or d.state<>'draft' then raise exception 'No active draft to discard'; end if;
 select b.sha256 into h from private.studio_maintenance_revisions r join private.studio_blobs b on b.id=r.blob_id where r.draft_id=d.id and r.revision=d.revision;
 if p_expected_revision is distinct from d.revision or p_expected_sha256 is distinct from h then raise exception 'Draft revision changed. Reload before discarding'; end if;
 update private.studio_maintenance_drafts set state='discarded',discarded_by=me,discarded_reason=btrim(p_reason),updated_at=now() where id=d.id;
 select module_id into m from private.studio_snapshots where id=d.snapshot_id;
 res:=jsonb_build_object('draftId',d.id,'revision',d.revision,'state','discarded');
 perform private.studio_event(m,null,'editor',me::text,'maintenance_draft_discarded',res||jsonb_build_object('reason',btrim(p_reason)));
 return private.studio_remember(me::text,p_command,'discard_maintenance_draft',req,res);
end $$;

create function public.studio_maintenance_draft_view(p_draft uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); d private.studio_maintenance_drafts;
begin
 select * into d from private.studio_maintenance_drafts where id=p_draft;
 if not found then raise exception 'Draft not found'; end if;
 return jsonb_build_object('id',d.id,'file',public.studio_bank_file_view(d.snapshot_id,d.path),'revision',d.revision,'state',d.state,
  'createdBy',d.created_by,'createdAt',d.created_at,'updatedAt',d.updated_at,'discardedBy',d.discarded_by,'discardedReason',d.discarded_reason,
  'revisions',(select jsonb_agg(jsonb_build_object('revision',r.revision,'blobId',r.blob_id,'sha256',b.sha256,'size',b.size_bytes,'integrity',b.integrity,
    'reason',r.reason,'restoredFrom',r.restored_from,'createdBy',r.created_by,'createdAt',r.created_at) order by r.revision desc)
   from private.studio_maintenance_revisions r join private.studio_blobs b on b.id=r.blob_id where r.draft_id=d.id));
end $$;
create function public.studio_maintenance_drafts_view(p_module text default null,p_snapshot uuid default null,p_path text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'moduleId',s.module_id,'snapshotId',d.snapshot_id,'path',d.path,'purpose',s.purpose,
  'revision',d.revision,'state',d.state,'updatedAt',d.updated_at) order by d.updated_at desc,d.id)
  from private.studio_maintenance_drafts d join private.studio_snapshots s on s.id=d.snapshot_id
  where (p_module is null or s.module_id=p_module) and (p_snapshot is null or d.snapshot_id=p_snapshot) and (p_path is null or d.path=p_path)),'[]'::jsonb);
end $$;
revoke all on function private.studio_maintenance_identity() from public,anon,authenticated,service_role;
revoke all on function public.studio_save_maintenance_draft(uuid,uuid,text,integer,text,uuid,text,integer,uuid),public.studio_discard_maintenance_draft(uuid,integer,text,text,uuid),public.studio_maintenance_draft_view(uuid),public.studio_maintenance_drafts_view(text,uuid,text) from public,anon,service_role;
grant execute on function public.studio_save_maintenance_draft(uuid,uuid,text,integer,text,uuid,text,integer,uuid),public.studio_discard_maintenance_draft(uuid,integer,text,text,uuid),public.studio_maintenance_draft_view(uuid),public.studio_maintenance_drafts_view(text,uuid,text) to authenticated;
