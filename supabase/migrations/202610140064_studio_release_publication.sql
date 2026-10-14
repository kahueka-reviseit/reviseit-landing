-- Human decisions, worker readiness and activation are separate durable facts.
create table private.studio_release_candidates (
 id uuid primary key default gen_random_uuid(), preparation_id uuid not null unique references private.studio_release_preparations(id),
 module_id text not null references private.studio_modules(module_id), release text not null,
 report_sha256 text not null, publication jsonb not null, registrations jsonb not null,
 bundle_sha256 text not null, workflow_sha256 text not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(module_id,release)
);
create table private.studio_release_reviews (
 id uuid primary key default gen_random_uuid(), candidate_id uuid not null references private.studio_release_candidates(id),
 decision text not null check(decision in ('approved','revoked')), reason text not null check(length(btrim(reason)) between 10 and 2000),
 actor uuid not null references auth.users(id), created_at timestamptz not null default now(), sequence bigint generated always as identity unique
);
create table private.studio_release_worker_receipts (
 candidate_id uuid not null references private.studio_release_candidates(id), worker text not null,
 approval_id uuid not null references private.studio_release_reviews(id), report_sha256 text not null,
 checked_at timestamptz not null default now(), primary key(candidate_id,worker)
);
create table private.studio_release_activations (
 id uuid primary key default gen_random_uuid(), module_id text not null references private.studio_modules(module_id),
 candidate_id uuid not null references private.studio_release_candidates(id), approval_id uuid not null references private.studio_release_reviews(id),
 previous_release text, release text not null, kind text not null check(kind in ('publish','rollback','confirm_current')),
 actor uuid not null references auth.users(id), reason text not null, worker text not null, worker_checked_at timestamptz not null,
 created_at timestamptz not null default now(), sequence bigint generated always as identity unique
);
alter table private.studio_release_candidates enable row level security;
alter table private.studio_release_reviews enable row level security;
alter table private.studio_release_worker_receipts enable row level security;
alter table private.studio_release_activations enable row level security;
revoke all on private.studio_release_candidates,private.studio_release_reviews,private.studio_release_worker_receipts,private.studio_release_activations from public,anon,authenticated,service_role,reviseit_studio_operator;
create trigger studio_immutable before update or delete on private.studio_release_candidates for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_release_reviews for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_release_activations for each row execute function private.studio_immutable();

create function private.studio_candidate_integrity(c private.studio_release_candidates) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.studio_release_preparations p join private.studio_blobs b on b.id=p.report_blob_id
 where p.id=c.preparation_id and p.state='checked' and b.sha256=c.report_sha256 and b.integrity='verified')
 and not exists(select 1 from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id where f.preparation_id=c.preparation_id and b.integrity<>'verified');
$$;
create function private.studio_release_approval(p_candidate uuid) returns uuid language sql stable set search_path='' as $$
 select case when decision='approved' then id end from private.studio_release_reviews where candidate_id=p_candidate order by sequence desc limit 1;
$$;
-- Raw UTF-8 bytes must hash to the immutable objects already verified in R2.
create function public.studio_stage_release(p_preparation uuid,p_report_sha256 text,p_publication text,p_registrations text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); p private.studio_release_preparations;c private.studio_release_candidates;
 pub jsonb;regs jsonb;r jsonb;bh text;wh text;req jsonb:=jsonb_build_array(p_preparation,p_report_sha256,private.studio_sha(p_publication),private.studio_sha(p_registrations));res jsonb;
