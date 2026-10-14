-- Bind maintenance integration to a reviewed, checked candidate. The Mac remains authoring authority.
-- No initial snapshot is accepted here; rehearsal copies never cross this boundary.
create table private.studio_maintenance_integrations (
 changeset_id uuid primary key references private.studio_changesets(id),
 check_id uuid not null references private.studio_maintenance_checks(id),
 review_id uuid not null references private.studio_maintenance_reviews(id),
 state text not null default 'prepared' check(state in ('prepared','authorised','applying','accepted','cancelled')),
 rationale text not null,
 authorisation_reason text,
 authorised_by uuid references auth.users(id),
 authorised_at timestamptz,
 operation_id uuid,
 accepted_snapshot_id uuid references private.studio_snapshots(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(check_id,review_id)
);
alter table private.studio_maintenance_integrations enable row level security;
revoke all on private.studio_maintenance_integrations from public,anon,authenticated,service_role,reviseit_studio_operator;
-- A maintenance edit is a file revision, including reference and authored-form files that have
-- no projected record identifier. Do not invent a task identity for them.
alter table private.studio_changeset_entries drop constraint studio_changeset_entries_record_kind_check;
alter table private.studio_changeset_entries add constraint studio_changeset_entries_record_kind_check check(record_kind in ('task_type','specification','form_source','index','bank_file'));

create function private.studio_integration_current(p_changeset uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((select c.state='succeeded' and (c.report->>'structuralOk')::boolean
  and private.studio_maintenance_check_current(c) and s.purpose='canonical' and s.origin='operator_import'
  and r.version=c.review_version and r.outcome='approved' and r.report_sha256=b.sha256 and b.integrity='verified'
  from private.studio_maintenance_integrations i join private.studio_maintenance_checks c on c.id=i.check_id
  join private.studio_snapshots s on s.id=c.snapshot_id join private.studio_maintenance_reviews r on r.id=i.review_id
  join private.studio_blobs b on b.id=c.report_blob_id where i.changeset_id=p_changeset),false);
$$;
create function private.studio_lock_integration(p_changeset uuid) returns private.studio_maintenance_integrations language plpgsql set search_path='' as $$
declare i private.studio_maintenance_integrations;c private.studio_maintenance_checks;e jsonb;begin
 select * into i from private.studio_maintenance_integrations where changeset_id=p_changeset;
 if not found then raise exception 'Integration not found';end if;
 select * into c from private.studio_maintenance_checks where id=i.check_id for update;
 for e in select value from jsonb_array_elements(c.entries) order by value->>'draftId' loop
  perform 1 from private.studio_maintenance_drafts where id=(e->>'draftId')::uuid for update;
 end loop;
 perform 1 from private.studio_modules where module_id=(select module_id from private.studio_snapshots where id=c.snapshot_id) for update;
 perform 1 from private.studio_changesets where id=p_changeset for update;
 select * into i from private.studio_maintenance_integrations where changeset_id=p_changeset for update;
 return i;
end $$;
create function public.studio_prepare_maintenance_integration(p_check uuid,p_review_version integer,p_rationale text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();c private.studio_maintenance_checks;s private.studio_snapshots;r private.studio_maintenance_reviews;x private.studio_changesets;draft_entry jsonb;rows jsonb;man jsonb;res jsonb;req jsonb:=jsonb_build_array(p_check,p_review_version,p_rationale);begin
 res:=private.studio_replay(me::text,p_command,'prepare_maintenance_integration',req);if res is not null then return res;end if;
 select * into c from private.studio_maintenance_checks where id=p_check for update;
 if not found then raise exception 'Check not found';end if;
 for draft_entry in select value from jsonb_array_elements(c.entries) order by value->>'draftId' loop perform 1 from private.studio_maintenance_drafts where id=(draft_entry->>'draftId')::uuid for update;end loop;
 select * into s from private.studio_snapshots where id=c.snapshot_id;
 perform 1 from private.studio_modules where module_id=s.module_id for update;
 if s.purpose<>'canonical' or s.origin<>'operator_import' then raise exception 'Rehearsal copies cannot become accepted bank changes';end if;
 select * into r from private.studio_maintenance_reviews where check_id=c.id and version=c.review_version;
 if c.review_version is distinct from p_review_version or r.outcome is distinct from 'approved' or c.state<>'succeeded' or (c.report->>'structuralOk')::boolean is not true
 or not private.studio_maintenance_check_current(c) then raise exception 'Current passing checks and content approval are required';end if;
 if not exists(select 1 from private.studio_blobs where id=c.report_blob_id and integrity='verified' and sha256=r.report_sha256) then raise exception 'Validation report integrity blocked';end if;
 if length(btrim(coalesce(p_rationale,''))) not between 10 and 4000 then raise exception 'Give an integration reason of 10 to 4000 characters';end if;
 select changeset_id into x.id from private.studio_maintenance_integrations where check_id=c.id and review_id=r.id;
 if found then return private.studio_remember(me::text,p_command,'prepare_maintenance_integration',req,jsonb_build_object('changesetId',x.id));end if;
 select jsonb_agg(jsonb_build_object('path',e->>'path','action','replace','recordKind','bank_file','recordId',e->>'path','parentRecordId','','before',f.sha256,'after',e->>'sha256','blobId',e->>'blobId') order by e->>'path') into rows
 from jsonb_array_elements(c.entries) e join private.studio_snapshot_files f on f.snapshot_id=s.id and f.path=e->>'path';
 if jsonb_array_length(rows) is distinct from jsonb_array_length(c.entries) or exists(select 1 from jsonb_array_elements(rows) e where e->>'before'=e->>'after' or not private.studio_safe_path(e->>'path')) then raise exception 'Candidate contains unchanged or unsafe entries';end if;
 x.id:=gen_random_uuid();man:=private.studio_manifest(s.module_id,s.id,rows,jsonb_build_object('changesetId',x.id,'kind','maintenance','purpose','canonical','checkId',c.id,'reviewId',r.id,'reportSha256',r.report_sha256,'candidateManifestSha256',c.candidate_manifest_sha256));
 insert into private.studio_changesets(id,module_id,kind,purpose,base_snapshot_id,manifest,manifest_sha256,created_by) values(x.id,s.module_id,'maintenance','canonical',s.id,man,private.studio_sha(man::text),me::text);
 insert into private.studio_changeset_entries(changeset_id,path,action,record_kind,record_id,parent_record_id,before_sha256,after_sha256,after_blob_id)
 select x.id,e->>'path','replace','bank_file',e->>'path','',e->>'before',e->>'after',(e->>'blobId')::uuid from jsonb_array_elements(rows) e;
 insert into private.studio_maintenance_integrations(changeset_id,check_id,review_id,rationale) values(x.id,c.id,r.id,btrim(p_rationale));
 perform private.studio_event(s.module_id,null,'editor',me::text,'maintenance_integration_prepared',jsonb_build_object('changesetId',x.id,'checkId',c.id,'reviewId',r.id));
 return private.studio_remember(me::text,p_command,'prepare_maintenance_integration',req,jsonb_build_object('changesetId',x.id));
end $$;

create function public.studio_maintenance_integration_view(p_changeset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();i private.studio_maintenance_integrations;x private.studio_changesets;begin
 select * into i from private.studio_maintenance_integrations where changeset_id=p_changeset;if not found then raise exception 'Integration not found';end if;
 select * into x from private.studio_changesets where id=p_changeset;
 return jsonb_build_object('id',x.id,'moduleId',x.module_id,'snapshotId',x.base_snapshot_id,'manifestSha256',x.manifest_sha256,'candidateManifestSha256',x.manifest->>'candidateManifestSha256','checkId',i.check_id,'reviewId',i.review_id,
 'state',i.state,'current',private.studio_integration_current(x.id),'rationale',i.rationale,'authorisationReason',i.authorisation_reason,'authorisedAt',i.authorised_at,'selfReviewed',x.self_reviewed,'operationId',i.operation_id,'acceptedSnapshotId',i.accepted_snapshot_id,'receipt',x.apply_receipt,
 'entries',(select jsonb_agg(jsonb_build_object('path',e.path,'beforeSha256',e.before_sha256,'afterSha256',e.after_sha256,'beforeBlobId',f.blob_id,'afterBlobId',e.after_blob_id) order by e.path) from private.studio_changeset_entries e join private.studio_snapshot_files f on f.snapshot_id=x.base_snapshot_id and f.path=e.path where e.changeset_id=x.id));
end $$;
create function public.studio_check_integrations_view(p_check uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();begin return (select coalesce(jsonb_agg(jsonb_build_object('id',i.changeset_id,'state',i.state,'current',private.studio_integration_current(i.changeset_id)) order by i.created_at desc),'[]'::jsonb) from private.studio_maintenance_integrations i where i.check_id=p_check);end $$;

create function public.studio_authorise_maintenance_integration(p_changeset uuid,p_manifest_sha256 text,p_rationale text,p_acknowledgements jsonb,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();i private.studio_maintenance_integrations;x private.studio_changesets;req jsonb:=jsonb_build_array(p_changeset,p_manifest_sha256,p_rationale,p_acknowledgements);res jsonb;begin
 res:=private.studio_replay(me::text,p_command,'authorise_maintenance_integration',req);if res is not null then return res;end if;
 i:=private.studio_lock_integration(p_changeset);select * into x from private.studio_changesets where id=p_changeset;
 if i.state<>'prepared' or x.state<>'draft' or x.manifest_sha256 is distinct from p_manifest_sha256 or not private.studio_integration_current(x.id) then raise exception 'Integration or review changed; prepare a fresh candidate';end if;
 if p_acknowledgements is distinct from '{"changes":true,"impact":true,"authority":true}'::jsonb or length(btrim(coalesce(p_rationale,''))) not between 10 and 4000 then raise exception 'Review exact changes, dependency impact and authoring authority, and give a reason';end if;
 update private.studio_changesets set state='authorised',authorised_by=me,authorised_at=now(),self_reviewed=exists(select 1 from private.studio_maintenance_checks c cross join lateral jsonb_array_elements(c.entries) e where c.id=i.check_id and e->>'author'=me::text),updated_at=now() where id=x.id;
 update private.studio_maintenance_integrations set state='authorised',authorised_by=me,authorised_at=now(),authorisation_reason=btrim(p_rationale),updated_at=now() where changeset_id=x.id;
 perform private.studio_event(x.module_id,null,'editor',me::text,'maintenance_integration_authorised',jsonb_build_object('changesetId',x.id,'manifestSha256',x.manifest_sha256,'reason',p_rationale));
 return private.studio_remember(me::text,p_command,'authorise_maintenance_integration',req,jsonb_build_object('changesetId',x.id));
end $$;
-- The old unbound maintenance approval route cannot bypass checked content review.
revoke execute on function public.studio_authorise_changeset(uuid,text,text,jsonb,uuid) from authenticated;

-- Freeze reviewed inputs only after the operator starts. There is deliberately no timeout that
-- could release an uncertain filesystem write. Recovery is explicit and retains its operation id.
create function private.studio_integration_freeze() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='studio_maintenance_drafts' then
  if exists(select 1 from private.studio_maintenance_integrations i join private.studio_maintenance_checks c on c.id=i.check_id where i.state='applying' and c.entries @> jsonb_build_array(jsonb_build_object('draftId',old.id))) then raise exception 'Bank handover in progress; recover it before changing this draft';end if;
 elsif tg_table_name='studio_maintenance_reviews' then
  if exists(select 1 from private.studio_maintenance_integrations where check_id=new.check_id and state='applying') then raise exception 'Bank handover in progress; review is frozen';end if;
 elsif tg_table_name='studio_modules' and new.accepted_snapshot_id is distinct from old.accepted_snapshot_id then
  if exists(select 1 from private.studio_maintenance_integrations i join private.studio_changesets x on x.id=i.changeset_id where x.module_id=old.module_id and i.state='applying') then raise exception 'Bank handover in progress; accepted bank is frozen';end if;
 end if;return new;
end $$;
create trigger studio_integration_freeze before update on private.studio_maintenance_drafts for each row execute function private.studio_integration_freeze();
create trigger studio_integration_freeze before insert on private.studio_maintenance_reviews for each row execute function private.studio_integration_freeze();
create trigger studio_integration_freeze before update on private.studio_modules for each row execute function private.studio_integration_freeze();

alter function public.studio_export_changeset(uuid,text) set schema private;
revoke all on function private.studio_export_changeset(uuid,text) from public,anon,authenticated,service_role,reviseit_studio_operator;
create function public.studio_export_changeset(p_changeset uuid,p_purpose text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from private.studio_maintenance_integrations where changeset_id=p_changeset) then raise exception 'Use the online maintenance handover command';end if;
 return private.studio_export_changeset(p_changeset,p_purpose);end $$;
create function public.studio_begin_maintenance_handover(p_changeset uuid,p_manifest_sha256 text,p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.studio_maintenance_integrations;x private.studio_changesets;begin
 i:=private.studio_lock_integration(p_changeset);select * into x from private.studio_changesets where id=p_changeset;
 if i.state='accepted' and i.operation_id=p_operation and x.manifest_sha256=p_manifest_sha256 then return jsonb_build_object('state','accepted','acceptedSnapshotId',i.accepted_snapshot_id,'changed',false);end if;
 if p_operation is null or x.manifest_sha256 is distinct from p_manifest_sha256 or x.state<>'authorised' or i.state not in ('authorised','applying') or not private.studio_integration_current(x.id) then raise exception 'Current authorised integration required';end if;
 if i.state='applying' and i.operation_id is distinct from p_operation then raise exception 'Another handover owns this integration';end if;
 if exists(select 1 from private.studio_maintenance_integrations j join private.studio_changesets y on y.id=j.changeset_id where y.module_id=x.module_id and j.state='applying' and j.changeset_id<>x.id) then raise exception 'Another handover owns this module';end if;
 update private.studio_maintenance_integrations set state='applying',operation_id=p_operation,updated_at=now() where changeset_id=x.id;
 return private.studio_export_changeset(x.id,'canonical')||jsonb_build_object('operationId',p_operation,'candidateManifestSha256',x.manifest->>'candidateManifestSha256','subjectAdapter',(select subject_adapter from private.studio_snapshots where id=x.base_snapshot_id));
end $$;

-- Acceptance must prove the whole resulting tree, parent, module and change set, not only a receipt.
alter function public.studio_accept_snapshot(text,uuid,uuid) set schema private;
revoke all on function private.studio_accept_snapshot(text,uuid,uuid) from public,anon,authenticated,service_role,reviseit_studio_operator;
create function public.studio_accept_snapshot(p_module text,p_snapshot uuid,p_expected_previous uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.studio_snapshots s join private.studio_maintenance_integrations i on i.changeset_id=s.changeset_id where s.id=p_snapshot) then raise exception 'Use verified maintenance completion';end if;
 return private.studio_accept_snapshot(p_module,p_snapshot,p_expected_previous);end $$;
alter function public.studio_record_apply_result(uuid,text,text,jsonb) set schema private;
revoke all on function private.studio_record_apply_result(uuid,text,text,jsonb) from public,anon,authenticated,service_role,reviseit_studio_operator;
create function public.studio_record_apply_result(p_changeset uuid,p_manifest_sha256 text,p_result text,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.studio_maintenance_integrations where changeset_id=p_changeset) then raise exception 'Use verified maintenance completion';end if;
 return private.studio_record_apply_result(p_changeset,p_manifest_sha256,p_result,p_receipt);end $$;
create function public.studio_complete_maintenance_handover(p_changeset uuid,p_operation uuid,p_snapshot uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.studio_maintenance_integrations;x private.studio_changesets;s private.studio_snapshots;expected jsonb;actual jsonb;begin
 i:=private.studio_lock_integration(p_changeset);select * into x from private.studio_changesets where id=p_changeset;
 if i.state='accepted' and i.operation_id=p_operation and i.accepted_snapshot_id=p_snapshot and x.apply_receipt=p_receipt then return jsonb_build_object('acceptedSnapshotId',p_snapshot,'changed',false);end if;
 if i.state<>'applying' or i.operation_id is distinct from p_operation or not private.studio_integration_current(x.id) then raise exception 'Handover authority changed';end if;
 select * into s from private.studio_snapshots where id=p_snapshot;
 if s.module_id is distinct from x.module_id or s.purpose is distinct from 'canonical' or s.origin is distinct from 'operator_import' or s.changeset_id is distinct from x.id or s.parent_snapshot_id is distinct from x.base_snapshot_id or s.manifest_sha256 is distinct from x.manifest->>'candidateManifestSha256' then raise exception 'Resulting bank does not match the reviewed candidate and lineage';end if;
 perform private.studio_require_blobs(array(select blob_id from private.studio_snapshot_files where snapshot_id=s.id)||array[s.manifest_blob_id]);
 select jsonb_agg(jsonb_build_object('path',path,'before',before_sha256,'after',after_sha256,'observed',after_sha256) order by path) into expected from private.studio_changeset_entries where changeset_id=x.id;
 select jsonb_agg(e order by e->>'path') into actual from jsonb_array_elements(p_receipt->'targets') e;
 if p_receipt->>'schema' is distinct from 'reviseit/studio-apply-receipt@1' or p_receipt->>'changesetId' is distinct from x.id::text or p_receipt->>'manifestSha256' is distinct from x.manifest_sha256 or p_receipt->>'moduleId' is distinct from x.module_id or p_receipt->>'purpose' is distinct from 'canonical' or coalesce(p_receipt->>'result','') not in ('applied','already_applied') or actual is distinct from expected then raise exception 'Apply receipt does not prove exact replacements';end if;
 perform private.studio_record_apply_result(x.id,x.manifest_sha256,p_receipt->>'result',p_receipt);
 update private.studio_maintenance_integrations set state='accepted',accepted_snapshot_id=s.id,updated_at=now() where changeset_id=x.id;
 return private.studio_accept_snapshot(x.module_id,s.id,x.base_snapshot_id);
end $$;
create function public.studio_cancel_maintenance_integration(p_changeset uuid,p_reason text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();i private.studio_maintenance_integrations;req jsonb:=jsonb_build_array(p_changeset,p_reason);res jsonb;begin
 res:=private.studio_replay(me::text,p_command,'cancel_maintenance_integration',req);if res is not null then return res;end if;
 i:=private.studio_lock_integration(p_changeset);
 if i.state not in ('prepared','authorised') or length(btrim(coalesce(p_reason,''))) not between 10 and 4000 then raise exception 'Only an unstarted integration can be cancelled; give a reason';end if;
 update private.studio_maintenance_integrations set state='cancelled',updated_at=now() where changeset_id=p_changeset;
 update private.studio_changesets set state='superseded',updated_at=now() where id=p_changeset;
 perform private.studio_event((select module_id from private.studio_changesets where id=p_changeset),null,'editor',me::text,'maintenance_integration_cancelled',jsonb_build_object('changesetId',p_changeset,'reason',p_reason));
 return private.studio_remember(me::text,p_command,'cancel_maintenance_integration',req,jsonb_build_object('changesetId',p_changeset));end $$;
-- Explicit recovery after verifying the complete original tree. Never unlock an uncertain write on a timer.
create function public.studio_abort_maintenance_handover(p_changeset uuid,p_operation uuid,p_observed_manifest text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.studio_maintenance_integrations;x private.studio_changesets;begin
 i:=private.studio_lock_integration(p_changeset);select * into x from private.studio_changesets where id=p_changeset;
 if i.state<>'applying' or i.operation_id is distinct from p_operation or p_observed_manifest is distinct from x.manifest->>'baseManifestSha256' or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Verify the complete restored base bank before aborting';end if;
 update private.studio_maintenance_integrations set state='cancelled',updated_at=now() where changeset_id=x.id;
 update private.studio_changesets set state='rejected',updated_at=now() where id=x.id;
 perform private.studio_event(x.module_id,null,'operator',session_user,'maintenance_handover_aborted',jsonb_build_object('changesetId',x.id,'operationId',p_operation,'reason',p_reason));
 return jsonb_build_object('changesetId',x.id,'state','cancelled');end $$;

revoke all on function private.studio_integration_current(uuid),private.studio_lock_integration(uuid),private.studio_integration_freeze() from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function public.studio_prepare_maintenance_integration(uuid,integer,text,uuid),public.studio_maintenance_integration_view(uuid),public.studio_check_integrations_view(uuid),public.studio_authorise_maintenance_integration(uuid,text,text,jsonb,uuid),public.studio_cancel_maintenance_integration(uuid,text,uuid) from public,anon,service_role,reviseit_studio_operator;
grant execute on function public.studio_prepare_maintenance_integration(uuid,integer,text,uuid),public.studio_maintenance_integration_view(uuid),public.studio_check_integrations_view(uuid),public.studio_authorise_maintenance_integration(uuid,text,text,jsonb,uuid),public.studio_cancel_maintenance_integration(uuid,text,uuid) to authenticated;
revoke all on function public.studio_begin_maintenance_handover(uuid,text,uuid),public.studio_complete_maintenance_handover(uuid,uuid,uuid,jsonb),public.studio_abort_maintenance_handover(uuid,uuid,text,text),public.studio_export_changeset(uuid,text),public.studio_accept_snapshot(text,uuid,uuid),public.studio_record_apply_result(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.studio_begin_maintenance_handover(uuid,text,uuid),public.studio_complete_maintenance_handover(uuid,uuid,uuid,jsonb),public.studio_abort_maintenance_handover(uuid,uuid,text,text),public.studio_export_changeset(uuid,text),public.studio_accept_snapshot(text,uuid,uuid),public.studio_record_apply_result(uuid,text,text,jsonb) to reviseit_studio_operator;
