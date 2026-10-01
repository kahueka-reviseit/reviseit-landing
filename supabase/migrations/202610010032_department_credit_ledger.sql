begin;
-- Source allocations, not paper counts. Test money cannot fund a live order.
create table private.department_wallets (
 department_id uuid not null references public.departments(id),
 mode text not null check(mode in ('test','live')),
 revision integer not null default 1,
 primary key(department_id,mode)
);
create table private.credit_sources (
 id uuid primary key default gen_random_uuid(), department_id uuid not null, mode text not null,
 kind text not null check(kind in ('purchase','offer','staff_grant','paid_invoice')),
 original_minor bigint not null check(original_minor between 1 and 100000000),
 remaining_minor bigint not null check(remaining_minor>=0 and remaining_minor<=original_minor),
 expires_at timestamptz, voided_at timestamptz, reference text,
 created_at timestamptz not null default now(),
 foreign key(department_id,mode) references private.department_wallets(department_id,mode),
 unique(id,department_id,mode)
);
create table private.credit_operations (
 id uuid primary key default gen_random_uuid(), department_id uuid not null, mode text not null,
 actor_id uuid references auth.users(id), request_key uuid not null unique,
 kind text not null check(kind in ('grant','purchase','claim','spend','return','void')),
 amount_minor bigint not null check(amount_minor between 1 and 100000000),
 request jsonb not null, reason text not null check(length(trim(reason)) between 3 and 2000),
 order_id uuid, original_operation uuid references private.credit_operations(id),
 created_at timestamptz not null default now(),
 foreign key(department_id,mode) references private.department_wallets(department_id,mode),
 unique(id,department_id,mode)
);
create unique index credit_spend_order on private.credit_operations(order_id) where kind='spend';
create unique index credit_return_once on private.credit_operations(original_operation) where kind='return';
create table private.credit_entries (
 id bigint generated always as identity primary key,
 operation_id uuid not null, source_id uuid not null, department_id uuid not null, mode text not null,
 amount_minor bigint not null check(amount_minor<>0),
 created_at timestamptz not null default now(),
 foreign key(operation_id,department_id,mode) references private.credit_operations(id,department_id,mode),
 foreign key(source_id,department_id,mode) references private.credit_sources(id,department_id,mode),
 unique(operation_id,source_id)
);
create function private.credit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Credit history is immutable'; end $$;
create trigger credit_operations_immutable before update or delete on private.credit_operations for each row execute function private.credit_immutable();
create trigger credit_entries_immutable before update or delete on private.credit_entries for each row execute function private.credit_immutable();
alter table private.department_wallets enable row level security;
alter table private.credit_sources enable row level security;
alter table private.credit_operations enable row level security;
alter table private.credit_entries enable row level security;
revoke all on private.department_wallets,private.credit_sources,private.credit_operations,private.credit_entries from public,anon,authenticated;

create function private.credit_balance(d uuid,m text) returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(remaining_minor),0)::bigint from private.credit_sources
 where department_id=d and mode=m and voided_at is null and (expires_at is null or expires_at>now());
$$;
create function private.lock_credit_wallet(d uuid,m text) returns void language plpgsql set search_path='' as $$
begin
 if d is null or m is null or m not in ('test','live') then raise exception 'Invalid wallet'; end if;
 insert into private.department_wallets(department_id,mode) values(d,m) on conflict do nothing;
 perform 1 from private.department_wallets where department_id=d and mode=m for update;
end $$;

