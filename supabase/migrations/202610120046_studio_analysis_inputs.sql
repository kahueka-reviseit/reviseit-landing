begin;
-- Explicit ancestor evidence and safe index proposals for the recorded analysis stages.

alter table private.studio_artifacts drop constraint studio_artifacts_record_kind_check;
alter table private.studio_artifacts add constraint studio_artifacts_record_kind_check check (record_kind in ('task_type','specification','form_source','index'));

alter table private.studio_changeset_entries drop constraint studio_changeset_entries_record_kind_check;
alter table private.studio_changeset_entries add constraint studio_changeset_entries_record_kind_check check (record_kind in ('task_type','specification','form_source','index'));

alter table private.studio_content_judgments drop constraint studio_content_judgments_record_kind_check;
alter table private.studio_content_judgments add constraint studio_content_judgments_record_kind_check check (record_kind in ('task_type','specification','form_source','index'));

create or replace function private.studio_safe_path(p_path text, p_kind text default null) returns boolean language sql immutable set search_path='' as $$
 select p_path is not null and length(p_path) <= 300
  and p_path ~ '^data/[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$'
  and p_path !~ '(^|/)\.\.?(/|$)' and p_path !~ '^data/archive(/|$)'
  and (p_kind is null
   or (p_kind = 'task_type' and p_path ~ '^data/task-types/[a-z0-9-]+/[^/]+\.md$')
   or (p_kind = 'specification' and p_path ~ '^data/specs/[a-z0-9-]+/[^/]+\.md$')
   or (p_kind = 'index' and p_path in ('data/indexes/task-type-database-index.md','data/indexes/question-specification-library.md'))
   or (p_kind = 'form_source' and p_path ~ '^data/forms/'));
$$;

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
  if p_record is null or p_record->>'kind' not in ('task_type','specification','form_source','index') or p_record->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'
   or not private.studio_safe_path(p_record->>'path', p_record->>'kind') then raise exception 'Invalid record proposal'; end if;
  if p_record->>'kind'='index' and p_record->>'id' <> replace(split_part(p_record->>'path','/',3),'.md','') then raise exception 'Index identity differs from stable path'; end if;
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

create or replace function public.studio_create_draft(p_run uuid, p_record_kind text, p_record_id text, p_parent_record_id text, p_path text, p_blob uuid, p_rationale text, p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs; i private.studio_run_inputs; b private.studio_blobs; idx private.studio_record_index; n private.studio_artifacts; lk text;
begin
 req := jsonb_build_object('run',p_run,'kind',p_record_kind,'id',p_record_id,'parent',p_parent_record_id,'path',p_path,'blob',p_blob,'rationale',p_rationale);
 res := private.studio_replay(me::text,p_command,'create_draft',req); if res is not null then return res; end if;
 select * into r from private.studio_runs where id=p_run for update;
 if not found then raise exception 'Run not found'; end if;
 if r.state <> 'active' then raise exception 'Run is %', r.state; end if;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 if p_record_kind not in ('task_type','specification','form_source','index') or p_record_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'
  or coalesce(p_parent_record_id,'') !~ '^([A-Za-z0-9][A-Za-z0-9_.-]{0,159})?$' then raise exception 'Invalid record identity'; end if;
 if p_record_kind='index' and p_record_id <> replace(split_part(p_path,'/',3),'.md','') then raise exception 'Index identity differs from stable path'; end if;
 if not private.studio_safe_path(p_path, p_record_kind) then raise exception 'Unsafe or out-of-scope record path'; end if;
 select * into b from private.studio_blobs where id=p_blob and module_id=r.module_id;
 if not found then raise exception 'Record bytes not found in this module'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 select * into idx from private.studio_record_index where snapshot_id=i.snapshot_id and record_kind=p_record_kind and record_id=p_record_id and parent_record_id=coalesce(p_parent_record_id,'');
 if found and idx.path <> p_path then raise exception 'Record % resolves to a different path in the pinned snapshot', p_record_id; end if;
 if not found and exists(select 1 from private.studio_snapshot_files where snapshot_id=i.snapshot_id and path=p_path) then raise exception 'Path already holds another record'; end if;
 lk := 'record:'||p_record_kind||':'||p_record_id||case when coalesce(p_parent_record_id,'')<>'' then ':'||p_parent_record_id else '' end;
 if exists(select 1 from private.studio_artifacts where run_id=r.id and logical_key=lk and state='current') then raise exception 'A current proposal for this record exists; revise it instead'; end if;
 insert into private.studio_artifacts(run_id,module_id,logical_key,kind,revision,blob_id,sha256,schema,record_kind,record_id,parent_record_id,record_path,author_kind,author_id,rationale)
  values(r.id,r.module_id,lk,'draft_record',coalesce((select max(revision) from private.studio_artifacts where run_id=r.id and logical_key=lk),0)+1,
   b.id,b.sha256,'reviseit/bank-record-markdown@1',p_record_kind,p_record_id,coalesce(p_parent_record_id,''),p_path,'user',me::text,p_rationale)
  returning * into n;
 perform private.studio_invalidate_from(r.id,'G3_records','Draft '||lk||' added');
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'draft_created',jsonb_build_object('artifact',n.id,'logicalKey',lk));
 perform private.studio_advance(r.id);
 return private.studio_remember(me::text,p_command,'create_draft',req,jsonb_build_object('artifactId',n.id,'logicalKey',lk,'revision',n.revision));
