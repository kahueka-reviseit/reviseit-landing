begin;
-- Existing order functions retain their checks, with a shared funding predicate.

create or replace function public.paper_configuration_for_teacher(target uuid,target_teacher uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o private.paper_orders; c private.paper_configurations; pay private.paper_payments; plan private.paper_configuration_plans;
begin
 select * into o from private.paper_orders where id=target;
 if not found or o.adapter_key<>'configured-bundle-v1' or not private.teacher_order_access(o,target_teacher) then return null; end if;
 select * into c from private.paper_configurations where order_id=target;
 select * into pay from private.paper_payments where order_id=target;
 select * into plan from private.paper_configuration_plans where order_id=target;
 return jsonb_build_object('orderId',o.id,'state',o.state,'moduleId',o.module_id,'release',o.release,
  'paid',private.order_has_funding(o.id),'purchasedTotal',case when o.entitlement='department_credit' then (select q.targets->'paper' from private.paper_credit_funding f join private.paper_credit_quotes q on q.id=f.quote_id where f.order_id=o.id) else null end,
  'paymentStatus',case when o.entitlement='department_credit' then case when private.order_has_funding(o.id) then 'paid' else 'refunded' end when pay.refunded_at is not null then 'refunded' when pay.status in ('creating','open') and pay.expires_at<=now() then 'expired' else pay.status end,
  'revision',c.revision,'configuration',c.configuration,'evaluation',c.evaluation,'definitionsSha256',c.definitions_sha256,
  'form',o.form,'snapshot',o.snapshot,'submitted',o.submission_key is not null,'submittedRevision',plan.revision);
end $$;

create or replace function public.save_paper_configuration(target uuid,target_teacher uuid,expected_revision integer,configuration jsonb,evaluation jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; c private.paper_configurations; pay private.paper_payments; paid boolean; next_revision integer;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or o.adapter_key<>'configured-bundle-v1' or not private.teacher_order_access(o,target_teacher) then raise exception 'Order access required'; end if;
 select * into c from private.paper_configurations where order_id=target for update;
 select * into pay from private.paper_payments where order_id=target;
 paid:=private.order_has_funding(o.id);
 if o.submission_key is not null or o.state not in ('awaiting_payment','awaiting_answers') then raise exception 'Order already submitted'; end if;
 if o.state='awaiting_payment' and (pay.status not in ('creating','open') or pay.expires_at<=now() or pay.refunded_at is not null) then raise exception 'Order cannot be configured'; end if;
 if o.state='awaiting_answers' and not paid then raise exception 'Order cannot be configured'; end if;
 if expected_revision is null or expected_revision<>c.revision then raise exception 'Configuration changed'; end if;
 if o.entitlement='department_credit' and configuration->'targets'->'paper' is distinct from
 (select q.targets->'paper' from private.paper_credit_funding f join private.paper_credit_quotes q on q.id=f.quote_id where f.order_id=o.id)
 then raise exception 'Purchased total is fixed'; end if;
 if not private.valid_configuration(configuration,o.snapshot,paid and o.state='awaiting_answers') then raise exception 'Invalid configuration'; end if;
 if jsonb_typeof(evaluation) is distinct from 'object' or octet_length(evaluation::text)>64000
  or evaluation->>'definitionsSha256' is distinct from c.definitions_sha256 or jsonb_typeof(evaluation->'ready') is distinct from 'boolean'
 then raise exception 'Invalid configuration evaluation'; end if;
 next_revision:=c.revision+1;
 insert into private.paper_configuration_revisions(order_id,revision,configuration,evaluation,actor) values(target,next_revision,configuration,evaluation,target_teacher::text);
 update private.paper_configurations set revision=next_revision,configuration=save_paper_configuration.configuration,evaluation=save_paper_configuration.evaluation,updated_at=now() where order_id=target;
 return next_revision;
end $$;

create or replace function public.submit_configured_paper_v5(target uuid,target_teacher uuid,request_key uuid,expected_revision integer,submitted_answers jsonb,plan jsonb,current_evaluation jsonb) returns uuid
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
 if not private.order_has_funding(o.id) then raise exception 'Order cannot be submitted'; end if;
 if o.state<>'awaiting_answers' then raise exception 'Order cannot be submitted'; end if;
 if request_key is null or expected_revision is null or expected_revision<>c.revision then raise exception 'Configuration changed'; end if;
 if current_evaluation is null or current_evaluation->>'engine' is distinct from 'cfg01-engine@2' or current_evaluation->'ready' is distinct from 'true'::jsonb or current_evaluation->>'definitionsSha256' is distinct from c.definitions_sha256
  or not private.valid_configuration(c.configuration,o.snapshot,true) or not private.configuration_totals_match(c.configuration,o.snapshot)
 then raise exception 'Configuration is not ready'; end if;
 if not private.valid_order_answers(jsonb_set(o.form,'{paperFields}','[]'::jsonb),submitted_answers) then raise exception 'Invalid answers'; end if;
 -- Plan version 2 adds the presentation order and each line's exact source binding.
 if not private.form_keys(plan,array['schema','orderId','module','release','formRevision','configurationRevision','definitionsSha256','targets','lines','order'])
  or plan->>'schema'<>'reviseit/configured-generation-plan@5' or plan->'order'<>coalesce(c.configuration->'order',(select jsonb_agg(l->'id') from jsonb_array_elements(o.snapshot->'lines') l)) or plan->>'orderId'<>target::text or plan->>'module'<>o.module_id or plan->>'release'<>o.release
  or plan->>'formRevision'<>o.snapshot->>'formRevision' or plan->'configurationRevision'<>to_jsonb(c.revision) or plan->>'definitionsSha256'<>c.definitions_sha256
  or plan->'targets'<>c.configuration->'targets' or jsonb_typeof(plan->'lines')<>'array' or jsonb_array_length(plan->'lines')<>jsonb_array_length(o.snapshot->'lines')
  or octet_length(plan::text)>360000 then raise exception 'Invalid generation plan'; end if;
 for line in select value from jsonb_array_elements(o.snapshot->'lines') loop
  pl:=plan->'lines'->pos;pos:=pos+1;own:=c.configuration->'lines'->(line->>'id');
  if not private.form_keys(pl,array['id','entryId','identity','kind','marks','parts','facets','answers','classificationSha256','diagram','sourceBinding','teacherBrief'])
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
  or exists(select 1 from jsonb_array_elements(capabilities) x where x not in ('"configured-plan@1"'::jsonb,'"configured-plan@2"'::jsonb,'"configured-plan@3"'::jsonb,'"configured-plan@4"'::jsonb,'"configured-plan@5"'::jsonb)) then raise exception 'Invalid worker capabilities'; end if;
 configured:=capabilities ? 'configured-plan@1' or capabilities ? 'configured-plan@2' or capabilities ? 'configured-plan@3' or capabilities ? 'configured-plan@4' or capabilities ? 'configured-plan@5';
 select * into o from private.paper_orders x
 where (x.state='queued' or (x.state in ('generating','rendering') and x.lease_until<now()))
 and (x.worker_id is null or x.worker_id=worker)
 -- A configured order goes only to a worker declaring its exact plan version.
 and (x.adapter_key<>'configured-bundle-v1' or (configured and exists(select 1 from private.paper_configuration_plans c where c.order_id=x.id
  and capabilities ? replace(c.plan->>'schema','reviseit/configured-generation-plan','configured-plan'))))
 and (x.entitlement='internal_test' or private.order_has_funding(x.id))
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
 || case when o.entitlement='paid' then jsonb_build_object('entitlement','paid','paymentMode',pay.mode) when o.entitlement='department_credit' then jsonb_build_object('entitlement','paid','paymentMode',(select mode from private.paper_credit_funding where order_id=o.id)) else '{}'::jsonb end
 || case when plan.order_id is null then '{}'::jsonb else jsonb_build_object('configurationPlan',plan.plan) end;
end $$;

create or replace function public.teacher_orders(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'title',o.title,'moduleId',o.module_id,'release',o.release,'internalTest',o.entitlement='internal_test',
 'state',o.state,'createdAt',o.created_at,'updatedAt',o.updated_at,
 'form',case when target is not null and o.state='awaiting_answers' and o.adapter_key<>'configured-bundle-v1' then o.form else null end,
 'answers',case when target is not null then o.answers else null end,
 'answerSummary',case when target is not null and jsonb_typeof(o.form)='object' and o.answers is not null then private.questionnaire_receipt(o.form,o.answers) else null end,
 'documents',case when o.state='released' then to_jsonb(array['paper','memo','learner-memo','teacher-description']) else '[]'::jsonb end,
 'payment',case when o.entitlement='department_credit' then (select jsonb_build_object('source','department_credit','status',case when private.order_has_funding(o.id) then 'paid' else 'refunded' end,'amountMinor',f.amount_minor,'currency','zar','testMode',f.mode='test','checkoutUrl',null,'needsAttention',false) from private.paper_credit_funding f where f.order_id=o.id) when p.order_id is null then null else jsonb_build_object('status',case when p.refunded_at is not null then 'refunded'
   when p.status in ('creating','open') and p.expires_at<=now() then 'expired' else p.status end,
  'amountMinor',p.amount_minor,'currency',p.currency,'testMode',p.mode='test',
  'checkoutUrl',case when target is not null and p.status='open' and p.expires_at>now() and o.state='awaiting_payment' then p.checkout_url else null end,
  'needsAttention',p.attention is not null) end,
 'configurable',o.adapter_key='configured-bundle-v1'
 ) order by o.created_at desc),'[]'::jsonb)
 from (select * from private.paper_orders x where (target is null or x.id=target) and private.can_read_order(x)
 order by x.created_at desc limit 100) o left join private.paper_payments p on p.order_id=o.id;
