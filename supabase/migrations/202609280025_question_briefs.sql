-- Preserve per-question words independently of authored options. No existing rows are rewritten.
begin;
create or replace function private.valid_configuration_without_briefs_025(cfg jsonb,snap jsonb,paid boolean) returns boolean
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


create or replace function private.valid_configuration(cfg jsonb,snap jsonb,paid boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare id text; b jsonb; k text;
begin
 if octet_length(cfg::text)>180000 or not private.valid_configuration_without_briefs_025(cfg-'briefs',snap,paid) then return false; end if;
 if cfg ? 'briefs' then
  if not paid or jsonb_typeof(cfg->'briefs') is distinct from 'object' then return false; end if;
  for id,b in select * from jsonb_each(cfg->'briefs') loop
   if not (cfg->'lines' ? id) or not private.form_keys(b,array['text','interpretedText','suggestions','resolutions'])
    or jsonb_typeof(b->'text') is distinct from 'string' or length(b->>'text')>4000
    or (b->'interpretedText'<>'null'::jsonb and (jsonb_typeof(b->'interpretedText')<>'string' or length(b->>'interpretedText')>4000))
    or jsonb_typeof(b->'suggestions') is distinct from 'object' or jsonb_typeof(b->'resolutions') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(b->'suggestions'))>30 then return false; end if;
   for k in select jsonb_object_keys(b->'resolutions') loop
    if not (b->'suggestions' ? k) or b->'resolutions'->>k not in ('brief','choice') then return false; end if;
   end loop;
  end loop;
 end if;
 return true;
exception when others then return false;
end $$;

create or replace function public.submit_configured_paper_v4(target uuid,target_teacher uuid,request_key uuid,expected_revision integer,submitted_answers jsonb,plan jsonb,current_evaluation jsonb) returns uuid
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
 if current_evaluation is null or current_evaluation->>'engine' is distinct from 'cfg01-engine@2' or current_evaluation->'ready' is distinct from 'true'::jsonb or current_evaluation->>'definitionsSha256' is distinct from c.definitions_sha256
  or not private.valid_configuration(c.configuration,o.snapshot,true) or not private.configuration_totals_match(c.configuration,o.snapshot)
 then raise exception 'Configuration is not ready'; end if;
 if not private.valid_order_answers(jsonb_set(o.form,'{paperFields}','[]'::jsonb),submitted_answers) then raise exception 'Invalid answers'; end if;
 -- Plan version 2 adds the presentation order and each line's exact source binding.
 if not private.form_keys(plan,array['schema','orderId','module','release','formRevision','configurationRevision','definitionsSha256','targets','lines','order'])
  or plan->>'schema'<>'reviseit/configured-generation-plan@4' or plan->'order'<>coalesce(c.configuration->'order',(select jsonb_agg(l->'id') from jsonb_array_elements(o.snapshot->'lines') l)) or plan->>'orderId'<>target::text or plan->>'module'<>o.module_id or plan->>'release'<>o.release
  or plan->>'formRevision'<>o.snapshot->>'formRevision' or plan->'configurationRevision'<>to_jsonb(c.revision) or plan->>'definitionsSha256'<>c.definitions_sha256
  or plan->'targets'<>c.configuration->'targets' or jsonb_typeof(plan->'lines')<>'array' or jsonb_array_length(plan->'lines')<>jsonb_array_length(o.snapshot->'lines')
  or octet_length(plan::text)>360000 then raise exception 'Invalid generation plan'; end if;
 for line in select value from jsonb_array_elements(o.snapshot->'lines') loop
  pl:=plan->'lines'->pos;pos:=pos+1;own:=c.configuration->'lines'->(line->>'id');
  if not private.form_keys(pl,array['id','entryId','identity','kind','marks','parts','facets','answers','classificationSha256','requirementsRef','diagram','sourceBinding','teacherBrief'])
   or pl->'teacherBrief' is distinct from coalesce(c.configuration->'briefs'->(line->>'id'),'null'::jsonb)
   or (pl->'teacherBrief'<>'null'::jsonb and pl->'teacherBrief'->>'text'<>coalesce(pl->'teacherBrief'->>'interpretedText',''))
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
  or exists(select 1 from jsonb_array_elements(capabilities) x where x not in ('"configured-plan@1"'::jsonb,'"configured-plan@2"'::jsonb,'"configured-plan@3"'::jsonb,'"configured-plan@4"'::jsonb)) then raise exception 'Invalid worker capabilities'; end if;
 configured:=capabilities ? 'configured-plan@1' or capabilities ? 'configured-plan@2' or capabilities ? 'configured-plan@3' or capabilities ? 'configured-plan@4';
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


revoke all on function public.submit_configured_paper_v4(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_configured_paper_v4(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb) to service_role;
commit;