begin
 res:=private.studio_replay(me::text,p_command,'stage_release',req);if res is not null then return res;end if;
 select * into p from private.studio_release_preparations where id=p_preparation;
 perform 1 from private.studio_modules where module_id=p.module_id for update;
 if p.id is null or p.state<>'checked' or not private.studio_release_preparation_current(p) or not exists(select 1 from private.studio_blobs where id=p.report_blob_id and sha256=p_report_sha256) then raise exception 'Checked current package required';end if;
 if not exists(select 1 from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id where f.preparation_id=p.id and f.path='export/public/'||p.module_id||'/publication-input.json' and b.sha256=private.studio_sha(p_publication))
 or not exists(select 1 from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id where f.preparation_id=p.id and f.path='registrations/verified-bindings.json' and b.sha256=private.studio_sha(p_registrations)) then raise exception 'Retained package bytes differ';end if;
 pub:=p_publication::jsonb;regs:=p_registrations::jsonb->'classifications';
 if not private.valid_catalogue_release(pub) or pub->'module'->>'id' is distinct from p.module_id or pub->>'release' is distinct from p.report->>'release'
 or jsonb_typeof(regs) is distinct from 'array' or jsonb_array_length(regs)<>jsonb_array_length(pub->'entries')
 or (select count(distinct x->>'entryId') from jsonb_array_elements(regs) x)<>jsonb_array_length(regs)
 then raise exception 'Complete exact release definitions required';end if;
 bh:=regs->0->'binding'->>'privateManifestSha256';wh:=regs->0->'binding'->>'workflowManifestSha256';
 if bh is null or wh is null or bh!~'^[a-f0-9]{64}$' or wh!~'^[a-f0-9]{64}$' then raise exception 'Exact worker manifests required';end if;
 if not exists(select 1 from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id where f.preparation_id=p.id and f.path='export/private/'||p.module_id||'/bundle-manifest.json' and b.sha256=bh) or not exists(select 1 from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id where f.preparation_id=p.id and f.path='bundle/'||p.module_id||'/manifest.json' and b.sha256=wh) then raise exception 'Worker manifests differ from package';end if;
 for r in select value from jsonb_array_elements(regs) loop
  if r->>'module' is distinct from p.module_id or r->>'release' is distinct from pub->>'release' or r->>'catalogueContentDigest' is distinct from pub->>'contentDigest'
  or r->'binding'->>'privateManifestSha256' is distinct from bh or r->'binding'->>'workflowManifestSha256' is distinct from wh
  or not exists(select 1 from jsonb_array_elements(pub->'entries') e where e->>'id'=r->>'entryId') then raise exception 'Release binding mismatch';end if;
 end loop;
 if exists(select 1 from private.catalogue_published_releases x where x.module_id=p.module_id and x.release=pub->>'release' and x.payload<>pub)
 or (exists(select 1 from public.catalogue_summaries where module_id=p.module_id and release=pub->>'release') and not exists(select 1 from private.catalogue_published_releases where module_id=p.module_id and release=pub->>'release' and payload=pub)) then raise exception 'Release name is already used by different bytes';end if;
 select * into c from private.studio_release_candidates where module_id=p.module_id and release=pub->>'release';
 if c.id is not null then
  if c.preparation_id<>p.id then raise exception 'Release name reserved; prepare a new version';end if;
 else
  insert into private.studio_release_candidates(preparation_id,module_id,release,report_sha256,publication,registrations,bundle_sha256,workflow_sha256,created_by)
  values(p.id,p.module_id,pub->>'release',p_report_sha256,pub,regs,bh,wh,me) returning * into c;
 end if;
 res:=jsonb_build_object('candidateId',c.id);return private.studio_remember(me::text,p_command,'stage_release',req,res);
end $$;

