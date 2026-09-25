begin;

-- CFG01A: exact source binding, repeated multiple-choice occurrences and
-- presentation order. Additive; migrations up to 020 are unchanged. The
-- configurator switch stays off unless an operator turns it on.

-- The exact generation inputs of one catalogue line: private bundle manifest,
-- bundle digest, form revision, every source dependency (module-relative path
-- and SHA-256) and the workflow manifest. Derived only from the immutable
-- registered form payload and the registered execution.
create function private.line_source_binding(form_payload jsonb,workflow text) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('schema','reviseit/cfg-source-binding@1','moduleId',form_payload->'module','release',form_payload->'release',
  'entryId',form_payload->'entryId','privateManifestSha256',form_payload->'manifestSha256','privateBundleDigest',form_payload->'bundleDigest',
  'formRevision',form_payload->'formRevision','workflowManifestSha256',to_jsonb(workflow),'sources',form_payload->'sources');
$$;

alter table private.catalogue_classifications add column source_binding jsonb;

-- Registration with the exact source binding. The classification's own
-- provenance (every specification and task source by module path and hash)
-- must equal the registered generation bundle's bytes for that entry, the form
-- revision must match, the workflow must be the registered one, and the
-- catalogue release and content digest must be the published ones.
create function public.register_catalogue_classification_bound(target_module text,target_release text,target_entry text,target_sha256 text,envelope jsonb,target_requirements_sha256 text,binding jsonb,
 bundle_sources jsonb,catalogue_digest text) returns void
language plpgsql security definer set search_path='' as $$
declare f jsonb; w text; expected jsonb; prov jsonb; req_ref text; kind text; prior private.catalogue_classifications; src jsonb; bsrc jsonb; n integer:=0;
begin
 if target_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(envelope) is distinct from 'object' or octet_length(envelope::text)>200000
  or envelope->'schemaVersion' not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(binding) is distinct from 'object' or jsonb_typeof(bundle_sources) is distinct from 'array'
 then raise exception 'Invalid classification'; end if;
 kind:=case envelope->>'kind' when 'structured' then 'structured:' when 'multiple_choice' then 'mcq:' end;
 if kind is null or envelope->>'moduleId' is distinct from target_module or envelope->>'release' is distinct from target_release
  or kind||(envelope->>'itemId') is distinct from target_entry then raise exception 'Classification identity mismatch'; end if;
 if catalogue_digest is null or catalogue_digest is distinct from (select payload->>'contentDigest' from private.catalogue_published_releases x where x.module_id=target_module and x.release=target_release)
 then raise exception 'Classification catalogue release mismatch'; end if;
 select payload into f from private.catalogue_authored_forms x where (x.module_id,x.release,x.entry_id,x.manifest_sha256)=(target_module,target_release,target_entry,binding->>'privateManifestSha256');
 if f is null then raise exception 'Classification source version mismatch'; end if;
 select workflow_sha256 into w from private.catalogue_executions x where (x.module_id,x.release,x.manifest_sha256)=(target_module,target_release,binding->>'privateManifestSha256');
 expected:=private.line_source_binding(f,w);
 if w is null or binding<>expected then raise exception 'Classification source version mismatch'; end if;
 if envelope->'formBinding'->'itemForm'->>'formRevision' is distinct from f->>'formRevision' then raise exception 'Classification source version mismatch'; end if;
 -- bundle_sources: the publisher's reading of the registered bundle, each
 -- {role,path,originalPath,sha256}; it must restate the registered sources exactly.
 if jsonb_array_length(bundle_sources)<>jsonb_array_length(f->'sources') then raise exception 'Classification source version mismatch'; end if;
 for bsrc in select value from jsonb_array_elements(bundle_sources) loop
  if not private.form_keys(bsrc,array['role','path','originalPath','sha256']) or bsrc->>'originalPath' not like 'our content/'||target_module||'/%'
   or not exists(select 1 from jsonb_array_elements(f->'sources') s where s->'role'=bsrc->'role' and s->'path'=bsrc->'path' and s->'sha256'=bsrc->'sha256')
  then raise exception 'Classification source version mismatch'; end if;
 end loop;
 -- Every specification/task source the classification describes is a registered
 -- source with identical bytes, and vice versa; top-level and dependencies alike.
 for src in select value from jsonb_array_elements(envelope->'provenance'->'sources') loop
  if src->>'role' in ('specification','task-type','task-dependency') then
   n:=n+1;
   if not exists(select 1 from jsonb_array_elements(bundle_sources) b where b->'originalPath'=src->'path' and b->'sha256'=src->'sha256')
   then raise exception 'Classification source version mismatch'; end if;
  end if;
 end loop;
 if n<>jsonb_array_length(bundle_sources) then raise exception 'Classification source version mismatch'; end if;
 if jsonb_typeof(envelope->'curriculumRequirementsRef')='object' then
  req_ref:=(envelope->'curriculumRequirementsRef'->>'profileId')||'@'||(envelope->'curriculumRequirementsRef'->>'version');
  if target_requirements_sha256 is null or not exists(select 1 from private.curriculum_requirement_profiles r where r.ref=req_ref and r.sha256=target_requirements_sha256)
  then raise exception 'Registered requirements profile required'; end if;
 else raise exception 'Invalid classification'; end if;
 select * into prior from private.catalogue_classifications x where (x.module_id,x.release,x.entry_id,x.sha256)=(target_module,target_release,target_entry,target_sha256);
 if found and (prior.payload<>envelope or prior.source_binding is distinct from binding) then raise exception 'Registered classification is immutable'; end if;
 insert into private.catalogue_classifications(module_id,release,entry_id,sha256,schema_version,requirements_ref,payload,source_binding)
 values(target_module,target_release,target_entry,target_sha256,(envelope->>'schemaVersion')::integer,req_ref,envelope,binding) on conflict do nothing;
 insert into private.catalogue_classification_bindings(module_id,release,entry_id,sha256,requirements_sha256)
 values(target_module,target_release,target_entry,target_sha256,target_requirements_sha256)
 on conflict(module_id,release,entry_id) do update set sha256=excluded.sha256,requirements_sha256=excluded.requirements_sha256,bound_at=now();
