-- Preserve every approval, receipt, registration and order. Only compare final availability
-- with the exact reviewed rehearsal instead of requiring every catalogue entry to be on sale.
create or replace function public.studio_activate_release(p_candidate uuid,p_approval uuid,p_expected_release text,p_expected_activation uuid,p_kind text,p_reason text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();c private.studio_release_candidates;p private.studio_release_preparations;w private.studio_release_worker_receipts;
 current_version text;last_id uuid;activation uuid;r jsonb;n integer;res jsonb;req jsonb:=jsonb_build_array(p_candidate,p_approval,p_expected_release,p_expected_activation,p_kind,p_reason);
begin
 res:=private.studio_replay(me::text,p_command,'activate_release',req);if res is not null then return res;end if;
 select * into c from private.studio_release_candidates where id=p_candidate;
 perform pg_advisory_xact_lock(hashtextextended(c.module_id,0));
 perform 1 from private.studio_modules where module_id=c.module_id for update;
 select current_release into current_version from public.curriculum_modules where id=c.module_id for update;
 select id into last_id from private.studio_release_activations where module_id=c.module_id order by sequence desc limit 1;
 if c.id is null or current_version is distinct from p_expected_release or last_id is distinct from p_expected_activation then raise exception 'Catalogue activation changed; refresh';end if;
 if p_approval is null or private.studio_release_approval(c.id) is distinct from p_approval or not private.studio_candidate_integrity(c) then raise exception 'Current approval and intact package required';end if;
 if p_kind is null or p_kind not in ('publish','rollback','confirm_current') or p_reason is null or length(btrim(p_reason)) not between 10 and 2000 then raise exception 'Activation kind and reason required';end if;
 select * into p from private.studio_release_preparations where id=c.preparation_id;
 if p_kind='rollback' then
  if c.release=current_version or not exists(select 1 from private.studio_release_activations where candidate_id=c.id) then raise exception 'Rollback needs a previously activated retained release';end if;
 elsif not private.studio_release_preparation_current(p) or (p_kind='publish' and c.release=current_version) or (p_kind='confirm_current' and c.release<>current_version) then raise exception 'Package superseded or wrong activation kind';end if;
 select * into w from private.studio_release_worker_receipts where candidate_id=c.id and approval_id=p_approval and report_sha256=c.report_sha256 and checked_at>now()-interval '2 minutes' order by checked_at desc limit 1;
 if w.candidate_id is null then raise exception 'Fresh teacher worker confirmation required';end if;
 if p_kind='publish' then
  if exists(select 1 from private.catalogue_published_releases where module_id=c.module_id and release=c.release) then raise exception 'Use rollback for an existing release';end if;
  perform public.publish_catalogue_release(c.publication,current_version);
  for r in select value from jsonb_array_elements(c.registrations) loop perform public.register_catalogue_authored_form(r->'registration');end loop;
  perform public.register_catalogue_execution(c.module_id,c.release,c.bundle_sha256,c.workflow_sha256);
  for r in select value from jsonb_array_elements(c.registrations) loop
   perform public.register_bloom_classification(c.module_id,c.release,r->>'entryId',r->>'sha256',r->'envelope',r->'binding',r->'bundleSources',r->>'catalogueContentDigest');
  end loop;
 else
  -- Never rebind an old release. Verify its immutable platform definitions instead.
  if not exists(select 1 from private.catalogue_published_releases where module_id=c.module_id and release=c.release and payload=c.publication) then raise exception 'Published catalogue differs from retained package';end if;
  for r in select value from jsonb_array_elements(c.registrations) loop
   if not exists(select 1 from private.catalogue_authored_forms f join private.catalogue_form_bindings b on (b.module_id,b.release,b.entry_id,b.manifest_sha256)=(f.module_id,f.release,f.entry_id,f.manifest_sha256)
    where f.module_id=c.module_id and f.release=c.release and f.entry_id=r->>'entryId' and f.payload=r->'registration')
   or not exists(select 1 from private.catalogue_classifications x join private.catalogue_classification_bindings b on (b.module_id,b.release,b.entry_id,b.sha256)=(x.module_id,x.release,x.entry_id,x.sha256)
    where x.module_id=c.module_id and x.release=c.release and x.entry_id=r->>'entryId' and x.payload=r->'envelope' and x.source_binding=r->'binding' and x.sha256=r->>'sha256')
   or not exists(select 1 from private.catalogue_executions where module_id=c.module_id and release=c.release and manifest_sha256=c.bundle_sha256 and workflow_sha256=c.workflow_sha256) then raise exception 'Published definitions differ from retained package';end if;
  end loop;
  update public.curriculum_modules set current_release=c.release where id=c.module_id;
 end if;
 n:=public.sync_supported_catalogue_readiness(c.module_id);
 -- The immutable, human-approved rehearsal pins availability by item identity.
 -- Existing exclusions remain unavailable; any additional or removed exclusion is drift.
 if p.report->'rehearsal' ? 'orderable' or p.report->'rehearsal' ? 'unavailable' then
  if jsonb_typeof(p.report->'rehearsal'->'orderable') is distinct from 'array'
   or jsonb_typeof(p.report->'rehearsal'->'unavailable') is distinct from 'array' then
   raise exception 'Approved availability inventory is incomplete';end if;
  if n<1 or n<>jsonb_array_length(p.report->'rehearsal'->'orderable')
   or (select coalesce(jsonb_agg(e order by e::text),'[]') from jsonb_array_elements(p.report->'rehearsal'->'orderable') e)
      is distinct from (select coalesce(jsonb_agg(to_jsonb(r.entry_id) order by to_jsonb(r.entry_id)::text),'[]') from public.catalogue_ordering_readiness r where r.module_id=c.module_id and r.release=c.release and r.orderable)
   or (select coalesce(jsonb_agg(e order by e::text),'[]') from jsonb_array_elements(p.report->'rehearsal'->'unavailable') e)
      is distinct from (select coalesce(jsonb_agg(to_jsonb(r.entry_id) order by to_jsonb(r.entry_id)::text),'[]') from public.catalogue_ordering_readiness r where r.module_id=c.module_id and r.release=c.release and not r.orderable)
   or (select coalesce(jsonb_agg(e order by e::text),'[]') from jsonb_array_elements((p.report->'rehearsal'->'orderable')||(p.report->'rehearsal'->'unavailable')) e)
      is distinct from (select coalesce(jsonb_agg(e->'id' order by (e->'id')::text),'[]') from jsonb_array_elements(c.publication->'entries') e)
   then raise exception 'Release availability differs from approved rehearsal';end if;
 elsif n<>jsonb_array_length(c.publication->'entries') then
  -- Retained historical reports without an inventory keep the stricter old rule.
  raise exception 'Release contains unavailable items';
 end if;
 insert into private.studio_release_activations(module_id,candidate_id,approval_id,previous_release,release,kind,actor,reason,worker,worker_checked_at)
 values(c.module_id,c.id,p_approval,current_version,c.release,p_kind,me,p_reason,w.worker,w.checked_at) returning id into activation;
 perform private.studio_event(c.module_id,null,'editor',me::text,'catalogue_'||p_kind,jsonb_build_object('activationId',activation,'candidateId',c.id,'previousRelease',current_version,'release',c.release));
 res:=jsonb_build_object('activationId',activation,'release',c.release,'orderable',n);return private.studio_remember(me::text,p_command,'activate_release',req,res);
end $$;

