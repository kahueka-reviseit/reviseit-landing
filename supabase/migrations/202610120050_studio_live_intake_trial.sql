begin;
-- Narrow first live trial: S1 only, at most two dispatches, at most USD 2.
-- Installs controls only: no profile, allowance, authorisation or credential is created.
alter table private.studio_budget_contracts drop constraint studio_budget_contracts_mode_check;
alter table private.studio_budget_contracts add constraint studio_budget_contracts_mode_check check(mode in ('recorded','openrouter'));
create table private.studio_live_authorisations (
 run_id uuid primary key references private.studio_run_budgets(run_id),
 plan_sha256 text not null check(plan_sha256 ~ '^[a-f0-9]{64}$'),
 input_revision integer not null,
 scope jsonb not null,
 expires_at timestamptz not null,
 reference text not null,
 key_evidence_sha256 text not null check(key_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 revoked_reason text
);
alter table private.studio_live_authorisations enable row level security;
revoke all on private.studio_live_authorisations from public,anon,authenticated,service_role,reviseit_studio_operator;

create function private.studio_live_allowed(p_run uuid,p_profile text,p_stage text) returns boolean
language plpgsql security definer set search_path='' as $$
declare p private.studio_provider_profiles; b private.studio_run_budgets; c private.studio_budget_contracts; a private.studio_live_authorisations; i private.studio_run_inputs;
begin
 select * into p from private.studio_provider_profiles where id=p_profile and enabled;
 if not found then return false; end if;
 select * into b from private.studio_run_budgets where run_id=p_run;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 if p.mode='mock' then return b.run_id is null or (c.mode='recorded' and c.profile_id=p.id); end if;
 if p_stage<>'S1_extract' or c.mode is distinct from 'openrouter' or c.profile_id is distinct from p.id then return false; end if;
 select * into a from private.studio_live_authorisations where run_id=p_run;
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and r.current_input_revision=x.input_revision where r.id=p_run;
 return a.run_id is not null and a.revoked_at is null and a.expires_at>clock_timestamp() and a.input_revision=i.input_revision
  and a.scope=jsonb_build_object('sourceDigest',i.source_digest,'bankManifestSha256',i.bank_manifest_sha256,'policySha256',i.policy_sha256,'skillSha256',i.skill_sha256);
end $$;

create function public.studio_live_authorise(p_run uuid,p_plan_sha256 text,p_scope jsonb,p_expires timestamptz,p_reference text,p_key_evidence_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.studio_runs; i private.studio_run_inputs; b private.studio_run_budgets; c private.studio_budget_contracts; t private.studio_budget_trials; a private.studio_live_authorisations;
begin
 select * into r from private.studio_runs where id=p_run for update;
 select * into i from private.studio_run_inputs where run_id=p_run and input_revision=r.current_input_revision;
 select * into b from private.studio_run_budgets where run_id=p_run;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 select * into t from private.studio_budget_trials where id=b.trial_id for update;
 if r.id is null or r.purpose<>'rehearsal' or r.state<>'active' or c.mode is distinct from 'openrouter' or t.state is distinct from 'open'
  or not exists(select 1 from private.studio_provider_profiles where id=c.profile_id and mode='live' and enabled)
  or t.limit_micro>2000000 or b.run_limit_micro>1600000 or b.stage_limit_micro>1600000 or b.operation_limit_micro>600000
  or c.endpoint<>'https://openrouter.ai/api/v1/chat/completions' then raise exception 'Live Studio provider trial contract refused'; end if;
 if p_scope is distinct from jsonb_build_object('sourceDigest',i.source_digest,'bankManifestSha256',i.bank_manifest_sha256,'policySha256',i.policy_sha256,'skillSha256',i.skill_sha256)
  or coalesce(p_plan_sha256,'') !~ '^[a-f0-9]{64}$' or coalesce(p_key_evidence_sha256,'') !~ '^[a-f0-9]{64}$'
  or length(coalesce(p_reference,''))<10 or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '24 hours'
  then raise exception 'Live Studio provider requires exact scope, fresh expiry and explicit authorisation'; end if;
 select * into a from private.studio_live_authorisations where run_id=p_run;
 if found then
  if a.plan_sha256<>p_plan_sha256 or a.scope<>p_scope or a.expires_at<>p_expires or a.reference<>p_reference or a.key_evidence_sha256<>p_key_evidence_sha256 or a.revoked_at is not null or a.input_revision<>i.input_revision then raise exception 'Live Studio provider authorisation is immutable'; end if;
  return to_jsonb(a);
 end if;
 if exists(select 1 from private.studio_provider_attempts prior_call join private.studio_provider_operations o on o.id=prior_call.operation_id join private.studio_stages s on s.id=o.stage_id where s.run_id=p_run and prior_call.possible_charge) then raise exception 'Live Studio provider already dispatched'; end if;
 insert into private.studio_live_authorisations(run_id,plan_sha256,input_revision,scope,expires_at,reference,key_evidence_sha256)
 values(p_run,p_plan_sha256,i.input_revision,p_scope,p_expires,p_reference,p_key_evidence_sha256) returning * into a;
 perform private.studio_event(r.module_id,r.id,'operator','studio','live_trial_authorised',jsonb_build_object('plan',p_plan_sha256,'expires',p_expires,'scope',p_scope));
 return to_jsonb(a);
end $$;

create function public.studio_live_revoke(p_run uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare r private.studio_runs;
begin
 select * into r from private.studio_runs where id=p_run for update;
 if length(coalesce(p_reason,''))<10 then raise exception 'Live Studio provider revocation reason required'; end if;
 update private.studio_live_authorisations set revoked_at=clock_timestamp(),revoked_reason=p_reason where run_id=p_run and revoked_at is null;
 perform private.studio_event(r.module_id,r.id,'operator','studio','live_trial_revoked',jsonb_build_object('reason',p_reason));
end $$;
create or replace function public.studio_budget_reserve(p_attempt uuid,p_lease uuid,p_provider_attempt uuid,p_request_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; b private.studio_run_budgets; c private.studio_budget_contracts; t private.studio_budget_trials;
 a private.studio_provider_attempts; o private.studio_provider_operations; old private.studio_budget_reservations;
 amount bigint; bytes bigint; images bigint; input_bound bigint; output_bound bigint; trial_used numeric; run_used numeric; stage_used numeric; operation_used numeric;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 select * into b from private.studio_run_budgets where run_id=s.run_id;
 if not found then raise exception 'Studio budget is not bound'; end if;
 select * into t from private.studio_budget_trials where id=b.trial_id for update;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 select p.* into a from private.studio_provider_attempts p join private.studio_provider_operations op on op.id=p.operation_id
  where p.id=p_provider_attempt and op.stage_id=s.id and op.current_attempt_id=p.id and p.stage_attempt_id=p_attempt for update of p;
 if not found or a.dispatch_state<>'prepared' then raise exception 'Budget attempt is not prepared'; end if;
 select * into o from private.studio_provider_operations where id=a.operation_id;
 if a.profile_id<>c.profile_id or not private.studio_live_allowed(s.run_id,c.profile_id,s.stage_key) then raise exception 'Live Studio provider disabled or pinned profile unavailable'; end if;
 if c.mode='openrouter' and p_request_manifest->>'mode' is distinct from 'openrouter' then raise exception 'Live Studio provider requires verified wire admission'; end if;
 if p_request_manifest->>'requestDigest' is distinct from o.request_digest or p_request_manifest->>'contractId' is distinct from c.id
  or p_request_manifest->>'bundleDigest' is distinct from c.bundle_sha256 or p_request_manifest->>'capabilityDigest' is distinct from c.capability_sha256
  or p_request_manifest->>'pricingDigest' is distinct from c.pricing_sha256 or p_request_manifest->>'model' is distinct from c.model
  or p_request_manifest->>'endpoint' is distinct from c.endpoint then raise exception 'Budget request pins mismatch'; end if;
 if exists(select 1 from unnest(array['requestBytes','imageCount','inputTokenBound','outputTokens']) k where coalesce(p_request_manifest->>k,'') !~ '^[0-9]{1,9}$') then raise exception 'Finite request limits required'; end if;
 bytes:=(p_request_manifest->>'requestBytes')::bigint;images:=(p_request_manifest->>'imageCount')::bigint;
 input_bound:=(p_request_manifest->>'inputTokenBound')::bigint;output_bound:=(p_request_manifest->>'outputTokens')::bigint;
 if bytes<1 or bytes>c.max_request_bytes or images>c.max_images or input_bound<bytes+images*c.image_token_ceiling or input_bound>c.max_input_tokens
  or output_bound<1 or output_bound>c.max_output_tokens then raise exception 'Budget request exceeds pinned capability'; end if;
 amount:=ceil((input_bound::numeric*c.input_micro_per_million+output_bound::numeric*c.output_micro_per_million)/1000000)::bigint;
 select * into old from private.studio_budget_reservations where provider_attempt_id=a.id;
 if found then
  if old.request_manifest<>p_request_manifest or old.reserved_micro<>amount or old.state<>'held' then raise exception 'Budget reservation replay changed'; end if;
  return jsonb_build_object('reservationId',a.id,'reservedMicro',old.reserved_micro,'reused',true);
 end if;
 if t.state<>'open' or exists(select 1 from private.studio_budget_reservations z join private.studio_provider_attempts pa on pa.id=z.provider_attempt_id
  where z.trial_id=t.id and ((z.actual_micro is null and pa.dispatch_state in ('succeeded','failed','uncertain')) or z.actual_micro>z.reserved_micro)) then raise exception 'Budget reconciliation required'; end if;
 select coalesce(sum(coalesce(actual_micro,reserved_micro)),0),coalesce(sum(coalesce(actual_micro,reserved_micro)) filter(where run_id=s.run_id),0),
  coalesce(sum(coalesce(actual_micro,reserved_micro)) filter(where run_id=s.run_id and stage_key=s.stage_key),0),
  coalesce(sum(coalesce(actual_micro,reserved_micro)) filter(where operation_id=o.id),0)
  into trial_used,run_used,stage_used,operation_used from private.studio_budget_reservations where trial_id=t.id;
 if trial_used+amount>t.limit_micro or run_used+amount>b.run_limit_micro or stage_used+amount>b.stage_limit_micro or operation_used+amount>b.operation_limit_micro then raise exception 'Studio budget exhausted'; end if;
 insert into private.studio_budget_reservations(provider_attempt_id,trial_id,run_id,stage_id,stage_key,operation_id,contract_id,request_digest,request_manifest,reserved_micro)
  values(a.id,t.id,s.run_id,s.id,s.stage_key,o.id,c.id,o.request_digest,p_request_manifest,amount);
 return jsonb_build_object('reservationId',a.id,'reservedMicro',amount,'reused',false);
end $$;

create or replace function private.studio_budget_dispatch_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare b private.studio_run_budgets; z private.studio_budget_reservations; rid uuid; t private.studio_budget_trials;
begin
 if new.dispatch_state='dispatched' and old.dispatch_state is distinct from new.dispatch_state then
  select s.run_id into rid from private.studio_provider_operations o join private.studio_stages s on s.id=o.stage_id where o.id=new.operation_id;
  if not private.studio_live_allowed(rid,new.profile_id,(select stage_key from private.studio_stages where id=(select stage_id from private.studio_provider_operations where id=new.operation_id))) then raise exception 'Live Studio provider disabled'; end if;
  select * into b from private.studio_run_budgets where run_id=rid;
  if found then
   select * into t from private.studio_budget_trials where id=b.trial_id for update;
   if exists(select 1 from private.studio_budget_contracts where id=b.contract_id and mode='openrouter') and (select count(*) from private.studio_provider_attempts a join private.studio_budget_reservations q on q.provider_attempt_id=a.id where q.trial_id=b.trial_id and a.possible_charge)>=2 then raise exception 'Live Studio provider dispatch ceiling reached'; end if;
   select * into z from private.studio_budget_reservations where provider_attempt_id=new.id;
   if not found or z.state<>'held' then raise exception 'Budget reservation required before dispatch'; end if;
   if t.state<>'open' or exists(select 1 from private.studio_budget_reservations q join private.studio_provider_attempts p on p.id=q.provider_attempt_id where q.trial_id=t.id and
    ((q.actual_micro is null and p.dispatch_state in ('succeeded','failed','uncertain')) or q.actual_micro>q.reserved_micro)) then raise exception 'Budget reconciliation required'; end if;
  end if;
 end if;
 return new;
end $$;
create function public.studio_claim_live(p_worker text,p_run uuid,p_bundle text,p_plan text,p_key_evidence text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.studio_settings; s private.studio_stages; i private.studio_run_inputs; r private.studio_runs; token uuid := gen_random_uuid(); a private.studio_stage_attempts; bad uuid;
begin
 if p_worker is null or p_worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 if p_run is null or p_bundle is null or p_bundle !~ '^[a-f0-9]{64}$' then raise exception 'Recorded claim requires a run and bundle'; end if;
 -- Studio capacity is separate from paid generation: its own queue table and its own running limit.
 perform pg_advisory_xact_lock(hashtextextended('reviseit:studio-claim',0));
 perform private.studio_expire_leases();
 select * into cfg from private.studio_settings;
 if (select count(*) from private.studio_stages where state='running') >= cfg.max_running then return null; end if;
 loop
  select st.* into s from private.studio_stages st join private.studio_runs x on x.id=st.run_id
   where st.state='queued' and x.state='active' and x.id=p_run
 and exists(select 1 from private.studio_run_budgets rb join private.studio_budget_contracts bc on bc.id=rb.contract_id join private.studio_budget_trials bt on bt.id=rb.trial_id where rb.run_id=x.id and bc.mode='openrouter' and bc.bundle_sha256=p_bundle and bt.state='open') and private.studio_live_allowed(x.id,(select provider_profile_id from private.studio_run_inputs where run_id=x.id and input_revision=x.current_input_revision),st.stage_key) and exists(select 1 from private.studio_live_authorisations where run_id=x.id and plan_sha256=p_plan and key_evidence_sha256=p_key_evidence) order by st.seq for update of st skip locked limit 1;
  if not found then return null; end if;
  select * into r from private.studio_runs where id=s.run_id;
  select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
  -- Missing, inaccessible or corrupt committed bytes block dependent consumption.
  select b.id into bad from private.studio_blobs b where b.integrity<>'verified' and (
   b.id in (select blob_id from private.studio_source_files where source_revision_id=i.source_revision_id)
   or b.id = (select manifest_blob_id from private.studio_snapshots where id=i.snapshot_id)
   or b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else coalesce(s.upstream->'artifacts','[]'::jsonb) end) x)) limit 1;
  exit when bad is null;
  update private.studio_stages set state='blocked', blocked_reason='Integrity blocked: '||bad, updated_at=now() where id=s.id;
  perform private.studio_event(r.module_id,r.id,'system','studio','stage_blocked',jsonb_build_object('stage',s.id,'blob',bad));
 end loop;
 insert into private.studio_stage_attempts(stage_id,attempt_number,worker_id,lease,lease_until)
  values(s.id,s.attempt_count+1,p_worker,token,now()+make_interval(secs=>cfg.lease_seconds)) returning * into a;
 update private.studio_stages set state='running', current_attempt_id=a.id, attempt_count=a.attempt_number, blocked_reason=null, updated_at=now() where id=s.id;
 perform private.studio_event(r.module_id,r.id,'worker',p_worker,'stage_claimed',jsonb_build_object('stage',s.id,'attempt',a.id,'number',a.attempt_number));
 return jsonb_build_object('stageId',s.id,'attemptId',a.id,'attemptNumber',a.attempt_number,'lease',token,'leaseSeconds',cfg.lease_seconds,
  'runId',r.id,'moduleId',r.module_id,'purpose',r.purpose,'stageKey',s.stage_key,'kind',s.kind,'inputDigest',s.input_digest,
  'pins',jsonb_build_object('inputRevision',i.input_revision,'sourceDigest',i.source_digest,'snapshotId',i.snapshot_id,'bankManifestSha256',i.bank_manifest_sha256,
   'policySha256',i.policy_sha256,'skillContract',i.skill_contract_id,'skillSha256',i.skill_sha256,'validatorSha256',i.validator_sha256,
   'subjectAdapter',i.subject_adapter,'providerProfile',i.provider_profile_id,'adapterVersion',i.adapter_version,'promptVersion',i.prompt_version),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('blobId',b.id,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type,'role',f.role) order by f.role,b.sha256),'[]'::jsonb)
   from private.studio_source_files f join private.studio_blobs b on b.id=f.blob_id where f.source_revision_id=i.source_revision_id),
  'snapshot',(select jsonb_build_object('id',x.id,'manifestSha256',x.manifest_sha256,'manifestBlobId',x.manifest_blob_id,'origin',x.origin,'purpose',x.purpose) from private.studio_snapshots x where x.id=i.snapshot_id),
  'upstream',s.upstream,'revisionRequest',case when s.stage_key='S5_draft' then private.studio_revision_request(r.id) else null end);
end $$;


revoke all on function private.studio_live_allowed(uuid,text,text) from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function public.studio_live_authorise(uuid,text,jsonb,timestamptz,text,text),public.studio_live_revoke(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_live_authorise(uuid,text,jsonb,timestamptz,text,text),public.studio_live_revoke(uuid,text) to reviseit_studio_operator;
revoke all on function public.studio_claim_live(text,uuid,text,text,text) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_claim_live(text,uuid,text,text,text) to service_role;
commit;
