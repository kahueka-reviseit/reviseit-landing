-- Editor-only inspection. No publication, readiness, bank acceptance or order writes.
create function public.studio_library_view(p_module text default null, p_snapshot uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); selected uuid;
begin
 if p_module is not null and not exists(select 1 from private.studio_modules where module_id=p_module) then raise exception 'Module not enrolled in Studio'; end if;
 if p_snapshot is not null then
  if p_module is null or not exists(select 1 from private.studio_snapshots where id=p_snapshot and module_id=p_module) then raise exception 'Snapshot does not belong to the selected module'; end if;
  selected:=p_snapshot;
 elsif p_module is not null then
  select accepted_snapshot_id into selected from private.studio_modules where module_id=p_module;
 end if;
 return jsonb_build_object('selectedSnapshotId',selected,
  'modules',(select coalesce(jsonb_agg(jsonb_build_object('id',m.module_id,'name',c.name,'currentRelease',c.current_release,'acceptedSnapshotId',m.accepted_snapshot_id) order by m.module_id),'[]'::jsonb)
   from private.studio_modules m join public.curriculum_modules c on c.id=m.module_id),
  'snapshots',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'moduleId',s.module_id,'manifestSha256',s.manifest_sha256,'purpose',s.purpose,'origin',s.origin,
    'accepted',s.id=m.accepted_snapshot_id,'createdAt',s.created_at,'fileCount',s.file_count,'adapter',s.subject_adapter) order by s.created_at desc,s.id),'[]'::jsonb)
   from private.studio_snapshots s join private.studio_modules m on m.module_id=s.module_id where p_module is null or s.module_id=p_module),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('moduleId',c.module_id,'release',c.release,'entryId',c.entry_id,'title',c.title,'topic',c.topic,
    'marksMin',c.marks_min,'marksMax',c.marks_max,'enabled',coalesce(r.orderable,false),'supported',private.catalogue_item_supported(c.module_id,c.release,c.entry_id),
    'orderable',coalesce(r.orderable,false) and private.catalogue_item_supported(c.module_id,c.release,c.entry_id)) order by c.module_id,c.entry_id),'[]'::jsonb)
   from public.catalogue_summaries c join public.curriculum_modules m on m.id=c.module_id and m.current_release=c.release
   join private.studio_modules sm on sm.module_id=c.module_id left join public.catalogue_ordering_readiness r on (r.module_id,r.release,r.entry_id)=(c.module_id,c.release,c.entry_id)
   where p_module is null or c.module_id=p_module),
  'records',(select coalesce(jsonb_agg(jsonb_build_object('kind',r.record_kind,'id',r.record_id,'parentId',r.parent_record_id,'path',r.path,'sha256',r.sha256,'status',r.status)
    order by r.record_kind,r.parent_record_id,r.record_id),'[]'::jsonb) from private.studio_record_index r where r.snapshot_id=selected),
  'files',(select coalesce(jsonb_agg(jsonb_build_object('path',f.path,'sha256',f.sha256,'size',b.size_bytes,'mediaType',b.media_type,'integrity',b.integrity) order by f.path),'[]'::jsonb)
   from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=selected));
end $$;

create function public.studio_bank_file_view(p_snapshot uuid, p_path text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); s private.studio_snapshots; f private.studio_snapshot_files; b private.studio_blobs;
begin
 select * into s from private.studio_snapshots where id=p_snapshot;
 if not found then raise exception 'Snapshot not found'; end if;
 select * into f from private.studio_snapshot_files where snapshot_id=s.id and path=p_path;
 if not found then raise exception 'File not found in this snapshot'; end if;
 select * into b from private.studio_blobs where id=f.blob_id and module_id=s.module_id;
 if not found then raise exception 'File binding is invalid'; end if;
 return jsonb_build_object('moduleId',s.module_id,'snapshotId',s.id,'purpose',s.purpose,'accepted',exists(select 1 from private.studio_modules where module_id=s.module_id and accepted_snapshot_id=s.id),
  'manifestSha256',s.manifest_sha256,'path',f.path,'sha256',f.sha256,'blobId',b.id,'size',b.size_bytes,'mediaType',b.media_type,'integrity',b.integrity,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('kind',record_kind,'id',record_id,'parentId',parent_record_id,'status',status) order by record_kind,parent_record_id,record_id),'[]'::jsonb)
   from private.studio_record_index where snapshot_id=s.id and path=f.path));
end $$;