end $$;

create or replace function private.studio_check_entries(p_module text, p_snapshot uuid, p_entries jsonb) returns table(
 path text, action text, record_kind text, record_id text, parent_record_id text, before_sha256 text, after_sha256 text, after_blob_id uuid, artifact_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare e jsonb; b private.studio_blobs; idx private.studio_record_index; f private.studio_snapshot_files; seen text[] := '{}'; retiring text[] := '{}'; l record;
begin
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) > 500 then raise exception 'Invalid change set entries'; end if;
 for e in select * from jsonb_array_elements(p_entries) loop
  if e->>'action' = 'retire' then retiring := retiring || ((e->>'recordKind')||':'||(e->>'recordId')); end if;
 end loop;
 for e in select * from jsonb_array_elements(p_entries) loop
  path := e->>'path'; action := e->>'action'; record_kind := e->>'recordKind'; record_id := e->>'recordId'; parent_record_id := coalesce(e->>'parentRecordId','');
  artifact_id := nullif(e->>'artifactId','')::uuid;
  if action not in ('add','replace','retire') then raise exception 'Unsupported change set action'; end if;
  if record_kind not in ('task_type','specification','form_source','index') or record_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$' then raise exception 'Invalid record identity'; end if;
  if not private.studio_safe_path(path, record_kind) then raise exception 'Unsafe or out-of-scope path: %', left(coalesce(path,'(null)'),120); end if;
  if record_kind='index' and record_id <> replace(split_part(path,'/',3),'.md','') then raise exception 'Index identity differs from stable path'; end if;
  if path = any(seen) then raise exception 'Duplicate change set path'; end if;
  seen := seen || path;
  select * into b from private.studio_blobs where id=(e->>'blobId')::uuid and module_id=p_module;
  if not found then raise exception 'Change set bytes not found in this module'; end if;
  if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
  after_blob_id := b.id; after_sha256 := b.sha256;
  select * into f from private.studio_snapshot_files sf where sf.snapshot_id=p_snapshot and sf.path=e->>'path';
  select * into idx from private.studio_record_index ri where ri.snapshot_id=p_snapshot and ri.record_kind=e->>'recordKind' and ri.record_id=e->>'recordId' and ri.parent_record_id=coalesce(e->>'parentRecordId','');
  if action = 'add' then
   if f.path is not null then raise exception 'Path already exists in the base snapshot'; end if;
   if idx.record_id is not null then raise exception 'Record % already exists in the base snapshot', record_id; end if;
   before_sha256 := null;
  else
   if f.path is null or idx.record_id is null or idx.path <> path then raise exception 'Record % does not resolve at that path in the base snapshot', record_id; end if;
   before_sha256 := f.sha256;
   if before_sha256 = after_sha256 then raise exception 'Change set entry does not change the file'; end if;
   if action = 'retire' then
    if idx.status <> 'active' then raise exception 'Record % is already retired', record_id; end if;
    for l in select * from private.studio_record_links rl where rl.snapshot_id=p_snapshot and rl.to_kind=e->>'recordKind' and rl.to_id=e->>'recordId' and rl.required loop
     if not ((l.from_kind||':'||l.from_id) = any(retiring))
      and exists(select 1 from private.studio_record_index x where x.snapshot_id=p_snapshot and x.record_kind=l.from_kind and x.record_id=l.from_id and x.status='active') then
      raise exception 'Retiring % would break the required reference from %', record_id, l.from_id;
     end if;
    end loop;
   end if;
  end if;
  return next;
 end loop;
