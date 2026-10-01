begin;
alter table private.paper_orders drop constraint paper_orders_entitlement_check;
alter table private.paper_orders add constraint paper_orders_entitlement_check check(entitlement in ('internal_test','paid','department_credit'));
create table private.credit_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 mode text not null default 'test' check(mode in ('test','live')),
 price_version text not null default '2026-10-01-prorated-v1'
);
insert into private.credit_settings(singleton) values(true);
alter table private.credit_settings enable row level security;
revoke all on private.credit_settings from public,anon,authenticated,service_role;
create table private.paper_credit_quotes (
 id uuid primary key default gen_random_uuid(), teacher_id uuid not null references auth.users(id),department_id uuid not null references public.departments(id),
 mode text not null check(mode in ('test','live')), module_id text not null, selection_revision integer not null,
 allocations jsonb not null, targets jsonb not null, definitions_sha256 text not null,
 price_version text not null, amount_minor bigint not null check(amount_minor>0), mcq_count integer not null, structured_marks integer not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes'
);
alter table private.paper_credit_quotes enable row level security;
revoke all on private.paper_credit_quotes from public,anon,authenticated,service_role;
create table private.paper_credit_funding (
 order_id uuid primary key references private.paper_orders(id),quote_id uuid not null unique references private.paper_credit_quotes(id),
 operation_id uuid not null unique references private.credit_operations(id),department_id uuid not null references public.departments(id),mode text not null,
 amount_minor bigint not null,request_key uuid not null unique,
 returned_at timestamptz
);
alter table private.paper_credit_funding enable row level security;
revoke all on private.paper_credit_funding from public,anon,authenticated,service_role;
alter table private.credit_operations add foreign key(order_id) references private.paper_orders(id);
create function public.department_credit_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select enabled from private.credit_settings where singleton;
$$;
create function private.credit_price(mcq integer,marks integer) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if mcq is null or marks is null or mcq not between 0 and 10 or marks not between 0 and 130 or mcq+marks=0 then raise exception 'Paper outside credit pricing limits'; end if;
 return mcq::bigint*5000+(marks::bigint*145000+65)/130;