create function public.studio_catalogue_item_view(p_module text,p_release text,p_entry text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); c public.catalogue_summaries; b private.catalogue_form_bindings; f jsonb; w text; current_version text; enabled boolean;
begin
 if not exists(select 1 from private.studio_modules where module_id=p_module) then raise exception 'Module not enrolled in Studio'; end if;
 select * into c from public.catalogue_summaries where (module_id,release,entry_id)=(p_module,p_release,p_entry);
 if not found then raise exception 'Catalogue item not found'; end if;
 select current_release into current_version from public.curriculum_modules where id=p_module;
 select orderable into enabled from public.catalogue_ordering_readiness where (module_id,release,entry_id)=(p_module,p_release,p_entry);
 select * into b from private.catalogue_form_bindings where (module_id,release,entry_id)=(p_module,p_release,p_entry);
 select payload into f from private.catalogue_authored_forms where (module_id,release,entry_id,manifest_sha256)=(p_module,p_release,p_entry,b.manifest_sha256);
 select workflow_sha256 into w from private.catalogue_executions where (module_id,release,manifest_sha256)=(p_module,p_release,b.manifest_sha256);
 return jsonb_build_object('moduleId',p_module,'release',p_release,'entryId',p_entry,'title',c.title,'topic',c.topic,'description',c.description,
  'marksMin',c.marks_min,'marksMax',c.marks_max,'preview',c.preview,'thumbnailPng',c.thumbnail_png,'thumbnailAlt',c.thumbnail_alt,
  'currentRelease',current_version,'enabled',coalesce(enabled,false),'supported',private.catalogue_item_supported(p_module,p_release,p_entry),
  'orderable',p_release=current_version and coalesce(enabled,false) and private.catalogue_item_supported(p_module,p_release,p_entry),
  'form',case when f is null then null else jsonb_build_object('revision',f->'formRevision','fields',f->'fields','explicitlyNoInput',f->'explicitlyNoInput','shared',f->'shared') end,
  'manifestSha256',b.manifest_sha256,'workflowSha256',w,'bundleSha256',b.private_bundle_sha256,
  'sources',coalesce(f->'sources','[]'::jsonb));
end $$;

create function public.studio_releases_view(p_module text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor();
begin
 if p_module is not null and not exists(select 1 from private.studio_modules where module_id=p_module) then raise exception 'Module not enrolled in Studio'; end if;
 return jsonb_build_object(
  'modules',(select coalesce(jsonb_agg(jsonb_build_object('id',m.module_id,'name',c.name,'currentRelease',c.current_release,'acceptedSnapshotId',m.accepted_snapshot_id) order by m.module_id),'[]'::jsonb)
   from private.studio_modules m join public.curriculum_modules c on c.id=m.module_id),
  'releases',(select coalesce(jsonb_agg(jsonb_build_object('moduleId',x.module_id,'release',x.release,'current',x.release=m.current_release,
    'publishedAt',p.published_at,'importedAt',i.imported_at,'previousRelease',p.expected_previous_release,
    'contentDigest',coalesce(p.payload->>'contentDigest',i.payload->>'contentDigest'),'entries',x.entries,
    'enabled',x.enabled,'supported',x.supported,'ready',x.ready,'forms',x.forms,'executions',x.executions) order by coalesce(p.published_at,i.imported_at) desc nulls last,x.module_id,x.release),'[]'::jsonb)
   from (select c.module_id,c.release,count(*) as entries,
    count(*) filter(where coalesce(r.orderable,false)) as enabled,
    count(*) filter(where private.catalogue_item_supported(c.module_id,c.release,c.entry_id)) as supported,
    count(*) filter(where coalesce(r.orderable,false) and private.catalogue_item_supported(c.module_id,c.release,c.entry_id)) as ready,
    count(*) filter(where f.payload is not null) as forms,
    count(*) filter(where e.workflow_sha256 is not null) as executions
    from public.catalogue_summaries c join private.studio_modules sm on sm.module_id=c.module_id
    left join public.catalogue_ordering_readiness r on (r.module_id,r.release,r.entry_id)=(c.module_id,c.release,c.entry_id)
    left join private.catalogue_form_bindings b on (b.module_id,b.release,b.entry_id)=(c.module_id,c.release,c.entry_id)
    left join private.catalogue_authored_forms f on (f.module_id,f.release,f.entry_id,f.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256)
    left join private.catalogue_executions e on (e.module_id,e.release,e.manifest_sha256)=(b.module_id,b.release,b.manifest_sha256)
    where p_module is null or c.module_id=p_module group by c.module_id,c.release) x
   join public.curriculum_modules m on m.id=x.module_id
   left join private.catalogue_published_releases p on (p.module_id,p.release)=(x.module_id,x.release)
   left join private.catalogue_imported_releases i on (i.module_id,i.release)=(x.module_id,x.release)));
end $$;
revoke all on function public.studio_library_view(text,uuid), public.studio_bank_file_view(uuid,text),public.studio_catalogue_item_view(text,text,text),public.studio_releases_view(text) from public,anon,service_role;
grant execute on function public.studio_library_view(text,uuid), public.studio_bank_file_view(uuid,text),public.studio_catalogue_item_view(text,text,text),public.studio_releases_view(text) to authenticated;
