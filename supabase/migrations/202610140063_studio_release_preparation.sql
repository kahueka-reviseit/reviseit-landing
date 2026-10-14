-- Offline producer builds are evidence, never catalogue publication or content approval.
create table private.studio_release_preparations (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 snapshot_id uuid not null references private.studio_snapshots(id),
 expected_current_release text,
 state text not null default 'queued' check(state in ('queued','building','checked','blocked','failed','cancelled')),
 operation_id uuid, toolchain_sha256 text,
 report jsonb, report_blob_id uuid references private.studio_blobs(id),
 created_by text not null, created_at timestamptz not null default now(), completed_at timestamptz
);
create table private.studio_release_preparation_files (
 preparation_id uuid not null references private.studio_release_preparations(id),
 path text not null, blob_id uuid not null references private.studio_blobs(id),
 primary key(preparation_id,path)
);
alter table private.studio_release_preparations enable row level security;
alter table private.studio_release_preparation_files enable row level security;
revoke all on private.studio_release_preparations,private.studio_release_preparation_files from public,anon,authenticated,service_role,reviseit_studio_operator;
create trigger studio_immutable before update or delete on private.studio_release_preparation_files for each row execute function private.studio_immutable();

create function private.studio_release_preparation_current(p private.studio_release_preparations) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.studio_modules m join public.curriculum_modules c on c.id=m.module_id
 where m.module_id=p.module_id and m.accepted_snapshot_id=p.snapshot_id and c.current_release is not distinct from p.expected_current_release)
 and not exists(select 1 from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=p.snapshot_id and b.integrity<>'verified')
 and not exists(select 1 from private.studio_blobs where id=p.report_blob_id and integrity<>'verified')
 and not exists(select 1 from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id where f.preparation_id=p.id and b.integrity<>'verified');
$$;
create function private.studio_new_release_preparation(p_snapshot uuid,p_expected_current text,p_actor text) returns jsonb language plpgsql set search_path='' as $$
declare s private.studio_snapshots;p private.studio_release_preparations;begin
 select * into s from private.studio_snapshots where id=p_snapshot;
 perform 1 from private.studio_modules where module_id=s.module_id for update;
 if s.id is null or s.purpose<>'canonical' or s.origin<>'operator_import' or not exists(select 1 from private.studio_modules where module_id=s.module_id and accepted_snapshot_id=s.id) then raise exception 'Select the current accepted authoring bank';end if;
 if s.subject_adapter not in ('caps-physical-sciences@1','caps-physical-sciences@2') then raise exception 'This producer supports Physical Sciences only';end if;
 if not exists(select 1 from public.curriculum_modules where id=s.module_id and current_release is not distinct from p_expected_current) then raise exception 'Teacher release changed; refresh before preparing';end if;
 if exists(select 1 from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=s.id and b.integrity<>'verified') then raise exception 'Bank integrity blocked';end if;
 insert into private.studio_release_preparations(module_id,snapshot_id,expected_current_release,created_by) values(s.module_id,s.id,p_expected_current,p_actor) returning * into p;
 perform private.studio_event(s.module_id,null,'system',p_actor,'release_preparation_requested',jsonb_build_object('preparationId',p.id,'snapshotId',s.id));
 return jsonb_build_object('preparationId',p.id);
