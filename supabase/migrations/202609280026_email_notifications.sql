begin;

-- C09: transactional email outbox. Additive only; no existing row is changed.
--
-- A trigger records one notification intent in the same transaction as the
-- authoritative event (a committed approval, a released pack, a held order).
-- If that transaction rolls back, no intent exists; once it commits, the intent
-- survives any process crash. Sending is separate: a server-side dispatcher
-- claims due rows under a lease and calls Resend. Email never gates, reverses
-- or repeats the event itself.
--
-- Activation is prospective. The mode starts 'off'. While off, events are still
-- recorded as 'skipped' (reason 'disabled'), so switching the mode on later
-- cannot backfill historic approvals or releases: their logical keys are taken.
--
-- Rollback: drop the two triggers (teacher_account_email_intent,
-- paper_order_email_intent). The tables and functions can then stay as inert
-- evidence or be dropped; nothing else depends on them.

create table private.email_settings (
 id boolean primary key default true check(id),
 mode text not null default 'off' check(mode in ('off','allowlist','on')),
 allowlist text[] not null default '{}',
 note text not null default 'Created disabled by migration 026' check(length(trim(note)) between 3 and 500),
 updated_at timestamptz not null default now()
);
insert into private.email_settings(id) values(true);
create table private.email_setting_changes (
 id bigint generated always as identity primary key,
 mode text not null, allowlist text[] not null, note text not null,
 changed_by text not null default session_user, changed_at timestamptz not null default now()
);

