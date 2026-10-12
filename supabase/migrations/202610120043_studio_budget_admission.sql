begin;
-- Provider operations belong to a stage, even when different runs pin identical bytes.
-- Retain and reuse old operation rows by (stage_id, operation), without re-keying history.
create unique index studio_provider_operation_stage_identity on private.studio_provider_operations(stage_id,operation);
create or replace function public.studio_provider_prepare(p_attempt uuid, p_lease uuid, p_operation text, p_request_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; i private.studio_run_inputs; lk text; op private.studio_provider_operations; pa private.studio_provider_attempts;
begin
 s := private.studio_fence(p_attempt,p_lease);
 if s.kind <> 'provider' then raise exception 'Deterministic stages make no provider calls'; end if;
 if p_operation !~ '^[a-z0-9_:.-]{1,120}$' or p_request_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid provider operation'; end if;
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and x.input_revision=r.current_input_revision where r.id=s.run_id;
 lk := private.studio_sha(s.id::text||'|'||s.input_digest||'|'||p_operation);
 insert into private.studio_provider_operations(stage_id,operation,logical_key,request_digest) values(s.id,p_operation,lk,p_request_digest) on conflict (stage_id,operation) do nothing;
 select * into op from private.studio_provider_operations where stage_id=s.id and operation=p_operation for update;
 if op.request_digest <> p_request_digest then raise exception 'Provider request changed for the same operation'; end if;
 if op.current_attempt_id is null then
  insert into private.studio_provider_attempts(operation_id,attempt_number,stage_attempt_id,profile_id) values(op.id,1,p_attempt,i.provider_profile_id) returning * into pa;
  update private.studio_provider_operations set current_attempt_id=pa.id where id=op.id;
  return jsonb_build_object('operationId',op.id,'providerAttemptId',pa.id,'attemptNumber',1,'action','dispatch');
 end if;
 select * into pa from private.studio_provider_attempts where id=op.current_attempt_id for update;
 if pa.dispatch_state = 'succeeded' then
  -- Never resend a settled request; reuse its recorded result.
  update private.studio_provider_attempts set stage_attempt_id=p_attempt where id=pa.id and stage_attempt_id is distinct from p_attempt;
  return jsonb_build_object('operationId',op.id,'providerAttemptId',pa.id,'attemptNumber',pa.attempt_number,'action','reuse','resultDigest',pa.result_digest);
 elsif pa.dispatch_state = 'prepared' then
  -- Prepared means intent was recorded but nothing was sent; a later attempt may adopt it.
  update private.studio_provider_attempts set stage_attempt_id=p_attempt where id=pa.id;
  return jsonb_build_object('operationId',op.id,'providerAttemptId',pa.id,'attemptNumber',pa.attempt_number,'action','dispatch');
 elsif pa.dispatch_state in ('dispatched','uncertain') then raise exception 'Provider outcome uncertain; explicit retry required';
 else raise exception 'Provider attempt failed; explicit retry required';
 end if;
end $$;
-- Integer micro-US dollars, atomic admission, immutable pricing evidence. No live profile enabled.
create table private.studio_budget_contracts (
 id text primary key,
 profile_id text not null references private.studio_provider_profiles(id),
 bundle_sha256 text not null check(bundle_sha256 ~ '^[a-f0-9]{64}$'),
 capability_sha256 text not null check(capability_sha256 ~ '^[a-f0-9]{64}$'),
 pricing_sha256 text not null check(pricing_sha256 ~ '^[a-f0-9]{64}$'),
 model text not null, endpoint text not null,
 mode text not null check(mode='recorded'),
 input_micro_per_million bigint not null check(input_micro_per_million between 1 and 1000000000000),
 output_micro_per_million bigint not null check(output_micro_per_million between 1 and 1000000000000),
 max_input_tokens bigint not null check(max_input_tokens between 1 and 100000000),
 max_output_tokens integer not null check(max_output_tokens between 1 and 32768),
 max_request_bytes integer not null check(max_request_bytes between 1 and 4194304),
 image_token_ceiling integer not null check(image_token_ceiling between 1 and 1000000),
 max_images integer not null check(max_images between 0 and 500),
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 created_at timestamptz not null default now()
);
create table private.studio_budget_trials (
 id uuid primary key,
 module_id text not null references private.studio_modules(module_id),
 limit_micro bigint not null check(limit_micro between 1 and 9000000000000000),
 state text not null default 'open' check(state in ('open','suspended')),
 authorisation jsonb not null check(jsonb_typeof(authorisation)='object'),
 created_at timestamptz not null default now()
);
create table private.studio_run_budgets (
 run_id uuid primary key references private.studio_runs(id),
 trial_id uuid not null references private.studio_budget_trials(id),
 contract_id text not null references private.studio_budget_contracts(id),
 run_limit_micro bigint not null check(run_limit_micro>0),
 stage_limit_micro bigint not null check(stage_limit_micro>0),
 operation_limit_micro bigint not null check(operation_limit_micro>0),
 created_at timestamptz not null default now()
);
create table private.studio_budget_reservations (
 provider_attempt_id uuid primary key references private.studio_provider_attempts(id),
 trial_id uuid not null references private.studio_budget_trials(id),
 run_id uuid not null references private.studio_runs(id),
 stage_id uuid not null references private.studio_stages(id),
 stage_key text not null,
 operation_id uuid not null references private.studio_provider_operations(id),
 contract_id text not null references private.studio_budget_contracts(id),
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 request_manifest jsonb not null,
 reserved_micro bigint not null check(reserved_micro>0),
 actual_micro bigint check(actual_micro>=0),
 state text not null default 'held' check(state in ('held','settled','released')),
 revision integer not null default 0,
 created_at timestamptz not null default now(),
 check((state='held')=(actual_micro is null))
);
create index studio_budget_trial_ledger on private.studio_budget_reservations(trial_id,run_id,stage_key,operation_id);
create table private.studio_budget_receipts (
 provider_attempt_id uuid not null references private.studio_budget_reservations(provider_attempt_id),
 revision integer not null,
 actual_micro bigint not null check(actual_micro>=0),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reason text not null,
 actor text not null,
 created_at timestamptz not null default now(),
 primary key(provider_attempt_id,revision)
);
alter table private.studio_budget_contracts enable row level security;
alter table private.studio_budget_trials enable row level security;
alter table private.studio_run_budgets enable row level security;
alter table private.studio_budget_reservations enable row level security;
alter table private.studio_budget_receipts enable row level security;
create function private.studio_budget_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Studio budget evidence is immutable'; end $$;
create trigger studio_budget_contract_immutable before update or delete on private.studio_budget_contracts for each row execute function private.studio_budget_immutable();
create trigger studio_budget_binding_immutable before update or delete on private.studio_run_budgets for each row execute function private.studio_budget_immutable();
create trigger studio_budget_receipt_immutable before update or delete on private.studio_budget_receipts for each row execute function private.studio_budget_immutable();

-- Operator-only grant. This creates test/offline allowances; mode=recorded cannot enable live dispatch.
create function public.studio_budget_grant(p_run uuid,p_trial uuid,p_trial_limit bigint,p_run_limit bigint,p_stage_limit bigint,p_operation_limit bigint,p_contract text,p_authorisation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.studio_runs; t private.studio_budget_trials; b private.studio_run_budgets; c private.studio_budget_contracts;
begin
 select * into r from private.studio_runs where id=p_run for update;
 if not found then raise exception 'Studio run not found'; end if;
 if p_authorisation is null or jsonb_typeof(p_authorisation)<>'object' or length(coalesce(p_authorisation->>'reference',''))<3 then raise exception 'Budget authorisation reference required'; end if;
 if p_trial_limit is null or p_run_limit is null or p_stage_limit is null or p_operation_limit is null or p_operation_limit<1 or p_stage_limit<p_operation_limit or p_run_limit<p_stage_limit or p_trial_limit<p_run_limit then raise exception 'Invalid nested budget limits'; end if;
 select * into c from private.studio_budget_contracts where id=p_contract;
 if not found or c.profile_id is distinct from (select provider_profile_id from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision) then raise exception 'Budget contract does not match pinned profile'; end if;
 insert into private.studio_budget_trials(id,module_id,limit_micro,authorisation) values(p_trial,r.module_id,p_trial_limit,p_authorisation) on conflict do nothing;
 select * into t from private.studio_budget_trials where id=p_trial for update;
 if t.module_id<>r.module_id or t.limit_micro<>p_trial_limit or t.authorisation<>p_authorisation then raise exception 'Budget trial identity conflict'; end if;
 select * into b from private.studio_run_budgets where run_id=p_run;
 if found then
  if b.trial_id<>p_trial or b.contract_id<>p_contract or b.run_limit_micro<>p_run_limit or b.stage_limit_micro<>p_stage_limit or b.operation_limit_micro<>p_operation_limit then raise exception 'Run budget identity conflict'; end if;
  return to_jsonb(b);
 end if;
 if exists(select 1 from private.studio_provider_attempts a join private.studio_provider_operations o on o.id=a.operation_id join private.studio_stages s on s.id=o.stage_id where s.run_id=p_run and a.possible_charge) then raise exception 'Budget must be bound before first dispatch'; end if;
 insert into private.studio_run_budgets values(p_run,p_trial,p_contract,p_run_limit,p_stage_limit,p_operation_limit,now()) returning * into b;
 return to_jsonb(b);
end $$;

-- Read the contract for a fenced worker; every new dispatch also checks it inside admission.
create function public.studio_budget_context(p_attempt uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; b private.studio_run_budgets; c private.studio_budget_contracts;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 select * into b from private.studio_run_budgets where run_id=s.run_id;
 if not found then raise exception 'Studio budget is not bound'; end if;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 return jsonb_build_object('contract',to_jsonb(c)-'evidence','trialId',b.trial_id,'runId',b.run_id);
end $$;

-- Trial row serializes shared allowances; run/stage fence is always acquired first.
create function public.studio_budget_reserve(p_attempt uuid,p_lease uuid,p_provider_attempt uuid,p_request_manifest jsonb)
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
 if a.profile_id<>c.profile_id or not exists(select 1 from private.studio_provider_profiles where id=c.profile_id and enabled and mode='mock') then raise exception 'Live Studio provider disabled or pinned profile unavailable'; end if;
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

-- A dispatch cannot bypass its reservation; historical mock protocol fixtures remain available.
create function private.studio_budget_dispatch_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare b private.studio_run_budgets; z private.studio_budget_reservations; rid uuid; t private.studio_budget_trials;
begin
 if new.dispatch_state='dispatched' and old.dispatch_state is distinct from new.dispatch_state then
  if not exists(select 1 from private.studio_provider_profiles where id=new.profile_id and enabled and mode='mock') then raise exception 'Live Studio provider disabled'; end if;
  select s.run_id into rid from private.studio_provider_operations o join private.studio_stages s on s.id=o.stage_id where o.id=new.operation_id;
  select * into b from private.studio_run_budgets where run_id=rid;
  if found then
   select * into t from private.studio_budget_trials where id=b.trial_id for update;
   select * into z from private.studio_budget_reservations where provider_attempt_id=new.id;
   if not found or z.state<>'held' then raise exception 'Budget reservation required before dispatch'; end if;
   if t.state<>'open' or exists(select 1 from private.studio_budget_reservations q join private.studio_provider_attempts p on p.id=q.provider_attempt_id where q.trial_id=t.id and
    ((q.actual_micro is null and p.dispatch_state in ('succeeded','failed','uncertain')) or q.actual_micro>q.reserved_micro)) then raise exception 'Budget reconciliation required'; end if;
  end if;
 end if;
 return new;
end $$;
create trigger studio_budget_dispatch before update on private.studio_provider_attempts for each row execute function private.studio_budget_dispatch_guard();

-- Exact result evidence is required. Null cost preserves the whole reservation and blocks admission.
create function public.studio_budget_settle(p_provider_attempt uuid,p_actual_micro bigint,p_evidence_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare z private.studio_budget_reservations; a private.studio_provider_attempts;
begin
 select r.* into z from private.studio_budget_reservations r where provider_attempt_id=p_provider_attempt;
 if not found then raise exception 'Budget reservation not found'; end if;
 perform 1 from private.studio_runs where id=z.run_id for update;
 perform 1 from private.studio_budget_trials where id=z.trial_id for update;
 select * into z from private.studio_budget_reservations where provider_attempt_id=p_provider_attempt for update;
 select * into a from private.studio_provider_attempts where id=p_provider_attempt;
 if coalesce(p_evidence_sha256,'') !~ '^[a-f0-9]{64}$' or a.dispatch_state not in ('succeeded','failed') or p_evidence_sha256 is distinct from a.result_digest then raise exception 'Budget settlement needs retained result evidence'; end if;
 if p_actual_micro is not null and p_actual_micro<0 then raise exception 'Invalid actual cost'; end if;
 if z.state<>'held' then
  if z.actual_micro is distinct from p_actual_micro and not exists(select 1 from private.studio_budget_receipts where provider_attempt_id=a.id and revision=z.revision and actor='operator') then raise exception 'Budget settlement conflict'; end if;
 else
  if p_actual_micro is not null then
   update private.studio_budget_reservations set actual_micro=p_actual_micro,state='settled',revision=revision+1 where provider_attempt_id=a.id returning * into z;
   insert into private.studio_budget_receipts values(a.id,z.revision,p_actual_micro,p_evidence_sha256,'Retained provider usage','worker',now());
  end if;
 end if;
 return jsonb_build_object('actualMicro',z.actual_micro,'reservedMicro',z.reserved_micro,'halted',z.actual_micro is null or z.actual_micro>z.reserved_micro,'revision',z.revision);
end $$;

-- Explicit reconciliation or cancellation, never an automatic refund of a dispatched request.
create function public.studio_budget_reconcile(p_provider_attempt uuid,p_expected_revision integer,p_actual_micro bigint,p_evidence_sha256 text,p_reason text,p_release_unsent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare z private.studio_budget_reservations; a private.studio_provider_attempts; receipt private.studio_budget_receipts;
begin
 select * into z from private.studio_budget_reservations where provider_attempt_id=p_provider_attempt;
 if not found then raise exception 'Budget reservation not found'; end if;
 perform 1 from private.studio_runs where id=z.run_id for update;
 perform 1 from private.studio_budget_trials where id=z.trial_id for update;
 select * into z from private.studio_budget_reservations where provider_attempt_id=p_provider_attempt for update;
 select * into a from private.studio_provider_attempts where id=p_provider_attempt for update;
 if p_actual_micro is null or p_actual_micro<0 or coalesce(p_evidence_sha256,'') !~ '^[a-f0-9]{64}$' or length(coalesce(p_reason,''))<3 then raise exception 'Reconciliation evidence required'; end if;
 select * into receipt from private.studio_budget_receipts where provider_attempt_id=a.id and revision=p_expected_revision+1;
 if found and receipt.actor='operator' and receipt.actual_micro=p_actual_micro and receipt.evidence_sha256=p_evidence_sha256 and receipt.reason=p_reason then return to_jsonb(z); end if;
 if z.revision is distinct from p_expected_revision then raise exception 'Budget revision changed'; end if;
 if p_release_unsent then
  if a.possible_charge or a.dispatch_state not in ('prepared','failed_before_dispatch') or p_actual_micro<>0 then raise exception 'Cannot release a possibly charged reservation'; end if;
  update private.studio_provider_attempts set dispatch_state='failed_before_dispatch',settled_at=now() where id=a.id;
 elsif a.dispatch_state not in ('succeeded','failed','uncertain') then raise exception 'Reconcile an ended or uncertain attempt, not an active dispatch'; end if;
 update private.studio_budget_reservations set actual_micro=p_actual_micro,state=case when p_release_unsent then 'released' else 'settled' end,revision=revision+1 where provider_attempt_id=a.id returning * into z;
 insert into private.studio_budget_receipts values(a.id,z.revision,p_actual_micro,p_evidence_sha256,p_reason,'operator',now());
 return to_jsonb(z);
end $$;

-- Financially unresolved or over-bound replies cannot become model-derived stage output.
create function private.studio_budget_output_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare b private.studio_run_budgets; z private.studio_budget_reservations;
begin
 select * into b from private.studio_run_budgets where run_id=new.run_id;
 if found and new.author_kind='worker' and new.kind in ('inventory','task_matches','spec_matches','draft_record') then
  select * into z from private.studio_budget_reservations where provider_attempt_id=new.provider_attempt_id;
  if not found or z.state<>'settled' or z.actual_micro>z.reserved_micro then raise exception 'Budget result is not cleared for output'; end if;
 end if;
 return new;
end $$;
create trigger studio_budget_output before insert on private.studio_artifacts for each row execute function private.studio_budget_output_guard();

revoke all on private.studio_budget_contracts,private.studio_budget_trials,private.studio_run_budgets,private.studio_budget_reservations,private.studio_budget_receipts from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function private.studio_budget_immutable(),private.studio_budget_dispatch_guard(),private.studio_budget_output_guard() from public,anon,authenticated,service_role,reviseit_studio_operator;
revoke all on function public.studio_budget_grant(uuid,uuid,bigint,bigint,bigint,bigint,text,jsonb),public.studio_budget_reconcile(uuid,integer,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.studio_budget_grant(uuid,uuid,bigint,bigint,bigint,bigint,text,jsonb),public.studio_budget_reconcile(uuid,integer,bigint,text,text,boolean) to reviseit_studio_operator;
revoke all on function public.studio_budget_context(uuid,uuid),public.studio_budget_reserve(uuid,uuid,uuid,jsonb),public.studio_budget_settle(uuid,bigint,text) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_budget_context(uuid,uuid),public.studio_budget_reserve(uuid,uuid,uuid,jsonb),public.studio_budget_settle(uuid,bigint,text) to service_role;
commit;
