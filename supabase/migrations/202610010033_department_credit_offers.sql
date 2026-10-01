begin;
create table private.credit_offers (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 3 and 160),
 mode text not null check(mode in ('test','live')), amount_minor bigint not null check(amount_minor between 1 and 100000000),
 opens_at timestamptz not null, claim_by timestamptz not null, use_by timestamptz not null,
 places integer not null check(places between 1 and 10000), enabled boolean not null default false,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(opens_at<claim_by and claim_by<use_by)
);
create table private.credit_offer_departments (
 offer_id uuid not null references private.credit_offers(id),department_id uuid not null references public.departments(id),primary key(offer_id,department_id)
);
create table private.credit_offer_claims (
 offer_id uuid not null references private.credit_offers(id),department_id uuid not null references public.departments(id),
 operation_id uuid not null unique references private.credit_operations(id), primary key(offer_id,department_id)
);
alter table private.credit_offers enable row level security;
alter table private.credit_offer_departments enable row level security;
alter table private.credit_offer_claims enable row level security;
revoke all on private.credit_offers,private.credit_offer_departments,private.credit_offer_claims from public,anon,authenticated;
create function public.create_department_offer(title text,target_mode text,amount_minor bigint,opens_at timestamptz,claim_by timestamptz,
 use_by timestamptz,places integer,departments uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
 if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
 if departments is null or cardinality(departments) not between 1 and 10000 then raise exception 'Choose eligible departments'; end if;
 insert into private.credit_offers(title,mode,amount_minor,opens_at,claim_by,use_by,places,created_by)
 values(trim(title),target_mode,amount_minor,opens_at,claim_by,use_by,places,auth.uid()) returning id into oid;
 insert into private.credit_offer_departments select oid,d from (select distinct unnest(departments) d) x;
 return oid;
end $$;
create function public.set_department_offer_enabled(target uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
 if enabled is null then raise exception 'Choose offer status'; end if;
 update private.credit_offers set enabled=set_department_offer_enabled.enabled where id=target;
 if not found then raise exception 'Offer not found'; end if;
end $$;
create function public.claim_department_offer(target uuid,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare d uuid; offer private.credit_offers; op private.credit_operations; oid uuid; sid uuid; req jsonb;
begin
 perform 1 from public.teacher_accounts where user_id=auth.uid() for update;
 d:=public.approved_department_id();
 if not public.is_department_head(d) then raise exception 'Department head access required'; end if;
 if request_key is null then raise exception 'Request key required'; end if;
 -- All claim paths lock offer before wallet, bounding limited places globally.
 select * into offer from private.credit_offers where id=target for update;
 if not found then raise exception 'Offer not available'; end if;
 perform private.lock_credit_wallet(d,offer.mode);
 req:=jsonb_build_object('offer',target,'department',d);
 select * into op from private.credit_operations where credit_operations.request_key=claim_department_offer.request_key;
 if found then
  if op.kind<>'claim' or op.actor_id is distinct from auth.uid() or op.request<>req then raise exception 'Request key already used'; end if;
  return op.id;
 end if;
 select operation_id into oid from private.credit_offer_claims where offer_id=target and department_id=d;
 if found then return oid; end if;
 if not offer.enabled or now()<offer.opens_at or now()>=offer.claim_by
 or not exists(select 1 from private.credit_offer_departments where offer_id=target and department_id=d)
 or (select count(*) from private.credit_offer_claims where offer_id=target)>=offer.places then raise exception 'Offer not available'; end if;
 insert into private.credit_operations(department_id,mode,actor_id,request_key,kind,amount_minor,request,reason)
 values(d,offer.mode,auth.uid(),request_key,'claim',offer.amount_minor,req,'Claimed offer: '||offer.title) returning id into oid;
 insert into private.credit_sources(department_id,mode,kind,original_minor,remaining_minor,expires_at,reference)
 values(d,offer.mode,'offer',offer.amount_minor,offer.amount_minor,offer.use_by,offer.title) returning id into sid;
 insert into private.credit_entries(operation_id,source_id,department_id,mode,amount_minor) values(oid,sid,d,offer.mode,offer.amount_minor);
 insert into private.credit_offer_claims values(target,d,oid);
 update private.department_wallets set revision=revision+1 where department_id=d and mode=offer.mode;
 return oid;
end $$;
create function public.department_offers(target_department uuid,target_mode text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_credit_administrator() and not public.is_department_head(target_department) then raise exception 'Department head access required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'amountMinor',o.amount_minor,'opensAt',o.opens_at,
 'claimBy',o.claim_by,'useBy',o.use_by,'claimed',c.operation_id is not null,'available',o.enabled and now()>=o.opens_at and now()<o.claim_by and
 (select count(*) from private.credit_offer_claims where offer_id=o.id)<o.places) order by o.claim_by)
 from private.credit_offers o join private.credit_offer_departments d on d.offer_id=o.id left join private.credit_offer_claims c on c.offer_id=o.id and c.department_id=d.department_id
 where d.department_id=target_department and o.mode=target_mode),'[]'::jsonb);
end $$;
revoke all on function public.create_department_offer(text,text,bigint,timestamptz,timestamptz,timestamptz,integer,uuid[]),
 public.set_department_offer_enabled(uuid,boolean),public.claim_department_offer(uuid,uuid),public.department_offers(uuid,text) from public,anon,authenticated;
grant execute on function public.create_department_offer(text,text,bigint,timestamptz,timestamptz,timestamptz,integer,uuid[]),
 public.set_department_offer_enabled(uuid,boolean),public.claim_department_offer(uuid,uuid),public.department_offers(uuid,text) to authenticated;
commit;
