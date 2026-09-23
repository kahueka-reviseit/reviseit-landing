begin;

-- C04A: Stripe does not guarantee notification order. A full refund can arrive
-- before this payment's intent is associated with its order. Such a refund is
-- retained, not discarded, and applied the moment the paid session associates
-- the intent. A refunded order never unlocks its questionnaire. Migration 018
-- rows, events and orders are unchanged.
create table private.stripe_pending_refunds (
 event_id text primary key references private.stripe_events(event_id),
 payment_intent_id text not null check(payment_intent_id ~ '^pi_[A-Za-z0-9]{1,250}$'),
 livemode boolean not null,
 amount_refunded integer not null,
 currency text not null,
 applied_to uuid references private.paper_payments(order_id),
 outcome text,
 received_at timestamptz not null default now(),
 applied_at timestamptz
);
create index stripe_pending_refunds_intent on private.stripe_pending_refunds(payment_intent_id) where applied_at is null;
alter table private.stripe_pending_refunds enable row level security;
revoke all on private.stripe_pending_refunds from public,anon,authenticated,service_role,reviseit_catalogue_publisher;

-- One refund rule for both delivery orders. The caller holds the payment row lock.
create function private.apply_full_refund(pay private.paper_payments,event_livemode boolean,amount_refunded integer,refund_currency text) returns text
language plpgsql security definer set search_path='' as $$
begin
 if event_livemode is distinct from (pay.mode='live') then return 'rejected:mode'; end if;
 if refund_currency is distinct from pay.currency or amount_refunded is distinct from pay.amount_minor then return 'partial-or-mismatched-refund'; end if;
 if pay.refunded_at is not null then return 'already-refunded'; end if;
 update private.paper_payments set refunded_at=now(),attention=null,updated_at=now() where order_id=pay.order_id;
 update private.paper_orders set state='cancelled',updated_at=now() where id=pay.order_id and state in ('awaiting_payment','awaiting_answers','held');
 insert into private.paper_job_events(order_id,event,actor) values(pay.order_id,'refunded','stripe');
 return 'refunded';
end $$;