create function public.studio_review_release(p_candidate uuid,p_report_sha256 text,p_decision text,p_reason text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();c private.studio_release_candidates;p private.studio_release_preparations;rid uuid;res jsonb;req jsonb:=jsonb_build_array(p_candidate,p_report_sha256,p_decision,p_reason);begin
 res:=private.studio_replay(me::text,p_command,'review_release',req);if res is not null then return res;end if;
 select * into c from private.studio_release_candidates where id=p_candidate;
 perform 1 from private.studio_modules where module_id=c.module_id for update;
 select * into p from private.studio_release_preparations where id=c.preparation_id;
 if c.id is null or c.report_sha256 is distinct from p_report_sha256 or p_decision not in ('approved','revoked') or length(btrim(p_reason)) not between 10 and 2000 then raise exception 'Exact package and review reason required';end if;
 if p_decision='approved' and (not private.studio_candidate_integrity(c) or (not private.studio_release_preparation_current(p) and not exists(select 1 from private.studio_release_activations where candidate_id=c.id))) then raise exception 'Package superseded or integrity blocked';end if;
 insert into private.studio_release_reviews(candidate_id,decision,reason,actor) values(c.id,p_decision,p_reason,me) returning id into rid;
 perform private.studio_event(c.module_id,null,'editor',me::text,'release_'||p_decision,jsonb_build_object('candidateId',c.id,'reportSha256',c.report_sha256,'reviewId',rid));
 res:=jsonb_build_object('reviewId',rid);return private.studio_remember(me::text,p_command,'review_release',req,res);
end $$;

-- Only the teacher worker gateway can list/confirm bundles. It cannot approve or publish.
create function public.studio_release_worker_queue() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'moduleId',c.module_id,'release',c.release,'reportSha256',c.report_sha256,'approvalId',private.studio_release_approval(c.id),
 'bundleSha256',c.bundle_sha256,'workflowSha256',c.workflow_sha256,
 'files',(select jsonb_agg(jsonb_build_object('path',f.path,'sha256',b.sha256,'size',b.size_bytes) order by f.path) from private.studio_release_preparation_files f join private.studio_blobs b on b.id=f.blob_id
 where f.preparation_id=c.preparation_id and (f.path like 'export/private/'||c.module_id||'/%' or f.path like 'bundle/'||c.module_id||'/%'))) order by c.created_at),'[]')
 from private.studio_release_candidates c join private.studio_release_preparations p on p.id=c.preparation_id
 where private.studio_release_approval(c.id) is not null and private.studio_candidate_integrity(c)
 and (private.studio_release_preparation_current(p) or exists(select 1 from private.studio_release_activations where candidate_id=c.id));