create table private.email_notifications (
 id uuid primary key default gen_random_uuid(),
 -- One logical message per event: access-approved:{user}:{revision},
 -- paper-ready:{order}:{pack hash}, paper-attention:{order}.
 logical_key text not null unique check(length(logical_key) between 10 and 200),
 kind text not null check(kind in ('access_approved','paper_ready','paper_attention')),
 user_id uuid not null references auth.users(id) on delete cascade,
 order_id uuid references private.paper_orders(id),
 school_id uuid references public.schools(id),
 account_revision integer,
 pack_hash text,
 -- Snapshot at event time. A later address change cancels; it never retargets.
 recipient text not null check(recipient='' or recipient ~ '^[^@\s]+@[^@\s]+$'),
 status text not null check(status in ('skipped','queued','sending','accepted','delayed','delivered',
  'bounced','complained','failed','suppressed','cancelled','unknown','resolved')),
 reason text check(length(reason)<=80),
 payload jsonb, payload_hash text,
 attempts integer not null default 0 check(attempts between 0 and 20),
 ambiguous boolean not null default false,
 next_attempt_at timestamptz not null default now(),
 lease uuid, lease_until timestamptz,
 first_attempt_at timestamptz,
 provider_id text unique check(length(provider_id) between 1 and 200),
 last_error text check(length(last_error)<=300),
 resolved_by uuid, resolution_note text check(length(resolution_note)<=500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_event_at timestamptz
);
create index email_notifications_due on private.email_notifications(next_attempt_at) where status in ('queued','sending');
create index email_notifications_order on private.email_notifications(order_id);
-- Every verified provider callback is kept once, even if it arrives before we
-- have recorded the provider's message identifier.
create table private.email_events (
 event_id text primary key check(length(event_id) between 1 and 200),
 provider_id text check(length(provider_id)<=200),
 type text not null check(length(type)<=60),
 bounce_type text check(length(bounce_type)<=40),
 occurred_at timestamptz,
 notification_id uuid references private.email_notifications(id),
 outcome text,
 received_at timestamptz not null default now()
);
create index email_events_provider on private.email_events(provider_id) where notification_id is null;
create table private.email_suppressions (
 address text primary key,
 reason text not null check(reason in ('bounced','complained')),
 source_event text,
 created_at timestamptz not null default now()
);
alter table private.email_settings enable row level security;
alter table private.email_setting_changes enable row level security;
alter table private.email_notifications enable row level security;
alter table private.email_events enable row level security;
alter table private.email_suppressions enable row level security;
revoke all on private.email_settings,private.email_setting_changes,private.email_notifications,private.email_events,private.email_suppressions
 from public,anon,authenticated,service_role;

-- Owner-only switch, run from the SQL editor. It never touches existing rows.
create function private.set_email_mode(new_mode text,new_allowlist text[],change_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.email_settings set mode=new_mode,allowlist=(select coalesce(array_agg(distinct lower(trim(x))),'{}') from unnest(coalesce(new_allowlist,'{}')) x),
  note=change_note,updated_at=now() where id;
 insert into private.email_setting_changes(mode,allowlist,note) select mode,allowlist,note from private.email_settings where id;
end $$;

create function private.enqueue_email(kind text,logical_key text,target_user uuid,target_order uuid,target_school uuid,revision integer,pack text) returns void
language plpgsql security definer set search_path='' as $$
declare s private.email_settings; addr text; st text:='queued'; why text;
begin
 select * into s from private.email_settings where id;
 select lower(u.email) into addr from auth.users u join public.teacher_accounts a on a.user_id=u.id
  where u.id=target_user and u.email_confirmed_at is not null and lower(u.email)=lower(a.email);
 if addr is null then st:='skipped'; why:='no_verified_recipient'; addr:='';
 elsif s.mode is distinct from 'on' and s.mode is distinct from 'allowlist' then st:='skipped'; why:='disabled';
 elsif s.mode='allowlist' and not addr=any(s.allowlist) then st:='skipped'; why:='not_allowlisted';
 elsif exists(select 1 from private.email_suppressions x where x.address=addr) then st:='suppressed'; why:='address_suppressed';
 end if;
 insert into private.email_notifications(logical_key,kind,user_id,order_id,school_id,account_revision,pack_hash,recipient,status,reason)
  values(enqueue_email.logical_key,enqueue_email.kind,target_user,target_order,target_school,revision,pack,addr,st,why)
  on conflict on constraint email_notifications_logical_key_key do nothing;
exception when others then
 -- The authoritative event must never fail because of email bookkeeping.
 raise warning 'Email intent % not recorded: %',enqueue_email.logical_key,sqlerrm;
end $$;

create function private.order_email_intent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state='released' and old.state is distinct from 'released' and new.pack_hash is not null then
  perform private.enqueue_email('paper_ready','paper-ready:'||new.id||':'||new.pack_hash,new.teacher_id,new.id,new.school_id,null,new.pack_hash);
 -- Only a hold during creation. A payment that arrived after checkout closed is
 -- a different conversation, which staff handle from the papers queue.
 elsif new.state='held' and old.state in ('queued','generating','awaiting_memo_review','rendering','awaiting_release') then
  perform private.enqueue_email('paper_attention','paper-attention:'||new.id,new.teacher_id,new.id,new.school_id,null,null);
 end if;
 return null;
end $$;
create trigger paper_order_email_intent after update of state on private.paper_orders
 for each row execute function private.order_email_intent();

create function private.account_email_intent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- A repeated save or department change on an approved account sends nothing.
 if new.status='approved' and old.status is distinct from 'approved' then
  perform private.enqueue_email('access_approved','access-approved:'||new.user_id||':'||new.revision,new.user_id,null,new.school_id,new.revision,null);
 end if;
 return null;
end $$;
create trigger teacher_account_email_intent after update of status on public.teacher_accounts
 for each row execute function private.account_email_intent();

-- Current eligibility, rechecked immediately before every send attempt.
create function private.email_ineligible(n private.email_notifications) returns text
language plpgsql stable security definer set search_path='' as $$
declare s private.email_settings; u record; a record; o record;
begin
 select * into s from private.email_settings where id;
 if s.mode='allowlist' and not n.recipient=any(s.allowlist) then return 'not_allowlisted'; end if;
 if exists(select 1 from private.email_suppressions x where x.address=n.recipient) then return 'address_suppressed'; end if;
 if n.first_attempt_at is null and n.created_at<now()-interval '48 hours' then return 'expired'; end if;
 select id,email,email_confirmed_at into u from auth.users where id=n.user_id;
 select * into a from public.teacher_accounts where user_id=n.user_id;
 if u.id is null or a.user_id is null then return 'account_missing'; end if;
 if u.email_confirmed_at is null or lower(u.email)<>n.recipient or lower(a.email)<>n.recipient then return 'recipient_changed'; end if;
 if a.status<>'approved' or a.school_id is distinct from n.school_id then return 'access_changed'; end if;
 if n.order_id is not null then
  select * into o from private.paper_orders where id=n.order_id;
  if not exists(select 1 from public.school_curriculum_access c where c.school_id=o.school_id and c.module_id=o.module_id and c.active) then return 'access_changed'; end if;
  if n.kind='paper_ready' and (o.state<>'released' or o.pack_hash is distinct from n.pack_hash) then return 'no_longer_released'; end if;
  if n.kind='paper_attention' and o.state<>'held' then return 'resolved_before_send'; end if;
 end if;
 return null;
end $$;

-- Minimal safe metadata for rendering: no questions, answers, briefs or notes.
create function private.email_metadata(n private.email_notifications) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',a.full_name,'school',s.name,
  'curriculum',(select m.name from private.paper_orders o join public.curriculum_modules m on m.id=o.module_id where o.id=n.order_id),
  'orderId',n.order_id)
 from public.teacher_accounts a left join public.schools s on s.id=n.school_id where a.user_id=n.user_id;
$$;

create function public.claim_email_notifications(worker text,max_count integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.email_settings; n private.email_notifications; why text; token uuid; claimed jsonb:='[]';
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' or max_count is null or max_count not between 1 and 50 then raise exception 'Invalid claim'; end if;
 -- Outside Resend's 24-hour idempotency window a crashed send is never retried
 -- blindly: it waits for a delivery callback or an operator outcome.
 update private.email_notifications set status='unknown',reason='acceptance_unresolved',lease=null,lease_until=null,updated_at=now()
  where status='sending' and lease_until<now() and first_attempt_at<now()-interval '23 hours';
 select * into s from private.email_settings where id;
 if s.mode='off' then return claimed; end if;
 for n in select * from private.email_notifications x
  where (x.status='queued' or (x.status='sending' and x.lease_until<now())) and x.next_attempt_at<=now()
  order by x.created_at limit max_count for update skip locked loop
  if n.attempts>=5 then
   update private.email_notifications set status=case when n.ambiguous or n.status='sending' then 'unknown' else 'failed' end,
    reason='attempts_exhausted',lease=null,lease_until=null,updated_at=now() where id=n.id;
   continue;
  end if;
  why:=private.email_ineligible(n);
  if why is not null then
   update private.email_notifications set status=case when why='address_suppressed' then 'suppressed' else 'cancelled' end,
    reason=why,lease=null,lease_until=null,updated_at=now() where id=n.id;
   continue;
  end if;
  token:=gen_random_uuid();
  update private.email_notifications set status='sending',lease=token,lease_until=now()+interval '2 minutes',attempts=attempts+1,
   ambiguous=ambiguous or n.status='sending',first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=n.id;
  claimed:=claimed||jsonb_build_array(jsonb_build_object('id',n.id,'lease',token,'kind',n.kind,'recipient',n.recipient,
   'payload',n.payload,'attempt',n.attempts+1,'metadata',private.email_metadata(n)));
 end loop;
 return claimed;
end $$;

-- The first rendered payload is frozen; every retry sends exactly the same bytes.
create function public.record_email_payload(target uuid,token uuid,rendered jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.email_notifications;
begin
 select * into n from private.email_notifications where id=target for update;
 if not found or n.lease is distinct from token or n.lease_until<=now() or n.status<>'sending' then raise exception 'Email lease lost'; end if;
 if n.payload is not null then return n.payload; end if;
 if jsonb_typeof(rendered)<>'object' or not rendered ?& array['subject','html','text'] or octet_length(rendered::text)>200000
  or rendered->>'to' is distinct from n.recipient then raise exception 'Invalid email payload'; end if;
 update private.email_notifications set payload=rendered,payload_hash=encode(sha256(convert_to(rendered::text,'UTF8')),'hex'),updated_at=now() where id=target;
 return rendered;
end $$;

create function private.email_rank(status text) returns integer language sql immutable as $$
 select case status when 'accepted' then 1 when 'delayed' then 2 when 'delivered' then 3
  when 'bounced' then 4 when 'complained' then 4 when 'failed' then 4 when 'suppressed' then 4 else 0 end;
$$;

-- Applies one provider event. Out-of-order events never move a message backwards.
create function private.apply_email_event(target uuid,event_type text,bounce text,event_id text,happened timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare n private.email_notifications; next_status text;
begin
 select * into n from private.email_notifications where id=target for update;
 next_status:=case event_type when 'email.sent' then 'accepted' when 'email.delivery_delayed' then 'delayed'
  when 'email.delivered' then 'delivered' when 'email.complained' then 'complained' when 'email.failed' then 'failed'
  when 'email.suppressed' then 'suppressed'
  when 'email.bounced' then case when lower(coalesce(bounce,'')) in ('transient','temporary') then 'delayed' else 'bounced' end end;
 if next_status is null then return 'ignored'; end if;
 if next_status in ('bounced','complained') then
  insert into private.email_suppressions(address,reason,source_event) values(n.recipient,next_status,event_id) on conflict do nothing;
 end if;
 if n.status in ('resolved','cancelled','skipped') or private.email_rank(next_status)<=private.email_rank(n.status) then return 'kept:'||n.status; end if;
 update private.email_notifications set status=next_status,reason=null,lease=null,lease_until=null,
  last_event_at=greatest(coalesce(last_event_at,happened),happened),updated_at=now() where id=target;
 return next_status;
end $$;

create function public.complete_email_attempt(target uuid,token uuid,outcome text,provider_message text,error_text text,ambiguous_failure boolean) returns text
language plpgsql security definer set search_path='' as $$
declare n private.email_notifications; e private.email_events; result text;
begin
 select * into n from private.email_notifications where id=target for update;
 if not found or n.lease is distinct from token or n.status<>'sending' then raise exception 'Email lease lost'; end if;
 if outcome='accepted' then
  if provider_message is null or provider_message !~ '^[A-Za-z0-9_-]{1,200}$' then raise exception 'Invalid provider identifier'; end if;
  update private.email_notifications set status='accepted',provider_id=provider_message,reason=null,last_error=null,lease=null,lease_until=null,updated_at=now() where id=target;
  result:='accepted';
  -- Callbacks that arrived before the send was recorded are applied now.
  for e in select * from private.email_events where provider_id=provider_message and notification_id is null order by occurred_at nulls last,received_at loop
   update private.email_events set notification_id=target,outcome=private.apply_email_event(target,e.type,e.bounce_type,e.event_id,coalesce(e.occurred_at,e.received_at)) where event_id=e.event_id;
  end loop;
  select status into result from private.email_notifications where id=target;
 elsif outcome='retry' then
  if n.attempts>=5 or ((n.ambiguous or ambiguous_failure) and n.first_attempt_at<now()-interval '23 hours') then
   result:=case when n.ambiguous or ambiguous_failure then 'unknown' else 'failed' end;
   update private.email_notifications set status=result,reason='attempts_exhausted',ambiguous=ambiguous or ambiguous_failure,
    last_error=left(error_text,300),lease=null,lease_until=null,updated_at=now() where id=target;
  else
   result:='queued';
   update private.email_notifications set status='queued',ambiguous=ambiguous or ambiguous_failure,last_error=left(error_text,300),
    next_attempt_at=now()+(array[interval '1 minute',interval '5 minutes',interval '20 minutes',interval '60 minutes'])[least(n.attempts,4)],
    lease=null,lease_until=null,updated_at=now() where id=target;
  end if;
 elsif outcome='rejected' then
  result:='failed';
  update private.email_notifications set status='failed',reason='provider_rejected',last_error=left(error_text,300),lease=null,lease_until=null,updated_at=now() where id=target;
 else raise exception 'Invalid outcome'; end if;
 return result;
end $$;

create function public.record_email_event(event_id text,event_type text,provider_message text,occurred timestamptz,bounce text) returns text
language plpgsql security definer set search_path='' as $$
declare target uuid; result text;
begin
 if event_id is null or length(event_id) not between 1 and 200 or event_type is null or length(event_type)>60 then raise exception 'Invalid email event'; end if;
 insert into private.email_events(event_id,provider_id,type,bounce_type,occurred_at) values(record_email_event.event_id,provider_message,event_type,left(bounce,40),occurred)
  on conflict do nothing;
 if not found then return 'duplicate'; end if;
 select id into target from private.email_notifications where provider_id=provider_message;
 if target is null then return 'pending'; end if;
 result:=private.apply_email_event(target,event_type,bounce,event_id,coalesce(occurred,now()));
 update private.email_events set notification_id=target,outcome=result where email_events.event_id=record_email_event.event_id;
 return result;
end $$;

-- Staff visibility: recent messages with their delivery state. No payload bodies.
create function public.email_notifications_for_staff() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_reviewer() then raise exception 'Reviewer access required'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'status',n.status,'reason',n.reason,'orderId',n.order_id,
  'recipient',n.recipient,'attempts',n.attempts,'createdAt',n.created_at,'updatedAt',n.updated_at) order by n.created_at desc),'[]'::jsonb)
  from (select * from private.email_notifications x where x.status<>'skipped' order by x.created_at desc limit 100) n);
