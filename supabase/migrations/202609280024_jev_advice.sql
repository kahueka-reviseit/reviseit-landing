begin;
-- Optional direct Jev advice. No order, payment or generation state is changed.
create table private.jev_advice_calls (
 order_id uuid not null references private.paper_orders(id),
 line_id text not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 revision integer not null,
 status text not null default 'reserved' check(status in ('reserved','complete','unavailable')),
 response jsonb,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 primary key(order_id,line_id,request_hash)
);
alter table private.jev_advice_calls enable row level security;
revoke all on private.jev_advice_calls from public,anon,authenticated,service_role;

create function public.reserve_jev_advice(target uuid,target_teacher uuid,target_line text,expected_revision integer,request_hash text,call_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg jsonb; old private.jev_advice_calls; n integer;
begin
 if target_line is null or length(target_line) not between 1 and 100 or request_hash is null or request_hash !~ '^[a-f0-9]{64}$'
   or expected_revision is null or call_limit is null or call_limit not between 1 and 100 then raise exception 'Invalid advice request'; end if;
 -- Lock serialises reservations across all instances, and against order changes.
 perform 1 from private.paper_orders where id=target for update;
 cfg:=public.paper_configuration_for_teacher(target,target_teacher);
 if cfg is null or not coalesce((cfg->>'paid')::boolean,false) or cfg->>'state'<>'awaiting_answers'
   or coalesce((cfg->>'submitted')::boolean,true) or (cfg->>'revision')::integer<>expected_revision
   or not ((cfg->'configuration'->'lines') ? target_line) then return jsonb_build_object('status','unavailable'); end if;
 select * into old from private.jev_advice_calls c where c.order_id=target and c.line_id=target_line and c.request_hash=reserve_jev_advice.request_hash;
 if found then return jsonb_build_object('status',old.status,'response',old.response); end if;
 select count(*) into n from private.jev_advice_calls where order_id=target;
 if n>=call_limit then return jsonb_build_object('status','limit'); end if;
 insert into private.jev_advice_calls(order_id,line_id,request_hash,revision) values(target,target_line,request_hash,expected_revision);
 return jsonb_build_object('status','dispatch');
end $$;

create function public.finish_jev_advice(target uuid,target_line text,request_hash text,result jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if result is not null and (jsonb_typeof(result)<>'object' or octet_length(result::text)>32768) then raise exception 'Invalid advice result'; end if;
 update private.jev_advice_calls c set status=case when result is null then 'unavailable' else 'complete' end,response=result,completed_at=now()
 where c.order_id=target and c.line_id=target_line and c.request_hash=finish_jev_advice.request_hash and c.status='reserved';
end $$;
revoke all on function public.reserve_jev_advice(uuid,uuid,text,integer,text,integer),public.finish_jev_advice(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_jev_advice(uuid,uuid,text,integer,text,integer),public.finish_jev_advice(uuid,text,text,jsonb) to service_role;
commit;
