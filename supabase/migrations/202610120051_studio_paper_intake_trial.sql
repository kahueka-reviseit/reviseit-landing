begin;
-- A distinct question-paper rehearsal. Existing grants keep their two-call ceiling.
-- No allowance, profile, source or authorisation is installed by this migration.
alter table private.studio_live_authorisations
 add column trial_kind text not null default 'synthetic' check(trial_kind in ('synthetic','question_paper')),
 add column max_dispatches integer not null default 2 check(max_dispatches between 2 and 21),
 add constraint studio_live_scope_ceiling check(trial_kind<>'synthetic' or max_dispatches=2);

create function public.studio_live_authorise_paper(p_run uuid,p_plan_sha256 text,p_scope jsonb,p_expires timestamptz,p_reference text,p_key_evidence_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.studio_runs; i private.studio_run_inputs; b private.studio_run_budgets; c private.studio_budget_contracts;
 t private.studio_budget_trials; a private.studio_live_authorisations; plan jsonb; inputs jsonb; pages integer;
begin
 select * into r from private.studio_runs where id=p_run for update;
 select * into i from private.studio_run_inputs where run_id=p_run and input_revision=r.current_input_revision;
 select * into b from private.studio_run_budgets where run_id=p_run;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 select * into t from private.studio_budget_trials where id=b.trial_id for update;
 plan:=c.evidence->'paperIntake'; inputs:=plan->'inputManifest';
 if r.id is null or r.purpose<>'rehearsal' or r.state<>'active' or c.mode is distinct from 'openrouter' or t.state is distinct from 'open'
  or not exists(select 1 from private.studio_provider_profiles where id=c.profile_id and mode='live' and enabled)
  or c.endpoint<>'https://openrouter.ai/api/v1/chat/completions'
  or t.limit_micro<>12000000 or b.run_limit_micro<>10000000 or b.stage_limit_micro<>10000000 or b.operation_limit_micro<>2000000
  or c.max_request_bytes<>786432 or c.max_input_tokens<>790528 or c.max_output_tokens<>32768 or c.max_images<>1 or c.image_token_ceiling<>4096
  or plan->>'schema' is distinct from 'reviseit/studio-paper-intake-plan@1' or plan->>'moduleId' is distinct from r.module_id
  or c.evidence->>'planDigest' is distinct from p_plan_sha256
  or plan->'phaseLimits' is distinct from '{"page":{"requestBytes":786432,"outputTokens":8192,"images":1},"reconcile":{"requestBytes":262144,"outputTokens":32768,"images":0}}'::jsonb
  or inputs->>'policySha256' is distinct from i.policy_sha256 or inputs->>'skillSha256' is distinct from i.skill_sha256
  or coalesce(inputs->>'pageCount','') !~ '^([1-9]|1[0-9]|20)$'
  then raise exception 'Live Studio provider paper trial contract refused'; end if;
 pages:=(inputs->>'pageCount')::integer;
 if jsonb_typeof(inputs->'pages') is distinct from 'array' or jsonb_array_length(inputs->'pages')<>pages
  or plan->'limits' is distinct from jsonb_build_object('trialMicro',12000000,'runMicro',10000000,'stageMicro',10000000,'operationMicro',2000000,'maxDispatches',pages+1,'requiredBalanceMicro',10000000)
  or (select count(*) from private.studio_run_budgets where trial_id=b.trial_id)<>1
  or (select count(*) from private.studio_source_files where source_revision_id=i.source_revision_id)<>1
  or not exists(select 1 from private.studio_source_files f join private.studio_blobs x on x.id=f.blob_id
    where f.source_revision_id=i.source_revision_id and f.role='question_paper' and x.media_type='application/pdf'
    and x.sha256=inputs->>'sourceSha256' and x.size_bytes::text=inputs->>'sourceBytes' and x.integrity='verified')
  then raise exception 'Live Studio provider paper source or dispatch scope refused'; end if;
 if p_scope is distinct from jsonb_build_object('sourceDigest',i.source_digest,'bankManifestSha256',i.bank_manifest_sha256,'policySha256',i.policy_sha256,'skillSha256',i.skill_sha256)
  or coalesce(p_plan_sha256,'') !~ '^[a-f0-9]{64}$' or coalesce(p_key_evidence_sha256,'') !~ '^[a-f0-9]{64}$'
  or length(coalesce(p_reference,''))<10 or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '24 hours'
  then raise exception 'Live Studio provider requires exact paper scope, fresh expiry and explicit authorisation'; end if;
 select * into a from private.studio_live_authorisations where run_id=p_run;
 if found then
  if a.trial_kind<>'question_paper' or a.max_dispatches<>pages+1 or a.plan_sha256<>p_plan_sha256 or a.scope<>p_scope or a.expires_at<>p_expires or a.reference<>p_reference or a.key_evidence_sha256<>p_key_evidence_sha256 or a.revoked_at is not null or a.input_revision<>i.input_revision then raise exception 'Live Studio provider authorisation is immutable'; end if;
  return to_jsonb(a);
 end if;
 if exists(select 1 from private.studio_provider_attempts x join private.studio_provider_operations o on o.id=x.operation_id join private.studio_stages s on s.id=o.stage_id where s.run_id=p_run and x.possible_charge)
  then raise exception 'Live Studio provider already dispatched'; end if;
 insert into private.studio_live_authorisations(run_id,plan_sha256,input_revision,scope,expires_at,reference,key_evidence_sha256,trial_kind,max_dispatches)
 values(p_run,p_plan_sha256,i.input_revision,p_scope,p_expires,p_reference,p_key_evidence_sha256,'question_paper',pages+1) returning * into a;
 perform private.studio_event(r.module_id,r.id,'operator','studio','live_paper_trial_authorised',jsonb_build_object('plan',p_plan_sha256,'expires',p_expires,'scope',p_scope,'maxDispatches',pages+1));
 return to_jsonb(a);
end $$;

create function private.studio_paper_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.studio_live_authorisations; c private.studio_budget_contracts; phase text; page integer; pages integer;
begin
 select * into a from private.studio_live_authorisations where run_id=new.run_id;
 if a.trial_kind is distinct from 'question_paper' then return new; end if;
 select * into c from private.studio_budget_contracts where id=new.contract_id;
 phase:=new.request_manifest->>'intakePhase';
 if coalesce(new.request_manifest->>'sourcePage','') !~ '^[0-9]{1,2}$' then raise exception 'Budget paper source page required'; end if;
 page:=(new.request_manifest->>'sourcePage')::integer;pages:=a.max_dispatches-1;
 if phase='page' then
  if page<1 or page>pages or (new.request_manifest->>'imageCount')::integer<>1
   or (new.request_manifest->>'requestBytes')::integer>786432 or (new.request_manifest->>'outputTokens')::integer<>8192
   then raise exception 'Budget paper page phase limit'; end if;
 elsif phase='reconcile' then
  if page<>0 or (new.request_manifest->>'imageCount')::integer<>0
   or (new.request_manifest->>'requestBytes')::integer>262144 or (new.request_manifest->>'outputTokens')::integer<>32768
   then raise exception 'Budget paper reconciliation phase limit'; end if;
  if (select count(distinct (z.request_manifest->>'sourcePage')::integer) from private.studio_budget_reservations z
    join private.studio_provider_attempts p on p.id=z.provider_attempt_id
    where z.run_id=new.run_id and z.request_manifest->>'intakePhase'='page' and p.dispatch_state='succeeded' and z.state='settled')<>pages
   then raise exception 'Budget paper reconciliation requires every settled page'; end if;
 else raise exception 'Budget paper phase required'; end if;
 if exists(select 1 from private.studio_budget_reservations z where z.run_id=new.run_id
   and z.request_manifest->>'intakePhase'=phase and (z.request_manifest->>'sourcePage')::integer=page)
  then raise exception 'Budget paper page or reconciliation already reserved; new trial required for retry'; end if;
 return new;
end $$;
create trigger studio_paper_reservation before insert on private.studio_budget_reservations
 for each row execute function private.studio_paper_reservation_guard();

create or replace function public.studio_budget_context(p_attempt uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; b private.studio_run_budgets; c private.studio_budget_contracts;
 routing jsonb; evidence jsonb := '{}'::jsonb; paper jsonb;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 select * into b from private.studio_run_budgets where run_id=s.run_id;
 if not found then raise exception 'Studio budget is not bound'; end if;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 if jsonb_typeof(c.evidence->'openrouter')='object' then
  select jsonb_object_agg(key,value) into routing from jsonb_each(c.evidence->'openrouter')
   where key in ('endpoint','model','provider','capability_sha256','pricing_sha256','input_micro_per_million','output_micro_per_million');
  evidence:=jsonb_build_object('openrouter',routing);
 end if;
 if jsonb_typeof(c.evidence->'paperIntake')='object' then
  paper:=c.evidence->'paperIntake';
  evidence:=evidence||jsonb_build_object('paperIntake',jsonb_build_object('moduleId',paper->'moduleId','phaseLimits',paper->'phaseLimits',
   'inputManifest',jsonb_build_object('sourceSha256',paper->'inputManifest'->'sourceSha256','policySha256',paper->'inputManifest'->'policySha256',
    'pageCount',paper->'inputManifest'->'pageCount','pages',(select jsonb_agg(jsonb_build_object('filePage',x->'filePage','renderSha256',x->'renderSha256','textSha256',x->'textSha256')) from jsonb_array_elements(paper->'inputManifest'->'pages') x))));
 end if;
 return jsonb_build_object('contract',(to_jsonb(c)-'evidence')||case when evidence='{}'::jsonb then '{}'::jsonb else jsonb_build_object('evidence',evidence) end,
  'trialId',b.trial_id,'runId',b.run_id);
end $$;

revoke all on function public.studio_live_authorise_paper(uuid,text,jsonb,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_live_authorise_paper(uuid,text,jsonb,timestamptz,text,text) to reviseit_studio_operator;
revoke all on function private.studio_paper_reservation_guard() from public,anon,authenticated,service_role,reviseit_studio_operator;

create or replace function private.studio_budget_dispatch_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare b private.studio_run_budgets; z private.studio_budget_reservations; rid uuid; t private.studio_budget_trials; ceiling integer;
begin
 if new.dispatch_state='dispatched' and old.dispatch_state is distinct from new.dispatch_state then
  select s.run_id into rid from private.studio_provider_operations o join private.studio_stages s on s.id=o.stage_id where o.id=new.operation_id;
  if not private.studio_live_allowed(rid,new.profile_id,(select stage_key from private.studio_stages where id=(select stage_id from private.studio_provider_operations where id=new.operation_id))) then raise exception 'Live Studio provider disabled'; end if;
  select * into b from private.studio_run_budgets where run_id=rid;
  if found then
   select * into t from private.studio_budget_trials where id=b.trial_id for update;
   select min(a.max_dispatches) into ceiling from private.studio_live_authorisations a join private.studio_run_budgets rb on rb.run_id=a.run_id where rb.trial_id=b.trial_id;
   if exists(select 1 from private.studio_budget_contracts where id=b.contract_id and mode='openrouter') and (select count(*) from private.studio_provider_attempts a join private.studio_budget_reservations q on q.provider_attempt_id=a.id where q.trial_id=b.trial_id and a.possible_charge)>=coalesce(ceiling,2) then raise exception 'Live Studio provider dispatch ceiling reached'; end if;
   select * into z from private.studio_budget_reservations where provider_attempt_id=new.id;
   if not found or z.state<>'held' then raise exception 'Budget reservation required before dispatch'; end if;
   if t.state<>'open' or exists(select 1 from private.studio_budget_reservations q join private.studio_provider_attempts p on p.id=q.provider_attempt_id where q.trial_id=t.id and
    ((q.actual_micro is null and p.dispatch_state in ('succeeded','failed','uncertain')) or q.actual_micro>q.reserved_micro)) then raise exception 'Budget reconciliation required'; end if;
  end if;
 end if;
 return new;
end $$;

commit;
