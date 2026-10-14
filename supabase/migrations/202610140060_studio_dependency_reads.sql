-- Read-only dependency discovery over retained, immutable source bindings.
-- Index the existing evidence; do not create a competing copy or change publication/approval.
create index studio_catalogue_source_lookup on private.catalogue_authored_forms using gin ((payload->'sources') jsonb_path_ops);
create index studio_order_source_lookup on private.paper_orders using gin (snapshot jsonb_path_ops);
create index studio_record_link_reverse_lookup on private.studio_record_links(snapshot_id,to_kind,to_id);

create function public.studio_file_impact_view(p_snapshot uuid,p_path text,p_sha256 text,p_draft uuid default null,p_revision integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); f jsonb; s private.studio_snapshots; d private.studio_maintenance_drafts; h text; form_entry text; affected jsonb; unresolved integer;
begin
 f:=public.studio_bank_file_view(p_snapshot,p_path);
 select * into s from private.studio_snapshots where id=p_snapshot;
 h:=f->>'sha256';
 if p_draft is not null then
  select * into d from private.studio_maintenance_drafts where id=p_draft and snapshot_id=p_snapshot and path=p_path;
  if not found or p_revision is distinct from d.revision or d.state<>'draft' then raise exception 'Draft changed. Reopen the impact report from the current draft'; end if;
  select b.sha256 into h from private.studio_maintenance_revisions r join private.studio_blobs b on b.id=r.blob_id where r.draft_id=d.id and r.revision=d.revision;
 elsif p_revision is distinct from 0 then raise exception 'A saved draft is required for this revision'; end if;
 if p_sha256 is distinct from h then raise exception 'Source revision changed. Reopen the impact report'; end if;
 -- Do not guess a parent for a legacy link that names only a variant label. Even a currently
 -- unique label is not a durable parent-qualified identity. Such edges stay outside the graph.
 with recursive edges as (
  select a.path as from_path,b.path as to_path from private.studio_record_links l
  join private.studio_record_index a on a.snapshot_id=l.snapshot_id and a.record_kind=l.from_kind and a.record_id=l.from_id and a.parent_record_id=''
  join private.studio_record_index b on b.snapshot_id=l.snapshot_id and b.record_kind=l.to_kind and b.record_id=l.to_id and b.parent_record_id=''
  where l.snapshot_id=p_snapshot and l.from_kind<>'task_variant' and l.to_kind<>'task_variant'
 ), reached(path) as (
  select p_path union select e.from_path from edges e join reached r on r.path=e.to_path
 )
 select coalesce(jsonb_agg(jsonb_build_object('kind',r.record_kind,'id',r.record_id,'parentId',r.parent_record_id,'path',r.path,'sha256',r.sha256,'status',r.status) order by r.path,r.record_kind,r.parent_record_id,r.record_id),'[]'::jsonb)
 into affected from private.studio_record_index r where r.snapshot_id=p_snapshot and r.path<>p_path and r.path in(select path from reached);
 select count(*) into unresolved from private.studio_record_links l where l.snapshot_id=p_snapshot and (
  l.from_kind='task_variant' or l.to_kind='task_variant' or
  not exists(select 1 from private.studio_record_index r where r.snapshot_id=l.snapshot_id and r.record_kind=l.from_kind and r.record_id=l.from_id and r.parent_record_id='') or
  not exists(select 1 from private.studio_record_index r where r.snapshot_id=l.snapshot_id and r.record_kind=l.to_kind and r.record_id=l.to_id and r.parent_record_id=''));
 -- This is an identity-only candidate, not proof that an authored JSON file matches a release.
 if p_path ~ '^data/forms/authored/specification/[A-Z0-9_-]+\.json$' then form_entry:='structured:'||regexp_replace(split_part(p_path,'/',5),'\.json$','');
 elsif p_path ~ '^data/forms/authored/multiple-choice/[A-Z0-9_-]+\.json$' then form_entry:='mcq:'||regexp_replace(split_part(p_path,'/',5),'\.json$',''); end if;
 return jsonb_build_object('file',f,'computedAt',statement_timestamp(),'projectionSha256',s.projection_sha256,
  'binding',jsonb_build_object('draftId',p_draft,'revision',p_revision,'sha256',h),
  'dependentRecords',affected,'unresolvedLinkCount',unresolved,
  'catalogueUses',(select coalesce(jsonb_agg(jsonb_build_object('moduleId',c.module_id,'release',c.release,'entryId',c.entry_id,'title',c.title,'current',c.release=m.current_release,
   'manifestSha256',a.manifest_sha256,'sources',(select jsonb_agg(x order by x->>'path',x->>'role') from jsonb_array_elements(a.payload->'sources') x where x->>'sha256'=f->>'sha256')) order by c.release,c.entry_id),'[]'::jsonb)
   from private.catalogue_authored_forms a join private.catalogue_form_bindings b on (b.module_id,b.release,b.entry_id,b.manifest_sha256)=(a.module_id,a.release,a.entry_id,a.manifest_sha256)
   join public.catalogue_summaries c on (c.module_id,c.release,c.entry_id)=(a.module_id,a.release,a.entry_id) join public.curriculum_modules m on m.id=c.module_id
   where a.module_id=s.module_id and (a.payload->'sources') @> jsonb_build_array(jsonb_build_object('sha256',f->>'sha256'))),
  'formItems',(select coalesce(jsonb_agg(jsonb_build_object('moduleId',c.module_id,'release',c.release,'entryId',c.entry_id,'title',c.title,'current',c.release=m.current_release) order by c.release),'[]'::jsonb)
   from public.catalogue_summaries c join public.curriculum_modules m on m.id=c.module_id where c.module_id=s.module_id and c.entry_id=form_entry),
  'orders',jsonb_build_object(
   'pinningSourceBytes',(select count(*) from private.paper_orders o where o.module_id=s.module_id and o.snapshot->>'schema'='reviseit/frozen-authored-inputs@1'
    and o.snapshot @> jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('binding',jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('sha256',f->>'sha256'))))))),
   'containingFormItem',(select count(*) from private.paper_orders o where o.module_id=s.module_id and form_entry is not null and o.snapshot->>'schema'='reviseit/frozen-authored-inputs@1'
    and o.snapshot @> jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('entryId',form_entry)))),
   'unrecognisedSnapshots',(select count(*) from private.paper_orders o where o.module_id=s.module_id and o.snapshot->>'schema' is distinct from 'reviseit/frozen-authored-inputs@1')),
  'coverage',jsonb_build_object('currentCatalogueItems',(select count(*) from public.catalogue_summaries c join public.curriculum_modules m on m.id=c.module_id and m.current_release=c.release where c.module_id=s.module_id),
   'currentItemsWithoutBindings',(select count(*) from public.catalogue_summaries c join public.curriculum_modules m on m.id=c.module_id and m.current_release=c.release
    where c.module_id=s.module_id and not exists(select 1 from private.catalogue_form_bindings b join private.catalogue_authored_forms a on (a.module_id,a.release,a.entry_id,a.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256) where (b.module_id,b.release,b.entry_id)=(c.module_id,c.release,c.entry_id)))));
end $$;
revoke all on function public.studio_file_impact_view(uuid,text,text,uuid,integer) from public,anon,service_role;
grant execute on function public.studio_file_impact_view(uuid,text,text,uuid,integer) to authenticated;