end $$;

create or replace function private.studio_stage_upstream(p_run uuid,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d private.studio_decisions; g private.studio_decisions; s private.studio_stages; ids uuid[]; prior jsonb;
begin
 if p_key='S1_extract' then return '[]'::jsonb;
 elsif p_key in ('S2_task_match','S3_spec_match') then d:=private.studio_live_decision(p_run,'G1_inventory');return d.bound;
 elsif p_key='S4_prioritise' then
  d:=private.studio_live_decision(p_run,'G1_inventory');g:=private.studio_live_decision(p_run,'G2_matches');
  if d.id is null or g.id is null then return null; end if;
  prior:=(d.bound->'artifacts')||(g.bound->'artifacts');
 elsif p_key in ('S5_draft','S6_assemble_validate') then
  s:=private.studio_current_stage(p_run,case p_key when 'S5_draft' then 'S4_prioritise' else 'S5_draft' end);
  if s.id is null or s.state<>'succeeded' then return null; end if;
  prior:=(case when jsonb_typeof(s.upstream)='array' then s.upstream else s.upstream->'artifacts' end)||private.studio_artifact_list(private.studio_stage_outputs(s.id));
  if p_key='S6_assemble_validate' then prior:=prior||private.studio_artifact_list(private.studio_drafts(p_run)); end if;
 elsif p_key='S7_package' then
  d:=private.studio_live_decision(p_run,'G4_content');
  if d.id is null then return null; end if;
  s:=private.studio_current_stage(p_run,'S6_assemble_validate');
  prior:=s.upstream||(d.bound->'artifacts');
 else raise exception 'Unknown stage'; end if;
 select coalesce(array_agg(distinct (x->>'id')::uuid),'{}') into ids from jsonb_array_elements(prior) x;
 if p_key in ('S5_draft','S6_assemble_validate') then return private.studio_artifact_list(ids); end if;
 return jsonb_build_object('artifacts',private.studio_artifact_list(ids));
end $$;

create or replace function public.studio_analysis_inputs(p_attempt uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; i private.studio_run_inputs; snap private.studio_snapshots;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 if s.stage_key not in ('S4_prioritise','S5_draft','S6_assemble_validate','S7_package') then raise exception 'Analysis inputs unavailable for this stage'; end if;
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and r.current_input_revision=x.input_revision where r.id=s.run_id;
 select * into snap from private.studio_snapshots where id=i.snapshot_id;
 return jsonb_build_object('stageId',s.id,'inputDigest',s.input_digest,'sourceRevisionId',i.source_revision_id,
  'snapshotId',snap.id,'moduleId',snap.module_id,'manifestSha256',snap.manifest_sha256,
  'subjectAdapter',snap.subject_adapter,'projectionSha256',snap.projection_sha256,
  'artifacts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'logicalKey',a.logical_key,'kind',a.kind,'sha256',a.sha256,'blobId',a.blob_id,'size',b.size_bytes,
    'schema',a.schema,'meta',a.meta,'authorKind',a.author_kind,'providerAttemptId',a.provider_attempt_id,
    'record',case when a.record_kind is null then null else jsonb_build_object('kind',a.record_kind,'id',a.record_id,'parentId',a.parent_record_id,'path',a.record_path) end) order by a.logical_key),'[]'::jsonb)
   from private.studio_artifacts a join private.studio_blobs b on b.id=a.blob_id
   where a.id in (select (x->>'id')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else s.upstream->'artifacts' end) x)),
  'decisions',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'gate',d.gate,'reviewer',d.reviewer,'rationale',d.rationale,'items',d.items,'bound',d.bound,'authorisation',d.authorisation) order by d.gate),'[]'::jsonb)
   from private.studio_decisions d where d.run_id=s.run_id and d.gate in ('G1_inventory','G2_matches','G3_records','G4_content') and d.id=(private.studio_live_decision(s.run_id,d.gate)).id),
  'changeset',(select jsonb_build_object('id',c.id,'state',c.state,'manifestSha256',c.manifest_sha256,'manifest',c.manifest,'validationArtifactId',c.validation_artifact_id) from private.studio_changesets c where c.id=(private.studio_current_changeset(s.run_id)).id),
  'links',(select coalesce(jsonb_agg(jsonb_build_object('fromKind',l.from_kind,'fromId',l.from_id,'toKind',l.to_kind,'toId',l.to_id,'required',l.required)),'[]'::jsonb) from private.studio_record_links l where l.snapshot_id=i.snapshot_id),
  'files',(select coalesce(jsonb_agg(jsonb_build_object('path',f.path,'sha256',f.sha256,'blobId',b.id,'size',b.size_bytes) order by f.path),'[]'::jsonb)
   from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=snap.id),
  'records',(select coalesce(jsonb_agg(jsonb_build_object('kind',record_kind,'id',record_id,'parentId',parent_record_id,'path',path,'sha256',sha256,'status',status)
   order by record_kind,record_id,parent_record_id),'[]'::jsonb) from private.studio_record_index where snapshot_id=snap.id));
