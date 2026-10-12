begin;
-- Intake can only enumerate the current, fenced source revision and its pinned policy.
create function public.studio_intake_inputs(p_attempt uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; i private.studio_run_inputs; r private.studio_runs;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 if s.stage_key<>'S1_extract' then raise exception 'Intake inputs unavailable for this stage'; end if;
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 return jsonb_build_object('stageId',s.id,'inputDigest',s.input_digest,'moduleId',r.module_id,
  'sourceRevisionId',i.source_revision_id,'sourceDigest',i.source_digest,
  'asOf',to_char(i.created_at at time zone 'UTC','YYYY-MM-DD'),
  'sources',(select jsonb_agg(jsonb_build_object('blobId',b.id,'sha256',b.sha256,'size',b.size_bytes,
    'mediaType',b.media_type,'role',f.role,'filename',f.original_filename) order by f.role,b.id)
   from private.studio_source_files f join private.studio_blobs b on b.id=f.blob_id where f.source_revision_id=i.source_revision_id),
  'policy',(select jsonb_build_object('blobId',b.id,'sha256',b.sha256,'size',b.size_bytes,'path',f.path)
   from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id
   where f.snapshot_id=i.snapshot_id and f.path='data/reference/curriculum-policy.md' and f.sha256=i.policy_sha256));
end $$;
revoke all on function public.studio_intake_inputs(uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_intake_inputs(uuid,uuid) to service_role;
commit;
