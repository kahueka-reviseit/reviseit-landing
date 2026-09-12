begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 160)
);
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null check (length(trim(name)) between 2 and 160),
  unique (school_id, name), unique(id, school_id)
);
create table private.account_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.account_reviewers enable row level security;
revoke all on private.account_reviewers from public, anon, authenticated;
create table public.teacher_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  email_confirmed_at timestamptz,
  full_name text not null default '',
  requested_school text not null default '',
  requested_department text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  school_id uuid references public.schools(id),
  department_id uuid,
  revision integer not null default 1,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (department_id, school_id) references public.departments(id, school_id),
  check (status <> 'approved' or (school_id is not null and department_id is not null and reviewed_by is not null and reviewed_at is not null))
);
create table public.account_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.teacher_accounts(user_id),
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected','suspended')),
  school_id uuid references public.schools(id),
  department_id uuid references public.departments(id),
  note text not null check (length(trim(note)) between 3 and 2000),
  created_at timestamptz not null default now()
);

create function private.is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.account_reviewers r join auth.users u on u.id=r.user_id
    where r.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
create function public.is_account_reviewer() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.is_reviewer(); $$;
-- Read the current database state, never user-editable metadata or a stale approval claim.
create function public.approved_school_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.school_id from public.teacher_accounts a join auth.users u on u.id=a.user_id
  where a.user_id=auth.uid() and a.status='approved' and u.email_confirmed_at is not null
    and lower(a.email)=lower(u.email);
$$;

alter table public.schools enable row level security;
alter table public.departments enable row level security;
alter table public.teacher_accounts enable row level security;
alter table public.account_reviews enable row level security;
create policy account_read on public.teacher_accounts for select to authenticated
  using (user_id=auth.uid() or private.is_reviewer());
create policy school_read on public.schools for select to authenticated
  using (id=public.approved_school_id() or private.is_reviewer());
create policy department_read on public.departments for select to authenticated
  using (school_id=public.approved_school_id() or private.is_reviewer());
create policy review_read on public.account_reviews for select to authenticated using (private.is_reviewer());
-- No direct writes, including through the public Supabase data endpoint.
revoke all on public.schools, public.departments, public.teacher_accounts, public.account_reviews from anon, authenticated;
grant select on public.schools, public.departments, public.teacher_accounts, public.account_reviews to authenticated;

create function private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.teacher_accounts(user_id,email,email_confirmed_at,full_name,requested_school,requested_department)
  values(new.id, lower(coalesce(new.email,'')), new.email_confirmed_at, left(coalesce(new.raw_user_meta_data->>'full_name',''),160),
    left(coalesce(new.raw_user_meta_data->>'school',''),160), left(coalesce(new.raw_user_meta_data->>'department',''),160));
  return new;
end; $$;
create trigger teacher_account_created after insert on auth.users for each row execute function private.on_auth_user_created();

create function private.on_auth_email_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.teacher_accounts set email_confirmed_at=new.email_confirmed_at where user_id=new.id;
  if new.email is distinct from old.email then
    update public.teacher_accounts set email=lower(coalesce(new.email,'')),
      status=case when status in ('rejected','suspended') then status else 'pending' end,
      school_id=null,department_id=null,reviewed_by=null,reviewed_at=null,revision=revision+1 where user_id=new.id;
  end if;
  return new;
end; $$;
create trigger teacher_email_changed after update of email,email_confirmed_at on auth.users for each row execute function private.on_auth_email_changed();

create function public.submit_school_details(full_name text, school text, department text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if length(trim(full_name)) not between 2 and 160 or length(trim(school)) not between 2 and 160
    or length(trim(department)) not between 2 and 160 or full_name is null or school is null or department is null then
    raise exception 'Complete your name, school and department';
  end if;
  update public.teacher_accounts set full_name=trim(submit_school_details.full_name),requested_school=trim(school),
    requested_department=trim(department),status='pending',school_id=null,department_id=null,
    reviewed_at=null,reviewed_by=null,revision=revision+1
    where user_id=auth.uid() and status in ('pending','approved');
  if not found then raise exception 'Account details cannot be changed in this state'; end if;
end; $$;

create function public.register_school_department(school_slug text, school_name text, department_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s uuid; d uuid;
begin
  if not private.is_reviewer() then raise exception 'Reviewer access required'; end if;
  insert into public.schools(slug,name) values(school_slug,trim(school_name)) on conflict(slug) do nothing;
  select id into s from public.schools where slug=school_slug;
  insert into public.departments(school_id,name) values(s,trim(department_name)) on conflict(school_id,name) do nothing;
  select id into d from public.departments where school_id=s and name=trim(department_name);
  return d;
end; $$;

create function public.review_teacher_account(target_user uuid, expected_revision integer, decision text,
  selected_department uuid, review_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.teacher_accounts; s uuid;
begin
  if not private.is_reviewer() then raise exception 'Reviewer access required'; end if;
  if target_user=auth.uid() then raise exception 'A second reviewer must review your account'; end if;
  select * into a from public.teacher_accounts where user_id=target_user for update;
  if not found or expected_revision is null or a.revision<>expected_revision then raise exception 'Account changed. Refresh before reviewing'; end if;
  if decision is null or decision not in ('approved','rejected','suspended') then raise exception 'Invalid decision'; end if;
  if decision='approved' then
    if not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null and lower(email)=a.email)
      then raise exception 'Confirm the school email first'; end if;
    if length(trim(a.full_name))<2 or length(trim(a.requested_school))<2 or length(trim(a.requested_department))<2
      then raise exception 'School details incomplete'; end if;
    select school_id into s from public.departments where id=selected_department;
    if s is null then raise exception 'Choose a verified school department'; end if;
  end if;
  insert into public.account_reviews(user_id,reviewer_id,decision,school_id,department_id,note)
    values(target_user,auth.uid(),decision,s,case when decision='approved' then selected_department end,trim(review_note));
  update public.teacher_accounts set status=decision,school_id=s,
    department_id=case when decision='approved' then selected_department end,
    reviewed_by=auth.uid(),reviewed_at=now(),revision=revision+1 where user_id=target_user;
end; $$;

revoke all on function private.is_reviewer(), private.on_auth_user_created(), private.on_auth_email_changed() from public, anon, authenticated;
grant execute on function private.is_reviewer() to authenticated;
revoke all on function public.is_account_reviewer(), public.approved_school_id(),
 public.submit_school_details(text,text,text), public.register_school_department(text,text,text),
 public.review_teacher_account(uuid,integer,text,uuid,text) from public, anon, authenticated;
grant execute on function public.is_account_reviewer(), public.approved_school_id(),
 public.submit_school_details(text,text,text), public.register_school_department(text,text,text),
 public.review_teacher_account(uuid,integer,text,uuid,text) to authenticated;
commit;
