begin;
create table private.credit_topup_amounts(amount_minor integer primary key check(amount_minor between 100 and 100000000), enabled boolean not null default false);
-- No commercial top-up amounts are enabled by this migration.
create table private.credit_purchases(
 id uuid primary key default gen_random_uuid(),department_id uuid not null references public.departments(id),head_id uuid not null references auth.users(id),
 mode text not null check(mode in ('test','live')),amount_minor integer not null,request_key uuid not null unique,
 reference text not null default '' check(length(reference)<=200),
 status text not null default 'creating' check(status in ('creating','open','paid','expired','attention')),
 checkout_session_id text unique,checkout_url text,payment_intent_id text unique,
 operation_id uuid unique references private.credit_operations(id),source_id uuid unique references private.credit_sources(id),
 expires_at timestamptz not null default now()+interval '60 minutes',created_at timestamptz not null default now()
);
create table private.credit_payment_alerts(payment_intent_id text primary key,mode text not null,amount_refunded bigint not null check(amount_refunded>=0),disputed boolean not null default false,updated_at timestamptz not null default now());
create table private.credit_stripe_events(id text primary key,kind text not null,mode text not null,purchase_id uuid,outcome text not null,created_at timestamptz not null default now());
alter table private.credit_topup_amounts enable row level security;
alter table private.credit_purchases enable row level security;
alter table private.credit_payment_alerts enable row level security;
alter table private.credit_stripe_events enable row level security;
revoke all on private.credit_topup_amounts,private.credit_purchases,private.credit_payment_alerts,private.credit_stripe_events from public,anon,authenticated,service_role;
create function public.credit_topups() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(amount_minor order by amount_minor),'[]'::jsonb) from private.credit_topup_amounts where enabled and public.is_department_head(public.approved_department_id());
$$;
create function public.begin_credit_purchase(amount_minor integer,reference text,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.credit_purchases; d uuid; cfg private.credit_settings;
begin
 perform 1 from public.teacher_accounts where user_id=auth.uid() for update;
 d:=public.approved_department_id();if not public.is_department_head(d) then raise exception 'Department head access required'; end if;
 if request_key is null or reference is null or length(reference)>200 then raise exception 'Invalid purchase'; end if;
 select * into p from private.credit_purchases where credit_purchases.request_key=begin_credit_purchase.request_key;
 if found then
  if p.head_id<>auth.uid() or p.department_id<>d or p.amount_minor<>amount_minor or p.reference<>reference then raise exception 'Request key already used'; end if;
 else
  select * into cfg from private.credit_settings where singleton and enabled;
  if not found or not exists(select 1 from private.credit_topup_amounts a where a.amount_minor=begin_credit_purchase.amount_minor and enabled) then raise exception 'Top-up unavailable'; end if;
  insert into private.credit_purchases(department_id,head_id,mode,amount_minor,request_key,reference) values(d,auth.uid(),cfg.mode,amount_minor,request_key,reference) returning * into p;
 end if;
 return jsonb_build_object('id',p.id,'mode',p.mode,'amountMinor',p.amount_minor,'status',p.status,'checkoutUrl',p.checkout_url,'expiresAt',p.expires_at);
end $$;
create function public.attach_credit_checkout(target uuid,session_id text,session_url text,session_livemode boolean) returns void language plpgsql security definer set search_path='' as $$
declare p private.credit_purchases;
begin
 select * into p from private.credit_purchases where id=target for update;
 if not found or session_livemode is distinct from (p.mode='live') or session_id is null or session_id!~'^cs_(test|live)_[A-Za-z0-9]{1,250}$'
 or session_url is null or session_url!~'^https://checkout\.stripe\.com/' then raise exception 'Invalid checkout'; end if;
 if p.checkout_session_id is not null and p.checkout_session_id<>session_id then raise exception 'Checkout already attached'; end if;
 update private.credit_purchases set checkout_session_id=session_id,checkout_url=session_url,status=case when status='creating' then 'open' else status end where id=target;
end $$;
create function public.record_credit_checkout(event_id text,event_type text,event_livemode boolean,session jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.credit_purchases; pi text:=session->>'paymentIntent'; oid uuid; sid uuid; outcome text; alert private.credit_payment_alerts;
begin
 if pi is not null then perform private.lock_payment_intent(pi); end if;
 select * into p from private.credit_purchases where id=(session->>'metadataPurchaseId')::uuid for update;
 if not found then raise exception 'Credit purchase not found'; end if;
 if session->>'id' is null or session->>'id'!~'^cs_(test|live)_[A-Za-z0-9]{1,250}$'
 or event_livemode is distinct from (p.mode='live') or session->'livemode' is distinct from to_jsonb(event_livemode)
 or session->>'clientReferenceId' is distinct from p.id::text or session->'amountTotal' is distinct from to_jsonb(p.amount_minor)
 or session->>'currency' is distinct from 'zar' or (p.checkout_session_id is not null and p.checkout_session_id is distinct from session->>'id')
 then raise exception 'Credit payment mismatch'; end if;
 if exists(select 1 from private.credit_stripe_events where id=event_id) then return jsonb_build_object('outcome','duplicate'); end if;
 select * into alert from private.credit_payment_alerts where payment_intent_id=pi and mode=p.mode;
 if session->>'paymentStatus'='paid' and session->>'status'='complete' then
  if pi is null or pi!~'^pi_[A-Za-z0-9]{1,250}$' then raise exception 'Missing payment identity'; end if;
  perform private.lock_credit_wallet(p.department_id,p.mode);
  if p.operation_id is null then
   insert into private.credit_operations(department_id,mode,actor_id,request_key,kind,amount_minor,request,reason)
   values(p.department_id,p.mode,p.head_id,p.id,'purchase',p.amount_minor,jsonb_build_object('purchase',p.id),'Stripe-confirmed top-up') returning id into oid;
   insert into private.credit_sources(department_id,mode,kind,original_minor,remaining_minor,reference,voided_at)
   values(p.department_id,p.mode,'purchase',p.amount_minor,p.amount_minor,p.reference,case when alert.payment_intent_id is not null then now() end) returning id into sid;
   insert into private.credit_entries(operation_id,source_id,department_id,mode,amount_minor) values(oid,sid,p.department_id,p.mode,p.amount_minor);
   update private.department_wallets set revision=revision+1 where department_id=p.department_id and mode=p.mode;
  end if;
  update private.credit_purchases set operation_id=coalesce(operation_id,oid),source_id=coalesce(source_id,sid),payment_intent_id=pi,
   checkout_session_id=session->>'id',status=case when alert.payment_intent_id is not null then 'attention' else 'paid' end where id=p.id;
  outcome:=case when alert.payment_intent_id is not null then 'needs_review' else 'funded' end;
 elsif session->>'status'='expired' and p.operation_id is null then
  update private.credit_purchases set status='expired' where id=p.id;outcome:='expired';
 else outcome:='pending';end if;
 insert into private.credit_stripe_events(id,kind,mode,purchase_id,outcome) values(event_id,event_type,p.mode,p.id,outcome);
 return jsonb_build_object('outcome',outcome);
end $$;
create function public.record_credit_payment_alert(event_id text,event_livemode boolean,payment_intent text,amount_refunded bigint,disputed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.credit_purchases; m text:=case when event_livemode then 'live' else 'test' end;
begin
 if payment_intent is null or payment_intent!~'^pi_[A-Za-z0-9]{1,250}$' or amount_refunded is null or amount_refunded<0 or disputed is null then raise exception 'Invalid payment alert'; end if;
 perform private.lock_payment_intent(payment_intent);
 if exists(select 1 from private.credit_stripe_events where id=event_id) then return jsonb_build_object('outcome','duplicate'); end if;
 insert into private.credit_payment_alerts(payment_intent_id,mode,amount_refunded,disputed) values(payment_intent,m,amount_refunded,disputed)
 on conflict(payment_intent_id) do update set amount_refunded=greatest(credit_payment_alerts.amount_refunded,excluded.amount_refunded),
 disputed=credit_payment_alerts.disputed or excluded.disputed,updated_at=now();
 select * into p from private.credit_purchases where payment_intent_id=payment_intent and mode=m for update;
 if found then
  perform private.lock_credit_wallet(p.department_id,p.mode);
  update private.credit_sources set voided_at=coalesce(voided_at,now()) where id=p.source_id;
  update private.credit_purchases set status='attention' where id=p.id;
  update private.department_wallets set revision=revision+1 where department_id=p.department_id and mode=p.mode;
 end if;
 insert into private.credit_stripe_events(id,kind,mode,purchase_id,outcome) values(event_id,'payment_alert',m,p.id,'needs_review');
 return jsonb_build_object('outcome','needs_review');
end $$;
create function public.credit_purchase_for_head(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.credit_purchases;
begin
 select * into p from private.credit_purchases where id=target;
 if not found or not public.is_department_head(p.department_id) then return null; end if;
 return jsonb_build_object('id',p.id,'sessionId',p.checkout_session_id,'status',p.status,'amountMinor',p.amount_minor,'mode',p.mode);
end $$;
revoke all on function public.credit_topups(),public.begin_credit_purchase(integer,text,uuid),public.credit_purchase_for_head(uuid),
 public.attach_credit_checkout(uuid,text,text,boolean),public.record_credit_checkout(text,text,boolean,jsonb),public.record_credit_payment_alert(text,boolean,text,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.credit_topups(),public.begin_credit_purchase(integer,text,uuid),public.credit_purchase_for_head(uuid) to authenticated;
grant execute on function public.attach_credit_checkout(uuid,text,text,boolean),public.record_credit_checkout(text,text,boolean,jsonb),public.record_credit_payment_alert(text,boolean,text,bigint,boolean) to service_role;
commit;
