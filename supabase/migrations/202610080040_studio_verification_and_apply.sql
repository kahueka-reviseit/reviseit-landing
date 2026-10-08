-- Additive corrections to the unapplied Studio candidate; no teacher functions change.
begin;

create function private.studio_storage_actor(p_actor uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.studio_editors e join auth.users u on u.id=e.user_id
 join private.account_reviewers r on r.user_id=e.user_id where e.user_id=p_actor and u.email_confirmed_at is not null)
 then raise exception 'Studio editor access required'; end if;
 return p_actor;
end $$;
revoke all on function private.studio_storage_actor(uuid) from public,anon,authenticated,service_role;

drop function public.studio_prepare_commit(uuid,text,bigint,text);

create function public.studio_prepare_commit(p_session uuid, p_sha256 text, p_size bigint, p_detected_type text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_storage_actor(p_actor); s private.studio_upload_sessions; target text; b private.studio_blobs;
begin
 select * into s from private.studio_upload_sessions where id=p_session and owner=me for update;
 if not found then raise exception 'Upload session not found'; end if;
 if s.state = 'finalised' then return jsonb_build_object('state','finalised','blobId',s.blob_id,'targetKey',s.target_key); end if;
 if s.state not in ('open','verifying') then raise exception 'Upload session is %', s.state; end if;
 if s.state = 'open' and s.expires_at < now() then
  update private.studio_upload_sessions set state='expired', updated_at=now() where id=s.id;
  return jsonb_build_object('state','expired');
 end if;
 if p_sha256 is distinct from s.claimed_sha256 or p_size is distinct from s.claimed_size or p_detected_type is distinct from s.media_type then
  update private.studio_upload_sessions set state='rejected', verified_sha256=case when p_sha256 ~ '^[a-f0-9]{64}$' then p_sha256 end,
   rejection=case when p_sha256 is distinct from s.claimed_sha256 then 'digest mismatch' when p_size is distinct from s.claimed_size then 'size mismatch' else 'type mismatch' end,
   updated_at=now() where id=s.id;
  perform private.studio_event(s.module_id,null,'editor',me::text,'upload_rejected',jsonb_build_object('session',s.id));
  return jsonb_build_object('state','rejected','reason',(select rejection from private.studio_upload_sessions where id=s.id));
 end if;
 target := 'studio/blobs/'||s.module_id||'/'||p_sha256;
 perform private.studio_key_lock(target);
 if exists(select 1 from private.studio_gc_claims where object_key=target) then raise exception 'Storage cleanup in progress; retry'; end if;
 update private.studio_upload_sessions set state='verifying', verified_sha256=p_sha256, target_key=target, updated_at=now() where id=s.id;
 select * into b from private.studio_blobs where module_id=s.module_id and sha256=p_sha256;
 return jsonb_build_object('state','verifying','targetKey',target,'existingBlob',
  case when b.id is null then null else jsonb_build_object('id',b.id,'integrity',b.integrity) end);
end $$;

revoke all on function public.studio_prepare_commit(uuid,text,bigint,text,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_prepare_commit(uuid,text,bigint,text,uuid) to service_role;

drop function public.studio_commit_upload(uuid);

create function public.studio_commit_upload(p_session uuid, p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_storage_actor(p_actor); s private.studio_upload_sessions; b private.studio_blobs; existed boolean;
begin
 select * into s from private.studio_upload_sessions where id=p_session and owner=me for update;
 if not found then raise exception 'Upload session not found'; end if;
 if s.state = 'finalised' then
  select * into b from private.studio_blobs where id=s.blob_id;
  return jsonb_build_object('state','finalised','blobId',b.id,'sha256',b.sha256,'duplicate',true);
 end if;
 if s.state <> 'verifying' then raise exception 'Upload session is %', s.state; end if;
 perform private.studio_key_lock(s.target_key);
 if exists(select 1 from private.studio_gc_claims where object_key=s.target_key) then raise exception 'Storage cleanup in progress; retry'; end if;
 select * into b from private.studio_blobs where module_id=s.module_id and sha256=s.verified_sha256 for update;
 existed := found;
 if not existed then
  insert into private.studio_blobs(module_id,sha256,size_bytes,media_type,immutable_key) values(s.module_id,s.verified_sha256,s.claimed_size,s.media_type,s.target_key) returning * into b;
 elsif b.size_bytes <> s.claimed_size then raise exception 'Stored blob size conflict';
 elsif b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %; use explicit recovery', b.id, b.integrity;
 end if;
 update private.studio_upload_sessions set state='finalised', blob_id=b.id, updated_at=now() where id=s.id;
 perform private.studio_event(s.module_id,null,'editor',me::text,'upload_finalised',jsonb_build_object('session',s.id,'blob',b.id,'duplicate',existed));
 return jsonb_build_object('state','finalised','blobId',b.id,'sha256',b.sha256,'duplicate',existed);
end $$;

revoke all on function public.studio_commit_upload(uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_commit_upload(uuid,uuid) to service_role;

drop function public.studio_complete_recovery(uuid);

create function public.studio_complete_recovery(p_blob uuid, p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_storage_actor(p_actor); b private.studio_blobs;
begin
 update private.studio_blobs set integrity='verified', integrity_detail=null, verified_at=now(), checked_at=now() where id=p_blob and integrity='recovering' returning * into b;
 if not found then raise exception 'Blob is not being recovered'; end if;
 perform private.studio_event(b.module_id,null,'editor',me::text,'recovery_completed',jsonb_build_object('blob',b.id));
 return jsonb_build_object('blobId',b.id,'integrity',b.integrity);
end $$;

revoke all on function public.studio_complete_recovery(uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_complete_recovery(uuid,uuid) to service_role;

create or replace function private.studio_require_blobs(p_blobs uuid[]) returns void language plpgsql volatile security definer set search_path='' as $$
declare b record;
begin
 for b in select x.id, v.integrity from unnest(p_blobs) x(id) left join private.studio_blobs v on v.id=x.id loop
  if b.integrity is distinct from 'verified' then raise exception 'Integrity blocked: % is %', b.id, coalesce(b.integrity,'absent'); end if;
 end loop;
end $$;

create or replace function public.studio_complete(p_attempt uuid, p_lease uuid, p_outputs uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; produced uuid[];
begin
 s := private.studio_fence(p_attempt,p_lease);
 select coalesce(array_agg(id order by id),'{}') into produced from private.studio_artifacts where stage_attempt_id=p_attempt;
 if produced is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(coalesce(p_outputs,'{}')) x) then raise exception 'Completion must list exactly the outputs persisted by this attempt'; end if;
 perform 1 from private.studio_blobs where id in (select blob_id from private.studio_artifacts where id=any(produced)) for share;
 perform private.studio_require_blobs(array(select blob_id from private.studio_artifacts where id=any(produced)));
 if exists(select 1 from private.studio_artifacts where id=any(produced) and state<>'current') then raise exception 'An output was superseded before completion'; end if;
 if exists(select 1 from private.studio_provider_attempts where stage_attempt_id=p_attempt and dispatch_state in ('prepared','dispatched')) then raise exception 'Provider attempt unsettled'; end if;
 if s.stage_key = 'S6_assemble_validate' and not exists(select 1 from private.studio_changesets where stage_id=s.id and state='draft') then raise exception 'Assembly must persist its change set'; end if;
 if private.studio_current_stage(s.run_id,s.stage_key) is distinct from s then
  -- Defensive: inputs moved after claim. Advance would have fenced this attempt; never accept it.
  raise exception 'Studio lease lost';
 end if;
 update private.studio_stage_attempts set state='completed', ended_at=now() where id=p_attempt;
 update private.studio_stages set state='succeeded', completed_at=now(), error=null, updated_at=now() where id=s.id;
 perform private.studio_event((select module_id from private.studio_runs where id=s.run_id),s.run_id,'worker',(select worker_id from private.studio_stage_attempts where id=p_attempt),'stage_succeeded',jsonb_build_object('stage',s.id,'outputs',to_jsonb(produced)));
 perform private.studio_advance(s.run_id);
 return jsonb_build_object('stageId',s.id,'state','succeeded');
end $$;

create or replace function public.studio_create_maintenance_changeset(p_module text, p_base_snapshot uuid, p_entries jsonb, p_rationale text, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; m private.studio_modules; c private.studio_changesets; rows jsonb; man jsonb;
begin
 req := jsonb_build_object('module',p_module,'base',p_base_snapshot,'entries',p_entries,'rationale',p_rationale);
 res := private.studio_replay(me::text,p_command,'create_maintenance_changeset',req); if res is not null then return res; end if;
 select * into m from private.studio_modules where module_id=p_module for update;
 if not found then raise exception 'Module not enrolled in Studio'; end if;
 if m.accepted_snapshot_id is distinct from p_base_snapshot then raise exception 'Maintenance must start from the current accepted snapshot'; end if;
 if jsonb_array_length(p_entries) = 0 then raise exception 'Empty maintenance change set'; end if;
 select jsonb_agg(jsonb_build_object('path',x.path,'action',x.action,'recordKind',x.record_kind,'recordId',x.record_id,'parentRecordId',x.parent_record_id,
  'before',x.before_sha256,'after',x.after_sha256,'blobId',x.after_blob_id)) into rows from private.studio_check_entries(p_module,p_base_snapshot,p_entries) x;
 c.id := gen_random_uuid();
 man := private.studio_manifest(p_module,p_base_snapshot,rows,jsonb_build_object('changesetId',c.id,'kind','maintenance','purpose','canonical'));
 insert into private.studio_changesets(id,module_id,kind,purpose,base_snapshot_id,manifest,manifest_sha256,created_by)
  values(c.id,p_module,'maintenance','canonical',p_base_snapshot,man,private.studio_sha(man::text),me::text) returning * into c;
 insert into private.studio_changeset_entries(changeset_id,path,action,record_kind,record_id,parent_record_id,before_sha256,after_sha256,after_blob_id)
  select c.id,x->>'path',x->>'action',x->>'recordKind',x->>'recordId',x->>'parentRecordId',x->>'before',x->>'after',(x->>'blobId')::uuid from jsonb_array_elements(rows) x;
 perform private.studio_event(p_module,null,'editor',me::text,'changeset_created',jsonb_build_object('changeset',c.id,'kind','maintenance','rationale',p_rationale));
 return private.studio_remember(me::text,p_command,'create_maintenance_changeset',req,jsonb_build_object('changesetId',c.id,'manifestSha256',c.manifest_sha256));
end $$;

create or replace function public.studio_put_changeset(p_attempt uuid, p_lease uuid, p_entries jsonb, p_validation_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; r private.studio_runs; i private.studio_run_inputs; v private.studio_artifacts; rows jsonb; man jsonb; c private.studio_changesets; drafts uuid[]; listed uuid[];
begin
 s := private.studio_fence(p_attempt,p_lease);
 if s.stage_key <> 'S6_assemble_validate' then raise exception 'Only assembly produces change sets'; end if;
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 select * into v from private.studio_artifacts where id=p_validation_artifact and stage_attempt_id=p_attempt and kind='validation_result' and state='current';
 if not found then raise exception 'Validation result from this attempt required'; end if;
 if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Invalid change set entries'; end if;
 drafts := private.studio_drafts(r.id);
 select coalesce(array_agg((x->>'artifactId')::uuid),'{}') into listed from jsonb_array_elements(p_entries) x;
 -- The change set covers exactly the current proposals: none omitted, none stale.
 if (select coalesce(array_agg(x order by x),'{}') from unnest(drafts) x) is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(listed) x) then raise exception 'Change set must list exactly the current proposals'; end if;
 select jsonb_agg(jsonb_build_object('path',x.path,'action',x.action,'recordKind',x.record_kind,'recordId',x.record_id,'parentRecordId',x.parent_record_id,
  'before',x.before_sha256,'after',x.after_sha256,'blobId',x.after_blob_id,'artifactId',a.id)) into rows
  from jsonb_array_elements(p_entries) e
  join private.studio_artifacts a on a.id=(e->>'artifactId')::uuid
  cross join lateral private.studio_check_entries(r.module_id,i.snapshot_id,jsonb_build_array(jsonb_build_object('path',a.record_path,'action',e->>'action','recordKind',a.record_kind,
   'recordId',a.record_id,'parentRecordId',a.parent_record_id,'blobId',a.blob_id,'artifactId',a.id))) x;
 rows := coalesce(rows,'[]'::jsonb);
 perform count(*) from private.studio_check_entries(r.module_id,i.snapshot_id,rows);
 c.id := gen_random_uuid();
 man := private.studio_manifest(r.module_id,i.snapshot_id,rows,jsonb_build_object('changesetId',c.id,'kind','analysis','purpose',r.purpose,'runId',r.id,'inputRevision',i.input_revision,'validationSha256',v.sha256));
 update private.studio_changesets set state='superseded', updated_at=now() where run_id=r.id and state='draft';
 insert into private.studio_changesets(id,module_id,run_id,kind,purpose,base_snapshot_id,manifest,manifest_sha256,stage_id,validation_artifact_id,created_by)
  values(c.id,r.module_id,r.id,'analysis',r.purpose,i.snapshot_id,man,private.studio_sha(man::text),s.id,v.id,'worker') returning * into c;
 insert into private.studio_changeset_entries(changeset_id,path,action,record_kind,record_id,parent_record_id,before_sha256,after_sha256,after_blob_id,artifact_id)
  select c.id,x->>'path',x->>'action',x->>'recordKind',x->>'recordId',x->>'parentRecordId',x->>'before',x->>'after',(x->>'blobId')::uuid,(x->>'artifactId')::uuid from jsonb_array_elements(rows) x;
 return jsonb_build_object('changesetId',c.id,'manifestSha256',c.manifest_sha256,'entries',jsonb_array_length(rows));
end $$;

-- Reverify stored output bytes at the gateway immediately before database completion.
create function public.studio_completion_outputs(p_attempt uuid, p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.studio_fence(p_attempt,p_lease);
 return coalesce((select jsonb_agg(jsonb_build_object('blobId',b.id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes))
 from private.studio_artifacts a join private.studio_blobs b on b.id=a.blob_id where a.stage_attempt_id=p_attempt),'[]'::jsonb);
end $$;
revoke all on function public.studio_completion_outputs(uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_completion_outputs(uuid,uuid) to service_role;

commit;
