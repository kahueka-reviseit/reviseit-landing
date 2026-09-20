-- Opt-in observation only. No trigger, provider call, teacher read path or order update.
-- Capture happens AFTER submission, in a separate transaction from generation admission.
create table private.semantic_observations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references private.paper_orders(id),
 checks_sha256 text not null check(checks_sha256 ~ '^[a-f0-9]{64}$'),
 input jsonb not null,
 input_sha256 text not null,
 created_at timestamptz not null default now(),
 unique(order_id,checks_sha256)
);
create table private.semantic_observation_results (
 observation_id uuid primary key references private.semantic_observations(id),
 input_sha256 text not null,
 outcome text not null check(outcome in ('response_received','not_sent','uncertain')),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=64000),
 recorded_at timestamptz not null default now()
);
alter table private.semantic_observations enable row level security;
alter table private.semantic_observation_results enable row level security;
revoke all on private.semantic_observations,private.semantic_observation_results from public,anon,authenticated,service_role;

create function private.freeze_semantic_observation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Shadow evidence is immutable'; end; $$;
create trigger freeze_semantic_observation before update or delete on private.semantic_observations
 for each row execute function private.freeze_semantic_observation();
create trigger freeze_semantic_result before update or delete on private.semantic_observation_results
 for each row execute function private.freeze_semantic_observation();

create function public.capture_semantic_observation(target uuid,checks_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; payload jsonb; h text; saved private.semantic_observations;
begin
 if checks_hash is null or checks_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid check identity'; end if;
 select * into o from private.paper_orders where id=target;
 if not found or o.submission_key is null or o.answers is null or o.generation_plan is null
 or o.state in ('awaiting_answers','cancelled') then raise exception 'Submitted planned order required'; end if;
 payload:=jsonb_build_object('orderId',o.id,'submissionKey',o.submission_key,'module',o.module_id,
 'release',o.release,'form',o.form,'answers',o.answers,'generationPlan',o.generation_plan,'checksSha256',checks_hash);
 h:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 insert into private.semantic_observations(order_id,checks_sha256,input,input_sha256)
 values(target,checks_hash,payload,h) on conflict(order_id,checks_sha256) do nothing;
 select * into saved from private.semantic_observations where order_id=target and checks_sha256=checks_hash;
 if saved.input_sha256<>h or saved.input<>payload then raise exception 'Shadow input changed'; end if;
 return jsonb_build_object('id',saved.id,'inputSha256',saved.input_sha256,'input',saved.input);
end; $$;

create function public.record_semantic_observation(target uuid,input_hash text,result_outcome text,result_evidence jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare saved private.semantic_observations; previous private.semantic_observation_results;
begin
 select * into saved from private.semantic_observations where id=target for update;
 if not found or input_hash is distinct from saved.input_sha256 then raise exception 'Shadow input identity required'; end if;
 if result_outcome is null or result_outcome not in ('response_received','not_sent','uncertain')
 or jsonb_typeof(result_evidence) is distinct from 'object' or octet_length(result_evidence::text)>64000
 then raise exception 'Invalid shadow evidence'; end if;
 select * into previous from private.semantic_observation_results where observation_id=target;
 if found then
  if previous.outcome=result_outcome and previous.evidence=result_evidence then return; end if;
  raise exception 'Shadow result already recorded';
 end if;
 insert into private.semantic_observation_results(observation_id,input_sha256,outcome,evidence)
 values(target,input_hash,result_outcome,result_evidence);
end; $$;
revoke all on function private.freeze_semantic_observation(),public.capture_semantic_observation(uuid,text),
 public.record_semantic_observation(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.capture_semantic_observation(uuid,text),public.record_semantic_observation(uuid,text,text,jsonb) to service_role;