end $$;
alter table private.catalogue_classifications drop constraint catalogue_classifications_schema_version_check;
alter table private.catalogue_classifications add constraint catalogue_classifications_schema_version_check check(schema_version in (1,2));

create or replace function private.compile_configured_order(target_teacher uuid,target_module text,selection_revision integer,allocations jsonb,targets jsonb,
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
  -- Only supported multiple-choice types may repeat; each occurrence becomes its own line.
  if array_position(sel.entry_ids,entry)<>n+1 and p->>'kind'<>'multiple-choice' then raise exception 'Question is not available to order'; end if;
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
   select jsonb_build_object('sha256',cc.sha256,'requirementsRef',cc.requirements_ref,'payload',cc.payload,'sourceBinding',cc.source_binding) into cls
   from private.catalogue_classifications cc where (cc.module_id,cc.release,cc.entry_id,cc.sha256)=(target_module,sel.release,entry,cb.sha256);
   -- A classification describes exact source bytes. It is pinned only with the
   -- very form, bundle and workflow the order will generate from; anything else
   -- fails loudly instead of quietly falling back or removing the item.
   if cls->'sourceBinding' is null or cls->'sourceBinding'='null'::jsonb
    or cls->'sourceBinding'<>private.line_source_binding(p,(select workflow_sha256 from private.catalogue_executions x where (x.module_id,x.release,x.manifest_sha256)=(target_module,sel.release,b.manifest_sha256)))
   then raise exception 'Classification source version mismatch'; end if;
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
   'checkoutMarks',marks,'binding',p,'classification',cls,
   'preview',coalesce(c.preview,'null'::jsonb)));
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
  'configurator',jsonb_build_object('schemaVersion',2));
 if exists(select 1 from jsonb_array_elements(lines) l where l->'binding'->'manifestSha256' is distinct from snap->'manifestSha256') then raise exception 'Question is not available to order'; end if;
 rev:=encode(sha256(convert_to(jsonb_build_object('source',snap,'items',items,'paperFields',shared)::text,'UTF8')),'hex');
 form:=jsonb_build_object('schemaVersion',2,'revision',rev,'items',items,'paperFields',shared);
 if not private.valid_questionnaire(form) then raise exception 'Compiled form exceeds questionnaire limits'; end if;
 release:=sel.release;snapshot:=snap||jsonb_build_object('formRevision',rev);
 definitions_sha256:=encode(sha256(convert_to(jsonb_build_object('form',form,'snapshot',snapshot)::text,'UTF8')),'hex');
end $$;