end $$;
create function public.studio_request_release_preparation(p_snapshot uuid,p_expected_current text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();req jsonb:=jsonb_build_array(p_snapshot,p_expected_current);res jsonb;begin
 res:=private.studio_replay(me::text,p_command,'request_release_preparation',req);if res is not null then return res;end if;
 res:=private.studio_new_release_preparation(p_snapshot,p_expected_current,me::text);
 return private.studio_remember(me::text,p_command,'request_release_preparation',req,res);
end $$;
-- Operator-created rehearsals are labelled as operator work, never attributed to a person.
create function public.studio_operator_release_preparation(p_snapshot uuid,p_expected_current text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare req jsonb:=jsonb_build_array(p_snapshot,p_expected_current);res jsonb;begin
 res:=private.studio_replay('operator',p_command,'operator_release_preparation',req);if res is not null then return res;end if;
 res:=private.studio_new_release_preparation(p_snapshot,p_expected_current,'operator');return private.studio_remember('operator',p_command,'operator_release_preparation',req,res);end $$;
create function public.studio_begin_release_preparation(p_preparation uuid,p_operation uuid,p_toolchain text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.studio_release_preparations;begin
 select * into p from private.studio_release_preparations where id=p_preparation for update;
 if p.id is null or p_operation is null or p_toolchain is null or p_toolchain !~ '^[a-f0-9]{64}$' then raise exception 'Exact preparation, operation and toolchain required';end if;
 if p.state in ('checked','blocked') and p.operation_id=p_operation and p.toolchain_sha256=p_toolchain then return jsonb_build_object('state',p.state,'report',p.report);end if;
 if p.state not in ('queued','building') or (p.state='building' and (p.operation_id is distinct from p_operation or p.toolchain_sha256 is distinct from p_toolchain)) then raise exception 'Another operation owns this build, or it is closed';end if;
 if not private.studio_release_preparation_current(p) then raise exception 'Accepted bank or teacher release changed';end if;
 update private.studio_release_preparations set state='building',operation_id=p_operation,toolchain_sha256=p_toolchain where id=p.id;
 return jsonb_build_object('state','building','id',p.id,'moduleId',p.module_id,'snapshotId',p.snapshot_id,'expectedCurrentRelease',p.expected_current_release,
 'bankManifestSha256',(select manifest_sha256 from private.studio_snapshots where id=p.snapshot_id),
 'files',(select jsonb_agg(jsonb_build_object('path',f.path,'sha256',f.sha256,'size',b.size_bytes,'mediaType',b.media_type) order by f.path) from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=p.snapshot_id));
end $$;
create function public.studio_finish_release_preparation(p_preparation uuid,p_operation uuid,p_report jsonb,p_report_sha256 text,p_report_size bigint,p_files jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.studio_release_preparations;f jsonb;b private.studio_blobs;report_blob uuid;begin
 select * into p from private.studio_release_preparations where id=p_preparation for update;
 if p.state in ('checked','blocked') and p.operation_id=p_operation and p.report=p_report and exists(select 1 from private.studio_blobs where id=p.report_blob_id and sha256=p_report_sha256 and size_bytes=p_report_size)
 and p_files=(select jsonb_agg(jsonb_build_object('path',x.path,'sha256',y.sha256,'size',y.size_bytes,'mediaType',y.media_type) order by x.path collate "C") from private.studio_release_preparation_files x join private.studio_blobs y on y.id=x.blob_id where x.preparation_id=p.id) then return jsonb_build_object('preparationId',p.id,'state',p.state);end if;
 if p.id is null or p.state<>'building' or p.operation_id is distinct from p_operation then raise exception 'Build operation is not current';end if;
 perform 1 from private.studio_modules where module_id=p.module_id for update;
 if not private.studio_release_preparation_current(p) then raise exception 'Accepted bank or teacher release changed during the build';end if;
 if p_report->>'schema' is distinct from 'reviseit/release-preparation@1' or p_report->>'preparationId' is distinct from p.id::text or p_report->>'moduleId' is distinct from p.module_id
 or p_report->>'bankManifestSha256' is distinct from (select manifest_sha256 from private.studio_snapshots where id=p.snapshot_id)
 or p_report->>'toolchainSha256' is distinct from p.toolchain_sha256 or p_report->>'release' is null or length(p_report->>'release') not between 1 and 80
 or p_report->'published' is distinct from 'false'::jsonb or p_report->>'humanReview' is distinct from 'pending'
 or jsonb_typeof(p_report->'checks') is distinct from 'array' or jsonb_array_length(p_report->'checks')<>6
 or (select count(distinct x->>'name') from jsonb_array_elements(p_report->'checks') x where x->>'name' in ('catalogue','forms','workflow','classifications','registration','orderCompilation') and x->>'status' in ('passed','blocked'))<>6
 or jsonb_typeof(p_report->'items') is distinct from 'array' or jsonb_array_length(p_report->'items') not between 1 and 500
 or jsonb_typeof(p_report->'notChecked') is distinct from 'array' or p_report_size not between 1 and 1500000
 or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 10000 then raise exception 'Invalid release preparation report';end if;
 if p_report->'files' is distinct from p_files then raise exception 'Report files and retained package differ';end if;
 for f in select value from jsonb_array_elements(p_files) loop
  if f->>'path' is null or f->>'path' !~ '^(inputs|export|bundle|registrations)/[A-Za-z0-9_. /-]+$' or f->>'path' ~ '(^|/)\.\.?(/|$)' or (f->>'size')::bigint not between 1 and 50000000 then raise exception 'Unsafe or oversized build artifact';end if;
  b:=private.studio_register_blob(p.module_id,f->>'sha256',(f->>'size')::bigint,f->>'mediaType');
  insert into private.studio_release_preparation_files(preparation_id,path,blob_id) values(p.id,f->>'path',b.id);
 end loop;
 b:=private.studio_register_blob(p.module_id,p_report_sha256,p_report_size,'application/json');report_blob:=b.id;
 update private.studio_release_preparations set state=case when exists(select 1 from jsonb_array_elements(p_report->'checks') x where x->>'status'='blocked') then 'blocked' else 'checked' end,report=p_report,report_blob_id=report_blob,completed_at=now() where id=p.id returning * into p;
 perform private.studio_event(p.module_id,null,'system','operator','release_preparation_completed',jsonb_build_object('preparationId',p.id,'state',p.state,'reportSha256',p_report_sha256));
 return jsonb_build_object('preparationId',p.id,'state',p.state);
end $$;
create function public.studio_close_release_preparation(p_preparation uuid,p_operation uuid) returns void language plpgsql security definer set search_path='' as $$
begin update private.studio_release_preparations set state='failed',completed_at=now() where id=p_preparation and operation_id=p_operation and state='building';if not found then raise exception 'Build is not running under this operation';end if;end $$;
create function public.studio_cancel_release_preparation(p_preparation uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();begin update private.studio_release_preparations set state='cancelled',completed_at=now() where id=p_preparation and state in ('queued','building');if not found then raise exception 'Preparation is already closed';end if;end $$;
create function public.studio_release_preparations_view(p_module text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();begin return jsonb_build_object(
 'banks',(select coalesce(jsonb_agg(jsonb_build_object('moduleId',m.module_id,'snapshotId',m.accepted_snapshot_id,'manifestSha256',s.manifest_sha256,'currentRelease',c.current_release) order by m.module_id),'[]') from private.studio_modules m join private.studio_snapshots s on s.id=m.accepted_snapshot_id join public.curriculum_modules c on c.id=m.module_id where p_module is null or m.module_id=p_module),
 'preparations',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'moduleId',p.module_id,'snapshotId',p.snapshot_id,'state',p.state,'current',private.studio_release_preparation_current(p),'createdAt',p.created_at,'completedAt',p.completed_at,'createdBy',case when p.created_by='operator' then 'Operator' else 'Studio editor' end,'expectedCurrentRelease',p.expected_current_release,'report',p.report,'reportBlobId',p.report_blob_id,'reportSha256',(select sha256 from private.studio_blobs where id=p.report_blob_id)) order by p.created_at desc),'[]') from (select * from private.studio_release_preparations where p_module is null or module_id=p_module order by created_at desc limit 100) p));end $$;
create function public.studio_release_preparation_file(p_preparation uuid,p_path text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();b uuid;begin
 if p_path='report.json' then select report_blob_id into b from private.studio_release_preparations where id=p_preparation;
 else select blob_id into b from private.studio_release_preparation_files where preparation_id=p_preparation and path=p_path;end if;
 if b is null then raise exception 'Preparation file not found';end if;return jsonb_build_object('blobId',b,'path',p_path);
end $$;
revoke all on function public.studio_release_preparation_file(uuid,text) from public,anon,service_role;
grant execute on function public.studio_release_preparation_file(uuid,text) to authenticated;
revoke all on function private.studio_release_preparation_current(private.studio_release_preparations),private.studio_new_release_preparation(uuid,text,text) from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function public.studio_request_release_preparation(uuid,text,uuid),public.studio_cancel_release_preparation(uuid),public.studio_release_preparations_view(text) from public,anon,service_role;
grant execute on function public.studio_request_release_preparation(uuid,text,uuid),public.studio_cancel_release_preparation(uuid),public.studio_release_preparations_view(text) to authenticated;
revoke all on function public.studio_operator_release_preparation(uuid,text,uuid),public.studio_begin_release_preparation(uuid,uuid,text),public.studio_finish_release_preparation(uuid,uuid,jsonb,text,bigint,jsonb),public.studio_close_release_preparation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.studio_operator_release_preparation(uuid,text,uuid),public.studio_begin_release_preparation(uuid,uuid,text),public.studio_finish_release_preparation(uuid,uuid,jsonb,text,bigint,jsonb),public.studio_close_release_preparation(uuid,uuid) to reviseit_studio_operator;
