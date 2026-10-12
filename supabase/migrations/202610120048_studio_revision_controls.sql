begin;
-- Local candidate only. Human feedback creates new work; it never renews an approval.
create table private.studio_revision_requests (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references private.studio_runs(id),
 input_revision integer not null,
 stage_key text not null check(stage_key='S5_draft'),
 gate text not null check(gate in ('G3_records','G4_content')),
 decision_id uuid not null references private.studio_decisions(id),
 instruction text not null check(length(trim(instruction)) between 10 and 8000),
 bound jsonb not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 sequence bigint generated always as identity unique
);
alter table private.studio_revision_requests enable row level security;
revoke all on private.studio_revision_requests from public,anon,authenticated,service_role,reviseit_studio_operator;

create function private.studio_revision_request(p_run uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',q.id,'instruction',q.instruction,'reviewer',q.created_by,'bound',q.bound)
 from private.studio_revision_requests q join private.studio_runs r on r.id=q.run_id and r.current_input_revision=q.input_revision
 where q.run_id=p_run order by q.sequence desc limit 1;
$$;
create or replace function private.studio_stage_digest(p_run uuid, p_key text) returns text language plpgsql stable security definer set search_path='' as $$
declare i private.studio_run_inputs; up jsonb;
begin
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and x.input_revision=r.current_input_revision where r.id=p_run;
 up := private.studio_stage_upstream(p_run, p_key);
 if up is null then return null; end if;
 return private.studio_sha(p_key||'|'||private.studio_level_digest(i, private.studio_stage_level(p_key))||'|'||up::text||case when p_key='S5_draft' and private.studio_revision_request(p_run) is not null then '|'||private.studio_revision_request(p_run)::text else '' end);
end $$;

create function public.studio_request_revision(p_run uuid,p_gate text,p_expected_version integer,p_bound uuid[],p_instruction text,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs; binding jsonb; d jsonb; q uuid;
begin
 req:=jsonb_build_object('run',p_run,'gate',p_gate,'version',p_expected_version,'bound',to_jsonb(p_bound),'instruction',p_instruction);
 res:=private.studio_replay(me::text,p_command,'request_revision',req); if res is not null then return res; end if;
 select * into r from private.studio_runs where id=p_run for update;
 if r.id is null or r.state<>'active' then raise exception 'Run is not active'; end if;
 if p_gate is null or p_gate not in ('G3_records','G4_content') or length(trim(coalesce(p_instruction,''))) not between 10 and 8000 then raise exception 'Choose a record/content checkpoint and give specific changes (10–8000 characters)'; end if;
 binding:=private.studio_gate_binding(p_run,p_gate);
 d:=public.studio_record_decision(p_run,p_gate,p_expected_version,p_bound,'returned',p_instruction,
   jsonb_build_object('provenance','explicit_review','reference','Studio request changes','scope','Revise these drafts and revalidate; no bank write'), '[]'::jsonb,gen_random_uuid());
 insert into private.studio_revision_requests(run_id,input_revision,stage_key,gate,decision_id,instruction,bound,created_by)
 values(r.id,r.current_input_revision,'S5_draft',p_gate,(d->>'decisionId')::uuid,p_instruction,binding,me) returning id into q;
 perform private.studio_invalidate_from(r.id,'G3_records','Editor requested a new draft revision');
 -- Remove old proposals from the current candidate even when the new plan defers/removes a record.
 -- Bytes, parent links, decisions and provider evidence remain available as history.
 update private.studio_artifacts a set state='superseded' from private.studio_stages s
 where a.stage_id=s.id and a.run_id=r.id and a.state='current' and s.stage_key in ('S5_draft','S6_assemble_validate','S7_package');
 update private.studio_artifacts set state='superseded' where run_id=r.id and kind='draft_record' and state='current';
 update private.studio_changesets set state='superseded',updated_at=now() where run_id=r.id and state in ('draft','authorised');
 perform private.studio_advance(r.id);
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'revision_requested',jsonb_build_object('requestId',q,'gate',p_gate,'instruction',p_instruction));
 return private.studio_remember(me::text,p_command,'request_revision',req,jsonb_build_object('requestId',q,'stageId',(private.studio_current_stage(r.id,'S5_draft')).id,'invalidatedFrom','G3_records'));
end $$;
create or replace function public.studio_worker_read(p_attempt uuid, p_lease uuid, p_blob uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; r private.studio_runs; i private.studio_run_inputs; b private.studio_blobs;
begin
 s := private.studio_fence(p_attempt,p_lease);
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 select * into b from private.studio_blobs where id=p_blob and module_id=r.module_id;
 if not found or not (
  (s.stage_key='S5_draft' and b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(coalesce(private.studio_revision_request(r.id)->'bound'->'artifacts','[]'::jsonb)) x)) or
  b.id in (select blob_id from private.studio_source_files where source_revision_id=i.source_revision_id)
  or b.id in (select manifest_blob_id from private.studio_snapshots where id=i.snapshot_id union all select blob_id from private.studio_snapshot_files where snapshot_id=i.snapshot_id)
  or b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else coalesce(s.upstream->'artifacts','[]'::jsonb) end) x)
  or b.id in (select blob_id from private.studio_artifacts where id=any(private.studio_drafts(r.id)) and s.stage_key in ('S6_assemble_validate'))
 ) then raise exception 'Input not available to this stage'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 return jsonb_build_object('blobId',b.id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type);
