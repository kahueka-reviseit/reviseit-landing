begin;

-- Compiled authored fields stay private. A new manifest creates a new record;
-- existing orders retain their exact copy independently of current readiness.
create table private.catalogue_authored_forms (
 module_id text not null, release text not null, entry_id text not null,
 manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb not null, registered_at timestamptz not null default now(),
 primary key(module_id,release,entry_id,manifest_sha256),
 foreign key(module_id,release,entry_id) references public.catalogue_summaries(module_id,release,entry_id)
);
alter table private.catalogue_authored_forms enable row level security;
revoke all on private.catalogue_authored_forms from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
alter table private.catalogue_form_bindings add column manifest_sha256 text;

create function private.freeze_authored_form() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Registered authored form is immutable'; end $$;
create trigger freeze_authored_form before update or delete on private.catalogue_authored_forms
for each row execute function private.freeze_authored_form();

create function public.register_catalogue_authored_form(p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare shared jsonb; source jsonb; prior jsonb; k text;
begin
 if not private.form_keys(p,array['module','release','entryId','kind','canonicalId','formRevision','bundleDigest','manifestSha256','sharedFormsSha256','fields','shared','sources','explicitlyNoInput'])
  or octet_length(p::text)>100000 or p->>'kind' not in ('specification','multiple-choice')
  or p->>'entryId' is distinct from (case when p->>'kind'='specification' then 'structured:' else 'mcq:' end)||(p->>'canonicalId')
  or not private.valid_questionnaire_fields(p->'fields',30)
  or jsonb_typeof(p->'explicitlyNoInput') is distinct from 'boolean'
  or (p->>'explicitlyNoInput')::boolean is distinct from (jsonb_array_length(p->'fields')=0)
  or not private.form_keys(p->'shared',array['paper-logistics','multiple-choice-block'])
  or jsonb_typeof(p->'sources') is distinct from 'array' then raise exception 'Invalid authored form registration'; end if;
 foreach k in array array['formRevision','bundleDigest','manifestSha256','sharedFormsSha256'] loop
  if not private.form_text(p->k,64) or p->>k !~ '^[a-f0-9]{64}$' then raise exception 'Invalid binding digest'; end if;
 end loop;
 for shared in select value from jsonb_each(p->'shared') loop
  if not private.form_keys(shared,array['revision','fields']) or shared->>'revision' !~ '^[a-f0-9]{64}$'
   or not private.valid_questionnaire_fields(shared->'fields',20) then raise exception 'Invalid shared form'; end if;
 end loop;
 if jsonb_array_length(p->'sources') not between 1 and 100 then raise exception 'Source bindings required'; end if;
 for source in select value from jsonb_array_elements(p->'sources') loop
  if not private.form_keys(source,array['role','path','sha256']) or source->>'role' not in ('specification','task-type')
   or source->>'sha256' !~ '^[a-f0-9]{64}$' or not private.form_text(source->'path',500)
   or source->>'path' ~ '(^/|(^|/)\.\.(/|$)|\\)' then raise exception 'Invalid private source reference'; end if;
 end loop;
 select payload into prior from private.catalogue_authored_forms where module_id=p->>'module' and release=p->>'release' and entry_id=p->>'entryId' and manifest_sha256=p->>'manifestSha256';
 if found and prior<>p then raise exception 'Registered authored form is immutable'; end if;
 insert into private.catalogue_authored_forms(module_id,release,entry_id,manifest_sha256,payload)
 values(p->>'module',p->>'release',p->>'entryId',p->>'manifestSha256',p) on conflict do nothing;
 -- Registration deliberately leaves execution disabled. Readiness must be
 -- enabled separately only after the matching execution path is connected.
 perform public.set_catalogue_form_binding(p->>'module',p->>'release',p->>'entryId',p->>'formRevision',p->>'bundleDigest',p->>'sharedFormsSha256',false);
 update private.catalogue_form_bindings set manifest_sha256=p->>'manifestSha256'
 where module_id=p->>'module' and release=p->>'release' and entry_id=p->>'entryId';
end $$;
revoke all on function public.register_catalogue_authored_form(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.register_catalogue_authored_form(jsonb) to reviseit_catalogue_publisher;

-- Guard future readiness changes against a digest-only or obsolete binding.
create function private.check_registered_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.orderable and not exists (
  select 1 from private.catalogue_form_bindings b join private.catalogue_authored_forms f
   on (f.module_id,f.release,f.entry_id,f.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256)
  where (b.module_id,b.release,b.entry_id)=(new.module_id,new.release,new.entry_id)
   and f.payload->>'formRevision'=b.form_revision and f.payload->>'bundleDigest'=b.private_bundle_sha256
   and f.payload->>'sharedFormsSha256'=b.shared_forms_sha256
 ) then raise exception 'Registered private form required before enabling'; end if;
 return new;
end $$;
create trigger check_registered_binding before insert or update on public.catalogue_ordering_readiness
for each row execute function private.check_registered_binding();

create function private.freeze_catalogue_order_inputs() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.snapshot->>'schema'='reviseit/frozen-authored-inputs@1' and
  (new.form,new.snapshot,new.module_id,new.release,new.teacher_id,new.school_id,new.entitlement,new.adapter_key)
  is distinct from (old.form,old.snapshot,old.module_id,old.release,old.teacher_id,old.school_id,old.entitlement,old.adapter_key)
 then raise exception 'Issued catalogue order inputs are immutable'; end if;
 return new;
end $$;
create trigger freeze_catalogue_order_inputs before update on private.paper_orders
for each row execute function private.freeze_catalogue_order_inputs();

-- This is an operator-only internal entitlement, never a browser checkout or
-- a simulated payment. It consumes the saved selection and current bindings.
create function public.provision_catalogue_internal_order(
 target uuid,target_teacher uuid,target_module text,selection_revision integer,
 allocations jsonb,expected_manifests jsonb,target_worker text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare s uuid; sel public.paper_selections; entry text; c public.catalogue_summaries;
 b private.catalogue_form_bindings; p jsonb; common jsonb; shared jsonb; form jsonb; snap jsonb;
 items jsonb:='[]'; lines jsonb:='[]'; scopes jsonb:='["paper-logistics"]';
 has_mcq boolean:=false; n integer:=0; marks integer; rev text; existing private.paper_orders;
begin
 if target is null or target_worker is null or target_worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Internal order identity and worker required'; end if;
 select * into existing from private.paper_orders where id=target;
 if found then raise exception 'Internal order already exists; inspect existing identity'; end if;
 select a.school_id into s from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=target_teacher and a.status='approved' and u.email_confirmed_at is not null and lower(a.email)=lower(u.email);
 if s is null or not exists(select 1 from public.school_curriculum_access where school_id=s and module_id=target_module and active) then raise exception 'Approved curriculum access required'; end if;
 select * into sel from public.paper_selections where user_id=target_teacher and school_id=s and module_id=target_module for share;
 if not found or sel.revision<>selection_revision or cardinality(sel.entry_ids)=0
  or sel.release is distinct from (select current_release from public.curriculum_modules where id=target_module)
 then raise exception 'Saved selection changed or empty'; end if;
 if not private.form_keys(allocations,sel.entry_ids) or not private.form_keys(expected_manifests,sel.entry_ids) then raise exception 'Exact selection allocations and revisions required'; end if;
 foreach entry in array sel.entry_ids loop
  select * into b from private.catalogue_form_bindings where module_id=target_module and release=sel.release and entry_id=entry for share;
  if not found or b.manifest_sha256 is distinct from expected_manifests->>entry
   or not exists(select 1 from public.catalogue_ordering_readiness where module_id=target_module and release=sel.release and entry_id=entry and orderable)
  then raise exception 'Selected form changed or execution unavailable'; end if;
  select payload into p from private.catalogue_authored_forms where module_id=target_module and release=sel.release and entry_id=entry and manifest_sha256=b.manifest_sha256;
  if p is null or p->>'formRevision'<>b.form_revision or p->>'bundleDigest'<>b.private_bundle_sha256 or p->>'sharedFormsSha256'<>b.shared_forms_sha256 then raise exception 'Unbound private form'; end if;
  if common is null then common:=p->'shared'; elsif common<>p->'shared' then raise exception 'Shared forms disagree'; end if;
  select * into c from public.catalogue_summaries where module_id=target_module and release=sel.release and entry_id=entry;
  if jsonb_typeof(allocations->entry) is distinct from 'number' or (allocations->>entry)::numeric<>trunc((allocations->>entry)::numeric)
   or (allocations->>entry)::numeric not between c.marks_min and c.marks_max then raise exception 'Marks outside selected range'; end if;
  marks:=(allocations->>entry)::integer; n:=n+1;
  items:=items||jsonb_build_array(jsonb_build_object('id','q'||n,'title',c.title,'marks',marks,'fields',p->'fields'));
  lines:=lines||jsonb_build_array(jsonb_build_object('id','q'||n,'entryId',entry,'marks',marks,'binding',p));
  has_mcq:=has_mcq or p->>'kind'='multiple-choice';
 end loop;
 shared:=common->'paper-logistics'->'fields';
 if has_mcq then shared:=shared||(common->'multiple-choice-block'->'fields');scopes:=scopes||'"multiple-choice-block"'::jsonb;end if;
 snap:=jsonb_build_object('schema','reviseit/frozen-authored-inputs@1','module',target_module,'release',sel.release,
  'catalogueDigest',(select payload->>'contentDigest' from private.catalogue_published_releases where module_id=target_module and release=sel.release),
  'lines',lines,'sharedScopes',scopes,'manifestSha256',lines->0->'binding'->>'manifestSha256');
 -- Mixing bundles in one release is refused; a form refresh is a new full bundle.
 if exists(select 1 from jsonb_array_elements(lines) l where l->'binding'->'manifestSha256' is distinct from snap->'manifestSha256') then raise exception 'Selected bundles disagree'; end if;
 rev:=encode(sha256(convert_to(jsonb_build_object('source',snap,'items',items,'paperFields',shared)::text,'UTF8')),'hex');
 form:=jsonb_build_object('schemaVersion',2,'revision',rev,'items',items,'paperFields',shared);
 if not private.valid_questionnaire(form) then raise exception 'Compiled form exceeds questionnaire limits'; end if;
 insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot,worker_id)
 values(target,target_teacher,s,target_module,sel.release,'Internal catalogue paper','internal_test','authored-bundle-v1',form,snap||jsonb_build_object('formRevision',rev),target_worker);
 return target;
end $$;
revoke all on function public.provision_catalogue_internal_order(uuid,uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated,reviseit_catalogue_publisher;
grant execute on function public.provision_catalogue_internal_order(uuid,uuid,text,integer,jsonb,jsonb,text) to service_role;
revoke all on function private.freeze_authored_form(),private.check_registered_binding(),private.freeze_catalogue_order_inputs() from public,anon,authenticated;
commit;
