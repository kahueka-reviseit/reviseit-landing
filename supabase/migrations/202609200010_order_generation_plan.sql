-- Private execution plans never enter the teacher order read model.
alter table private.paper_orders add column generation_plan jsonb;
create function private.valid_generation_plan(p jsonb,f jsonb,module text,release text) returns boolean
language plpgsql immutable set search_path='' as $$
declare line jsonb; item jsonb; pos integer:=0;
begin
 if p is null then return true; end if;
 if not private.form_keys(p,array['schemaVersion','module','release','formRevision','lines','paper'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'module' is distinct from module or p->>'release' is distinct from release
  or not private.valid_questionnaire(f) or p->'formRevision' is distinct from f->'revision'
  or jsonb_typeof(p->'lines') is distinct from 'array' or octet_length(p::text)>100000 then return false; end if;
 if jsonb_array_length(p->'lines')<>jsonb_array_length(f->'items') then return false; end if;
 if not private.form_keys(p->'paper',array['paper_label','subject','grade','date','exam_period','instructions']) then return false; end if;
 if jsonb_typeof(p->'paper'->'instructions') is distinct from 'array' then return false; end if;
 for line in select value from jsonb_array_elements(p->'lines') loop
  item:=f->'items'->pos;pos:=pos+1;
  if not private.form_keys(line,array['id','specification','profileKey','profileSha256','marks'])
   or line->'id' is distinct from item->'id' or line->'marks' is distinct from item->'marks'
   or not private.form_id(line->'profileKey') or not private.form_text(line->'specification',160)
   or not private.form_text(line->'profileSha256',64) or line->>'profileSha256' !~ '^[a-f0-9]{64}$' then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
alter table private.paper_orders add constraint valid_generation_plan check(private.valid_generation_plan(generation_plan,form,module_id,release));
create function private.freeze_generation_plan() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.generation_plan is not null and new.generation_plan is distinct from old.generation_plan then raise exception 'Generation plan is immutable'; end if;
 if old.generation_plan is null and new.generation_plan is not null and old.state<>'awaiting_answers' then raise exception 'Generation plan must precede submission'; end if;
 return new;
end; $$;
create trigger freeze_generation_plan before update on private.paper_orders for each row execute function private.freeze_generation_plan();
revoke all on function private.valid_generation_plan(jsonb,jsonb,text,text),private.freeze_generation_plan() from public,anon,authenticated;

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
 -- A restarted worker must use the same persistent state volume. Another host
 -- must not replay possibly billable calls on a fresh volume.
 if o.worker_id is not null and o.worker_id<>worker then return null; end if;
 token:=gen_random_uuid();
 update private.paper_orders set lease=token,lease_until=now()+interval '90 seconds',worker_id=worker,
 state=case when o.state='queued' then 'generating' else o.state end,updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'claimed',worker);
 return jsonb_build_object('resumed',o.worker_id is not null,'id',o.id,'lease',token,'adapterKey',o.adapter_key,'schoolId',o.school_id,
 'moduleId',o.module_id,'release',o.release,'answers',o.answers,'snapshot',o.snapshot,
 'memoReview',o.memo_review,'internalTest',true) || case when o.generation_plan is null then '{}'::jsonb else jsonb_build_object('generationPlan',o.generation_plan) end;
end; $$;