end $$;
create function public.studio_claim_recorded(p_worker text,p_run uuid,p_bundle text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.studio_settings; s private.studio_stages; i private.studio_run_inputs; r private.studio_runs; token uuid := gen_random_uuid(); a private.studio_stage_attempts; bad uuid;
begin
 if p_worker is null or p_worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 if p_run is null or p_bundle is null or p_bundle !~ '^[a-f0-9]{64}$' then raise exception 'Recorded claim requires a run and bundle'; end if;
 -- Studio capacity is separate from paid generation: its own queue table and its own running limit.
 perform pg_advisory_xact_lock(hashtextextended('reviseit:studio-claim',0));
 perform private.studio_expire_leases();
 select * into cfg from private.studio_settings;
 if (select count(*) from private.studio_stages where state='running') >= cfg.max_running then return null; end if;
 loop
  select st.* into s from private.studio_stages st join private.studio_runs x on x.id=st.run_id
   where st.state='queued' and x.state='active' and x.id=p_run
 and exists(select 1 from private.studio_run_budgets rb join private.studio_budget_contracts bc on bc.id=rb.contract_id join private.studio_budget_trials bt on bt.id=rb.trial_id where rb.run_id=x.id and bc.mode='recorded' and bc.bundle_sha256=p_bundle and bt.state='open') order by st.seq for update of st skip locked limit 1;
  if not found then return null; end if;
  select * into r from private.studio_runs where id=s.run_id;
  select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
  -- Missing, inaccessible or corrupt committed bytes block dependent consumption.
  select b.id into bad from private.studio_blobs b where b.integrity<>'verified' and (
   b.id in (select blob_id from private.studio_source_files where source_revision_id=i.source_revision_id)
   or b.id = (select manifest_blob_id from private.studio_snapshots where id=i.snapshot_id)
   or b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else coalesce(s.upstream->'artifacts','[]'::jsonb) end) x)) limit 1;
  exit when bad is null;
  update private.studio_stages set state='blocked', blocked_reason='Integrity blocked: '||bad, updated_at=now() where id=s.id;
  perform private.studio_event(r.module_id,r.id,'system','studio','stage_blocked',jsonb_build_object('stage',s.id,'blob',bad));
 end loop;
 insert into private.studio_stage_attempts(stage_id,attempt_number,worker_id,lease,lease_until)
  values(s.id,s.attempt_count+1,p_worker,token,now()+make_interval(secs=>cfg.lease_seconds)) returning * into a;
 update private.studio_stages set state='running', current_attempt_id=a.id, attempt_count=a.attempt_number, blocked_reason=null, updated_at=now() where id=s.id;
 perform private.studio_event(r.module_id,r.id,'worker',p_worker,'stage_claimed',jsonb_build_object('stage',s.id,'attempt',a.id,'number',a.attempt_number));
 return jsonb_build_object('stageId',s.id,'attemptId',a.id,'attemptNumber',a.attempt_number,'lease',token,'leaseSeconds',cfg.lease_seconds,
  'runId',r.id,'moduleId',r.module_id,'purpose',r.purpose,'stageKey',s.stage_key,'kind',s.kind,'inputDigest',s.input_digest,
  'pins',jsonb_build_object('inputRevision',i.input_revision,'sourceDigest',i.source_digest,'snapshotId',i.snapshot_id,'bankManifestSha256',i.bank_manifest_sha256,
   'policySha256',i.policy_sha256,'skillContract',i.skill_contract_id,'skillSha256',i.skill_sha256,'validatorSha256',i.validator_sha256,
   'subjectAdapter',i.subject_adapter,'providerProfile',i.provider_profile_id,'adapterVersion',i.adapter_version,'promptVersion',i.prompt_version),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('blobId',b.id,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type,'role',f.role) order by f.role,b.sha256),'[]'::jsonb)
   from private.studio_source_files f join private.studio_blobs b on b.id=f.blob_id where f.source_revision_id=i.source_revision_id),
  'snapshot',(select jsonb_build_object('id',x.id,'manifestSha256',x.manifest_sha256,'manifestBlobId',x.manifest_blob_id,'origin',x.origin,'purpose',x.purpose) from private.studio_snapshots x where x.id=i.snapshot_id),
  'upstream',s.upstream,'revisionRequest',case when s.stage_key='S5_draft' then private.studio_revision_request(r.id) else null end);
