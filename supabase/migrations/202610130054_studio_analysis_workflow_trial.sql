begin;
-- Complete rehearsals only. No profile, run, allowance or approval is installed.
alter table private.studio_live_authorisations drop constraint studio_live_authorisations_trial_kind_check;
alter table private.studio_live_authorisations drop constraint studio_live_authorisations_max_dispatches_check;
alter table private.studio_live_authorisations add constraint studio_live_authorisations_trial_kind_check check(trial_kind in ('synthetic','question_paper','analysis_workflow'));
alter table private.studio_live_authorisations add constraint studio_live_authorisations_max_dispatches_check check(max_dispatches between 2 and (case when trial_kind='analysis_workflow' then 256 else 21 end));
create function public.studio_live_authorise_workflow(p_run uuid,p_plan_sha256 text,p_scope jsonb,p_expires timestamptz,p_reference text,p_key_evidence_sha256 text)
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
  or plan->>'schema' is distinct from 'reviseit/studio-analysis-trial-plan@1' or plan->>'moduleId' is distinct from r.module_id
  or c.evidence->>'planDigest' is distinct from p_plan_sha256
  or plan->'phaseLimits' is distinct from '{"page":{"requestBytes":2097152,"outputTokens":8192,"images":1},"reconcile":{"requestBytes":262144,"outputTokens":32768,"images":0}}'::jsonb
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

create or replace function private.studio_live_allowed(p_run uuid,p_profile text,p_stage text) returns boolean
language plpgsql security definer set search_path='' as $$
declare p private.studio_provider_profiles; b private.studio_run_budgets; c private.studio_budget_contracts; a private.studio_live_authorisations; i private.studio_run_inputs;
begin
 select * into p from private.studio_provider_profiles where id=p_profile and enabled;
 if not found then return false; end if;
 select * into b from private.studio_run_budgets where run_id=p_run;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 if p.mode='mock' then return b.run_id is null or (c.mode='recorded' and c.profile_id=p.id); end if;
 if c.mode is distinct from 'openrouter' or c.profile_id is distinct from p.id then return false; end if;
 select * into a from private.studio_live_authorisations where run_id=p_run;
 if a.trial_kind='analysis_workflow' then
  if p_stage not in ('S1_extract','S2_task_match','S3_spec_match','S4_prioritise','S5_draft','S6_assemble_validate','S7_package') then return false; end if;
 elsif p_stage<>'S1_extract' then return false; end if;
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and r.current_input_revision=x.input_revision where r.id=p_run;
 return a.run_id is not null and a.revoked_at is null and a.expires_at>clock_timestamp() and a.input_revision=i.input_revision
  and a.scope=jsonb_build_object('sourceDigest',i.source_digest,'bankManifestSha256',i.bank_manifest_sha256,'policySha256',i.policy_sha256,'skillSha256',i.skill_sha256);
end $$;

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
   and z.request_manifest->>'intakePhase'=phase and (z.request_manifest->>'sourcePage')::integer=page)
  then raise exception 'Budget paper page or reconciliation already reserved; new trial required for retry'; end if;
 return new;
end $$;
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
 if jsonb_typeof(c.evidence->'analysisWorkflow')='object' then
  evidence:=evidence||jsonb_build_object('analysisWorkflow',c.evidence->'analysisWorkflow');
 end if;
 return jsonb_build_object('contract',(to_jsonb(c)-'evidence')||case when evidence='{}'::jsonb then '{}'::jsonb else jsonb_build_object('evidence',evidence) end,
  'trialId',b.trial_id,'runId',b.run_id);
end $$;


create function public.studio_live_refresh_key_evidence(p_run uuid,p_plan text,p_previous text,p_new text,p_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare a private.studio_live_authorisations;
begin
 select * into a from private.studio_live_authorisations where run_id=p_run for update;
 if a.run_id is null or a.trial_kind<>'analysis_workflow' or a.revoked_at is not null or a.expires_at<=clock_timestamp()
  or a.plan_sha256 is distinct from p_plan or a.key_evidence_sha256 is distinct from p_previous
  or coalesce(p_new,'') !~ '^[a-f0-9]{64}$' or length(coalesce(p_reference,''))<10
  then raise exception 'Exact active workflow key refresh required'; end if;
 update private.studio_live_authorisations set key_evidence_sha256=p_new where run_id=p_run;
 perform private.studio_event((select module_id from private.studio_runs where id=p_run),p_run,'operator','studio','live_key_preflight_refreshed',jsonb_build_object('previous',p_previous,'new',p_new,'reference',p_reference));
end $$;
revoke all on function public.studio_live_authorise_workflow(uuid,text,jsonb,timestamptz,text,text),public.studio_live_refresh_key_evidence(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_live_authorise_workflow(uuid,text,jsonb,timestamptz,text,text),public.studio_live_refresh_key_evidence(uuid,text,text,text,text) to reviseit_studio_operator;
commit;
