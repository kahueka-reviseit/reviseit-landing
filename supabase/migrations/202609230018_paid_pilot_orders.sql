begin;

-- C04: paid pilot orders. Additive only. Existing internal orders keep their
-- entitlement, frozen inputs, events and documents. A paid entitlement exists
-- only after a server-verified Stripe result; a browser return never unlocks it.

alter table private.paper_orders drop constraint paper_orders_entitlement_check;
alter table private.paper_orders add constraint paper_orders_entitlement_check check(entitlement in ('internal_test','paid'));
alter table private.paper_orders drop constraint paper_orders_state_check;
alter table private.paper_orders add constraint paper_orders_state_check check(state in
 ('awaiting_payment','awaiting_answers','queued','generating','awaiting_memo_review','rendering','awaiting_release','released','held','cancelled'));

-- One operator-configured pilot allowance per payment mode. Seats bound how many
-- paid orders checkout may admit; the worker ledger separately bounds money.
-- The worker identity is a routing fence, never a grant.
create table private.pilot_funding (
 mode text primary key check(mode in ('test','live')),
 enabled boolean not null default false,
 order_limit integer not null check(order_limit between 0 and 1000),
 worker_id text not null check(worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'),
 note text not null check(length(trim(note)) between 3 and 500),
 updated_at timestamptz not null default now()
);
create unique index pilot_funding_single_enabled on private.pilot_funding(enabled) where enabled;
create table private.pilot_funding_changes (
 id bigint generated always as identity primary key, mode text not null, enabled boolean not null,
 order_limit integer not null, worker_id text not null, note text not null,
 changed_by text not null default session_user, changed_at timestamptz not null default now()
);

-- Price and currency are fixed here and in the server, never read from a request.
create table private.paper_payments (
 order_id uuid primary key references private.paper_orders(id),
 teacher_id uuid not null references auth.users(id),
 request_key uuid not null unique,
 mode text not null check(mode in ('test','live')),
 amount_minor integer not null check(amount_minor=10000),
 currency text not null check(currency='zar'),
 status text not null default 'creating' check(status in ('creating','open','paid','expired','failed','cancelled')),
 checkout_session_id text unique check(checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{1,250}$'),
 checkout_url text check(length(checkout_url)<=2048 and checkout_url ~ '^https://checkout\.stripe\.com/[A-Za-z0-9/_#%.=?&-]+$'),
 expires_at timestamptz not null,
 payment_intent_id text check(payment_intent_id ~ '^pi_[A-Za-z0-9]{1,250}$'),
 paid_at timestamptz,
 refunded_at timestamptz,
 attention text check(attention in ('refund_review')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((status='paid')=(paid_at is not null) or refunded_at is not null)
);
create index paper_payments_teacher on private.paper_payments(teacher_id,status);
-- Every verified Stripe notification is recorded once. A retry returns the saved outcome.
create table private.stripe_events (
 event_id text primary key check(length(event_id) between 3 and 255),
 event_type text not null, livemode boolean not null, order_id uuid,
 outcome text not null, received_at timestamptz not null default now()
);
alter table private.pilot_funding enable row level security;
alter table private.pilot_funding_changes enable row level security;
alter table private.paper_payments enable row level security;
alter table private.stripe_events enable row level security;
revoke all on private.pilot_funding,private.pilot_funding_changes,private.paper_payments,private.stripe_events
 from public,anon,authenticated,service_role,reviseit_catalogue_publisher;

-- Operator-only (database owner). Configures the one active pilot allowance.
create function public.configure_pilot_funding(target_mode text,target_enabled boolean,target_limit integer,target_worker text,change_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if target_mode is null or target_enabled is null or target_limit is null or target_worker is null or change_note is null then raise exception 'Complete pilot funding settings required'; end if;
 if target_enabled then update private.pilot_funding set enabled=false,updated_at=now() where mode<>target_mode and enabled; end if;
 insert into private.pilot_funding(mode,enabled,order_limit,worker_id,note) values(target_mode,target_enabled,target_limit,target_worker,trim(change_note))
 on conflict(mode) do update set enabled=excluded.enabled,order_limit=excluded.order_limit,worker_id=excluded.worker_id,note=excluded.note,updated_at=now();
 insert into private.pilot_funding_changes(mode,enabled,order_limit,worker_id,note) values(target_mode,target_enabled,target_limit,target_worker,trim(change_note));
end $$;
revoke all on function public.configure_pilot_funding(text,boolean,integer,text,text) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;

-- Paid seats count settled payments and unexpired checkouts, with a grace period
-- for a notification that arrives just after Stripe's own expiry.
create function private.pilot_seats_used(target_mode text) returns integer
language sql stable security definer set search_path='' as $$
 select count(*)::integer from private.paper_payments p
 where p.mode=target_mode and p.refunded_at is null
  and (p.status='paid' or (p.status in ('creating','open') and p.expires_at+interval '10 minutes'>now()));
$$;

-- A catalogue item is supported only with its current registered form, a
-- registered execution workflow and no recorded mapping exclusion.
create function private.catalogue_item_supported(target_module text,target_release text,target_entry text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.catalogue_form_bindings b
  join private.catalogue_authored_forms f on (f.module_id,f.release,f.entry_id,f.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256)
  join private.catalogue_executions e on (e.module_id,e.release,e.manifest_sha256)=(b.module_id,b.release,b.manifest_sha256)
  where (b.module_id,b.release,b.entry_id)=(target_module,target_release,target_entry)
   and f.payload->>'formRevision'=b.form_revision and f.payload->>'bundleDigest'=b.private_bundle_sha256
   and f.payload->>'sharedFormsSha256'=b.shared_forms_sha256)
 and not ((target_module='caps-grade-11-physical-sciences' and target_entry='structured:P1-CIRC-01')
  or (target_module='caps-grade-10-physical-sciences' and target_entry in ('structured:P2-CHEM-04','structured:P2-CHEM-05')));
$$;

-- Readiness now also requires the execution registration and respects exclusions.
create or replace function private.check_registered_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.orderable and not exists (
  select 1 from private.catalogue_form_bindings b join private.catalogue_authored_forms f
   on (f.module_id,f.release,f.entry_id,f.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256)
  where (b.module_id,b.release,b.entry_id)=(new.module_id,new.release,new.entry_id)
   and f.payload->>'formRevision'=b.form_revision and f.payload->>'bundleDigest'=b.private_bundle_sha256
   and f.payload->>'sharedFormsSha256'=b.shared_forms_sha256
 ) then raise exception 'Registered private form required before enabling'; end if;
 if new.orderable and not private.catalogue_item_supported(new.module_id,new.release,new.entry_id) then
  raise exception 'Connected execution required before enabling';
 end if;
 return new;
end $$;

-- Operator-only. Sets readiness from current bindings for the module's current
-- release: supported entries become selectable, everything else stays visible
-- and unavailable. Returns the number enabled.
create function public.sync_supported_catalogue_readiness(target_module text) returns integer
language plpgsql security definer set search_path='' as $$
declare r text; n integer;
begin
 select current_release into r from public.curriculum_modules where id=target_module for share;
 if r is null then raise exception 'Unknown curriculum'; end if;
 update public.catalogue_ordering_readiness set orderable=false,updated_at=now()
  where module_id=target_module and release=r and orderable and not private.catalogue_item_supported(module_id,release,entry_id);
 update public.catalogue_ordering_readiness set orderable=true,updated_at=now()
  where module_id=target_module and release=r and not orderable and private.catalogue_item_supported(module_id,release,entry_id);
 select count(*) into n from public.catalogue_ordering_readiness where module_id=target_module and release=r and orderable;
 return n;
end $$;
revoke all on function public.sync_supported_catalogue_readiness(text) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;

-- Compile a paid order from the teacher's saved selection and the CURRENT
-- supported bindings. The browser supplies only the selection revision and
-- per-item marks within the published range; it never supplies forms, sources,
-- readiness, price or entitlement. Mirrors the internal provisioning compiler.
create function private.compile_paid_order(target_teacher uuid,target_module text,selection_revision integer,allocations jsonb,
 out school uuid,out release text,out form jsonb,out snapshot jsonb)
language plpgsql security definer set search_path='' as $$
declare sel public.paper_selections; entry text; c public.catalogue_summaries; b private.catalogue_form_bindings; p jsonb;
 common jsonb; shared jsonb; items jsonb:='[]'; lines jsonb:='[]'; scopes jsonb:='["paper-logistics"]';
 has_mcq boolean:=false; n integer:=0; marks integer; rev text; snap jsonb;
begin
 select a.school_id into school from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=target_teacher and a.status='approved' and u.email_confirmed_at is not null and lower(a.email)=lower(u.email);
 if school is null or not exists(select 1 from public.school_curriculum_access x where x.school_id=school and x.module_id=target_module and x.active) then raise exception 'Curriculum access required'; end if;
 select * into sel from public.paper_selections where user_id=target_teacher and school_id=school and module_id=target_module for share;
 if not found or selection_revision is null or sel.revision<>selection_revision or cardinality(sel.entry_ids)=0
  or sel.release is distinct from (select current_release from public.curriculum_modules where id=target_module)
 then raise exception 'Saved selection changed or empty'; end if;
 if allocations is null or not private.form_keys(allocations,sel.entry_ids) then raise exception 'Invalid mark allocations'; end if;
 foreach entry in array sel.entry_ids loop
  if not exists(select 1 from public.catalogue_ordering_readiness r where r.module_id=target_module and r.release=sel.release and r.entry_id=entry and r.orderable)
   or not private.catalogue_item_supported(target_module,sel.release,entry) then raise exception 'Question is not available to order'; end if;
  select * into b from private.catalogue_form_bindings x where x.module_id=target_module and x.release=sel.release and x.entry_id=entry for share;
  select payload into p from private.catalogue_authored_forms f where f.module_id=target_module and f.release=sel.release and f.entry_id=entry and f.manifest_sha256=b.manifest_sha256;
  if p is null then raise exception 'Question is not available to order'; end if;
  if common is null then common:=p->'shared'; elsif common<>p->'shared' then raise exception 'Question is not available to order'; end if;
  select * into c from public.catalogue_summaries s where s.module_id=target_module and s.release=sel.release and s.entry_id=entry;
  if jsonb_typeof(allocations->entry) is distinct from 'number' or (allocations->>entry)::numeric<>trunc((allocations->>entry)::numeric)
   or (allocations->>entry)::numeric not between c.marks_min and c.marks_max then raise exception 'Invalid mark allocations'; end if;
  marks:=(allocations->>entry)::integer;
  -- The connected multiple-choice workflow produces two-mark items.
  if p->>'kind'='multiple-choice' and marks<>2 then raise exception 'Invalid mark allocations'; end if;
  n:=n+1;
  items:=items||jsonb_build_array(jsonb_build_object('id','q'||n,'title',c.title,'marks',marks,'fields',p->'fields'));
  lines:=lines||jsonb_build_array(jsonb_build_object('id','q'||n,'entryId',entry,'marks',marks,'binding',p));
  has_mcq:=has_mcq or p->>'kind'='multiple-choice';
 end loop;
 shared:=common->'paper-logistics'->'fields';
 if has_mcq then shared:=shared||(common->'multiple-choice-block'->'fields');scopes:=scopes||'"multiple-choice-block"'::jsonb;end if;
 snap:=jsonb_build_object('schema','reviseit/frozen-authored-inputs@1','module',target_module,'release',sel.release,
  'catalogueDigest',(select payload->>'contentDigest' from private.catalogue_published_releases x where x.module_id=target_module and x.release=sel.release),
  'lines',lines,'sharedScopes',scopes,'manifestSha256',lines->0->'binding'->>'manifestSha256');
 if exists(select 1 from jsonb_array_elements(lines) l where l->'binding'->'manifestSha256' is distinct from snap->'manifestSha256') then raise exception 'Question is not available to order'; end if;
 rev:=encode(sha256(convert_to(jsonb_build_object('source',snap,'items',items,'paperFields',shared)::text,'UTF8')),'hex');
 form:=jsonb_build_object('schemaVersion',2,'revision',rev,'items',items,'paperFields',shared);
 if not private.valid_questionnaire(form) then raise exception 'Compiled form exceeds questionnaire limits'; end if;
 release:=sel.release;snapshot:=snap||jsonb_build_object('formRevision',rev);
end $$;

-- Teacher checkout admission. Freezes the order and reserves one pilot seat
-- atomically. The caller's identity comes from the database session.
create function public.begin_paper_checkout(request_key uuid,target_module text,selection_revision integer,allocations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); f private.pilot_funding; pay private.paper_payments; o uuid; compiled record;
begin
 if me is null or public.approved_school_id() is null or not public.can_use_curriculum(target_module) then raise exception 'Curriculum access required'; end if;
 if request_key is null then raise exception 'Invalid checkout request'; end if;
 select * into pay from private.paper_payments where paper_payments.request_key=begin_paper_checkout.request_key;
 if found then
  if pay.teacher_id<>me then raise exception 'Invalid checkout request'; end if;
  return jsonb_build_object('orderId',pay.order_id,'mode',pay.mode,'status',pay.status,'amountMinor',pay.amount_minor,'currency',pay.currency,
   'sessionId',pay.checkout_session_id,'checkoutUrl',pay.checkout_url,'expiresAt',pay.expires_at,'existing',false);
 end if;
 -- Serialise this teacher's checkouts, then seats for the whole pilot.
 perform 1 from public.teacher_accounts where user_id=me for update;
 select * into pay from private.paper_payments p where p.teacher_id=me and p.status in ('creating','open') and p.expires_at>now() order by created_at desc limit 1;
 if found then
  return jsonb_build_object('orderId',pay.order_id,'mode',pay.mode,'status',pay.status,'amountMinor',pay.amount_minor,'currency',pay.currency,
   'sessionId',pay.checkout_session_id,'checkoutUrl',pay.checkout_url,'expiresAt',pay.expires_at,'existing',true);
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
  'sessionId',null,'checkoutUrl',null,'expiresAt',pay.expires_at,'existing',false);
end $$;

-- Server-only: attach the hosted Checkout Session created with the order identity.
create function public.attach_paper_checkout(target uuid,session_id text,session_url text,session_livemode boolean) returns void
language plpgsql security definer set search_path='' as $$
declare pay private.paper_payments;
begin
 select * into pay from private.paper_payments where order_id=target for update;
 if not found then raise exception 'Unknown checkout'; end if;
 if session_livemode is distinct from (pay.mode='live') or session_id !~ ('^cs_'||case when pay.mode='live' then 'live' else 'test' end||'_') then raise exception 'Checkout mode mismatch'; end if;
 if pay.checkout_session_id is not null then
  if pay.checkout_session_id=session_id then return; end if;
  raise exception 'Checkout already attached';
 end if;
 if pay.status<>'creating' then raise exception 'Checkout is no longer open'; end if;
 update private.paper_payments set checkout_session_id=session_id,checkout_url=session_url,status='open',updated_at=now() where order_id=target;
end $$;

-- Server-only: record a Stripe Checkout result that the server verified by
-- signature and by retrieving the session from Stripe. Idempotent per event
-- and per order state. A mismatch is recorded and never unlocks the form.
create function public.record_stripe_checkout(event_id text,event_type text,event_livemode boolean,session jsonb) returns jsonb
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
     if o.state='awaiting_payment' then
      update private.paper_orders set state='awaiting_answers',updated_at=now() where id=target;
      outcome:='paid';
     else
      -- Paid after local cancellation or expiry: keep the payment, hold the order
      -- and flag it for an operator decision (normally a Stripe refund).
      update private.paper_orders set state='held',updated_at=now() where id=target and state in ('cancelled','awaiting_payment');
      update private.paper_payments set attention='refund_review' where order_id=target;
      outcome:='paid-needs-operator';
     end if;
     insert into private.paper_job_events(order_id,event,actor,detail) values(target,case when outcome='paid' then 'paid' else 'paid_needs_operator' end,'stripe',
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
 -- A reconciliation is not a Stripe event; do not occupy an event identifier.
 if event_type<>'reconcile' then
  insert into private.stripe_events(event_id,event_type,livemode,order_id,outcome) values(record_stripe_checkout.event_id,event_type,event_livemode,case when pay.order_id is null then null else target end,outcome);
 end if;
 return jsonb_build_object('duplicate',false,'outcome',outcome,'orderId',case when pay.order_id is null then null else target end);
end $$;

-- Server-only: a full refund made in Stripe closes the order without generation.
create function public.record_stripe_refund(event_id text,event_livemode boolean,payment_intent text,amount_refunded integer,refund_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.stripe_events; pay private.paper_payments; outcome text;
begin
 select * into prior from private.stripe_events e where e.event_id=record_stripe_refund.event_id;
 if found then return jsonb_build_object('duplicate',true,'outcome',prior.outcome); end if;
 select * into pay from private.paper_payments where payment_intent_id=payment_intent for update;
 if not found then outcome:='ignored:unknown-payment';
 elsif event_livemode is distinct from (pay.mode='live') then outcome:='rejected:mode';
 elsif refund_currency is distinct from pay.currency or amount_refunded is distinct from pay.amount_minor then outcome:='partial-or-mismatched-refund';
 else
  update private.paper_payments set refunded_at=coalesce(refunded_at,now()),attention=null,updated_at=now() where order_id=pay.order_id;
  update private.paper_orders set state='cancelled',updated_at=now() where id=pay.order_id and state in ('awaiting_payment','awaiting_answers','held');
  insert into private.paper_job_events(order_id,event,actor) values(pay.order_id,'refunded','stripe');
  outcome:='refunded';
 end if;
 insert into private.stripe_events(event_id,event_type,livemode,order_id,outcome) values(record_stripe_refund.event_id,'charge.refunded',event_livemode,pay.order_id,outcome);
 return jsonb_build_object('duplicate',false,'outcome',outcome,'orderId',pay.order_id);
end $$;

-- Server-only: the teacher abandoned checkout. The server expires the Stripe
-- session first; a payment that still arrives is held for refund review.
create function public.cancel_paper_checkout(target uuid,target_teacher uuid) returns void
language plpgsql security definer set search_path='' as $$
declare pay private.paper_payments;
begin
 select * into pay from private.paper_payments where order_id=target and teacher_id=target_teacher for update;
 if not found then raise exception 'Order access required'; end if;
 if pay.status='paid' then raise exception 'Order already paid'; end if;
 if pay.status in ('creating','open') then
  update private.paper_payments set status='cancelled',updated_at=now() where order_id=target;
  update private.paper_orders set state='cancelled',updated_at=now() where id=target and state='awaiting_payment';
  insert into private.paper_job_events(order_id,event,actor) values(target,'checkout_cancelled',target_teacher::text);
 end if;
end $$;

-- Server-only lookup used before talking to Stripe on the teacher's behalf.
create function public.paper_checkout_for_teacher(target uuid,target_teacher uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('orderId',p.order_id,'mode',p.mode,'status',p.status,'sessionId',p.checkout_session_id,'expiresAt',p.expires_at,'orderState',o.state)
 from private.paper_payments p join private.paper_orders o on o.id=p.order_id where p.order_id=target and p.teacher_id=target_teacher;
$$;

-- Teacher view: can this approved teacher buy now? Reveals no counts.
create function public.pilot_checkout_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('available',coalesce(public.approved_school_id() is not null and bool_or(f.enabled and private.pilot_seats_used(f.mode)<f.order_limit),false),
  'amountMinor',10000,'currency','zar') from private.pilot_funding f where f.enabled;
$$;

-- The teacher read model keeps every existing key and adds payment status.
create or replace function public.teacher_orders(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'title',o.title,'moduleId',o.module_id,'release',o.release,'internalTest',o.entitlement='internal_test',
 'state',o.state,'createdAt',o.created_at,'updatedAt',o.updated_at,
 'form',case when target is not null and o.state='awaiting_answers' then o.form else null end,
 'answers',case when target is not null then o.answers else null end,
 'answerSummary',case when target is not null and jsonb_typeof(o.form)='object' and o.answers is not null then private.questionnaire_receipt(o.form,o.answers) else null end,
 'documents',case when o.state='released' then to_jsonb(array['paper','memo','learner-memo','teacher-description']) else '[]'::jsonb end,
 'payment',case when p.order_id is null then null else jsonb_build_object('status',case when p.refunded_at is not null then 'refunded'
   when p.status in ('creating','open') and p.expires_at<=now() then 'expired' else p.status end,
  'amountMinor',p.amount_minor,'currency',p.currency,'testMode',p.mode='test',
  'checkoutUrl',case when target is not null and p.status='open' and p.expires_at>now() and o.state='awaiting_payment' then p.checkout_url else null end,
  'needsAttention',p.attention is not null) end
 ) order by o.created_at desc),'[]'::jsonb)
 from (select * from private.paper_orders x where (target is null or x.id=target) and private.can_read_order(x)
 order by x.created_at desc limit 100) o left join private.paper_payments p on p.order_id=o.id;
$$;

-- A paid order's questionnaire opens only while its payment stands.
create or replace function public.submit_paper_answers(target uuid,request_key uuid,submitted_answers jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; line jsonb; problem jsonb; item jsonb; field jsonb;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or not private.can_read_order(o) then raise exception 'Order access required'; end if;
 if o.entitlement='paid' and not exists(select 1 from private.paper_payments p where p.order_id=o.id and p.status='paid' and p.refunded_at is null)
  then raise exception 'Order cannot be submitted'; end if;
 if request_key is null or not private.valid_order_answers(o.form,submitted_answers) then raise exception 'Invalid answers'; end if;
 if o.state in ('cancelled','held','awaiting_payment') then raise exception 'Order cannot be submitted'; end if;
 if o.submission_key is not null then
  if o.submission_key=request_key and o.answers=submitted_answers then return o.id; end if;
  raise exception 'Order already submitted';
 end if;
 if o.state<>'awaiting_answers' then raise exception 'Order already submitted'; end if;
 if o.generation_plan->'schemaVersion'='2'::jsonb then
  for line in select value from jsonb_array_elements(o.generation_plan->'lines') loop
   problem:=private.answer_policy_error(line->'answerPolicy',submitted_answers->'items'->(line->>'id'));
   if problem is not null then
    select value into item from jsonb_array_elements(o.form->'items') where value->'id'=line->'id';
    select value into field from jsonb_array_elements(item->'fields') where value->'id'=problem->'field';
    raise exception 'Incompatible answers' using detail=jsonb_build_object('itemId',line->>'id','fieldId',problem->>'field',
     'message',(item->>'title')||': '||(field->>'label')||': '||(problem->>'message'))::text;
   end if;
  end loop;
 end if;
 update private.paper_orders set answers=submitted_answers,submission_key=request_key,submitted_at=now(),state='queued',updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'submitted',auth.uid()::text);
 return o.id;
end; $$;

-- Claims skip a paid order unless its payment stands. Paid claims carry the
-- entitlement and payment mode so the worker can apply the pilot allowance.
-- Internal-order payloads are byte-for-byte the same shape as before.
create or replace function public.claim_paper_job(worker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; token uuid; pay private.paper_payments;
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 select * into o from private.paper_orders x
 where (x.state='queued' or (x.state in ('generating','rendering') and x.lease_until<now()))
 and (x.worker_id is null or x.worker_id=worker)
 and (x.entitlement<>'paid' or exists(select 1 from private.paper_payments p where p.order_id=x.id and p.status='paid' and p.refunded_at is null))
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
 select * into pay from private.paper_payments where order_id=o.id;
 return jsonb_build_object('resumed',o.state<>'queued','id',o.id,'lease',token,'adapterKey',o.adapter_key,'schoolId',o.school_id,
 'moduleId',o.module_id,'release',o.release,'answers',o.answers,'snapshot',o.snapshot,
 'memoReview',o.memo_review,'internalTest',o.entitlement='internal_test')
 || case when o.generation_plan is null then '{}'::jsonb else jsonb_build_object('generationPlan',o.generation_plan) end
 || case when o.entitlement='paid' then jsonb_build_object('entitlement','paid','paymentMode',pay.mode) else '{}'::jsonb end;
end $$;

-- Operator action list for account reviewers: paid orders that did not proceed
-- normally. Identifiers only; the refund itself is made in Stripe.
create function public.paid_orders_needing_attention() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_reviewer() then raise exception 'Reviewer access required'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('orderId',o.id,'state',o.state,'mode',p.mode,'paidAt',p.paid_at,
  'paymentIntent',p.payment_intent_id,'checkoutSession',p.checkout_session_id,'school',s.name,'teacherEmail',a.email,
  'reason',case when p.attention='refund_review' then 'Paid after checkout closed' when o.state='held' then 'Generation held' else 'Cancelled after payment' end)
  order by p.paid_at),'[]'::jsonb)
  from private.paper_payments p join private.paper_orders o on o.id=p.order_id
  join public.schools s on s.id=o.school_id join public.teacher_accounts a on a.user_id=o.teacher_id
  where p.status='paid' and p.refunded_at is null and (p.attention is not null or o.state in ('held','cancelled')));
end $$;

revoke all on function private.pilot_seats_used(text),private.catalogue_item_supported(text,text,text),
 private.compile_paid_order(uuid,text,integer,jsonb) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
revoke all on function public.begin_paper_checkout(uuid,text,integer,jsonb),public.attach_paper_checkout(uuid,text,text,boolean),
 public.record_stripe_checkout(text,text,boolean,jsonb),public.record_stripe_refund(text,boolean,text,integer,text),
 public.cancel_paper_checkout(uuid,uuid),public.paper_checkout_for_teacher(uuid,uuid),public.pilot_checkout_status(),
 public.paid_orders_needing_attention() from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
grant execute on function public.begin_paper_checkout(uuid,text,integer,jsonb),public.pilot_checkout_status(),
 public.paid_orders_needing_attention() to authenticated;
grant execute on function public.attach_paper_checkout(uuid,text,text,boolean),public.record_stripe_checkout(text,text,boolean,jsonb),
 public.record_stripe_refund(text,boolean,text,integer,text),public.cancel_paper_checkout(uuid,uuid),
 public.paper_checkout_for_teacher(uuid,uuid) to service_role;

commit;
