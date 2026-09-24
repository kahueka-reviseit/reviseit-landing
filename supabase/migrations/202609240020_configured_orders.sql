begin;

-- CFG01: editable configuration for new paid orders. Additive only.
-- Existing authored-bundle-v1 orders, their frozen forms/snapshots, payments,
-- events, documents and the checkout that creates them are unchanged. A new
-- configured order pins its definitions at checkout, keeps every accepted
-- configuration revision, and freezes one generation plan at submission.
-- Nothing here is enabled until an operator turns the configurator on.

-- One operator switch. Off keeps the migration-019 checkout as the only path.
create table private.configurator_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 note text not null check(length(trim(note)) between 3 and 500),
 updated_at timestamptz not null default now()
);
create table private.configurator_setting_changes (
 id bigint generated always as identity primary key, enabled boolean not null, note text not null,
 changed_by text not null default session_user, changed_at timestamptz not null default now()
);
alter table private.configurator_settings enable row level security;
alter table private.configurator_setting_changes enable row level security;
revoke all on private.configurator_settings,private.configurator_setting_changes from public,anon,authenticated,service_role,reviseit_catalogue_publisher;

create function public.configure_configurator(target_enabled boolean,change_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if target_enabled is null or change_note is null then raise exception 'Complete configurator settings required'; end if;
 insert into private.configurator_settings(singleton,enabled,note) values(true,target_enabled,trim(change_note))
 on conflict(singleton) do update set enabled=excluded.enabled,note=excluded.note,updated_at=now();
 insert into private.configurator_setting_changes(enabled,note) values(target_enabled,trim(change_note));
end $$;

create function private.configurator_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.configurator_settings where singleton),false);
$$;

-- Teacher view: whether new checkouts use the editable configuration path.
create function public.configurator_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',public.approved_school_id() is not null and private.configurator_enabled());
$$;

-- Private classification definitions and curriculum requirement profiles.
-- Immutable by content hash. The envelope's detailed validation belongs to
-- the server consumer of the producer's contract; the database checks identity,
-- bounds and hashes, and never exposes a payload to a browser role.
create table private.catalogue_classifications (
 module_id text not null, release text not null, entry_id text not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 schema_version integer not null check(schema_version=1),
 requirements_ref text check(requirements_ref is null or length(requirements_ref) between 1 and 200),
 payload jsonb not null check(octet_length(payload::text)<=200000),
 registered_at timestamptz not null default now(),
 primary key(module_id,release,entry_id,sha256),
 foreign key(module_id,release,entry_id) references public.catalogue_summaries(module_id,release,entry_id)
);
create table private.curriculum_requirement_profiles (
 ref text not null check(length(ref) between 1 and 200),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb not null check(octet_length(payload::text)<=200000),
 registered_at timestamptz not null default now(),
 primary key(ref,sha256)
);
-- The current classification for future checkouts. Issued orders keep their copy.
create table private.catalogue_classification_bindings (
 module_id text not null, release text not null, entry_id text not null,
 sha256 text not null, requirements_sha256 text,
 bound_at timestamptz not null default now(),
 primary key(module_id,release,entry_id),
 foreign key(module_id,release,entry_id,sha256) references private.catalogue_classifications(module_id,release,entry_id,sha256)
);
alter table private.catalogue_classifications enable row level security;
alter table private.curriculum_requirement_profiles enable row level security;
alter table private.catalogue_classification_bindings enable row level security;
revoke all on private.catalogue_classifications,private.curriculum_requirement_profiles,private.catalogue_classification_bindings
 from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
create trigger freeze_catalogue_classification before update or delete on private.catalogue_classifications
for each row execute function private.freeze_authored_form();
create trigger freeze_requirement_profile before update or delete on private.curriculum_requirement_profiles
for each row execute function private.freeze_authored_form();