create function public.grant_department_credit(target_department uuid,target_mode text,amount_minor bigint,source_kind text,
 use_by timestamptz,source_reference text,reason text,request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare op private.credit_operations; req jsonb; sid uuid; oid uuid;
begin
 if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
 if amount_minor is null or amount_minor not between 1 and 100000000 or source_kind is null or source_kind not in ('staff_grant','paid_invoice')
 or request_key is null or reason is null or length(trim(reason)) not between 3 and 2000
 or (source_kind='paid_invoice' and length(trim(coalesce(source_reference,'')))=0)
 or length(coalesce(source_reference,''))>200 then raise exception 'Invalid credit grant'; end if;
 req:=jsonb_build_object('department',target_department,'mode',target_mode,'amount',amount_minor,'kind',source_kind,'useBy',use_by,'reference',source_reference,'reason',trim(reason));
 perform private.lock_credit_wallet(target_department,target_mode);
 select * into op from private.credit_operations where credit_operations.request_key=grant_department_credit.request_key;
 if found then
   if op.kind<>'grant' or op.actor_id is distinct from auth.uid() or op.request<>req then raise exception 'Request key already used'; end if;
   return op.id;
 end if;
 if use_by is not null and use_by<=now() then raise exception 'Use-by date has passed'; end if;
 insert into private.credit_operations(department_id,mode,actor_id,request_key,kind,amount_minor,request,reason)
 values(target_department,target_mode,auth.uid(),request_key,'grant',amount_minor,req,trim(reason)) returning id into oid;
 insert into private.credit_sources(department_id,mode,kind,original_minor,remaining_minor,expires_at,reference)
 values(target_department,target_mode,source_kind,amount_minor,amount_minor,use_by,source_reference) returning id into sid;
 insert into private.credit_entries(operation_id,source_id,department_id,mode,amount_minor) values(oid,sid,target_department,target_mode,amount_minor);
 update private.department_wallets set revision=revision+1 where department_id=target_department and mode=target_mode;
 return oid;
end $$;

-- Only trusted order admission calls this function in the same transaction
-- as creation. It has no public or service-role execute grant.
create function private.spend_department_credit(d uuid,m text,teacher uuid,target_order uuid,amount bigint,key uuid,request_data jsonb) returns uuid
language plpgsql set search_path='' as $$
declare op private.credit_operations; s private.credit_sources; oid uuid; needed bigint:=amount; take bigint;
begin
 if amount is null or amount not between 1 and 100000000 or key is null or target_order is null or request_data is null then raise exception 'Invalid credit spend'; end if;
 perform 1 from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=teacher and a.department_id=d and a.status='approved' and a.can_spend_credits
 and lower(a.email)=lower(u.email) and u.email_confirmed_at is not null for update of a;
 if not found then raise exception 'Department spending access required'; end if;
 perform private.lock_credit_wallet(d,m);
 select * into op from private.credit_operations where request_key=key;
 if found then
  if op.kind<>'spend' or op.actor_id is distinct from teacher or op.order_id<>target_order or op.department_id<>d or op.mode<>m
    or op.amount_minor<>amount or op.request<>request_data then raise exception 'Request key already used'; end if;
  return op.id;
 end if;
 if private.credit_balance(d,m)<amount then raise exception 'Insufficient department credit'; end if;
 insert into private.credit_operations(department_id,mode,actor_id,request_key,kind,amount_minor,request,reason,order_id)
 values(d,m,teacher,key,'spend',amount,request_data,'Paper creation',target_order) returning id into oid;
 for s in select * from private.credit_sources where department_id=d and mode=m and remaining_minor>0 and voided_at is null
  and (expires_at is null or expires_at>now()) order by expires_at asc nulls last,(kind='purchase'),created_at,id for update loop
  take:=least(needed,s.remaining_minor);
  update private.credit_sources set remaining_minor=remaining_minor-take where id=s.id;
  insert into private.credit_entries(operation_id,source_id,department_id,mode,amount_minor) values(oid,s.id,d,m,-take);
  needed:=needed-take; exit when needed=0;
 end loop;
 if needed<>0 then raise exception 'Credit allocation failed'; end if;
 update private.department_wallets set revision=revision+1 where department_id=d and mode=m;
 return oid;
end $$;

create function public.return_department_credit(spend_id uuid,reason text,request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare original private.credit_operations; op private.credit_operations; allocation record; oid uuid; req jsonb;
begin
 if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
 if reason is null or length(trim(reason)) not between 3 and 2000 or request_key is null then raise exception 'Invalid return reason'; end if;
 select * into original from private.credit_operations where id=spend_id and kind='spend';
 if not found then raise exception 'Credit spend not found'; end if;
 perform private.lock_credit_wallet(original.department_id,original.mode);
 req:=jsonb_build_object('spend',spend_id,'reason',trim(reason));
 select * into op from private.credit_operations where credit_operations.request_key=return_department_credit.request_key;
 if found then
  if op.kind<>'return' or op.actor_id is distinct from auth.uid() or op.request<>req then raise exception 'Request key already used'; end if;
  return op.id;
 end if;
 if exists(select 1 from private.credit_operations where original_operation=spend_id and kind='return') then raise exception 'Credit already returned'; end if;
 -- Expiry/refunded-source policy is not invented here. Staff must resolve it
 -- separately rather than silently reviving expired or voided money.
 if exists(select 1 from private.credit_entries e join private.credit_sources s on s.id=e.source_id
  where e.operation_id=spend_id and (s.voided_at is not null or s.expires_at<=now())) then raise exception 'Original credit source needs review'; end if;
 insert into private.credit_operations(department_id,mode,actor_id,request_key,kind,amount_minor,request,reason,original_operation,order_id)
 values(original.department_id,original.mode,auth.uid(),request_key,'return',original.amount_minor,req,trim(reason),spend_id,original.order_id) returning id into oid;
 for allocation in select * from private.credit_entries where operation_id=spend_id loop
  update private.credit_sources set remaining_minor=remaining_minor-allocation.amount_minor where id=allocation.source_id;
  insert into private.credit_entries(operation_id,source_id,department_id,mode,amount_minor)
   values(oid,allocation.source_id,original.department_id,original.mode,-allocation.amount_minor);
 end loop;
 update private.department_wallets set revision=revision+1 where department_id=original.department_id and mode=original.mode;
 return oid;
end $$;

create function public.department_credit_summary(target_department uuid,target_mode text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare manager boolean;
begin
 if target_mode is null or target_mode not in ('test','live') then raise exception 'Invalid wallet'; end if;
 if not public.is_credit_administrator() and target_department is distinct from public.approved_department_id() then raise exception 'Department access required'; end if;
 manager:=public.is_credit_administrator() or public.is_department_head(target_department);
 return jsonb_build_object('departmentId',target_department,'mode',target_mode,'balanceMinor',private.credit_balance(target_department,target_mode),
 'canManage',manager,'canSpend',coalesce((select can_spend_credits from public.teacher_accounts where user_id=auth.uid() and department_id=target_department and status='approved'),false),
 'sources',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'remainingMinor',remaining_minor,'expiresAt',expires_at,'voidedAt',voided_at) order by created_at,id)
  from private.credit_sources where department_id=target_department and mode=target_mode),'[]'::jsonb) else '[]'::jsonb end,
 'activity',coalesce((select jsonb_agg(row_data order by created_at desc,id) from (
  select o.id,o.created_at,jsonb_build_object('id',o.id,'kind',o.kind,'amountMinor',o.amount_minor,'createdAt',o.created_at,'orderId',o.order_id) row_data
  from private.credit_operations o where o.department_id=target_department and o.mode=target_mode and (manager or o.actor_id=auth.uid()) order by o.created_at desc,o.id limit 100) recent),'[]'::jsonb));
end $$;
revoke all on function private.credit_immutable(),private.credit_balance(uuid,text),private.lock_credit_wallet(uuid,text),
 private.spend_department_credit(uuid,text,uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.grant_department_credit(uuid,text,bigint,text,timestamptz,text,text,uuid),
 public.return_department_credit(uuid,text,uuid),public.department_credit_summary(uuid,text) from public,anon,authenticated;
grant execute on function public.grant_department_credit(uuid,text,bigint,text,timestamptz,text,text,uuid),
 public.return_department_credit(uuid,text,uuid),public.department_credit_summary(uuid,text) to authenticated;
commit;
