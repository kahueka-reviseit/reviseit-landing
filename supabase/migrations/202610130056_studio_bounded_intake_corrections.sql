begin;
-- New v2 plans only: bounded, schema-rejected tool-response correction; no transport retry.
create or replace function public.studio_live_authorise_workflow(p_run uuid,p_plan_sha256 text,p_scope jsonb,p_expires timestamptz,p_reference text,p_key_evidence_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.studio_runs; i private.studio_run_inputs; b private.studio_run_budgets; c private.studio_budget_contracts;
 t private.studio_budget_trials; a private.studio_live_authorisations; plan jsonb; inputs jsonb; pages integer; trial_limit bigint; run_limit bigint;
begin
 select * into r from private.studio_runs where id=p_run for update;
 select * into i from private.studio_run_inputs where run_id=p_run and input_revision=r.current_input_revision;
 select * into b from private.studio_run_budgets where run_id=p_run;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 select * into t from private.studio_budget_trials where id=b.trial_id for update;
 plan:=c.evidence->'analysisWorkflow'; inputs:=plan->'inputManifest';
 -- A distinct complete-analysis grant; existing intake grants are not expanded.
 trial_limit:=100000000;
 run_limit:=90000000;
 if r.id is null or r.purpose<>'rehearsal' or r.state<>'active' or c.mode is distinct from 'openrouter' or t.state is distinct from 'open'
  or not exists(select 1 from private.studio_provider_profiles where id=c.profile_id and mode='live' and enabled)
  or c.endpoint<>'https://openrouter.ai/api/v1/chat/completions'
  or t.limit_micro<>trial_limit or b.run_limit_micro<>run_limit or b.stage_limit_micro<>30000000 or b.operation_limit_micro<>9000000
  or c.max_request_bytes<>4194304 or c.max_input_tokens<>4259840 or c.max_output_tokens<>32768 or c.max_images<>16 or c.image_token_ceiling<>4096
  or coalesce(plan->>'schema','') not in ('reviseit/studio-analysis-trial-plan@1','reviseit/studio-analysis-trial-plan@2') or plan->>'moduleId' is distinct from r.module_id
  or c.evidence->>'planDigest' is distinct from p_plan_sha256
  or plan->'phaseLimits' is distinct from '{"page":{"requestBytes":2097152,"outputTokens":8192,"images":1},"reconcile":{"requestBytes":262144,"outputTokens":32768,"images":0}}'::jsonb
  or (plan->>'schema'='reviseit/studio-analysis-trial-plan@2' and plan->'runtime' is distinct from '{"requestBytes":1500000,"turns":3,"rejections":2,"callSeconds":300,"batchSeconds":960,"stageSeconds":7200}'::jsonb)
  or plan->>'bankManifestSha256' is distinct from i.bank_manifest_sha256
  or plan->'stages' is distinct from '["S1_extract","S2_task_match","S3_spec_match","S4_prioritise","S5_draft","S6_assemble_validate","S7_package"]'::jsonb
  or inputs->>'policySha256' is distinct from i.policy_sha256 or inputs->>'skillSha256' is distinct from i.skill_sha256
  or coalesce(inputs->>'pageCount','') !~ '^([1-9]|1[0-9]|20)$'
  then raise exception 'Live Studio provider workflow trial contract refused'; end if;
 pages:=(inputs->>'pageCount')::integer;
 if jsonb_typeof(inputs->'pages') is distinct from 'array' or jsonb_array_length(inputs->'pages')<>pages
  or plan->'limits' is distinct from jsonb_build_object('trialMicro',trial_limit,'runMicro',run_limit,'stageMicro',30000000,'operationMicro',9000000,'maxDispatches',256,'requiredBalanceMicro',9000000)
  or (select count(*) from private.studio_run_budgets where trial_id=b.trial_id)<>1
  or (select count(*) from private.studio_source_files where source_revision_id=i.source_revision_id)<>1
  or not exists(select 1 from private.studio_source_files f join private.studio_blobs x on x.id=f.blob_id
    where f.source_revision_id=i.source_revision_id and f.role='question_paper' and x.media_type='application/pdf'
    and x.sha256=inputs->>'sourceSha256' and x.size_bytes::text=inputs->>'sourceBytes' and x.integrity='verified')
  then raise exception 'Live Studio provider workflow source or dispatch scope refused'; end if;
 if p_scope is distinct from jsonb_build_object('sourceDigest',i.source_digest,'bankManifestSha256',i.bank_manifest_sha256,'policySha256',i.policy_sha256,'skillSha256',i.skill_sha256)
  or coalesce(p_plan_sha256,'') !~ '^[a-f0-9]{64}$' or coalesce(p_key_evidence_sha256,'') !~ '^[a-f0-9]{64}$'
  or length(coalesce(p_reference,''))<10 or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '24 hours'
  then raise exception 'Live Studio provider requires exact paper scope, fresh expiry and explicit authorisation'; end if;
 select * into a from private.studio_live_authorisations where run_id=p_run;
 if found then
  if a.trial_kind<>'analysis_workflow' or a.max_dispatches<>256 or a.plan_sha256<>p_plan_sha256 or a.scope<>p_scope or a.expires_at<>p_expires or a.reference<>p_reference or a.key_evidence_sha256<>p_key_evidence_sha256 or a.revoked_at is not null or a.input_revision<>i.input_revision then raise exception 'Live Studio provider authorisation is immutable'; end if;
  return to_jsonb(a);
 end if;
 if exists(select 1 from private.studio_provider_attempts x join private.studio_provider_operations o on o.id=x.operation_id join private.studio_stages s on s.id=o.stage_id where s.run_id=p_run and x.possible_charge)
  then raise exception 'Live Studio provider already dispatched'; end if;
 insert into private.studio_live_authorisations(run_id,plan_sha256,input_revision,scope,expires_at,reference,key_evidence_sha256,trial_kind,max_dispatches)
 values(p_run,p_plan_sha256,i.input_revision,p_scope,p_expires,p_reference,p_key_evidence_sha256,'analysis_workflow',256) returning * into a;
 perform private.studio_event(r.module_id,r.id,'operator','studio','live_analysis_workflow_authorised',jsonb_build_object('plan',p_plan_sha256,'expires',p_expires,'scope',p_scope,'maxDispatches',256));
 return to_jsonb(a);
end $$;

create or replace function private.studio_paper_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.studio_live_authorisations; c private.studio_budget_contracts; phase text; page integer; pages integer; turn integer; correction_plan boolean; op_key text;
begin
 select * into a from private.studio_live_authorisations where run_id=new.run_id;
 if a.trial_kind not in ('question_paper','analysis_workflow') or a.trial_kind is null then return new; end if;
 select * into c from private.studio_budget_contracts where id=new.contract_id;
 if a.trial_kind='analysis_workflow' and new.request_manifest->>'workflowStage' is distinct from new.stage_key then raise exception 'Workflow stage identity differs'; end if;
 if a.trial_kind='analysis_workflow' and new.stage_key<>'S1_extract' then
  if new.stage_key not in ('S2_task_match','S3_spec_match','S5_draft') or new.request_manifest ? 'intakePhase' then raise exception 'Workflow provider stage refused'; end if;
  return new;
 end if;
 phase:=new.request_manifest->>'intakePhase';
 if coalesce(new.request_manifest->>'sourcePage','') !~ '^[0-9]{1,2}$' then raise exception 'Budget paper source page required'; end if;
 page:=(new.request_manifest->>'sourcePage')::integer;pages:=case when a.trial_kind='analysis_workflow' then (c.evidence->'analysisWorkflow'->'inputManifest'->>'pageCount')::integer else a.max_dispatches-1 end;
 if phase='page' then
  if page<1 or page>pages or (new.request_manifest->>'imageCount')::integer<>1
   or (new.request_manifest->>'requestBytes')::integer>(case when a.trial_kind='analysis_workflow' then 2097152 else 786432 end) or (new.request_manifest->>'outputTokens')::integer<>8192
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
 correction_plan:=a.trial_kind='analysis_workflow' and c.evidence->'analysisWorkflow'->>'schema'='reviseit/studio-analysis-trial-plan@2';
 if correction_plan then
  if coalesce(new.request_manifest->>'intakeTurn','') !~ '^[1-3]$' then raise exception 'Intake correction turn required'; end if;
  turn:=(new.request_manifest->>'intakeTurn')::integer;
  select operation into op_key from private.studio_provider_operations where id=new.operation_id;
  if op_key !~ (':turn:'||turn||'$') then raise exception 'Intake correction operation identity differs'; end if;
  if turn>1 and not exists(select 1 from private.studio_budget_reservations z
    join private.studio_provider_attempts p on p.id=z.provider_attempt_id
    join private.studio_provider_operations o on o.id=z.operation_id
    where z.run_id=new.run_id and z.request_manifest->>'intakePhase'=phase
      and z.request_manifest->>'sourcePage'=new.request_manifest->>'sourcePage'
      and z.request_manifest->>'intakeTurn'=(turn-1)::text
      and o.operation=regexp_replace(op_key,':turn:[1-3]$',':turn:'||(turn-1))
      and p.dispatch_state='succeeded' and z.state='settled' and z.actual_micro is not null
      and z.actual_micro<=z.reserved_micro)
    then raise exception 'Intake correction requires preceding settled reply'; end if;
 elsif new.request_manifest ? 'intakeTurn' then raise exception 'Legacy intake grant has no correction turns'; end if;
 if exists(select 1 from private.studio_budget_reservations z where z.run_id=new.run_id
   and z.request_manifest->>'intakePhase'=phase and (z.request_manifest->>'sourcePage')::integer=page
   and (not correction_plan or z.request_manifest->>'intakeTurn'=turn::text)) then
  -- Intake-only grants remain single-shot. Complete workflows may resume only an
  -- explicitly retried, identical logical operation after exact cost reconciliation.
  if a.trial_kind<>'analysis_workflow' then raise exception 'Budget paper page or reconciliation already reserved; new trial required for retry'; end if;
  if not exists(
    select 1 from private.studio_provider_attempts n
    join private.studio_provider_attempts previous on previous.operation_id=n.operation_id and previous.attempt_number=n.attempt_number-1
    join private.studio_budget_reservations prior on prior.provider_attempt_id=previous.id
    where n.id=new.provider_attempt_id and n.operation_id=new.operation_id
      and n.retried_by is not null and length(trim(n.retry_reason))>=10
      and previous.dispatch_state in ('failed','uncertain','failed_before_dispatch')
      and prior.state in ('settled','released') and prior.actual_micro is not null
      and prior.actual_micro<=prior.reserved_micro
      and prior.request_digest=new.request_digest and prior.request_manifest=new.request_manifest
  ) or exists(
    select 1 from private.studio_budget_reservations z where z.run_id=new.run_id
      and z.request_manifest->>'intakePhase'=phase and (z.request_manifest->>'sourcePage')::integer=page
      and (not correction_plan or z.request_manifest->>'intakeTurn'=turn::text)
      and z.operation_id<>new.operation_id
  ) then raise exception 'Budget paper retry requires explicit same-operation retry and reconciled prior cost'; end if;
 end if;
 return new;
end $$;
commit;
