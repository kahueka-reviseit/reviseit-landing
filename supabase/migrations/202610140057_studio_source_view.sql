-- Read-only source detail for Paper 04. Keeps private storage keys out of browser props.
create function public.studio_source_view(p_source uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); src private.studio_sources;
begin
 select * into src from private.studio_sources where id=p_source;
 if not found then raise exception 'Source not found'; end if;
 return jsonb_build_object('id',src.id,'moduleId',src.module_id,'title',src.title,'state',src.state,'revision',src.current_revision,
  'revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'identity',r.identity,'digest',r.source_digest,'reason',r.reason,'createdAt',r.created_at,
    'files',(select coalesce(jsonb_agg(jsonb_build_object('blobId',b.id,'filename',f.original_filename,'role',f.role,'size',b.size_bytes,'sha256',b.sha256,'integrity',b.integrity) order by f.role,f.original_filename),'[]'::jsonb)
      from private.studio_source_files f join private.studio_blobs b on b.id=f.blob_id where f.source_revision_id=r.id)) order by r.revision desc),'[]'::jsonb)
    from private.studio_source_revisions r where r.source_id=src.id));
end $$;
revoke all on function public.studio_source_view(uuid) from public,anon,service_role;
grant execute on function public.studio_source_view(uuid) to authenticated;