create or replace function private.valid_configuration(cfg jsonb,snap jsonb,paid boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare line jsonb; own jsonb; ids text[]; k text;
begin
 if not (private.form_keys(cfg,array['schemaVersion','targets','lines','answers']) or private.form_keys(cfg,array['schemaVersion','targets','lines','answers','order'])) or cfg->'schemaVersion' is distinct from '1'::jsonb
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
 -- Optional presentation order: a permutation of the purchased occurrences.
 if cfg ? 'order' and (jsonb_typeof(cfg->'order')<>'array' or jsonb_array_length(cfg->'order')<>cardinality(ids)
  or (select count(distinct x) from jsonb_array_elements_text(cfg->'order') x where x=any(ids))<>cardinality(ids)) then return false; end if;
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

create or replace function public.submit_configured_paper(target uuid,target_teacher uuid,request_key uuid,expected_revision integer,submitted_answers jsonb,plan jsonb) returns uuid
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
 -- Plan version 2 adds the presentation order and each line's exact source binding.
 if not private.form_keys(plan,array['schema','orderId','module','release','formRevision','configurationRevision','definitionsSha256','targets','lines','order'])
  or plan->>'schema'<>'reviseit/configured-generation-plan@2' or plan->'order'<>coalesce(c.configuration->'order',(select jsonb_agg(l->'id') from jsonb_array_elements(o.snapshot->'lines') l)) or plan->>'orderId'<>target::text or plan->>'module'<>o.module_id or plan->>'release'<>o.release
  or plan->>'formRevision'<>o.snapshot->>'formRevision' or plan->'configurationRevision'<>to_jsonb(c.revision) or plan->>'definitionsSha256'<>c.definitions_sha256
  or plan->'targets'<>c.configuration->'targets' or jsonb_typeof(plan->'lines')<>'array' or jsonb_array_length(plan->'lines')<>jsonb_array_length(o.snapshot->'lines')
  or octet_length(plan::text)>200000 then raise exception 'Invalid generation plan'; end if;
 for line in select value from jsonb_array_elements(o.snapshot->'lines') loop
  pl:=plan->'lines'->pos;pos:=pos+1;own:=c.configuration->'lines'->(line->>'id');
  if not private.form_keys(pl,array['id','entryId','identity','kind','marks','parts','facets','answers','classificationSha256','requirementsRef','diagram','sourceBinding'])
   or pl->'sourceBinding'<>private.line_source_binding(line->'binding',o.snapshot->'execution'->>'workflowManifestSha256')
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

create or replace function public.claim_paper_job(worker text,capabilities jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; token uuid; pay private.paper_payments; plan private.paper_configuration_plans; configured boolean;
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 if jsonb_typeof(capabilities) is distinct from 'array' or jsonb_array_length(capabilities)>10
  or exists(select 1 from jsonb_array_elements(capabilities) x where x not in ('"configured-plan@1"'::jsonb,'"configured-plan@2"'::jsonb)) then raise exception 'Invalid worker capabilities'; end if;
 configured:=capabilities ? 'configured-plan@1' or capabilities ? 'configured-plan@2';
 select * into o from private.paper_orders x
 where (x.state='queued' or (x.state in ('generating','rendering') and x.lease_until<now()))
 and (x.worker_id is null or x.worker_id=worker)
 -- A configured order goes only to a worker declaring its exact plan version.
 and (x.adapter_key<>'configured-bundle-v1' or (configured and exists(select 1 from private.paper_configuration_plans c where c.order_id=x.id
  and capabilities ? replace(c.plan->>'schema','reviseit/configured-generation-plan','configured-plan'))))
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

create or replace function public.save_paper_selection(target_module text,target_release text,expected_revision integer,selected_ids text[]) returns integer
language plpgsql security definer set search_path='' as $$
declare s uuid; next_revision integer; published_release text;
begin
 s:=public.approved_school_id();
 if s is null or not public.can_use_curriculum(target_module) then raise exception 'Curriculum access required'; end if;
 if expected_revision is null or expected_revision<0 then raise exception 'Refresh before saving'; end if;
 perform 1 from public.school_curriculum_access where school_id=s and module_id=target_module and active for update;
 if not found then raise exception 'Curriculum access required'; end if;
 select current_release into published_release from public.curriculum_modules where id=target_module for share;
 if target_release is null or target_release<>published_release then raise exception 'Catalogue changed. Reload before saving'; end if;
 if selected_ids is null or cardinality(selected_ids)>30 or array_position(selected_ids,null) is not null
   -- Repeats: only multiple-choice types, and only while the configurator is on.
   or exists(select 1 from unnest(selected_ids) x group by x having count(*)>1 and (x not like 'mcq:%' or not private.configurator_enabled()))
   or exists(select 1 from unnest(selected_ids) x where not exists(
      select 1 from public.catalogue_summaries c
      where c.module_id=target_module and c.release=target_release and c.entry_id=x))
   then raise exception 'Invalid question selection'; end if;
 if exists(select 1 from unnest(selected_ids) x where not exists(
      select 1 from public.catalogue_ordering_readiness r
      join private.catalogue_form_bindings b
        on b.module_id=r.module_id and b.release=r.release and b.entry_id=r.entry_id
      where r.module_id=target_module and r.release=target_release and r.entry_id=x and r.orderable))
   then raise exception 'Question is not available to order'; end if;
 insert into public.paper_selections(user_id,school_id,module_id,release,entry_ids)
   select auth.uid(),s,target_module,target_release,selected_ids where expected_revision=0
   on conflict(user_id,school_id,module_id) do nothing returning revision into next_revision;
 if next_revision is null then
   update public.paper_selections set release=target_release,entry_ids=selected_ids,revision=revision+1,updated_at=now()
     where user_id=auth.uid() and school_id=s and module_id=target_module and revision=expected_revision returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'Selection changed. Reload before saving'; end if;
 return next_revision;
end $$;

create or replace function private.compile_paid_order(target_teacher uuid,target_module text,selection_revision integer,allocations jsonb,
 out school uuid,out release text,out form jsonb,out snapshot jsonb)
language plpgsql security definer set search_path='' as $$
declare sel public.paper_selections; entry text; c public.catalogue_summaries; b private.catalogue_form_bindings; p jsonb;
 common jsonb; shared jsonb; items jsonb:='[]'; lines jsonb:='[]'; scopes jsonb:='["paper-logistics"]';
 has_mcq boolean:=false; n integer:=0; marks integer; rev text; snap jsonb;
begin
 select a.school_id into school from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=target_teacher and a.status='approved' and u.email_confirmed_at is not null and lower(a.email)=lower(u.email);
 if school is null or not exists(select 1 from public.school_curriculum_access x where x.school_id=school and x.module_id=target_module and x.active) then raise exception 'Curriculum access required'; end if;
 select * into sel from public.paper_selections where user_id=target_teacher and school_id=school and module_id=target_module for share;
 if not found or selection_revision is null or sel.revision<>selection_revision or cardinality(sel.entry_ids)=0
  or sel.release is distinct from (select current_release from public.curriculum_modules where id=target_module)
 then raise exception 'Saved selection changed or empty'; end if;
 -- The migration-018 path keeps its one-occurrence-per-item behaviour.
 if cardinality(sel.entry_ids)<>(select count(distinct x) from unnest(sel.entry_ids) x) then raise exception 'Saved selection changed or empty'; end if;
 if allocations is null or not private.form_keys(allocations,sel.entry_ids) then raise exception 'Invalid mark allocations'; end if;
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
  -- The connected multiple-choice workflow produces two-mark items.
  if p->>'kind'='multiple-choice' and marks<>2 then raise exception 'Invalid mark allocations'; end if;
  n:=n+1;
  items:=items||jsonb_build_array(jsonb_build_object('id','q'||n,'title',c.title,'marks',marks,'fields',p->'fields'));
  lines:=lines||jsonb_build_array(jsonb_build_object('id','q'||n,'entryId',entry,'marks',marks,'binding',p));
  has_mcq:=has_mcq or p->>'kind'='multiple-choice';
 end loop;
 shared:=common->'paper-logistics'->'fields';
 if has_mcq then shared:=shared||(common->'multiple-choice-block'->'fields');scopes:=scopes||'"multiple-choice-block"'::jsonb;end if;
 snap:=jsonb_build_object('schema','reviseit/frozen-authored-inputs@1','module',target_module,'release',sel.release,
  'catalogueDigest',(select payload->>'contentDigest' from private.catalogue_published_releases x where x.module_id=target_module and x.release=sel.release),
  'lines',lines,'sharedScopes',scopes,'manifestSha256',lines->0->'binding'->>'manifestSha256');
 if exists(select 1 from jsonb_array_elements(lines) l where l->'binding'->'manifestSha256' is distinct from snap->'manifestSha256') then raise exception 'Question is not available to order'; end if;
 rev:=encode(sha256(convert_to(jsonb_build_object('source',snap,'items',items,'paperFields',shared)::text,'UTF8')),'hex');
 form:=jsonb_build_object('schemaVersion',2,'revision',rev,'items',items,'paperFields',shared);
 if not private.valid_questionnaire(form) then raise exception 'Compiled form exceeds questionnaire limits'; end if;
 release:=sel.release;snapshot:=snap||jsonb_build_object('formRevision',rev);
end $$;

-- Unbound registration is withdrawn: every future classification carries its binding.
revoke all on function public.register_catalogue_classification(text,text,text,text,jsonb,text) from reviseit_catalogue_publisher;
revoke all on function private.line_source_binding(jsonb,text) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
revoke all on function public.register_catalogue_classification_bound(text,text,text,text,jsonb,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.register_catalogue_classification_bound(text,text,text,text,jsonb,text,jsonb,jsonb,text) to reviseit_catalogue_publisher;

commit;
