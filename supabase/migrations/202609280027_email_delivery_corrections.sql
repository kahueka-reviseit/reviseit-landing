begin;

-- C09A: two delivery corrections to migration 026. Additive; replaces function
-- bodies only. Safe whether or not 026 has already been applied.
--
-- R1. An ambiguous attempt that was put back in the queue is checked against
--     the idempotency window before it can be claimed again, exactly like a
--     crashed send. Past 23 hours it becomes 'unknown' for a recorded outcome.
-- R2. If recording an intent fails inside the event transaction, the event
--     still commits (email must never block a release or approval) and the
--     intent is rebuilt from the committed event history on the next scheduled
--     claim. Rebuilding uses the delivery mode that applied when the event
--     happened, so disabled-mode or historical events are never sent later.

create index if not exists paper_job_events_email_recovery on private.paper_job_events(at) where event in ('released','held');
create index if not exists account_reviews_email_recovery on public.account_reviews(created_at) where decision='approved';

-- The delivery mode in force at a moment. Before any recorded change the
-- migration default applies, which is 'off'.
create function private.email_mode_at(moment timestamptz) returns private.email_settings
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select row(true,c.mode,c.allowlist,c.note,c.changed_at)::private.email_settings from private.email_setting_changes c
    where c.changed_at<=moment order by c.changed_at desc,c.id desc limit 1),
  row(true,'off','{}'::text[],'Default before any change',moment)::private.email_settings);
$$;

-- Same rules as before, evaluated against the mode at the event's own time.
-- Raises on failure; callers decide whether a failure may be swallowed.
create function private.enqueue_email_at(kind text,logical_key text,target_user uuid,target_order uuid,target_school uuid,revision integer,pack text,moment timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare s private.email_settings; addr text; st text:='queued'; why text;
begin
 s:=private.email_mode_at(moment);
 select lower(u.email) into addr from auth.users u join public.teacher_accounts a on a.user_id=u.id
  where u.id=target_user and u.email_confirmed_at is not null and lower(u.email)=lower(a.email);
 if addr is null then st:='skipped'; why:='no_verified_recipient'; addr:='';
 elsif s.mode is distinct from 'on' and s.mode is distinct from 'allowlist' then st:='skipped'; why:='disabled';
 elsif s.mode='allowlist' and not addr=any(s.allowlist) then st:='skipped'; why:='not_allowlisted';
 elsif exists(select 1 from private.email_suppressions x where x.address=addr) then st:='suppressed'; why:='address_suppressed';
 end if;
 insert into private.email_notifications(logical_key,kind,user_id,order_id,school_id,account_revision,pack_hash,recipient,status,reason,created_at)
  values(enqueue_email_at.logical_key,enqueue_email_at.kind,target_user,target_order,target_school,revision,pack,addr,st,why,moment)
  on conflict on constraint email_notifications_logical_key_key do nothing;
end $$;

-- Trigger entry point, unchanged signature. A failure is still only a warning
-- here; the committed event stays in paper_job_events or account_reviews and
-- private.recover_email_intents() rebuilds the intent.
create or replace function private.enqueue_email(kind text,logical_key text,target_user uuid,target_order uuid,target_school uuid,revision integer,pack text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.enqueue_email_at(kind,logical_key,target_user,target_order,target_school,revision,pack,now());
exception when others then
 raise warning 'Email intent % not recorded now; it will be recovered from the event history: %',enqueue_email.logical_key,sqlerrm;
end $$;

-- Rebuilds missing intents for events of the last 48 hours (the same limit
-- after which an unsent intent expires). Only events whose own-time mode was
-- 'on' or 'allowlist' are considered, and only while the account has not been
-- reviewed or re-addressed since the event, so nothing is retargeted.
create function private.recover_email_intents() returns integer
language plpgsql security definer set search_path='' as $$
declare e record; made integer:=0; before integer;
begin
 for e in
  select 'paper_ready' kind,'paper-ready:'||j.order_id||':'||(j.detail->>'packHash') k,o.teacher_id uid,o.id oid,o.school_id sid,null::integer rev,j.detail->>'packHash' pack,j.at moment
   from private.paper_job_events j join private.paper_orders o on o.id=j.order_id
   where j.event='released' and j.at>now()-interval '48 hours' and j.detail ? 'packHash'
  union all
  select 'paper_attention','paper-attention:'||j.order_id,o.teacher_id,o.id,o.school_id,null,null,j.at
   from private.paper_job_events j join private.paper_orders o on o.id=j.order_id
   where j.event='held' and j.at>now()-interval '48 hours'
  union all
  select 'access_approved','access-approved:'||a.user_id||':'||a.revision,a.user_id,null,a.school_id,a.revision,null,r.created_at
   from public.account_reviews r join public.teacher_accounts a on a.user_id=r.user_id
   where r.decision='approved' and r.created_at>now()-interval '48 hours'
    and a.status='approved' and a.reviewed_at=r.created_at
 loop
  continue when exists(select 1 from private.email_notifications n where n.logical_key=e.k);
  continue when (private.email_mode_at(e.moment)).mode='off';
  -- Orders: the account must be unchanged since the event (no later review or address change).
  continue when e.oid is not null and not exists(select 1 from public.teacher_accounts a where a.user_id=e.uid and a.status='approved' and a.reviewed_at<=e.moment);
  begin
   select count(*) into before from private.email_notifications;
   perform private.enqueue_email_at(e.kind,e.k,e.uid,e.oid,e.sid,e.rev,e.pack,e.moment);
   made:=made+(select count(*) from private.email_notifications)-before;
  exception when others then
   raise warning 'Email intent % still not recoverable: %',e.k,sqlerrm;
  end;
 end loop;
 return made;
end $$;

create or replace function public.claim_email_notifications(worker text,max_count integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.email_settings; n private.email_notifications; why text; token uuid; claimed jsonb:='[]';
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' or max_count is null or max_count not between 1 and 50 then raise exception 'Invalid claim'; end if;
 perform private.recover_email_intents();
 -- Any attempt whose acceptance is unresolved (a crashed send, or a timeout
 -- put back in the queue) is never sent again once it is older than 23 hours,
 -- inside Resend's 24-hour idempotency window. It waits for a delivery
 -- callback or a recorded staff outcome.
 update private.email_notifications set status='unknown',reason='acceptance_unresolved',lease=null,lease_until=null,updated_at=now()
  where first_attempt_at<now()-interval '23 hours'
   and ((status='sending' and lease_until<now()) or (status='queued' and ambiguous));
 select * into s from private.email_settings where id;
 if s.mode='off' then return claimed; end if;
 for n in select * from private.email_notifications x
  where (x.status='queued' or (x.status='sending' and x.lease_until<now())) and x.next_attempt_at<=now()
  order by x.created_at limit max_count for update skip locked loop
  -- Checked again under the row lock, so no interleaving can slip past the window.
  if (n.ambiguous or n.status='sending') and n.first_attempt_at<now()-interval '23 hours' then
   update private.email_notifications set status='unknown',reason='acceptance_unresolved',lease=null,lease_until=null,updated_at=now() where id=n.id;
   continue;
  end if;
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

revoke all on function private.email_mode_at(timestamptz),
 private.enqueue_email_at(text,text,uuid,uuid,uuid,integer,text,timestamptz),private.recover_email_intents()
 from public,anon,authenticated,service_role;

commit;
