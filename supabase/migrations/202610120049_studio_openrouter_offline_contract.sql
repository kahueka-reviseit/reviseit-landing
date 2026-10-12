-- Offline adapter admission needs the registered non-secret routing profile.
-- No live profile, contract mode, grant, dispatch, or permission is enabled here.
begin;
create or replace function public.studio_budget_context(p_attempt uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; b private.studio_run_budgets; c private.studio_budget_contracts; routing jsonb;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 select * into b from private.studio_run_budgets where run_id=s.run_id;
 if not found then raise exception 'Studio budget is not bound'; end if;
 select * into c from private.studio_budget_contracts where id=b.contract_id;
 if jsonb_typeof(c.evidence->'openrouter')='object' then
  select jsonb_object_agg(key,value) into routing from jsonb_each(c.evidence->'openrouter')
   where key in ('endpoint','model','provider','capability_sha256','pricing_sha256','input_micro_per_million','output_micro_per_million');
 end if;
 return jsonb_build_object('contract',(to_jsonb(c)-'evidence') ||
  case when routing is null then '{}'::jsonb else jsonb_build_object('evidence',jsonb_build_object('openrouter',routing)) end,
  'trialId',b.trial_id,'runId',b.run_id);
end $$;
commit;