$$;

create or replace function public.return_department_credit(spend_id uuid,reason text,request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare original private.credit_operations; op private.credit_operations; allocation record; oid uuid; req jsonb; order_state text;
begin
 if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
 if reason is null or length(trim(reason)) not between 3 and 2000 or request_key is null then raise exception 'Invalid return reason'; end if;
 select * into original from private.credit_operations where id=spend_id and kind='spend';
 if not found then raise exception 'Credit spend not found'; end if;
 select state into order_state from private.paper_orders where id=original.order_id for update;
 if order_state not in ('awaiting_answers','held','cancelled') then raise exception 'Paper must be stopped before credit is returned'; end if;
 perform private.lock_credit_wallet(original.department_id,original.mode);
 req:=jsonb_build_object('spend',spend_id,'reason',trim(reason));
 select * into op from private.credit_operations where credit_operations.request_key=return_department_credit.request_key;
 if found then
  if op.kind<>'return' or op.actor_id is distinct from auth.uid() or op.request<>req then raise exception 'Request key already used'; end if;
  return op.id;
 end if;
 if exists(select 1 from private.credit_operations where original_operation=spend_id and kind='return') then raise exception 'Credit already returned'; end if;
 -- Expiry/refunded-source policy is not invented here. Staff must resolve it
 -- separately rather than silently reviving expired or voided money.
 if exists(select 1 from private.credit_entries e join private.credit_sources s on s.id=e.source_id
  where e.operation_id=spend_id and (s.voided_at is not null or s.expires_at<=now())) then raise exception 'Original credit source needs review'; end if;
 insert into private.credit_operations(department_id,mode,actor_id,request_key,kind,amount_minor,request,reason,original_operation,order_id)
 values(original.department_id,original.mode,auth.uid(),request_key,'return',original.amount_minor,req,trim(reason),spend_id,original.order_id) returning id into oid;
 for allocation in select * from private.credit_entries where operation_id=spend_id loop
  update private.credit_sources set remaining_minor=remaining_minor-allocation.amount_minor where id=allocation.source_id;
  insert into private.credit_entries(operation_id,source_id,department_id,mode,amount_minor)
   values(oid,allocation.source_id,original.department_id,original.mode,-allocation.amount_minor);
 end loop;
 update private.department_wallets set revision=revision+1 where department_id=original.department_id and mode=original.mode;
 update private.paper_credit_funding set returned_at=now() where order_id=original.order_id;
 update private.paper_orders set state='cancelled',updated_at=now() where id=original.order_id;
 insert into private.paper_job_events(order_id,event,actor,detail) values(original.order_id,'credit_returned',auth.uid()::text,jsonb_build_object('operationId',oid));
 return oid;
end $$;

commit;