create function public.register_curriculum_requirements(target_ref text,target_sha256 text,profile jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 if target_ref is null or length(target_ref) not between 1 and 200 or target_sha256 !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(profile) is distinct from 'object' or octet_length(profile::text)>200000 then raise exception 'Invalid requirements profile'; end if;
 select payload into prior from private.curriculum_requirement_profiles where ref=target_ref and sha256=target_sha256;
 if found and prior<>profile then raise exception 'Requirements profile is immutable'; end if;
 insert into private.curriculum_requirement_profiles(ref,sha256,payload) values(target_ref,target_sha256,profile) on conflict do nothing;
end $$;

-- Registering or binding a classification never changes readiness. A
-- supported item without a classification remains orderable on marks alone.
create function public.register_catalogue_classification(target_module text,target_release text,target_entry text,target_sha256 text,envelope jsonb,target_requirements_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
declare prior jsonb; req_ref text; kind text; item text;
begin
 if target_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(envelope) is distinct from 'object' or octet_length(envelope::text)>200000
  or envelope->'schemaVersion' is distinct from '1'::jsonb then raise exception 'Invalid classification'; end if;
 kind:=case envelope->>'kind' when 'structured' then 'structured:' when 'multiple_choice' then 'mcq:' end;
 item:=envelope->>'itemId';
 if kind is null or envelope->>'moduleId' is distinct from target_module or envelope->>'release' is distinct from target_release
  or kind||item is distinct from target_entry then raise exception 'Classification identity mismatch'; end if;
 if not exists(select 1 from public.catalogue_summaries where module_id=target_module and release=target_release and entry_id=target_entry)
  then raise exception 'Unknown catalogue entry'; end if;
 -- Contract v1 references a profile as {profileId, version}; stored as profileId@version.
 if jsonb_typeof(envelope->'curriculumRequirementsRef')='object' then
  if not private.form_keys(envelope->'curriculumRequirementsRef',array['profileId','version']) or jsonb_typeof(envelope->'curriculumRequirementsRef'->'version')<>'number'
  then raise exception 'Invalid classification'; end if;
  req_ref:=(envelope->'curriculumRequirementsRef'->>'profileId')||'@'||(envelope->'curriculumRequirementsRef'->>'version');
 elsif envelope->'curriculumRequirementsRef' is not null and envelope->'curriculumRequirementsRef'<>'null'::jsonb then raise exception 'Invalid classification';
 end if;
 if req_ref is not null and (target_requirements_sha256 is null or not exists(select 1 from private.curriculum_requirement_profiles r where r.ref=req_ref and r.sha256=target_requirements_sha256))
  then raise exception 'Registered requirements profile required'; end if;
 select payload into prior from private.catalogue_classifications where module_id=target_module and release=target_release and entry_id=target_entry and sha256=target_sha256;
 if found and prior<>envelope then raise exception 'Registered classification is immutable'; end if;
 insert into private.catalogue_classifications(module_id,release,entry_id,sha256,schema_version,requirements_ref,payload)
 values(target_module,target_release,target_entry,target_sha256,1,req_ref,envelope) on conflict do nothing;
 insert into private.catalogue_classification_bindings(module_id,release,entry_id,sha256,requirements_sha256)
 values(target_module,target_release,target_entry,target_sha256,case when req_ref is null then null else target_requirements_sha256 end)
 on conflict(module_id,release,entry_id) do update set sha256=excluded.sha256,requirements_sha256=excluded.requirements_sha256,bound_at=now();
end $$;
revoke all on function public.register_curriculum_requirements(text,text,jsonb),
 public.register_catalogue_classification(text,text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.register_curriculum_requirements(text,text,jsonb),
 public.register_catalogue_classification(text,text,text,text,jsonb,text) to reviseit_catalogue_publisher;

-- The approved teacher, their school, a confirmed matching email and active
-- curriculum access: the same identity rule as checkout compilation, for
-- service-role functions that act for a teacher the server has authenticated.
create function private.teacher_order_access(o private.paper_orders,teacher uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(o.teacher_id=teacher and exists(select 1 from public.teacher_accounts a join auth.users u on u.id=a.user_id
  where a.user_id=teacher and a.status='approved' and a.school_id=o.school_id and a.department_id is not null
   and u.email_confirmed_at is not null and lower(a.email)=lower(u.email))
  and exists(select 1 from public.school_curriculum_access x where x.school_id=o.school_id and x.module_id=o.module_id and x.active),false);
$$;

-- Compile the definitions a configured order pins: the same supported
-- bindings, forms and shared settings as migration 018, plus the current
-- classification and requirements profile where bound. Marks become the
-- first configuration revision, never a frozen generation value.
create function private.compile_configured_order(target_teacher uuid,target_module text,selection_revision integer,allocations jsonb,targets jsonb,
 out school uuid,out release text,out form jsonb,out snapshot jsonb,out definitions_sha256 text)
language plpgsql security definer set search_path='' as $$
declare sel public.paper_selections; entry text; c public.catalogue_summaries; b private.catalogue_form_bindings; p jsonb;
 cb private.catalogue_classification_bindings; cls jsonb; req jsonb:='{}'; common jsonb; shared jsonb; items jsonb:='[]'; lines jsonb:='[]';
 scopes jsonb:='["paper-logistics"]'; has_mcq boolean:=false; n integer:=0; marks integer; total integer:=0; fixed integer; rev text; snap jsonb;
 section_totals jsonb:='{"multiple_choice":0,"structured":0}'; k text; kind text;
begin
 select a.school_id into school from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=target_teacher and a.status='approved' and u.email_confirmed_at is not null and lower(a.email)=lower(u.email);
 if school is null or not exists(select 1 from public.school_curriculum_access x where x.school_id=school and x.module_id=target_module and x.active) then raise exception 'Curriculum access required'; end if;
 select * into sel from public.paper_selections where user_id=target_teacher and school_id=school and module_id=target_module for share;
 if not found or selection_revision is null or sel.revision<>selection_revision or cardinality(sel.entry_ids)=0
  or sel.release is distinct from (select current_release from public.curriculum_modules where id=target_module)
 then raise exception 'Saved selection changed or empty'; end if;
 if allocations is null or not private.form_keys(allocations,sel.entry_ids) then raise exception 'Invalid mark allocations'; end if;
 if not private.form_keys(targets,array['paper']) and not private.form_keys(targets,array['paper','sections']) then raise exception 'Invalid mark targets'; end if;
 if jsonb_typeof(targets->'paper') is distinct from 'number' or (targets->>'paper')::numeric<>trunc((targets->>'paper')::numeric)
  or (targets->>'paper')::numeric not between 1 and 3000 then raise exception 'Invalid mark targets'; end if;
 foreach entry in array sel.entry_ids loop
  if not exists(select 1 from public.catalogue_ordering_readiness r where r.module_id=target_module and r.release=sel.release and r.entry_id=entry and r.orderable)
   or not private.catalogue_item_supported(target_module,sel.release,entry) then raise exception 'Question is not available to order'; end if;
  select * into b from private.catalogue_form_bindings x where x.module_id=target_module and x.release=sel.release and x.entry_id=entry for share;
  select payload into p from private.catalogue_authored_forms f where f.module_id=target_module and f.release=sel.release and f.entry_id=entry and f.manifest_sha256=b.manifest_sha256;
  if p is null then raise exception 'Question is not available to order'; end if;
  if common is null then common:=p->'shared'; elsif common<>p->'shared' then raise exception 'Question is not available to order'; end if;
  select * into c from public.catalogue_summaries s where s.module_id=target_module and s.release=sel.release and s.entry_id=entry;
  if jsonb_typeof(allocations->entry) is distinct from 'number' or (allocations->>entry)::numeric<>trunc((allocations->>entry)::numeric)
   or (allocations->>entry)::numeric not between c.marks_min and c.marks_max then raise exception 'Invalid mark allocations'; end if;
  marks:=(allocations->>entry)::integer;
  -- The connected multiple-choice workflow produces two-mark items; shown as fixed.
  fixed:=case when p->>'kind'='multiple-choice' then 2 end;
  if fixed is not null and marks<>fixed then raise exception 'Invalid mark allocations'; end if;
  kind:=case p->>'kind' when 'multiple-choice' then 'multiple_choice' else 'structured' end;
  select * into cb from private.catalogue_classification_bindings x where x.module_id=target_module and x.release=sel.release and x.entry_id=entry for share;
  cls:=null;
  if found then
   select jsonb_build_object('sha256',cc.sha256,'requirementsRef',cc.requirements_ref,'payload',cc.payload) into cls
   from private.catalogue_classifications cc where (cc.module_id,cc.release,cc.entry_id,cc.sha256)=(target_module,sel.release,entry,cb.sha256);
   if cls->>'requirementsRef' is not null and not req ? (cls->>'requirementsRef') then
    req:=req||jsonb_build_object(cls->>'requirementsRef',(select jsonb_build_object('sha256',r.sha256,'payload',r.payload)
     from private.curriculum_requirement_profiles r where r.ref=cls->>'requirementsRef' and r.sha256=cb.requirements_sha256));
   end if;
  end if;
  n:=n+1;total:=total+marks;
  section_totals:=jsonb_set(section_totals,array[kind],to_jsonb((section_totals->>kind)::integer+marks));
  items:=items||jsonb_build_array(jsonb_build_object('id','q'||n,'title',c.title,'marks',marks,'fields',p->'fields'));
  lines:=lines||jsonb_build_array(jsonb_build_object('id','q'||n,'entryId',entry,'kind',p->>'kind',
   'identity',jsonb_build_object('moduleId',target_module,'kind',kind,'itemId',p->>'canonicalId','release',sel.release),
   'title',c.title,'range',jsonb_build_object('min',coalesce(fixed,c.marks_min),'max',coalesce(fixed,c.marks_max)),'fixedMarks',to_jsonb(fixed),
   'checkoutMarks',marks,'binding',p,'classification',cls));
  has_mcq:=has_mcq or p->>'kind'='multiple-choice';
 end loop;
 if total<>(targets->>'paper')::integer then raise exception 'Invalid mark allocations'; end if;
 if targets ? 'sections' then
  if jsonb_typeof(targets->'sections') is distinct from 'object' or exists(select 1 from jsonb_object_keys(targets->'sections') s where s not in ('multiple_choice','structured')) then raise exception 'Invalid mark targets'; end if;
  for k in select jsonb_object_keys(targets->'sections') loop
   if jsonb_typeof(targets->'sections'->k) is distinct from 'number' or (targets->'sections'->k)<>(section_totals->k) then raise exception 'Invalid mark allocations'; end if;
  end loop;
 end if;
 shared:=common->'paper-logistics'->'fields';
 if has_mcq then shared:=shared||(common->'multiple-choice-block'->'fields');scopes:=scopes||'"multiple-choice-block"'::jsonb;end if;
 snap:=jsonb_build_object('schema','reviseit/configured-authored-inputs@1','module',target_module,'release',sel.release,
  'catalogueDigest',(select payload->>'contentDigest' from private.catalogue_published_releases x where x.module_id=target_module and x.release=sel.release),
  'lines',lines,'sharedScopes',scopes,'manifestSha256',lines->0->'binding'->>'manifestSha256','requirements',req,
  'configurator',jsonb_build_object('schemaVersion',1));
 if exists(select 1 from jsonb_array_elements(lines) l where l->'binding'->'manifestSha256' is distinct from snap->'manifestSha256') then raise exception 'Question is not available to order'; end if;
 rev:=encode(sha256(convert_to(jsonb_build_object('source',snap,'items',items,'paperFields',shared)::text,'UTF8')),'hex');
 form:=jsonb_build_object('schemaVersion',2,'revision',rev,'items',items,'paperFields',shared);
 if not private.valid_questionnaire(form) then raise exception 'Compiled form exceeds questionnaire limits'; end if;
 release:=sel.release;snapshot:=snap||jsonb_build_object('formRevision',rev);
 definitions_sha256:=encode(sha256(convert_to(jsonb_build_object('form',form,'snapshot',snapshot)::text,'UTF8')),'hex');
end $$;

-- Server-only. The definitions a checkout would pin, for the server's
-- deterministic feasibility check before any order or payment exists.
create function public.configured_checkout_candidate(target_teacher uuid,target_module text,selection_revision integer,allocations jsonb,targets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare compiled record;
begin
 if not private.configurator_enabled() then raise exception 'Configurator unavailable'; end if;
 select * into compiled from private.compile_configured_order(target_teacher,target_module,selection_revision,allocations,targets);
 return jsonb_build_object('definitionsSha256',compiled.definitions_sha256,'form',compiled.form,'snapshot',compiled.snapshot);
end $$;

-- Configuration drafts. The current row points at the latest accepted
-- revision; every accepted revision is kept unchanged.
create table private.paper_configurations (
 order_id uuid primary key references private.paper_orders(id),
 definitions_sha256 text not null check(definitions_sha256 ~ '^[a-f0-9]{64}$'),
 revision integer not null check(revision>=1),
 configuration jsonb not null check(octet_length(configuration::text)<=64000),
 evaluation jsonb check(evaluation is null or octet_length(evaluation::text)<=64000),
 updated_at timestamptz not null default now()
);
create table private.paper_configuration_revisions (
 order_id uuid not null references private.paper_orders(id),
 revision integer not null check(revision>=1),
 configuration jsonb not null, evaluation jsonb, actor text not null,
 created_at timestamptz not null default now(),
 primary key(order_id,revision)
);
-- The resolved configuration the worker consumes, frozen once at submission.
create table private.paper_configuration_plans (
 order_id uuid primary key references private.paper_orders(id),
 revision integer not null, plan jsonb not null check(octet_length(plan::text)<=200000),
 frozen_at timestamptz not null default now()
);
alter table private.paper_configurations enable row level security;
alter table private.paper_configuration_revisions enable row level security;
alter table private.paper_configuration_plans enable row level security;
revoke all on private.paper_configurations,private.paper_configuration_revisions,private.paper_configuration_plans
 from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
create trigger freeze_configuration_revision before update or delete on private.paper_configuration_revisions
for each row execute function private.freeze_authored_form();
create trigger freeze_configuration_plan before update or delete on private.paper_configuration_plans
for each row execute function private.freeze_authored_form();

-- A structurally valid configuration for these pinned lines. The server's
-- engine owns rules, parts and required decisions; the database owns shape,
-- identities, ranges and totals, and refuses paid-only content before payment.
create function private.valid_configuration(cfg jsonb,snap jsonb,paid boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare line jsonb; own jsonb; ids text[]; k text;
begin
 if not private.form_keys(cfg,array['schemaVersion','targets','lines','answers']) or cfg->'schemaVersion' is distinct from '1'::jsonb
  or octet_length(cfg::text)>64000 then return false; end if;
 if not (private.form_keys(cfg->'targets',array['paper']) or private.form_keys(cfg->'targets',array['paper','sections'])) then return false; end if;
 if cfg->'targets'->'paper'<>'null'::jsonb and (jsonb_typeof(cfg->'targets'->'paper')<>'number' or (cfg->'targets'->>'paper')::numeric<>trunc((cfg->'targets'->>'paper')::numeric)
  or (cfg->'targets'->>'paper')::numeric not between 1 and 3000) then return false; end if;
 if cfg->'targets' ? 'sections' then
  if jsonb_typeof(cfg->'targets'->'sections')<>'object' then return false; end if;
  for k in select jsonb_object_keys(cfg->'targets'->'sections') loop
   if k not in ('multiple_choice','structured') or jsonb_typeof(cfg->'targets'->'sections'->k)<>'number'
    or (cfg->'targets'->'sections'->>k)::numeric<>trunc((cfg->'targets'->'sections'->>k)::numeric) or (cfg->'targets'->'sections'->>k)::numeric not between 0 and 3000 then return false; end if;
  end loop;
 end if;
 select array_agg(l->>'id') into ids from jsonb_array_elements(snap->'lines') l;
 if not private.form_keys(cfg->'lines',ids) or not private.form_keys(cfg->'answers',array['items','paper'])
  or jsonb_typeof(cfg->'answers'->'items')<>'object' or jsonb_typeof(cfg->'answers'->'paper')<>'object' then return false; end if;
 if exists(select 1 from jsonb_object_keys(cfg->'answers'->'items') x where not x=any(ids)) then return false; end if;
 for line in select value from jsonb_array_elements(snap->'lines') loop
  own:=cfg->'lines'->(line->>'id');
  if not private.form_keys(own,array['marks','parts','facets']) or jsonb_typeof(own->'facets')<>'object' then return false; end if;
  if own->'marks'<>'null'::jsonb and (jsonb_typeof(own->'marks')<>'number' or (own->>'marks')::numeric<>trunc((own->>'marks')::numeric)
   or (own->>'marks')::numeric not between (line->'range'->>'min')::numeric and (line->'range'->>'max')::numeric) then return false; end if;
  if own->'parts'<>'null'::jsonb and (jsonb_typeof(own->'parts')<>'array' or jsonb_array_length(own->'parts')>40
   or exists(select 1 from jsonb_array_elements(own->'parts') x where not private.form_id(x))) then return false; end if;
  if exists(select 1 from jsonb_object_keys(own->'facets') x where not private.form_id(to_jsonb(x))) then return false; end if;
  -- Before payment only marks are accepted: no paid facets, parts or answers.
  if not paid and (own->'parts'<>'null'::jsonb or own->'facets'<>'{}'::jsonb
   or coalesce(cfg->'answers'->'items'->(line->>'id'),'{}'::jsonb)<>'{}'::jsonb) then return false; end if;
 end loop;
 if not paid and cfg->'answers'->'paper'<>'{}'::jsonb then return false; end if;
 return true;
exception when others then return false;
end $$;

-- Totals the database can prove from marks alone.
create function private.configuration_totals_match(cfg jsonb,snap jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare line jsonb; total integer:=0; sections jsonb:='{"multiple_choice":0,"structured":0}'; kind text; m integer; k text;
begin
 for line in select value from jsonb_array_elements(snap->'lines') loop
  if jsonb_typeof(cfg->'lines'->(line->>'id')->'marks')<>'number' then return false; end if;
  m:=(cfg->'lines'->(line->>'id')->>'marks')::integer;
  if line->'fixedMarks'<>'null'::jsonb and m<>(line->>'fixedMarks')::integer then return false; end if;
  kind:=line->'identity'->>'kind';total:=total+m;
  sections:=jsonb_set(sections,array[kind],to_jsonb((sections->>kind)::integer+m));
 end loop;
 if jsonb_typeof(cfg->'targets'->'paper')<>'number' or total<>(cfg->'targets'->>'paper')::integer then return false; end if;
 if cfg->'targets' ? 'sections' then
  for k in select jsonb_object_keys(cfg->'targets'->'sections') loop
   if (cfg->'targets'->'sections'->k)<>(sections->k) then return false; end if;
  end loop;
 end if;
 return true;
exception when others then return false;
end $$;

-- Configured checkout admission: the migration-019 rules (idempotent request
-- key, one open checkout per teacher, terminal restart, funded seat, fixed
-- price) with configured definitions pinned and the teacher's marks as
-- revision 1. The expected digest binds the definitions the server checked.
create function public.begin_configured_checkout(request_key uuid,target_module text,selection_revision integer,allocations jsonb,targets jsonb,expected_definitions text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); f private.pilot_funding; pay private.paper_payments; o uuid; compiled record; cfg jsonb; line jsonb; lines jsonb:='{}'; items jsonb:='{}';
begin
 if me is null or public.approved_school_id() is null or not public.can_use_curriculum(target_module) then raise exception 'Curriculum access required'; end if;
 if request_key is null then raise exception 'Invalid checkout request'; end if;
 select * into pay from private.paper_payments where paper_payments.request_key=begin_configured_checkout.request_key;
 if found then
  if pay.teacher_id<>me then raise exception 'Invalid checkout request'; end if;
  return jsonb_build_object('orderId',pay.order_id,'mode',pay.mode,'status',pay.status,'amountMinor',pay.amount_minor,'currency',pay.currency,
   'sessionId',pay.checkout_session_id,'checkoutUrl',pay.checkout_url,'expiresAt',pay.expires_at,'existing',false,
   'terminal',pay.refunded_at is null and (pay.status in ('expired','failed','cancelled') or (pay.status in ('creating','open') and pay.expires_at<=now())));
 end if;
 if not private.configurator_enabled() then raise exception 'Configurator unavailable'; end if;
 perform 1 from public.teacher_accounts where user_id=me for update;
 select * into pay from private.paper_payments p where p.teacher_id=me and p.status in ('creating','open') and p.expires_at>now() order by created_at desc limit 1;
 if found then
  return jsonb_build_object('orderId',pay.order_id,'mode',pay.mode,'status',pay.status,'amountMinor',pay.amount_minor,'currency',pay.currency,
   'sessionId',pay.checkout_session_id,'checkoutUrl',pay.checkout_url,'expiresAt',pay.expires_at,'existing',true,'terminal',false);
 end if;
 select * into f from private.pilot_funding where enabled for update;
 if not found then raise exception 'Pilot purchasing unavailable'; end if;
 if private.pilot_seats_used(f.mode)>=f.order_limit then raise exception 'Pilot capacity unavailable'; end if;
 select * into compiled from private.compile_configured_order(me,target_module,selection_revision,allocations,targets);
 if expected_definitions is null or compiled.definitions_sha256<>expected_definitions then raise exception 'Saved selection changed or empty'; end if;
 o:=gen_random_uuid();
 insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot,worker_id,state)
 values(o,me,compiled.school,target_module,compiled.release,'Catalogue paper','paid','configured-bundle-v1',compiled.form,compiled.snapshot,f.worker_id,'awaiting_payment');
 for line in select value from jsonb_array_elements(compiled.snapshot->'lines') loop
  lines:=lines||jsonb_build_object(line->>'id',jsonb_build_object('marks',line->'checkoutMarks','parts',null,'facets','{}'::jsonb));
 end loop;
 cfg:=jsonb_build_object('schemaVersion',1,'targets',targets,'lines',lines,'answers',jsonb_build_object('items',items,'paper','{}'::jsonb));
 -- The trigger adds execution/formatting after the definitions digest was
 -- computed; the stored digest covers what the teacher checked out.
 insert into private.paper_configurations(order_id,definitions_sha256,revision,configuration) values(o,compiled.definitions_sha256,1,cfg);
 insert into private.paper_configuration_revisions(order_id,revision,configuration,actor) values(o,1,cfg,me::text);
 insert into private.paper_payments(order_id,teacher_id,request_key,mode,amount_minor,currency,expires_at)
 values(o,me,begin_configured_checkout.request_key,f.mode,10000,'zar',now()+interval '60 minutes') returning * into pay;
 insert into private.paper_job_events(order_id,event,actor,detail) values(o,'checkout_started',me::text,jsonb_build_object('mode',f.mode,'amountMinor',10000,'currency','zar','configured',true));
 return jsonb_build_object('orderId',o,'mode',pay.mode,'status',pay.status,'amountMinor',10000,'currency','zar',
  'sessionId',null,'checkoutUrl',null,'expiresAt',pay.expires_at,'existing',false,'terminal',false);
end $$;

-- Execution and formatting are frozen for configured orders exactly as for
-- authored-bundle-v1 orders.
create or replace function private.freeze_new_catalogue_execution() returns trigger
language plpgsql security definer set search_path='' as $$
declare w text; f jsonb; expected text;
begin
 expected:=case new.adapter_key when 'authored-bundle-v1' then 'reviseit/frozen-authored-inputs@1'
  when 'configured-bundle-v1' then 'reviseit/configured-authored-inputs@1' end;
 if expected is null then return new; end if;
 if new.snapshot->>'schema' is distinct from expected
  or new.snapshot->>'module' is distinct from new.module_id or new.snapshot->>'release' is distinct from new.release
 then raise exception 'Catalogue snapshot identity required'; end if;
 select workflow_sha256 into w from private.catalogue_executions
 where module_id=new.module_id and release=new.release and manifest_sha256=new.snapshot->>'manifestSha256';
 if w is null then raise exception 'Connected workflow registration required'; end if;
 if exists(select 1 from jsonb_array_elements(new.snapshot->'lines') l where
  (new.module_id='caps-grade-11-physical-sciences' and l->>'entryId'='structured:P1-CIRC-01') or
  (new.module_id='caps-grade-10-physical-sciences' and l->>'entryId' in ('structured:P2-CHEM-04','structured:P2-CHEM-05')))
 then raise exception 'Selected item input mapping remains unresolved'; end if;
 select jsonb_build_object('schemaVersion',1,'schoolId',s.id,'schoolName',s.name,'moduleId',new.module_id,
  'revision',coalesce(p.revision,0),'preferences',p.preferences) into f
 from public.schools s left join public.school_formatting p on p.school_id=s.id and p.module_id=new.module_id
 where s.id=new.school_id;
 if f is null then raise exception 'School formatting identity required'; end if;
 new.snapshot:=new.snapshot||jsonb_build_object('execution',jsonb_build_object('workflowManifestSha256',w),'formatting',f);
 return new;
end $$;

create or replace function private.freeze_catalogue_order_inputs() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.snapshot->>'schema' in ('reviseit/frozen-authored-inputs@1','reviseit/configured-authored-inputs@1') and
  (new.form,new.snapshot,new.module_id,new.release,new.teacher_id,new.school_id,new.entitlement,new.adapter_key)
  is distinct from (old.form,old.snapshot,old.module_id,old.release,old.teacher_id,old.school_id,old.entitlement,old.adapter_key)
 then raise exception 'Issued catalogue order inputs are immutable'; end if;
 return new;
end $$;

-- Server-only read of one configured order for a teacher the server has
-- authenticated. Private definitions stay on the server; the route projects.
create function public.paper_configuration_for_teacher(target uuid,target_teacher uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o private.paper_orders; c private.paper_configurations; pay private.paper_payments; plan private.paper_configuration_plans;
begin
 select * into o from private.paper_orders where id=target;
 if not found or o.adapter_key<>'configured-bundle-v1' or not private.teacher_order_access(o,target_teacher) then return null; end if;
 select * into c from private.paper_configurations where order_id=target;
 select * into pay from private.paper_payments where order_id=target;
 select * into plan from private.paper_configuration_plans where order_id=target;
 return jsonb_build_object('orderId',o.id,'state',o.state,'moduleId',o.module_id,'release',o.release,
  'paid',pay.status='paid' and pay.refunded_at is null,
  'paymentStatus',case when pay.refunded_at is not null then 'refunded' when pay.status in ('creating','open') and pay.expires_at<=now() then 'expired' else pay.status end,
  'revision',c.revision,'configuration',c.configuration,'evaluation',c.evaluation,'definitionsSha256',c.definitions_sha256,
  'form',o.form,'snapshot',o.snapshot,'submitted',o.submission_key is not null,'submittedRevision',plan.revision);
end $$;

-- Server-only save with optimistic concurrency. The server supplies its
-- deterministic evaluation of exactly this configuration; the database keeps
-- both, bound to the new revision. A payment callback never writes here.
create function public.save_paper_configuration(target uuid,target_teacher uuid,expected_revision integer,configuration jsonb,evaluation jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; c private.paper_configurations; pay private.paper_payments; paid boolean; next_revision integer;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or o.adapter_key<>'configured-bundle-v1' or not private.teacher_order_access(o,target_teacher) then raise exception 'Order access required'; end if;
 select * into c from private.paper_configurations where order_id=target for update;
 select * into pay from private.paper_payments where order_id=target;
 paid:=pay.status='paid' and pay.refunded_at is null;
 if o.submission_key is not null or o.state not in ('awaiting_payment','awaiting_answers') then raise exception 'Order already submitted'; end if;
 if o.state='awaiting_payment' and (pay.status not in ('creating','open') or pay.expires_at<=now() or pay.refunded_at is not null) then raise exception 'Order cannot be configured'; end if;
 if o.state='awaiting_answers' and not paid then raise exception 'Order cannot be configured'; end if;
 if expected_revision is null or expected_revision<>c.revision then raise exception 'Configuration changed'; end if;
 if not private.valid_configuration(configuration,o.snapshot,paid and o.state='awaiting_answers') then raise exception 'Invalid configuration'; end if;
 if jsonb_typeof(evaluation) is distinct from 'object' or octet_length(evaluation::text)>64000
  or evaluation->>'definitionsSha256' is distinct from c.definitions_sha256 or jsonb_typeof(evaluation->'ready') is distinct from 'boolean'
 then raise exception 'Invalid configuration evaluation'; end if;
 next_revision:=c.revision+1;
 insert into private.paper_configuration_revisions(order_id,revision,configuration,evaluation,actor) values(target,next_revision,configuration,evaluation,target_teacher::text);
 update private.paper_configurations set revision=next_revision,configuration=save_paper_configuration.configuration,evaluation=save_paper_configuration.evaluation,updated_at=now() where order_id=target;
 return next_revision;
end $$;

-- Submitted answers are exactly the saved answers, plus explicit omissions for
-- optional fields the teacher left blank (valid_order_answers checks optionality).
create function private.answers_extend(saved jsonb,submitted jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(submitted)='object'
  and not exists(select 1 from jsonb_each(coalesce(saved,'{}'::jsonb)) e where submitted->e.key is distinct from e.value)
  and not exists(select 1 from jsonb_each(submitted) e where not coalesce(saved,'{}'::jsonb) ? e.key and e.value<>'{"kind":"omit"}'::jsonb),false);
$$;

-- Server-only submission. Lock order matches the refund and payment
-- recorders (payment intent, payment row, order row), then the configuration.
-- Entitlement, current revision, marks/totals, the stored ready evaluation
-- and exact answers are checked together; the plan is frozen once.
create function public.submit_configured_paper(target uuid,target_teacher uuid,request_key uuid,expected_revision integer,submitted_answers jsonb,plan jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; c private.paper_configurations; pay private.paper_payments; existing private.paper_configuration_plans;
 line jsonb; own jsonb; pl jsonb; pos integer:=0;
begin
 select * into pay from private.paper_payments where order_id=target;
 if found and pay.payment_intent_id is not null then perform private.lock_payment_intent(pay.payment_intent_id); end if;
 select * into pay from private.paper_payments where order_id=target for update;
 select * into o from private.paper_orders where id=target for update;
 if not found or o.adapter_key<>'configured-bundle-v1' or not private.teacher_order_access(o,target_teacher) then raise exception 'Order access required'; end if;
 select * into c from private.paper_configurations where order_id=target for update;
 if o.submission_key is not null then
  select * into existing from private.paper_configuration_plans where order_id=target;
  if o.submission_key=request_key and existing.revision=expected_revision and o.answers=submitted_answers then return o.id; end if;
  raise exception 'Order already submitted';
 end if;
 if pay.status is distinct from 'paid' or pay.refunded_at is not null then raise exception 'Order cannot be submitted'; end if;
 if o.state<>'awaiting_answers' then raise exception 'Order cannot be submitted'; end if;
 if request_key is null or expected_revision is null or expected_revision<>c.revision then raise exception 'Configuration changed'; end if;
 if c.evaluation is null or c.evaluation->'ready'<>'true'::jsonb or c.evaluation->>'definitionsSha256'<>c.definitions_sha256
  or not private.valid_configuration(c.configuration,o.snapshot,true) or not private.configuration_totals_match(c.configuration,o.snapshot)
 then raise exception 'Configuration is not ready'; end if;
 if not private.valid_order_answers(o.form,submitted_answers) or not private.answers_extend(c.configuration->'answers'->'paper',submitted_answers->'paper') then raise exception 'Invalid answers'; end if;
 if not private.form_keys(plan,array['schema','orderId','module','release','formRevision','configurationRevision','definitionsSha256','targets','lines'])
  or plan->>'schema'<>'reviseit/configured-generation-plan@1' or plan->>'orderId'<>target::text or plan->>'module'<>o.module_id or plan->>'release'<>o.release
  or plan->>'formRevision'<>o.snapshot->>'formRevision' or plan->'configurationRevision'<>to_jsonb(c.revision) or plan->>'definitionsSha256'<>c.definitions_sha256
  or plan->'targets'<>c.configuration->'targets' or jsonb_typeof(plan->'lines')<>'array' or jsonb_array_length(plan->'lines')<>jsonb_array_length(o.snapshot->'lines')
  or octet_length(plan::text)>200000 then raise exception 'Invalid generation plan'; end if;
 for line in select value from jsonb_array_elements(o.snapshot->'lines') loop
  pl:=plan->'lines'->pos;pos:=pos+1;own:=c.configuration->'lines'->(line->>'id');
  if not private.form_keys(pl,array['id','entryId','identity','kind','marks','parts','facets','answers','classificationSha256','requirementsRef','diagram'])
   or pl->'id'<>line->'id' or pl->'entryId'<>line->'entryId' or pl->'identity'<>line->'identity' or pl->'kind'<>line->'kind'
   or pl->'marks'<>own->'marks' or pl->'facets'<>own->'facets'
   or pl->'answers'<>coalesce(submitted_answers->'items'->(line->>'id'),'null'::jsonb)
   or not private.answers_extend(c.configuration->'answers'->'items'->(line->>'id'),submitted_answers->'items'->(line->>'id'))
   or pl->'classificationSha256' is distinct from coalesce(line->'classification'->'sha256','null'::jsonb)
   or (pl->'parts'<>'null'::jsonb and jsonb_typeof(pl->'parts')<>'array')
  then raise exception 'Invalid generation plan'; end if;
 end loop;
 insert into private.paper_configuration_plans(order_id,revision,plan) values(target,c.revision,plan);
 update private.paper_orders set answers=submitted_answers,submission_key=request_key,submitted_at=now(),state='queued',updated_at=now() where id=target;
 insert into private.paper_job_events(order_id,event,actor,detail) values(target,'submitted',target_teacher::text,jsonb_build_object('configurationRevision',c.revision));
 return target;
end $$;

-- The migration-018 answer path remains for its own orders only. A configured
-- order is submitted exclusively through its revision-checked function.
create or replace function public.submit_paper_answers(target uuid,request_key uuid,submitted_answers jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; line jsonb; problem jsonb; item jsonb; field jsonb;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or not private.can_read_order(o) then raise exception 'Order access required'; end if;
 if o.adapter_key='configured-bundle-v1' then raise exception 'Order cannot be submitted'; end if;
 if o.entitlement='paid' and not exists(select 1 from private.paper_payments p where p.order_id=o.id and p.status='paid' and p.refunded_at is null)
  then raise exception 'Order cannot be submitted'; end if;
 if request_key is null or not private.valid_order_answers(o.form,submitted_answers) then raise exception 'Invalid answers'; end if;
 if o.state in ('cancelled','held','awaiting_payment') then raise exception 'Order cannot be submitted'; end if;
 if o.submission_key is not null then
  if o.submission_key=request_key and o.answers=submitted_answers then return o.id; end if;
  raise exception 'Order already submitted';
 end if;
 if o.state<>'awaiting_answers' then raise exception 'Order already submitted'; end if;
 if o.generation_plan->'schemaVersion'='2'::jsonb then
  for line in select value from jsonb_array_elements(o.generation_plan->'lines') loop
   problem:=private.answer_policy_error(line->'answerPolicy',submitted_answers->'items'->(line->>'id'));
   if problem is not null then
    select value into item from jsonb_array_elements(o.form->'items') where value->'id'=line->'id';
    select value into field from jsonb_array_elements(item->'fields') where value->'id'=problem->'field';
    raise exception 'Incompatible answers' using detail=jsonb_build_object('itemId',line->>'id','fieldId',problem->>'field',
     'message',(item->>'title')||': '||(field->>'label')||': '||(problem->>'message'))::text;
   end if;
  end loop;
 end if;
 update private.paper_orders set answers=submitted_answers,submission_key=request_key,submitted_at=now(),state='queued',updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'submitted',auth.uid()::text);
 return o.id;
end; $$;

-- The teacher read model keeps every existing key and adds `configurable`.
-- A configured order's editable view comes from its configuration endpoint,
-- so its pinned checkout form is not offered through the legacy answer form.
create or replace function public.teacher_orders(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'title',o.title,'moduleId',o.module_id,'release',o.release,'internalTest',o.entitlement='internal_test',
 'state',o.state,'createdAt',o.created_at,'updatedAt',o.updated_at,
 'form',case when target is not null and o.state='awaiting_answers' and o.adapter_key<>'configured-bundle-v1' then o.form else null end,
 'answers',case when target is not null then o.answers else null end,
 'answerSummary',case when target is not null and jsonb_typeof(o.form)='object' and o.answers is not null then private.questionnaire_receipt(o.form,o.answers) else null end,
 'documents',case when o.state='released' then to_jsonb(array['paper','memo','learner-memo','teacher-description']) else '[]'::jsonb end,
 'payment',case when p.order_id is null then null else jsonb_build_object('status',case when p.refunded_at is not null then 'refunded'
   when p.status in ('creating','open') and p.expires_at<=now() then 'expired' else p.status end,
  'amountMinor',p.amount_minor,'currency',p.currency,'testMode',p.mode='test',
  'checkoutUrl',case when target is not null and p.status='open' and p.expires_at>now() and o.state='awaiting_payment' then p.checkout_url else null end,
  'needsAttention',p.attention is not null) end,
 'configurable',o.adapter_key='configured-bundle-v1'
 ) order by o.created_at desc),'[]'::jsonb)
 from (select * from private.paper_orders x where (target is null or x.id=target) and private.can_read_order(x)
 order by x.created_at desc limit 100) o left join private.paper_payments p on p.order_id=o.id;
$$;

-- Workers declare what they can execute. A configured order is claimed only
-- by a worker declaring `configured-plan@1`, and only with its frozen plan.
-- A worker that declares nothing receives exactly the previous claim payload.
drop function public.claim_paper_job(text);
create function public.claim_paper_job(worker text,capabilities jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; token uuid; pay private.paper_payments; plan private.paper_configuration_plans; configured boolean;
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 if jsonb_typeof(capabilities) is distinct from 'array' or jsonb_array_length(capabilities)>10
  or exists(select 1 from jsonb_array_elements(capabilities) x where x not in ('"configured-plan@1"'::jsonb)) then raise exception 'Invalid worker capabilities'; end if;
 configured:=capabilities ? 'configured-plan@1';
 select * into o from private.paper_orders x
 where (x.state='queued' or (x.state in ('generating','rendering') and x.lease_until<now()))
 and (x.worker_id is null or x.worker_id=worker)
 and (x.adapter_key<>'configured-bundle-v1' or (configured and exists(select 1 from private.paper_configuration_plans c where c.order_id=x.id)))
 and (x.entitlement<>'paid' or exists(select 1 from private.paper_payments p where p.order_id=x.id and p.status='paid' and p.refunded_at is null))
 and exists(select 1 from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=x.teacher_id and a.status='approved' and a.school_id=x.school_id
 and u.email_confirmed_at is not null and lower(u.email)=lower(a.email))
 and exists(select 1 from public.school_curriculum_access a where a.school_id=x.school_id and a.module_id=x.module_id and a.active)
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 token:=gen_random_uuid();
 update private.paper_orders set lease=token,lease_until=now()+interval '90 seconds',worker_id=worker,
 state=case when o.state='queued' then 'generating' else o.state end,updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'claimed',worker);
 select * into pay from private.paper_payments where order_id=o.id;
 select * into plan from private.paper_configuration_plans where order_id=o.id;
 return jsonb_build_object('resumed',o.state<>'queued','id',o.id,'lease',token,'adapterKey',o.adapter_key,'schoolId',o.school_id,
 'moduleId',o.module_id,'release',o.release,'answers',o.answers,'snapshot',o.snapshot,
 'memoReview',o.memo_review,'internalTest',o.entitlement='internal_test')
 || case when o.generation_plan is null then '{}'::jsonb else jsonb_build_object('generationPlan',o.generation_plan) end
 || case when o.entitlement='paid' then jsonb_build_object('entitlement','paid','paymentMode',pay.mode) else '{}'::jsonb end
 || case when plan.order_id is null then '{}'::jsonb else jsonb_build_object('configurationPlan',plan.plan) end;
end $$;

revoke all on function private.configurator_enabled(),private.teacher_order_access(private.paper_orders,uuid),
 private.compile_configured_order(uuid,text,integer,jsonb,jsonb),private.valid_configuration(jsonb,jsonb,boolean),
 private.configuration_totals_match(jsonb,jsonb),private.answers_extend(jsonb,jsonb) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
revoke all on function public.configure_configurator(boolean,text),public.configurator_status(),
 public.configured_checkout_candidate(uuid,text,integer,jsonb,jsonb),public.begin_configured_checkout(uuid,text,integer,jsonb,jsonb,text),
 public.paper_configuration_for_teacher(uuid,uuid),public.save_paper_configuration(uuid,uuid,integer,jsonb,jsonb),
 public.submit_configured_paper(uuid,uuid,uuid,integer,jsonb,jsonb),public.claim_paper_job(text,jsonb)
 from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
grant execute on function public.configurator_status(),public.begin_configured_checkout(uuid,text,integer,jsonb,jsonb,text) to authenticated;
grant execute on function public.configured_checkout_candidate(uuid,text,integer,jsonb,jsonb),public.paper_configuration_for_teacher(uuid,uuid),
 public.save_paper_configuration(uuid,uuid,integer,jsonb,jsonb),public.submit_configured_paper(uuid,uuid,uuid,integer,jsonb,jsonb),
 public.claim_paper_job(text,jsonb) to service_role;

commit;