$$;
create function public.studio_release_worker_file(p_candidate uuid,p_path text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c private.studio_release_candidates;b private.studio_blobs;begin
 select * into c from private.studio_release_candidates where id=p_candidate;
 if c.id is null or private.studio_release_approval(c.id) is null or not private.studio_candidate_integrity(c)
 or not (p_path like 'export/private/'||c.module_id||'/%' or p_path like 'bundle/'||c.module_id||'/%') then raise exception 'Approved worker package required';end if;
 select b1.* into b from private.studio_release_preparation_files f join private.studio_blobs b1 on b1.id=f.blob_id where f.preparation_id=c.preparation_id and f.path=p_path;
 if b.id is null then raise exception 'Package file not found';end if;
 return jsonb_build_object('key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes);
end $$;
create function public.studio_confirm_release_worker(p_candidate uuid,p_approval uuid,p_report_sha256 text,p_bundle text,p_workflow text,p_worker text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_release_candidates;begin
 select * into c from private.studio_release_candidates where id=p_candidate;
 perform 1 from private.studio_modules where module_id=c.module_id for update;
 if c.id is null or p_approval is null or private.studio_release_approval(c.id) is distinct from p_approval or c.report_sha256 is distinct from p_report_sha256
 or c.bundle_sha256 is distinct from p_bundle or c.workflow_sha256 is distinct from p_workflow or not private.studio_candidate_integrity(c)
 or p_worker is null or p_worker!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' then raise exception 'Worker confirmation is not current';end if;
 insert into private.studio_release_worker_receipts(candidate_id,worker,approval_id,report_sha256) values(c.id,p_worker,p_approval,p_report_sha256)
 on conflict(candidate_id,worker) do update set approval_id=excluded.approval_id,report_sha256=excluded.report_sha256,checked_at=now();
 return jsonb_build_object('confirmed',true);
end $$;

create function public.studio_activate_release(p_candidate uuid,p_approval uuid,p_expected_release text,p_expected_activation uuid,p_kind text,p_reason text,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if n<>jsonb_array_length(c.publication->'entries') then raise exception 'Release contains unavailable items';end if;
 insert into private.studio_release_activations(module_id,candidate_id,approval_id,previous_release,release,kind,actor,reason,worker,worker_checked_at)
 values(c.module_id,c.id,p_approval,current_version,c.release,p_kind,me,p_reason,w.worker,w.checked_at) returning id into activation;
 perform private.studio_event(c.module_id,null,'editor',me::text,'catalogue_'||p_kind,jsonb_build_object('activationId',activation,'candidateId',c.id,'previousRelease',current_version,'release',c.release));
 res:=jsonb_build_object('activationId',activation,'release',c.release,'orderable',n);return private.studio_remember(me::text,p_command,'activate_release',req,res);
end $$;

create function public.studio_release_publication_view(p_module text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();begin return jsonb_build_object('candidates',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',c.id,'preparationId',c.preparation_id,'moduleId',c.module_id,'release',c.release,'reportSha256',c.report_sha256,'intact',private.studio_candidate_integrity(c),
 'inputsCurrent',private.studio_release_preparation_current(p),'currentRelease',m.current_release,'approvalId',private.studio_release_approval(c.id),
 'lastActivationId',(select id from private.studio_release_activations where module_id=c.module_id order by sequence desc limit 1),
 'previouslyActivated',exists(select 1 from private.studio_release_activations where candidate_id=c.id),
 'worker',(select jsonb_build_object('name',w.worker,'checkedAt',w.checked_at,'fresh',w.checked_at>now()-interval '2 minutes') from private.studio_release_worker_receipts w where w.candidate_id=c.id and w.approval_id=private.studio_release_approval(c.id) order by w.checked_at desc limit 1),
 'reviews',(select coalesce(jsonb_agg(jsonb_build_object('decision',r.decision,'reason',r.reason,'actor',r.actor,'at',r.created_at) order by r.sequence desc),'[]') from private.studio_release_reviews r where r.candidate_id=c.id)
 ) order by c.created_at desc),'[]') from private.studio_release_candidates c join private.studio_release_preparations p on p.id=c.preparation_id join public.curriculum_modules m on m.id=c.module_id where p_module is null or c.module_id=p_module),
 'activations',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'moduleId',a.module_id,'candidateId',a.candidate_id,'from',a.previous_release,'to',a.release,'kind',a.kind,'actor',a.actor,'reason',a.reason,'at',a.created_at,'worker',a.worker) order by a.sequence desc),'[]') from private.studio_release_activations a where p_module is null or a.module_id=p_module));end $$;

revoke all on function private.studio_candidate_integrity(private.studio_release_candidates),private.studio_release_approval(uuid) from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function public.studio_stage_release(uuid,text,text,text,uuid),public.studio_review_release(uuid,text,text,text,uuid),public.studio_activate_release(uuid,uuid,text,uuid,text,text,uuid),public.studio_release_publication_view(text) from public,anon,service_role,reviseit_studio_operator;
grant execute on function public.studio_stage_release(uuid,text,text,text,uuid),public.studio_review_release(uuid,text,text,text,uuid),public.studio_activate_release(uuid,uuid,text,uuid,text,text,uuid),public.studio_release_publication_view(text) to authenticated;
revoke all on function public.studio_release_worker_queue(),public.studio_release_worker_file(uuid,text),public.studio_confirm_release_worker(uuid,uuid,text,text,text,text) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_release_worker_queue(),public.studio_release_worker_file(uuid,text),public.studio_confirm_release_worker(uuid,uuid,text,text,text,text) to service_role;