end $$;
create function public.quote_department_paper(target_module text,selection_revision integer,allocations jsonb,targets jsonb,expected_definitions text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.credit_settings; compiled record; d uuid; q private.paper_credit_quotes; n integer; marks integer;
begin
 select * into cfg from private.credit_settings where singleton and enabled;
 if not found then raise exception 'Department credit unavailable'; end if;
 d:=public.approved_department_id();if d is null then raise exception 'Department access required'; end if;
 select * into compiled from private.compile_configured_order(auth.uid(),target_module,selection_revision,allocations,targets);
 if expected_definitions is distinct from compiled.definitions_sha256 then raise exception 'Saved selection changed'; end if;
 select count(*) filter(where x->'identity'->>'kind'='multiple_choice'),coalesce(sum((x->>'checkoutMarks')::integer) filter(where x->'identity'->>'kind'='structured'),0)
 into n,marks from jsonb_array_elements(compiled.snapshot->'lines') x;
 insert into private.paper_credit_quotes(teacher_id,department_id,mode,module_id,selection_revision,allocations,targets,definitions_sha256,price_version,amount_minor,mcq_count,structured_marks)
 values(auth.uid(),d,cfg.mode,target_module,selection_revision,allocations,targets,compiled.definitions_sha256,cfg.price_version,private.credit_price(n,marks),n,marks) returning * into q;
 return jsonb_build_object('quoteId',q.id,'priceVersion',q.price_version,'amountMinor',q.amount_minor,'balanceMinor',private.credit_balance(d,cfg.mode),
 'expiresAt',q.expires_at,'mode',q.mode,'multipleChoiceMinor',n*5000,'structuredMinor',private.credit_price(n,marks)-n*5000);
end $$;

create function public.create_department_paper(quote_id uuid,request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare q private.paper_credit_quotes; settings private.credit_settings; funded private.paper_credit_funding; f private.pilot_funding; compiled record;
 o uuid; op uuid; cfg jsonb; line jsonb; lines jsonb:='{}'; n integer; marks integer;
begin
 if auth.uid() is null or public.approved_department_id() is null or request_key is null then raise exception 'Department access required'; end if;
 perform 1 from public.teacher_accounts where user_id=auth.uid() for update;
 select * into funded from private.paper_credit_funding where paper_credit_funding.request_key=create_department_paper.request_key;
 if found then
  if funded.quote_id<>create_department_paper.quote_id or not exists(select 1 from private.paper_orders where id=funded.order_id and teacher_id=auth.uid()) then raise exception 'Request key already used'; end if;
  return funded.order_id;
 end if;
 select * into q from private.paper_credit_quotes where id=quote_id and teacher_id=auth.uid() for update;
 if not found or q.department_id is distinct from public.approved_department_id() then raise exception 'Quote not available'; end if;
 select * into funded from private.paper_credit_funding where paper_credit_funding.quote_id=q.id;
 if found then return funded.order_id; end if;
 select * into settings from private.credit_settings where singleton and enabled for share;
 if not found or settings.mode<>q.mode then raise exception 'Department credit unavailable'; end if;
 if settings.price_version<>q.price_version or q.expires_at<=now() then raise exception 'Quote changed. Review and accept the current price'; end if;
 if not private.configurator_enabled() then raise exception 'Configurator unavailable'; end if;
 select * into f from private.pilot_funding where enabled and mode=q.mode for update;
 if not found then raise exception 'Pilot purchasing unavailable'; end if;
 if private.pilot_seats_used(q.mode)+(select count(*) from private.paper_credit_funding where mode=q.mode)>=f.order_limit then raise exception 'Pilot capacity unavailable'; end if;
 select * into compiled from private.compile_configured_order(auth.uid(),q.module_id,q.selection_revision,q.allocations,q.targets);
 if compiled.definitions_sha256<>q.definitions_sha256 then raise exception 'Saved selection changed'; end if;
 select count(*) filter(where x->'identity'->>'kind'='multiple_choice'),coalesce(sum((x->>'checkoutMarks')::integer) filter(where x->'identity'->>'kind'='structured'),0)
 into n,marks from jsonb_array_elements(compiled.snapshot->'lines') x;
 if private.credit_price(n,marks)<>q.amount_minor then raise exception 'Quote changed. Review and accept the current price'; end if;
 o:=gen_random_uuid();
 insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot,worker_id,state)
 values(o,auth.uid(),compiled.school,q.module_id,compiled.release,'Catalogue paper','department_credit','configured-bundle-v1',compiled.form,compiled.snapshot,f.worker_id,'awaiting_answers');
 op:=private.spend_department_credit(q.department_id,q.mode,auth.uid(),o,q.amount_minor,request_key,jsonb_build_object('quoteId',q.id));
 insert into private.paper_credit_funding(order_id,quote_id,operation_id,department_id,mode,amount_minor,request_key)
 values(o,q.id,op,q.department_id,q.mode,q.amount_minor,request_key);
 for line in select value from jsonb_array_elements(compiled.snapshot->'lines') loop
  lines:=lines||jsonb_build_object(line->>'id',jsonb_build_object('marks',line->'checkoutMarks','parts',null,'facets','{}'::jsonb));
 end loop;
 cfg:=jsonb_build_object('schemaVersion',1,'targets',q.targets,'lines',lines,'answers',jsonb_build_object('items','{}'::jsonb,'paper','{}'::jsonb));
 insert into private.paper_configurations(order_id,definitions_sha256,revision,configuration) values(o,q.definitions_sha256,1,cfg);
 insert into private.paper_configuration_revisions(order_id,revision,configuration,actor) values(o,1,cfg,auth.uid()::text);
 insert into private.paper_job_events(order_id,event,actor,detail) values(o,'credit_spent',auth.uid()::text,jsonb_build_object('amountMinor',q.amount_minor,'quoteId',q.id,'mode',q.mode));
 return o;
end $$;
create function private.order_has_funding(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.paper_orders o where o.id=target and
 ((o.entitlement='paid' and exists(select 1 from private.paper_payments p where p.order_id=o.id and p.status='paid' and p.refunded_at is null)) or
 (o.entitlement='department_credit' and exists(select 1 from private.paper_credit_funding f where f.order_id=o.id and f.returned_at is null
 and not exists(select 1 from private.credit_operations r where r.original_operation=f.operation_id and r.kind='return')))));
$$;
revoke all on function private.credit_price(integer,integer),private.order_has_funding(uuid) from public,anon,authenticated,service_role;
revoke all on function public.department_credit_enabled(),public.quote_department_paper(text,integer,jsonb,jsonb,text),public.create_department_paper(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.department_credit_enabled(),public.quote_department_paper(text,integer,jsonb,jsonb,text),public.create_department_paper(uuid,uuid) to authenticated;
commit;
