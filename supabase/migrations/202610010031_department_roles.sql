begin;
-- Authority belongs to verified membership, never signup metadata or a JWT claim.
alter table public.teacher_accounts add column department_role text not null default 'teacher'
  check (department_role in ('teacher','head'));
alter table public.teacher_accounts add column can_spend_credits boolean not null default true;
create table private.credit_administrators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table private.department_membership_events (
  id bigint generated always as identity primary key,
  target_user uuid not null references public.teacher_accounts(user_id),
  department_id uuid references public.departments(id),
  actor_id uuid references auth.users(id),
  previous_role text not null, new_role text not null,
  previous_spending boolean not null, new_spending boolean not null,
  reason text not null check(length(trim(reason)) between 3 and 2000),
  created_at timestamptz not null default now()
);
alter table private.credit_administrators enable row level security;
alter table private.department_membership_events enable row level security;
revoke all on private.credit_administrators,private.department_membership_events from public,anon,authenticated;

create function public.is_credit_administrator() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.credit_administrators c join auth.users u on u.id=c.user_id
    where c.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
create function public.approved_department_id() returns uuid
language sql stable security definer set search_path='' as $$
  select a.department_id from public.teacher_accounts a
    where a.user_id=auth.uid() and a.school_id=public.approved_school_id();
$$;
create function public.is_department_head(target_department uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.teacher_accounts a where a.user_id=auth.uid()
    and a.department_id=target_department and a.department_id=public.approved_department_id()
    and a.department_role='head');
$$;
-- Existing revocation paths automatically clear the new authority as well.
create function private.clear_department_authority() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'approved' or new.department_id is distinct from old.department_id
    or new.school_id is distinct from old.school_id or new.email is distinct from old.email then
    new.department_role:='teacher'; new.can_spend_credits:=true;
  end if;
  if new.department_role is distinct from old.department_role or new.can_spend_credits is distinct from old.can_spend_credits then
    insert into private.department_membership_events(target_user,department_id,actor_id,previous_role,new_role,previous_spending,new_spending,reason)
      values(old.user_id,coalesce(new.department_id,old.department_id),auth.uid(),old.department_role,new.department_role,
      old.can_spend_credits,new.can_spend_credits,coalesce(nullif(current_setting('reviseit.membership_reason',true),''),'Account authority changed'));
  end if;
  return new;
end; $$;
create trigger clear_department_authority before update on public.teacher_accounts
  for each row execute function private.clear_department_authority();

create function public.set_department_role(target_user uuid, expected_revision integer, new_role text, reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.teacher_accounts;
begin
  if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
  if new_role is null or new_role not in ('head','teacher') or reason is null or length(trim(reason)) not between 3 and 2000 then raise exception 'Invalid role or reason'; end if;
  select * into a from public.teacher_accounts where user_id=target_user for update;
  if not found or expected_revision is null or a.revision<>expected_revision then raise exception 'Account changed. Refresh before reviewing'; end if;
  if a.status<>'approved' or a.department_id is null or not exists(select 1 from auth.users u where u.id=a.user_id
    and u.email_confirmed_at is not null and lower(u.email)=lower(a.email)) then raise exception 'Verified department membership required'; end if;
  if a.department_role=new_role then return; end if;
  perform set_config('reviseit.membership_reason',trim(reason),true);
  update public.teacher_accounts set department_role=new_role,revision=revision+1 where user_id=target_user;
  perform set_config('reviseit.membership_reason','',true);
end; $$;

create function public.set_department_member_spending(target_user uuid, expected_revision integer, allowed boolean, reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.teacher_accounts; actor public.teacher_accounts; staff boolean;
begin
  staff:=public.is_credit_administrator();
  -- Lock both memberships in stable order: revocation cannot race this action.
  perform 1 from public.teacher_accounts where user_id in (auth.uid(),target_user) order by user_id for update;
  select * into a from public.teacher_accounts where user_id=target_user;
  if not found or expected_revision is null or a.revision<>expected_revision then raise exception 'Account changed. Refresh before reviewing'; end if;
  if not staff and (not public.is_department_head(a.department_id) or a.department_role='head' or a.user_id=auth.uid()) then
    raise exception 'Department head access required'; end if;
  if a.status<>'approved' or allowed is null or reason is null or length(trim(reason)) not between 3 and 2000 then raise exception 'Invalid membership change'; end if;
  if a.can_spend_credits=allowed then return; end if;
  perform set_config('reviseit.membership_reason',trim(reason),true);
  update public.teacher_accounts set can_spend_credits=allowed,revision=revision+1 where user_id=target_user;
  perform set_config('reviseit.membership_reason','',true);
end; $$;

create function public.department_members(target_department uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_credit_administrator() and not public.is_department_head(target_department) then raise exception 'Department head access required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId',a.user_id,'name',a.full_name,'email',a.email,
    'role',a.department_role,'canSpend',a.can_spend_credits,'revision',a.revision) order by a.full_name,a.user_id)
    from public.teacher_accounts a where a.department_id=target_department and a.status='approved'),'[]'::jsonb);
end; $$;
revoke all on function private.clear_department_authority() from public,anon,authenticated;
revoke all on function public.is_credit_administrator(),public.approved_department_id(),public.is_department_head(uuid),
 public.set_department_role(uuid,integer,text,text),public.set_department_member_spending(uuid,integer,boolean,text),public.department_members(uuid) from public,anon,authenticated;
grant execute on function public.is_credit_administrator(),public.approved_department_id(),public.is_department_head(uuid),
 public.set_department_role(uuid,integer,text,text),public.set_department_member_spending(uuid,integer,boolean,text),public.department_members(uuid) to authenticated;
create function public.credit_departments() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_credit_administrator() then raise exception 'Credit administrator access required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'school',s.name) order by s.name,d.name)
 from public.departments d join public.schools s on s.id=d.school_id),'[]'::jsonb);
end $$;
revoke all on function public.credit_departments() from public,anon,authenticated;
grant execute on function public.credit_departments() to authenticated;
commit;
