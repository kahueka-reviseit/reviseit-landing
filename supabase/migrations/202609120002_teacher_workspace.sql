begin;
-- Safe catalogue projections only. Never import specifications, forms or generation prompts here.
create table public.curriculum_modules (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  current_release text not null,
  is_demo boolean not null default false
);
create table public.school_curriculum_access (
  school_id uuid references public.schools(id),
  module_id text references public.curriculum_modules(id),
  active boolean not null default true,
  primary key(school_id,module_id)
);
create table public.catalogue_summaries (
  module_id text references public.curriculum_modules(id),
  release text not null,
  entry_id text not null,
  title text not null,
  topic text not null,
  description text not null,
  marks integer not null check(marks between 1 and 100),
  primary key(module_id,release,entry_id)
);
create table public.school_formatting (
  school_id uuid not null,
  module_id text not null,
  revision integer not null default 1,
  preferences jsonb not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(school_id,module_id),
  foreign key(school_id,module_id) references public.school_curriculum_access(school_id,module_id)
);
create table public.paper_selections (
  user_id uuid references auth.users(id),
  school_id uuid not null,
  module_id text not null,
  release text not null,
  revision integer not null default 1,
  entry_ids text[] not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,school_id,module_id),
  foreign key(school_id,module_id) references public.school_curriculum_access(school_id,module_id)
);

create function public.can_use_curriculum(target_module text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.school_curriculum_access
    where school_id=public.approved_school_id() and module_id=target_module and active);
$$;
revoke all on function public.can_use_curriculum(text) from public,anon,authenticated;
grant execute on function public.can_use_curriculum(text) to authenticated;

alter table public.curriculum_modules enable row level security;
alter table public.school_curriculum_access enable row level security;
alter table public.catalogue_summaries enable row level security;
alter table public.school_formatting enable row level security;
alter table public.paper_selections enable row level security;
create policy module_read on public.curriculum_modules for select to authenticated using(public.can_use_curriculum(id));
create policy access_read on public.school_curriculum_access for select to authenticated using(school_id=public.approved_school_id() and active);
create policy catalogue_read on public.catalogue_summaries for select to authenticated using(public.can_use_curriculum(module_id) and release=(select current_release from public.curriculum_modules where id=module_id));
create policy formatting_read on public.school_formatting for select to authenticated using(school_id=public.approved_school_id() and public.can_use_curriculum(module_id));
create policy selection_read on public.paper_selections for select to authenticated using(user_id=auth.uid() and school_id=public.approved_school_id() and public.can_use_curriculum(module_id));
revoke all on public.curriculum_modules,public.school_curriculum_access,public.catalogue_summaries,public.school_formatting,public.paper_selections from public,anon,authenticated;
grant select on public.curriculum_modules,public.school_curriculum_access,public.catalogue_summaries,public.school_formatting,public.paper_selections to authenticated;

create function public.save_school_formatting(target_module text,expected_revision integer,settings jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s uuid; next_revision integer;
begin
  s:=public.approved_school_id();
  if s is null or not public.can_use_curriculum(target_module) then raise exception 'Curriculum access required'; end if;
  if expected_revision is null or expected_revision<0 then raise exception 'Refresh before saving'; end if;
  if settings is null or jsonb_typeof(settings)<>'object' then raise exception 'Invalid formatting'; end if;
  if not (settings ?& array['font','fontSize','spacing','header','answerLines']) or
    (settings-array['font','fontSize','spacing','header','answerLines'])<>'{}'::jsonb or
    settings->>'font' not in ('Arial','Times New Roman') or
    settings->'fontSize' not in ('11'::jsonb,'12'::jsonb) or
    settings->>'spacing' not in ('normal','relaxed') or
    jsonb_typeof(settings->'font')<>'string' or jsonb_typeof(settings->'spacing')<>'string' or
    jsonb_typeof(settings->'header')<>'string' or length(settings->>'header')>160 or
    jsonb_typeof(settings->'answerLines')<>'boolean'
    then raise exception 'Invalid formatting'; end if;
  -- Serialise first-save races as well as existing-row edits for this school and module.
  perform 1 from public.school_curriculum_access where school_id=s and module_id=target_module and active for update;
  if not found then raise exception 'Curriculum access required'; end if;
  insert into public.school_formatting(school_id,module_id,preferences,updated_by)
    select s,target_module,settings,auth.uid() where expected_revision=0
    on conflict(school_id,module_id) do nothing returning revision into next_revision;
  if next_revision is null then
    update public.school_formatting set preferences=settings,revision=revision+1,updated_by=auth.uid(),updated_at=now()
      where school_id=s and module_id=target_module and revision=expected_revision returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'Formatting changed. Reload before saving'; end if;
  return next_revision;
end; $$;

create function public.save_paper_selection(target_module text,target_release text,expected_revision integer,selected_ids text[]) returns integer
language plpgsql security definer set search_path='' as $$
declare s uuid; next_revision integer; published_release text;
begin
  s:=public.approved_school_id();
  if s is null or not public.can_use_curriculum(target_module) then raise exception 'Curriculum access required'; end if;
  if expected_revision is null or expected_revision<0 then raise exception 'Refresh before saving'; end if;
  perform 1 from public.school_curriculum_access where school_id=s and module_id=target_module and active for update;
  if not found then raise exception 'Curriculum access required'; end if;
  select current_release into published_release from public.curriculum_modules where id=target_module for share;
  if target_release is null or target_release<>published_release then raise exception 'Catalogue changed. Reload before saving'; end if;
  if selected_ids is null or cardinality(selected_ids)>30 or array_position(selected_ids,null) is not null
    or cardinality(selected_ids)<>(select count(distinct x) from unnest(selected_ids) x)
    or exists(select 1 from unnest(selected_ids) x where not exists(select 1 from public.catalogue_summaries c where c.module_id=target_module and c.release=target_release and c.entry_id=x))
    then raise exception 'Invalid question selection'; end if;
  insert into public.paper_selections(user_id,school_id,module_id,release,entry_ids)
    select auth.uid(),s,target_module,target_release,selected_ids where expected_revision=0
    on conflict(user_id,school_id,module_id) do nothing returning revision into next_revision;
  if next_revision is null then
    update public.paper_selections set release=target_release,entry_ids=selected_ids,revision=revision+1,updated_at=now()
      where user_id=auth.uid() and school_id=s and module_id=target_module and revision=expected_revision returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'Selection changed. Reload before saving'; end if;
  return next_revision;
end; $$;
revoke all on function public.save_school_formatting(text,integer,jsonb),public.save_paper_selection(text,text,integer,text[]) from public,anon,authenticated;
grant execute on function public.save_school_formatting(text,integer,jsonb),public.save_paper_selection(text,text,integer,text[]) to authenticated;
commit;