end $$;

create function public.studio_execution_options() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();
begin
 return jsonb_build_object(
 'skills',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',skill_sha256) order by id),'[]'::jsonb) from private.studio_skill_contracts),
 'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'mode','recorded','contracts',c.ids) order by p.id),'[]'::jsonb)
 from private.studio_provider_profiles p join lateral (select jsonb_agg(jsonb_build_object('id',id,'bundleSha256',bundle_sha256) order by id) ids from private.studio_budget_contracts where profile_id=p.id and mode='recorded') c on c.ids is not null where p.enabled));
end $$;
create function public.studio_execution_view(p_run uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();
begin
 if not exists(select 1 from private.studio_runs where id=p_run) then raise exception 'Run not found'; end if;
 return jsonb_build_object(
 'budget',(select jsonb_build_object('mode',c.mode,'contractId',c.id,'bundleSha256',c.bundle_sha256,'trialState',t.state,'runLimitMicro',b.run_limit_micro,
   'heldMicro',coalesce((select sum(reserved_micro) from private.studio_budget_reservations where run_id=p_run and state='held'),0),
   'settledMicro',coalesce((select sum(actual_micro) from private.studio_budget_reservations where run_id=p_run and state='settled'),0))
 from private.studio_run_budgets b join private.studio_budget_contracts c on c.id=b.contract_id join private.studio_budget_trials t on t.id=b.trial_id where b.run_id=p_run),
 'currentStages',(select coalesce(jsonb_agg(s.id),'[]'::jsonb) from unnest(array['S1_extract','S2_task_match','S3_spec_match','S4_prioritise','S5_draft','S6_assemble_validate','S7_package']) k cross join lateral private.studio_current_stage(p_run,k) s where s.id is not null),
 'revisionRequests',(select coalesce(jsonb_agg(to_jsonb(q) order by q.sequence),'[]'::jsonb) from private.studio_revision_requests q where q.run_id=p_run));
end $$;
revoke all on function private.studio_revision_request(uuid) from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function public.studio_request_revision(uuid,text,integer,uuid[],text,uuid),public.studio_execution_options(),public.studio_execution_view(uuid) from public,anon,authenticated,service_role,reviseit_studio_operator;
grant execute on function public.studio_request_revision(uuid,text,integer,uuid[],text,uuid),public.studio_execution_options(),public.studio_execution_view(uuid) to authenticated;
revoke all on function public.studio_claim_recorded(text,uuid,text) from public,anon,authenticated,service_role,reviseit_studio_operator;
grant execute on function public.studio_claim_recorded(text,uuid,text) to service_role;
create function public.studio_claim_mock(p_worker text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.studio_settings; s private.studio_stages; i private.studio_run_inputs; r private.studio_runs; token uuid := gen_random_uuid(); a private.studio_stage_attempts; bad uuid;
begin
 if p_worker is null or p_worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 -- Studio capacity is separate from paid generation: its own queue table and its own running limit.
 perform pg_advisory_xact_lock(hashtextextended('reviseit:studio-claim',0));
 perform private.studio_expire_leases();
 select * into cfg from private.studio_settings;
 if (select count(*) from private.studio_stages where state='running') >= cfg.max_running then return null; end if;
 loop
  select st.* into s from private.studio_stages st join private.studio_runs x on x.id=st.run_id
   where st.state='queued' and x.state='active'
   and not exists(select 1 from private.studio_run_budgets where run_id=x.id)
   and exists(select 1 from private.studio_run_inputs where run_id=x.id and input_revision=x.current_input_revision and provider_profile_id='mock-v0') order by st.seq for update of st skip locked limit 1;
  if not found then return null; end if;
  select * into r from private.studio_runs where id=s.run_id;
  select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
  -- Missing, inaccessible or corrupt committed bytes block dependent consumption.
  select b.id into bad from private.studio_blobs b where b.integrity<>'verified' and (
   b.id in (select blob_id from private.studio_source_files where source_revision_id=i.source_revision_id)
   or b.id = (select manifest_blob_id from private.studio_snapshots where id=i.snapshot_id)
   or b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else coalesce(s.upstream->'artifacts','[]'::jsonb) end) x)) limit 1;
  exit when bad is null;
  update private.studio_stages set state='blocked', blocked_reason='Integrity blocked: '||bad, updated_at=now() where id=s.id;
  perform private.studio_event(r.module_id,r.id,'system','studio','stage_blocked',jsonb_build_object('stage',s.id,'blob',bad));
 end loop;
 insert into private.studio_stage_attempts(stage_id,attempt_number,worker_id,lease,lease_until)
  values(s.id,s.attempt_count+1,p_worker,token,now()+make_interval(secs=>cfg.lease_seconds)) returning * into a;
 update private.studio_stages set state='running', current_attempt_id=a.id, attempt_count=a.attempt_number, blocked_reason=null, updated_at=now() where id=s.id;
 perform private.studio_event(r.module_id,r.id,'worker',p_worker,'stage_claimed',jsonb_build_object('stage',s.id,'attempt',a.id,'number',a.attempt_number));
 return jsonb_build_object('stageId',s.id,'attemptId',a.id,'attemptNumber',a.attempt_number,'lease',token,'leaseSeconds',cfg.lease_seconds,
  'runId',r.id,'moduleId',r.module_id,'purpose',r.purpose,'stageKey',s.stage_key,'kind',s.kind,'inputDigest',s.input_digest,
  'pins',jsonb_build_object('inputRevision',i.input_revision,'sourceDigest',i.source_digest,'snapshotId',i.snapshot_id,'bankManifestSha256',i.bank_manifest_sha256,
   'policySha256',i.policy_sha256,'skillContract',i.skill_contract_id,'skillSha256',i.skill_sha256,'validatorSha256',i.validator_sha256,
   'subjectAdapter',i.subject_adapter,'providerProfile',i.provider_profile_id,'adapterVersion',i.adapter_version,'promptVersion',i.prompt_version),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('blobId',b.id,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type,'role',f.role) order by f.role,b.sha256),'[]'::jsonb)
   from private.studio_source_files f join private.studio_blobs b on b.id=f.blob_id where f.source_revision_id=i.source_revision_id),
  'snapshot',(select jsonb_build_object('id',x.id,'manifestSha256',x.manifest_sha256,'manifestBlobId',x.manifest_blob_id,'origin',x.origin,'purpose',x.purpose) from private.studio_snapshots x where x.id=i.snapshot_id),
  'upstream',s.upstream);
end $$;
revoke all on function public.studio_claim_mock(text) from public,anon,authenticated,service_role,reviseit_studio_operator;
grant execute on function public.studio_claim_mock(text) to service_role;
commit;