create or replace function public.record_stripe_refund(event_id text,event_livemode boolean,payment_intent text,amount_refunded integer,refund_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.stripe_events; pay private.paper_payments; outcome text;
begin
 select * into prior from private.stripe_events e where e.event_id=record_stripe_refund.event_id;
 if found then return jsonb_build_object('duplicate',true,'outcome',prior.outcome,'orderId',prior.order_id); end if;
 if event_livemode is null or payment_intent is null or payment_intent !~ '^pi_[A-Za-z0-9]{1,250}$' then raise exception 'Invalid Stripe refund event'; end if;
 select * into pay from private.paper_payments where payment_intent_id=payment_intent for update;
 if found then outcome:=private.apply_full_refund(pay,event_livemode,amount_refunded,refund_currency);
 else outcome:='retained:awaiting-payment-association';
 end if;
 insert into private.stripe_events(event_id,event_type,livemode,order_id,outcome) values(record_stripe_refund.event_id,'charge.refunded',event_livemode,pay.order_id,outcome);
 if pay.order_id is null then
  insert into private.stripe_pending_refunds(event_id,payment_intent_id,livemode,amount_refunded,currency)
  values(record_stripe_refund.event_id,payment_intent,event_livemode,amount_refunded,refund_currency);
 end if;
 return jsonb_build_object('duplicate',false,'outcome',outcome,'orderId',pay.order_id);
end $$;

-- Associating a payment intent applies any refund that arrived earlier.
create function private.apply_pending_refunds(target uuid) returns text
language plpgsql security definer set search_path='' as $$
declare pay private.paper_payments; pending private.stripe_pending_refunds; result text; last text;
begin
 select * into pay from private.paper_payments where order_id=target for update;
 if pay.payment_intent_id is null then return null; end if;
 for pending in select * from private.stripe_pending_refunds where payment_intent_id=pay.payment_intent_id and applied_at is null order by received_at,event_id for update loop
  select * into pay from private.paper_payments where order_id=target;
  result:=private.apply_full_refund(pay,pending.livemode,pending.amount_refunded,pending.currency);
  update private.stripe_pending_refunds set applied_to=target,outcome=result,applied_at=now() where event_id=pending.event_id;
  if result='refunded' then last:=result; end if;
 end loop;
 return last;
end $$;

-- Migration 018's checkout recorder, with two changes: a refunded payment never
-- unlocks the order, and retained refunds are applied on association.
create or replace function public.record_stripe_checkout(event_id text,event_type text,event_livemode boolean,session jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.stripe_events; pay private.paper_payments; o private.paper_orders; target uuid; outcome text;
begin
 select * into prior from private.stripe_events e where e.event_id=record_stripe_checkout.event_id;
 if found then return jsonb_build_object('duplicate',true,'outcome',prior.outcome,'orderId',prior.order_id); end if;
 if event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','reconcile')
  or event_livemode is null or jsonb_typeof(session) is distinct from 'object' then raise exception 'Invalid Stripe checkout event'; end if;
 begin target:=(session->>'clientReferenceId')::uuid; exception when others then target:=null; end;
 select * into pay from private.paper_payments where order_id=target for update;
 if not found then outcome:='rejected:unknown-order';
 elsif session->>'metadataOrderId' is distinct from target::text then outcome:='rejected:metadata';
 elsif event_livemode is distinct from (pay.mode='live') or (session->'livemode') is distinct from to_jsonb(pay.mode='live') then outcome:='rejected:mode';
 elsif pay.checkout_session_id is not null and pay.checkout_session_id is distinct from session->>'id' then outcome:='rejected:session';
 elsif (session->>'id') !~ ('^cs_'||case when pay.mode='live' then 'live' else 'test' end||'_[A-Za-z0-9]{1,250}$') then outcome:='rejected:session';
 elsif (session->'amountTotal') is distinct from to_jsonb(pay.amount_minor) or session->>'currency' is distinct from pay.currency then outcome:='rejected:amount';
 else
  select * into o from private.paper_orders where id=target for update;
  if pay.checkout_session_id is null then update private.paper_payments set checkout_session_id=session->>'id' where order_id=target; end if;
  if event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded','reconcile') then
   if session->>'paymentStatus'='paid' and session->>'status'='complete' then
    if pay.status='paid' then outcome:='already-paid';
    else
     update private.paper_payments set status='paid',paid_at=now(),updated_at=now(),
      payment_intent_id=case when session->>'paymentIntent' ~ '^pi_[A-Za-z0-9]{1,250}$' then session->>'paymentIntent' end where order_id=target;
     if private.apply_pending_refunds(target)='refunded' then
      outcome:='paid-already-refunded';
     elsif o.state='awaiting_payment' then
      update private.paper_orders set state='awaiting_answers',updated_at=now() where id=target;
      outcome:='paid';
     else
      update private.paper_orders set state='held',updated_at=now() where id=target and state in ('cancelled','awaiting_payment');
      update private.paper_payments set attention='refund_review' where order_id=target;
      outcome:='paid-needs-operator';
     end if;
     insert into private.paper_job_events(order_id,event,actor,detail) values(target,case outcome when 'paid' then 'paid' when 'paid-already-refunded' then 'paid_after_refund' else 'paid_needs_operator' end,'stripe',
      jsonb_build_object('mode',pay.mode,'amountMinor',pay.amount_minor,'currency',pay.currency,'eventType',event_type));
    end if;
   else outcome:='not-paid-yet';
   end if;
  elsif pay.status='paid' then outcome:='ignored-after-payment';
  else
   update private.paper_payments set status=case when event_type='checkout.session.expired' then 'expired' else 'failed' end,updated_at=now() where order_id=target;
   update private.paper_orders set state='cancelled',updated_at=now() where id=target and state='awaiting_payment';
   insert into private.paper_job_events(order_id,event,actor) values(target,case when event_type='checkout.session.expired' then 'checkout_expired' else 'payment_failed' end,'stripe');
   outcome:=case when event_type='checkout.session.expired' then 'expired' else 'failed' end;
  end if;
 end if;
 if event_type<>'reconcile' then
  insert into private.stripe_events(event_id,event_type,livemode,order_id,outcome) values(record_stripe_checkout.event_id,event_type,event_livemode,case when pay.order_id is null then null else target end,outcome);
 end if;
 return jsonb_build_object('duplicate',false,'outcome',outcome,'orderId',case when pay.order_id is null then null else target end);
end $$;

-- A repeated request key reports whether its unpaid checkout has ended, so the
-- browser can start an explicit new attempt with a new key. The same key still
-- always returns the same order; it never creates a second one.
create or replace function public.begin_paper_checkout(request_key uuid,target_module text,selection_revision integer,allocations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); f private.pilot_funding; pay private.paper_payments; o uuid; compiled record;
begin
 if me is null or public.approved_school_id() is null or not public.can_use_curriculum(target_module) then raise exception 'Curriculum access required'; end if;
 if request_key is null then raise exception 'Invalid checkout request'; end if;
 select * into pay from private.paper_payments where paper_payments.request_key=begin_paper_checkout.request_key;
 if found then
  if pay.teacher_id<>me then raise exception 'Invalid checkout request'; end if;
  return jsonb_build_object('orderId',pay.order_id,'mode',pay.mode,'status',pay.status,'amountMinor',pay.amount_minor,'currency',pay.currency,
   'sessionId',pay.checkout_session_id,'checkoutUrl',pay.checkout_url,'expiresAt',pay.expires_at,'existing',false,
   'terminal',pay.refunded_at is null and (pay.status in ('expired','failed','cancelled') or (pay.status in ('creating','open') and pay.expires_at<=now())));
 end if;
 perform 1 from public.teacher_accounts where user_id=me for update;
 select * into pay from private.paper_payments p where p.teacher_id=me and p.status in ('creating','open') and p.expires_at>now() order by created_at desc limit 1;
 if found then
  return jsonb_build_object('orderId',pay.order_id,'mode',pay.mode,'status',pay.status,'amountMinor',pay.amount_minor,'currency',pay.currency,
   'sessionId',pay.checkout_session_id,'checkoutUrl',pay.checkout_url,'expiresAt',pay.expires_at,'existing',true,'terminal',false);
 end if;
 select * into f from private.pilot_funding where enabled for update;
 if not found then raise exception 'Pilot purchasing unavailable'; end if;
 if private.pilot_seats_used(f.mode)>=f.order_limit then raise exception 'Pilot capacity unavailable'; end if;
 select * into compiled from private.compile_paid_order(me,target_module,selection_revision,allocations);
 o:=gen_random_uuid();
 insert into private.paper_orders(id,teacher_id,school_id,module_id,release,title,entitlement,adapter_key,form,snapshot,worker_id,state)
 values(o,me,compiled.school,target_module,compiled.release,'Catalogue paper','paid','authored-bundle-v1',compiled.form,compiled.snapshot,f.worker_id,'awaiting_payment');
 insert into private.paper_payments(order_id,teacher_id,request_key,mode,amount_minor,currency,expires_at)
 values(o,me,begin_paper_checkout.request_key,f.mode,10000,'zar',now()+interval '60 minutes') returning * into pay;
 insert into private.paper_job_events(order_id,event,actor,detail) values(o,'checkout_started',me::text,jsonb_build_object('mode',f.mode,'amountMinor',10000,'currency','zar'));
 return jsonb_build_object('orderId',o,'mode',pay.mode,'status',pay.status,'amountMinor',10000,'currency','zar',
  'sessionId',null,'checkoutUrl',null,'expiresAt',pay.expires_at,'existing',false,'terminal',false);
end $$;

revoke all on function private.apply_full_refund(private.paper_payments,boolean,integer,text),private.apply_pending_refunds(uuid) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
revoke all on function public.record_stripe_refund(text,boolean,text,integer,text),public.record_stripe_checkout(text,text,boolean,jsonb),public.begin_paper_checkout(uuid,text,integer,jsonb) from public,anon,authenticated,reviseit_catalogue_publisher;
grant execute on function public.record_stripe_refund(text,boolean,text,integer,text),public.record_stripe_checkout(text,text,boolean,jsonb) to service_role;
revoke execute on function public.begin_paper_checkout(uuid,text,integer,jsonb) from service_role;
grant execute on function public.begin_paper_checkout(uuid,text,integer,jsonb) to authenticated;

commit;