end $$;

revoke all on function public.studio_analysis_inputs(uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_analysis_inputs(uuid,uuid) to service_role;
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
 select * into c from private.studio_changesets where stage_id=s.id and state='draft';
 if c.id is not null then
  if c.validation_artifact_id is distinct from v.id or c.manifest->'entries' is distinct from (private.studio_manifest(r.module_id,i.snapshot_id,rows,'{}'::jsonb)->'entries') then
   raise exception 'Change set replay changed';
  end if;
  return jsonb_build_object('changesetId',c.id,'manifestSha256',c.manifest_sha256,'entries',jsonb_array_length(rows));
 end if;
 man := private.studio_manifest(r.module_id,i.snapshot_id,rows,jsonb_build_object('kind','analysis','purpose',r.purpose,'runId',r.id,'inputRevision',i.input_revision,'validationSha256',v.sha256));
 update private.studio_changesets set state='superseded', updated_at=now() where run_id=r.id and state='draft';
 insert into private.studio_changesets(module_id,run_id,kind,purpose,base_snapshot_id,manifest,manifest_sha256,stage_id,validation_artifact_id,created_by)
  values(r.module_id,r.id,'analysis',r.purpose,i.snapshot_id,man,private.studio_sha(man::text),s.id,v.id,'worker') returning * into c;
 insert into private.studio_changeset_entries(changeset_id,path,action,record_kind,record_id,parent_record_id,before_sha256,after_sha256,after_blob_id,artifact_id)
  select c.id,x->>'path',x->>'action',x->>'recordKind',x->>'recordId',x->>'parentRecordId',x->>'before',x->>'after',(x->>'blobId')::uuid,(x->>'artifactId')::uuid from jsonb_array_elements(rows) x;
 return jsonb_build_object('changesetId',c.id,'manifestSha256',c.manifest_sha256,'entries',jsonb_array_length(rows));
end $$;
commit;
