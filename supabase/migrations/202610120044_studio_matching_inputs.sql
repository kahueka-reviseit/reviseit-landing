begin;
-- Read only the snapshot already pinned to the fenced stage. No caller-supplied snapshot/module.
create function public.studio_matching_inputs(p_attempt uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; i private.studio_run_inputs; snap private.studio_snapshots;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 if s.stage_key not in ('S2_task_match','S3_spec_match') then raise exception 'Matching inputs unavailable for this stage'; end if;
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and r.current_input_revision=x.input_revision where r.id=s.run_id;
 select * into snap from private.studio_snapshots where id=i.snapshot_id;
 return jsonb_build_object('stageId',s.id,'inputDigest',s.input_digest,'sourceRevisionId',i.source_revision_id,
  'snapshotId',snap.id,'moduleId',snap.module_id,'manifestSha256',snap.manifest_sha256,
  'subjectAdapter',snap.subject_adapter,'projectionSha256',snap.projection_sha256,
  'files',(select coalesce(jsonb_agg(jsonb_build_object('path',f.path,'sha256',f.sha256,'blobId',b.id,'size',b.size_bytes) order by f.path),'[]'::jsonb)
   from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=snap.id),
  'records',(select coalesce(jsonb_agg(jsonb_build_object('kind',record_kind,'id',record_id,'parentId',parent_record_id,'path',path,'sha256',sha256,'status',status)
   order by record_kind,record_id,parent_record_id),'[]'::jsonb) from private.studio_record_index where snapshot_id=snap.id));
end $$;
revoke all on function public.studio_matching_inputs(uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_matching_inputs(uuid,uuid) to service_role;
commit;
