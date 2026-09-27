begin;

-- Bound the offered paper before Stripe is contacted. Existing funding keeps
-- its old 30-line limit until the operator explicitly sizes the live pilot.
alter table private.pilot_funding add column max_questions integer not null default 30 check(max_questions between 1 and 30);
alter table private.pilot_funding_changes add column max_questions integer not null default 30;
alter table private.pilot_funding add column max_structured integer not null default 30 check(max_structured between 0 and 30), add column max_multiple_choice integer not null default 30 check(max_multiple_choice between 0 and 30);
alter table private.pilot_funding_changes add column max_structured integer not null default 30, add column max_multiple_choice integer not null default 30;

create or replace function public.configure_pilot_funding(target_mode text,target_enabled boolean,target_limit integer,target_worker text,change_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if target_mode is null or target_enabled is null or target_limit is null or target_worker is null or change_note is null then raise exception 'Complete pilot funding settings required'; end if;
 if target_enabled then update private.pilot_funding set enabled=false,updated_at=now() where mode<>target_mode and enabled; end if;
 insert into private.pilot_funding(mode,enabled,order_limit,worker_id,note) values(target_mode,target_enabled,target_limit,target_worker,trim(change_note))
 on conflict(mode) do update set enabled=excluded.enabled,order_limit=excluded.order_limit,worker_id=excluded.worker_id,note=excluded.note,updated_at=now();
 insert into private.pilot_funding_changes(mode,enabled,order_limit,worker_id,note,max_questions,max_structured,max_multiple_choice)
 select mode,enabled,order_limit,worker_id,note,max_questions,max_structured,max_multiple_choice from private.pilot_funding where mode=target_mode;
end $$;

create function public.configure_pilot_paper_size(target_mode text,target_max_questions integer,change_note text,target_structured integer default 30,target_multiple_choice integer default 30)
returns void language plpgsql security definer set search_path='' as $$
begin
 if target_structured is null or target_structured not between 0 and 30 or target_multiple_choice is null or target_multiple_choice not between 0 and 30 or target_max_questions is null or target_max_questions not between 1 and 30 or change_note is null or length(trim(change_note)) not between 3 and 500 then raise exception 'Valid paper size and reason required'; end if;
 update private.pilot_funding set max_questions=target_max_questions,max_structured=target_structured,max_multiple_choice=target_multiple_choice,note=trim(change_note),updated_at=now() where mode=target_mode;
 if not found then raise exception 'Configure pilot funding first'; end if;
 insert into private.pilot_funding_changes(mode,enabled,order_limit,worker_id,note,max_questions,max_structured,max_multiple_choice)
 select mode,enabled,order_limit,worker_id,note,max_questions,max_structured,max_multiple_choice from private.pilot_funding where mode=target_mode;
end $$;
revoke all on function public.configure_pilot_paper_size(text,integer,text,integer,integer),public.configure_pilot_funding(text,boolean,integer,text,text) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;

create function private.enforce_pilot_paper_size() returns trigger
language plpgsql security definer set search_path='' as $$
declare f private.pilot_funding; lines jsonb; structured_count integer; mcq_count integer;
begin
 select * into f from private.pilot_funding where mode=new.mode and enabled for update;
 if not found then raise exception 'Pilot purchasing unavailable'; end if;
 select snapshot->'lines' into lines from private.paper_orders where id=new.order_id;
 if jsonb_typeof(lines) is distinct from 'array' then raise exception 'Invalid paper selection'; end if;
 if jsonb_array_length(lines)<1 or jsonb_array_length(lines)>f.max_questions then
  raise exception 'This pilot allows up to % questions per paper. Reduce your selection before payment.',f.max_questions;
 end if;
 select count(*) filter(where l->'binding'->>'kind'='specification'),count(*) filter(where l->'binding'->>'kind'='multiple-choice') into structured_count,mcq_count from jsonb_array_elements(lines) l;
 if structured_count+mcq_count<>jsonb_array_length(lines) then raise exception 'Invalid question kind'; end if;
 if structured_count>f.max_structured or mcq_count>f.max_multiple_choice then
  raise exception 'This pilot allows up to % structured and % multiple-choice questions per paper.',f.max_structured,f.max_multiple_choice;
 end if;
 return new;
end $$;
revoke all on function private.enforce_pilot_paper_size() from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
create trigger enforce_pilot_paper_size before insert on private.paper_payments for each row execute function private.enforce_pilot_paper_size();

-- A refunded live purchase must not silently recycle a spent worker allowance.
-- Unpaid expired/cancelled checkouts can still be restarted. Test mode retains
-- the previous refund behaviour for synthetic exercises.
create or replace function private.pilot_seats_used(target_mode text) returns integer
language sql stable security definer set search_path='' as $$
 select count(*)::integer from private.paper_payments p
 where p.mode=target_mode and
  ((target_mode='live' and p.paid_at is not null) or
   (p.refunded_at is null and (p.status='paid' or (p.status in ('creating','open') and p.expires_at+interval '10 minutes'>now()))));
$$;

create or replace function public.pilot_checkout_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('available',coalesce(public.approved_school_id() is not null and bool_or(f.enabled and private.pilot_seats_used(f.mode)<f.order_limit),false),
  'amountMinor',10000,'currency','zar','maxQuestions',coalesce(max(f.max_questions),30),'maxStructured',coalesce(max(f.max_structured),30),'maxMultipleChoice',coalesce(max(f.max_multiple_choice),30)) from private.pilot_funding f where f.enabled;
$$;
commit;