end $$;

-- A recorded operator outcome for a message whose acceptance is uncertain or
-- that failed. It does not resend; a resend is a separate future action.
create function public.resolve_email_notification(target uuid,decision text,note text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_reviewer() then raise exception 'Reviewer access required'; end if;
 if decision not in ('treat_as_sent','abandon') or note is null or length(trim(note)) not between 3 and 500 then raise exception 'Outcome and note required'; end if;
 update private.email_notifications set status='resolved',reason=decision,resolved_by=auth.uid(),resolution_note=trim(note),updated_at=now()
  where id=target and status in ('unknown','failed');
 if not found then raise exception 'Only an unknown or failed message can be resolved'; end if;
end $$;

-- Whether the signed-in teacher will actually get the completion email, so the
-- paper page never promises mail that is switched off.
create function public.my_email_delivery() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('completionEmail',coalesce(s.mode='on' or (s.mode='allowlist' and lower(u.email)=any(s.allowlist)),false)
   and not exists(select 1 from private.email_suppressions x where x.address=lower(u.email)),'address',lower(u.email))
 from private.email_settings s, auth.users u where s.id and u.id=auth.uid() and u.email_confirmed_at is not null;
$$;

revoke all on function private.set_email_mode(text,text[],text),private.enqueue_email(text,text,uuid,uuid,uuid,integer,text),
 private.order_email_intent(),private.account_email_intent(),private.email_ineligible(private.email_notifications),
 private.email_metadata(private.email_notifications),private.email_rank(text),private.apply_email_event(uuid,text,text,text,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.claim_email_notifications(text,integer),public.record_email_payload(uuid,uuid,jsonb),
 public.complete_email_attempt(uuid,uuid,text,text,text,boolean),public.record_email_event(text,text,text,timestamptz,text),
 public.email_notifications_for_staff(),public.resolve_email_notification(uuid,text,text),public.my_email_delivery()
 from public,anon,authenticated,service_role;
grant execute on function public.claim_email_notifications(text,integer),public.record_email_payload(uuid,uuid,jsonb),
 public.complete_email_attempt(uuid,uuid,text,text,text,boolean),public.record_email_event(text,text,text,timestamptz,text) to service_role;
grant execute on function public.email_notifications_for_staff(),public.resolve_email_notification(uuid,text,text),public.my_email_delivery() to authenticated;

commit;
