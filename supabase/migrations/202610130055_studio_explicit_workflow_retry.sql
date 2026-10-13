begin;
-- Preserve all grants, limits and completed results; support the existing explicit retry command.
create or replace function private.studio_paper_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.studio_live_authorisations; c private.studio_budget_contracts; phase text; page integer; pages integer;
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
 if exists(select 1 from private.studio_budget_reservations z where z.run_id=new.run_id
   and z.request_manifest->>'intakePhase'=phase and (z.request_manifest->>'sourcePage')::integer=page) then
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
      and z.operation_id<>new.operation_id
  ) then raise exception 'Budget paper retry requires explicit same-operation retry and reconciled prior cost'; end if;
 end if;
 return new;
end $$;
commit;
