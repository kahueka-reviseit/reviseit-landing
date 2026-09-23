begin;

-- Versioned private execution inputs. A new workflow gets a new registration;
-- issued orders retain their own execution identity and formatting snapshot.
create table private.catalogue_executions (
 module_id text not null, release text not null, manifest_sha256 text not null,
 workflow_sha256 text not null check(workflow_sha256 ~ '^[a-f0-9]{64}$'),
 primary key(module_id,release,manifest_sha256),
 check(manifest_sha256 ~ '^[a-f0-9]{64}$')
);
alter table private.catalogue_executions enable row level security;
revoke all on private.catalogue_executions from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
create trigger freeze_catalogue_execution before update or delete on private.catalogue_executions
for each row execute function private.freeze_authored_form();

create function public.register_catalogue_execution(target_module text,target_release text,target_manifest text,target_workflow text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if target_workflow is null or target_workflow !~ '^[a-f0-9]{64}$' or not exists(
  select 1 from private.catalogue_authored_forms where module_id=target_module and release=target_release and manifest_sha256=target_manifest
 ) then raise exception 'Registered private bundle required'; end if;
 if exists(select 1 from private.catalogue_executions where module_id=target_module and release=target_release and manifest_sha256=target_manifest and workflow_sha256<>target_workflow)
 then raise exception 'Execution registration is immutable'; end if;
 insert into private.catalogue_executions values(target_module,target_release,target_manifest,target_workflow) on conflict do nothing;
end $$;
revoke all on function public.register_catalogue_execution(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.register_catalogue_execution(text,text,text,text) to reviseit_catalogue_publisher;

create function private.freeze_new_catalogue_execution() returns trigger
language plpgsql security definer set search_path='' as $$
declare w text; f jsonb;
begin
 if new.adapter_key<>'authored-bundle-v1' then return new; end if;
 if new.snapshot->>'schema' is distinct from 'reviseit/frozen-authored-inputs@1'
  or new.snapshot->>'module' is distinct from new.module_id or new.snapshot->>'release' is distinct from new.release
 then raise exception 'Catalogue snapshot identity required'; end if;
 select workflow_sha256 into w from private.catalogue_executions
 where module_id=new.module_id and release=new.release and manifest_sha256=new.snapshot->>'manifestSha256';
 if w is null then raise exception 'Connected workflow registration required'; end if;
 if exists(select 1 from jsonb_array_elements(new.snapshot->'lines') l where
  (new.module_id='caps-grade-11-physical-sciences' and l->>'entryId'='structured:P1-CIRC-01') or
  (new.module_id='caps-grade-10-physical-sciences' and l->>'entryId' in ('structured:P2-CHEM-04','structured:P2-CHEM-05')))
 then raise exception 'Selected item input mapping remains unresolved'; end if;
 select jsonb_build_object('schemaVersion',1,'schoolId',s.id,'schoolName',s.name,'moduleId',new.module_id,
  'revision',coalesce(p.revision,0),'preferences',p.preferences) into f
 from public.schools s left join public.school_formatting p on p.school_id=s.id and p.module_id=new.module_id
 where s.id=new.school_id;
 if f is null then raise exception 'School formatting identity required'; end if;
 new.snapshot:=new.snapshot||jsonb_build_object('execution',jsonb_build_object('workflowManifestSha256',w),'formatting',f);
 return new;
end $$;
create trigger freeze_new_catalogue_execution before insert on private.paper_orders
for each row execute function private.freeze_new_catalogue_execution();
revoke all on function private.freeze_new_catalogue_execution() from public,anon,authenticated;

-- A preassigned worker is a routing fence, not evidence that a job ran before.
-- Existing worker identities and expired-lease recovery remain unchanged.
create or replace function public.claim_paper_job(worker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; token uuid;
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 select * into o from private.paper_orders x
 where (x.state='queued' or (x.state in ('generating','rendering') and x.lease_until<now()))
 and (x.worker_id is null or x.worker_id=worker)
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
 return jsonb_build_object('resumed',o.state<>'queued','id',o.id,'lease',token,'adapterKey',o.adapter_key,'schoolId',o.school_id,
 'moduleId',o.module_id,'release',o.release,'answers',o.answers,'snapshot',o.snapshot,
 'memoReview',o.memo_review,'internalTest',o.entitlement='internal_test') || case when o.generation_plan is null then '{}'::jsonb else jsonb_build_object('generationPlan',o.generation_plan) end;
end $$;
commit;
