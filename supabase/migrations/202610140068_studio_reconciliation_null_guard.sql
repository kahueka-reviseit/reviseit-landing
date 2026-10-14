begin;
-- A missing phase envelope must fail closed, including in v3 plans.
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
  or coalesce(plan->>'schema','') not in ('reviseit/studio-analysis-trial-plan@1','reviseit/studio-analysis-trial-plan@2','reviseit/studio-analysis-trial-plan@3') or plan->>'moduleId' is distinct from r.module_id
  or c.evidence->>'planDigest' is distinct from p_plan_sha256
  or (plan->'phaseLimits' is distinct from '{"page":{"requestBytes":2097152,"outputTokens":8192,"images":1},"reconcile":{"requestBytes":262144,"outputTokens":32768,"images":0}}'::jsonb and not (plan->>'schema'='reviseit/studio-analysis-trial-plan@3' and plan->'phaseLimits' is not distinct from '{"page":{"requestBytes":2097152,"outputTokens":8192,"images":1},"reconcile":{"requestBytes":1048576,"outputTokens":32768,"images":0}}'::jsonb))
  or (plan->>'schema' in ('reviseit/studio-analysis-trial-plan@2','reviseit/studio-analysis-trial-plan@3') and plan->'runtime' is distinct from '{"requestBytes":1500000,"turns":3,"rejections":2,"callSeconds":300,"batchSeconds":960,"stageSeconds":7200}'::jsonb)
  or plan->>'bankManifestSha256' is distinct from i.bank_manifest_sha256
  or plan->'stages' is distinct from '["S1_extract","S2_task_match","S3_spec_match","S4_prioritise","S5_draft","S6_assemble_validate","S7_package"]'::jsonb
  or inputs->>'policySha256' is distinct from i.policy_sha256 or inputs->>'skillSha256' is distinct from i.skill_sha256
  or coalesce(inputs->>'pageCount','') !~ (case when plan->>'schema'='reviseit/studio-analysis-trial-plan@3' then '^([1-9]|[1-3][0-9]|40)$' else '^([1-9]|1[0-9]|20)$' end)
  or (plan->>'schema'='reviseit/studio-analysis-trial-plan@3' and inputs->>'sourceRole' is distinct from 'combined')
  then raise exception 'Live Studio provider workflow trial contract refused'; end if;
 pages:=(inputs->>'pageCount')::integer;
 if jsonb_typeof(inputs->'pages') is distinct from 'array' or jsonb_array_length(inputs->'pages')<>pages
  or plan->'limits' is distinct from jsonb_build_object('trialMicro',trial_limit,'runMicro',run_limit,'stageMicro',30000000,'operationMicro',9000000,'maxDispatches',256,'requiredBalanceMicro',9000000)
  or (select count(*) from private.studio_run_budgets where trial_id=b.trial_id)<>1
  or (select count(*) from private.studio_source_files where source_revision_id=i.source_revision_id)<>1
  or not exists(select 1 from private.studio_source_files f join private.studio_blobs x on x.id=f.blob_id
    where f.source_revision_id=i.source_revision_id and f.role=(case when plan->>'schema'='reviseit/studio-analysis-trial-plan@3' then 'combined' else 'question_paper' end) and x.media_type='application/pdf'
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

commit;
