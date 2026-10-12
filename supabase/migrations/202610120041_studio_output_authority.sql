begin;
-- Correct Studio output authority without rewriting migrations 039/040 or teacher state.
-- Read-time liveness is defence in depth for retained rows from earlier implementations.
-- Roll forward to repair; do not restore stale-approval semantics as rollback.

create or replace function private.studio_live_decision(p_run uuid, p_gate text) returns private.studio_decisions language sql stable security definer set search_path='' as $$
 select d.* from private.studio_decisions d join private.studio_runs r on r.id=d.run_id
  join private.studio_run_inputs i on i.run_id=r.id and i.input_revision=r.current_input_revision
  where d.run_id=p_run and d.gate=p_gate and d.outcome='approved' and d.invalidated_at is null
   and d.dependency_digest = private.studio_level_digest(i, private.studio_stage_level(p_gate))
   and d.bound = private.studio_gate_binding(p_run,p_gate);
$$;

create or replace function private.studio_fence(p_attempt uuid, p_lease uuid) returns private.studio_stages language plpgsql security definer set search_path='' as $$
declare s private.studio_stages;
begin
 -- The run is the serialization point for review, replacement and stage completion.
 -- Always take it before stage/attempt locks, matching the editor commands.
 perform 1 from private.studio_runs r join private.studio_stages st on st.run_id=r.id
  join private.studio_stage_attempts a on a.stage_id=st.id where a.id=p_attempt for update of r;
 select st.* into s from private.studio_stages st join private.studio_stage_attempts a on a.id=st.current_attempt_id
  join private.studio_runs r on r.id=st.run_id
  where a.id=p_attempt and a.lease=p_lease and a.state='claimed' and a.lease_until > now() and st.state='running' and r.state='active'
  for update of st, a;
 if not found then raise exception 'Studio lease lost'; end if;
 return s;
end $$;

create or replace function public.studio_put_output(p_attempt uuid, p_lease uuid, p_logical_key text, p_kind text, p_sha256 text, p_size bigint, p_media_type text, p_schema text,
 p_record jsonb, p_meta jsonb, p_provider_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; r private.studio_runs; i private.studio_run_inputs; b private.studio_blobs; prev private.studio_artifacts; n private.studio_artifacts; pa private.studio_provider_attempts; idx private.studio_record_index; expected_key text;
begin
 s := private.studio_fence(p_attempt,p_lease);
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 if p_kind <> 'evidence' and s.stage_key is distinct from (case p_kind
  when 'inventory' then 'S1_extract' when 'page_text' then 'S1_extract'
  when 'task_matches' then 'S2_task_match' when 'spec_matches' then 'S3_spec_match'
  when 'gap_list' then 'S4_prioritise' when 'draft_record' then 'S5_draft'
  when 'changeset_manifest' then 'S6_assemble_validate' when 'validation_result' then 'S6_assemble_validate'
  when 'package_file' then 'S7_package' end) then
  raise exception 'Output ownership: kind % does not belong to stage %',p_kind,s.stage_key;
 end if;
 -- A logical key keeps its original stage family and kind, including evidence keys.
 -- Check historical owners too: discarding an artifact does not release its namespace.
 if exists(select 1 from private.studio_artifacts a left join private.studio_stages st on st.id=a.stage_id
  where a.run_id=r.id and a.logical_key=p_logical_key and
   (a.kind is distinct from p_kind or (st.id is not null and st.stage_key is distinct from s.stage_key))) then
  raise exception 'Output ownership: logical key belongs to another stage or kind';
 end if;
 if p_provider_attempt is not null then
  select p.* into pa from private.studio_provider_attempts p join private.studio_provider_operations o on o.id=p.operation_id
   where p.id=p_provider_attempt and o.stage_id=s.id and o.current_attempt_id=p.id and p.dispatch_state='succeeded' and p.stage_attempt_id=p_attempt;
  -- A late or superseded provider result can be stored on its attempt but never accepted here.
  if not found then raise exception 'Provider result is not the current settled attempt of this stage'; end if;
 end if;
 if p_kind = 'draft_record' then
  if p_record is null or p_record->>'kind' not in ('task_type','specification','form_source') or p_record->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'
   or not private.studio_safe_path(p_record->>'path', p_record->>'kind') then raise exception 'Invalid record proposal'; end if;
  select * into idx from private.studio_record_index where snapshot_id=i.snapshot_id and record_kind=p_record->>'kind' and record_id=p_record->>'id' and parent_record_id=coalesce(p_record->>'parentId','');
  if found and idx.path <> p_record->>'path' then raise exception 'Record resolves to a different path in the pinned snapshot'; end if;
  expected_key := 'record:'||(p_record->>'kind')||':'||(p_record->>'id')||coalesce(':'||nullif(p_record->>'parentId',''),'');
  if p_logical_key is distinct from expected_key then raise exception 'Record logical key mismatch'; end if;
 end if;
 b := private.studio_register_blob(r.module_id,p_sha256,p_size,p_media_type);
 select * into prev from private.studio_artifacts where run_id=r.id and logical_key=p_logical_key and state='current' for update;
 if prev.stage_attempt_id = p_attempt then
  -- A repeated upload of the same payload is a replay, not a new revision.
  if prev.blob_id is distinct from b.id or prev.schema is distinct from p_schema
   or prev.provider_attempt_id is distinct from p_provider_attempt or prev.meta is distinct from coalesce(p_meta,'{}'::jsonb)
   or prev.record_kind is distinct from (p_record->>'kind') or prev.record_id is distinct from (p_record->>'id')
   or prev.parent_record_id is distinct from coalesce(p_record->>'parentId','') or prev.record_path is distinct from (p_record->>'path')
   then raise exception 'Output replay changed'; end if;
  return jsonb_build_object('artifactId',prev.id,'revision',prev.revision,'blobId',prev.blob_id);
 end if;
 if prev.author_kind = 'user' and prev.stage_id = s.id then
  raise exception 'Output ownership: worker cannot replace an editor revision of the same stage';
 end if;
 if prev.id is not null then update private.studio_artifacts set state='superseded' where id=prev.id; end if;
 insert into private.studio_artifacts(run_id,module_id,logical_key,kind,revision,parent_id,blob_id,sha256,schema,record_kind,record_id,parent_record_id,record_path,
  stage_id,stage_attempt_id,provider_attempt_id,author_kind,author_id,meta)
  values(r.id,r.module_id,p_logical_key,p_kind,coalesce((select max(revision) from private.studio_artifacts where run_id=r.id and logical_key=p_logical_key),0)+1,prev.id,b.id,b.sha256,p_schema,
   p_record->>'kind',p_record->>'id',coalesce(p_record->>'parentId',''),p_record->>'path',s.id,p_attempt,p_provider_attempt,'worker',
   (select worker_id from private.studio_stage_attempts where id=p_attempt),coalesce(p_meta,'{}'::jsonb)) returning * into n;
 if prev.id is not null then
  perform private.studio_invalidate_binding(r.id,array[prev.id],'Worker replaced '||p_logical_key);
  perform private.studio_advance(r.id);
 end if;
 return jsonb_build_object('artifactId',n.id,'revision',n.revision,'blobId',b.id);
end $$;

commit;
