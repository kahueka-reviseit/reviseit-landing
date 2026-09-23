begin;

do $$ begin
 if not exists(select 1 from pg_roles where rolname='reviseit_catalogue_publisher') then
  create role reviseit_catalogue_publisher nologin;
 end if;
end $$;

-- A catalogue release says what may be shown. Readiness says only whether a
-- teacher can choose an entry today. Keeping it separate lets a reviewed
-- questionnaire be connected without republishing the catalogue.
create table public.catalogue_ordering_readiness (
  module_id text not null,
  release text not null,
  entry_id text not null,
  orderable boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(module_id,release,entry_id),
  foreign key(module_id,release,entry_id)
    references public.catalogue_summaries(module_id,release,entry_id)
);
alter table public.catalogue_ordering_readiness enable row level security;
create policy catalogue_ordering_read on public.catalogue_ordering_readiness for select to authenticated
  using(public.can_use_curriculum(module_id) and release=(select current_release from public.curriculum_modules where id=module_id));
revoke all on public.catalogue_ordering_readiness from public,anon,authenticated;
grant select on public.catalogue_ordering_readiness to authenticated;

-- The view is the sole browser-facing catalogue source. An absent readiness
-- row deliberately reads as unavailable.
create view public.teacher_catalogue_summaries with (security_invoker=true) as
  select c.module_id,c.release,c.entry_id,c.title,c.topic,c.description,
         c.marks_min,c.marks_max,c.thumbnail_alt,c.preview,
         coalesce(r.orderable,false) as orderable
  from public.catalogue_summaries c
  left join public.catalogue_ordering_readiness r
    on r.module_id=c.module_id and r.release=c.release and r.entry_id=c.entry_id;
revoke all on public.teacher_catalogue_summaries from public,anon,authenticated;
grant select on public.teacher_catalogue_summaries to authenticated;

-- A blank public description is allowed. Catalogue summaries are intentionally
-- redacted, and the title, topic and marks remain the public shape.
create or replace function private.valid_catalogue_release(v jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb; m jsonb; t jsonb; required text[]; k text;
begin
 required:=array['schema','status','module','release','contentDigest','entries'];
 if v is null or jsonb_typeof(v)<>'object' or not(v ?& required) or (v-required)<>'{}'::jsonb or octet_length(v::text)>20000000 then return false; end if;
 if v->>'schema' is distinct from 'reviseit/catalogue@2' or v->>'status' is distinct from 'published' then return false; end if;
 if jsonb_typeof(v->'release')<>'string' or length(trim(v->>'release')) not between 1 and 99 or jsonb_typeof(v->'contentDigest')<>'string' or v->>'contentDigest' !~ '^[a-f0-9]{64}$' then return false; end if;
 m:=v->'module';
 if jsonb_typeof(m)<>'object' or not(m ?& array['id','name']) or (m-array['id','name'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(m->'id')<>'string' or length(m->>'id')>120 or m->>'id' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or jsonb_typeof(m->'name')<>'string' or length(trim(m->>'name')) not between 1 and 200 then return false; end if;
 if jsonb_typeof(v->'entries')<>'array' or jsonb_array_length(v->'entries') not between 1 and 500 then return false; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(v->'entries'))<>jsonb_array_length(v->'entries') then return false; end if;
 for e in select value from jsonb_array_elements(v->'entries') loop
  required:=array['id','code','kind','paper','title','topic','description','marks'];
  if jsonb_typeof(e)<>'object' or not(e ?& required) or (e-(required||array['preview','thumbnail']))<>'{}'::jsonb then return false; end if;
  foreach k in array array['id','code','kind','title','topic'] loop
   if jsonb_typeof(e->k)<>'string' or length(trim(e->>k))<1 then return false; end if;
  end loop;
  if jsonb_typeof(e->'description')<>'string' or e->>'kind' not in ('structured','mcq') or e->>'code' !~ '^[A-Z0-9_-]+$' or e->>'id'<>(e->>'kind')||':'||(e->>'code') or length(e->>'id')>120 or length(e->>'title')>200 or length(e->>'topic')>200 or length(e->>'description')>500 or e->'paper' not in ('1'::jsonb,'2'::jsonb) then return false; end if;
  m:=e->'marks';
  if jsonb_typeof(m)<>'object' or not(m ?& array['min','max']) or (m-array['min','max'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(m->'min')<>'number' or jsonb_typeof(m->'max')<>'number' or (m->>'min')::numeric<>trunc((m->>'min')::numeric) or (m->>'max')::numeric<>trunc((m->>'max')::numeric) or (m->>'min')::numeric<1 or (m->>'max')::numeric<(m->>'min')::numeric or (m->>'max')::numeric>100 then return false; end if;
  if e ? 'preview' and not public.valid_catalogue_preview(e->'preview') then return false; end if;
  if e ? 'thumbnail' then
   t:=e->'thumbnail';
   if jsonb_typeof(t)<>'object' or not(t ?& array['png','alt']) or (t-array['png','alt'])<>'{}'::jsonb then return false; end if;
   if jsonb_typeof(t->'png')<>'string' or length(t->>'png') not between 12 and 350000 or t->>'png' !~ '^iVBORw0KGgo[A-Za-z0-9+/=]+$' or jsonb_typeof(t->'alt')<>'string' or length(trim(t->>'alt')) not between 1 and 300 then return false; end if;
   if substring(decode(t->>'png','base64') from 1 for 8)<>decode('89504e470d0a1a0a','hex') then return false; end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;

-- The content publisher records its own published release. This replaces the
-- old reviewer-receipt dependency for new releases while preserving the old
-- immutable history unchanged.
create table private.catalogue_published_releases (
  module_id text not null,
  release text not null,
  expected_previous_release text,
  payload jsonb not null,
  published_by text not null default session_user,
  published_at timestamptz not null default now(),
  primary key(module_id,release)
);
alter table private.catalogue_published_releases enable row level security;
revoke all on private.catalogue_published_releases from public,anon,authenticated,reviseit_catalogue_publisher;

create function public.publish_catalogue_release(manifest jsonb,expected_previous_release text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.catalogue_published_releases%rowtype;
 module_key text; release_key text; current_version text; e jsonb; module_exists boolean;
begin
 if not private.valid_catalogue_release(manifest) then raise exception 'Invalid published catalogue'; end if;
 module_key:=manifest->'module'->>'id'; release_key:=manifest->>'release';
 perform pg_advisory_xact_lock(hashtextextended(module_key,0));
 select * into prior from private.catalogue_published_releases where module_id=module_key and release=release_key;
 if found then
  if prior.payload<>manifest or prior.expected_previous_release is distinct from expected_previous_release then raise exception 'Catalogue release is immutable'; end if;
  return jsonb_build_object('status','already-published','module',module_key,'release',release_key);
 end if;
 select current_release into current_version from public.curriculum_modules where id=module_key for update;
 module_exists:=found;
 if (module_exists and current_version is distinct from expected_previous_release) or (not module_exists and expected_previous_release is not null) then raise exception 'Catalogue predecessor changed'; end if;
 if exists(select 1 from public.catalogue_summaries where module_id=module_key and release=release_key) then raise exception 'Catalogue release already exists outside publication history'; end if;
 if not module_exists then
  insert into public.curriculum_modules(id,name,current_release,is_demo) values(module_key,manifest->'module'->>'name',release_key,false);
 end if;
 for e in select value from jsonb_array_elements(manifest->'entries') loop
  insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max,preview,thumbnail_png,thumbnail_alt)
  values(module_key,release_key,e->>'id',e->>'title',e->>'topic',e->>'description',(e->'marks'->>'min')::int,(e->'marks'->>'max')::int,e->'preview',e->'thumbnail'->>'png',e->'thumbnail'->>'alt');
 end loop;
 insert into private.catalogue_published_releases(module_id,release,expected_previous_release,payload)
   values(module_key,release_key,expected_previous_release,manifest);
 update public.curriculum_modules set name=manifest->'module'->>'name',current_release=release_key where id=module_key;
 return jsonb_build_object('status','published','module',module_key,'release',release_key,'entries',jsonb_array_length(manifest->'entries'));
end $$;
revoke all on function public.publish_catalogue_release(jsonb,text) from public,anon,authenticated;
grant usage on schema public to reviseit_catalogue_publisher;
grant execute on function public.publish_catalogue_release(jsonb,text) to reviseit_catalogue_publisher;

create or replace function private.protect_imported_catalogue_rows() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op<>'INSERT' and (exists(select 1 from private.catalogue_imported_releases where module_id=old.module_id and release=old.release)
     or exists(select 1 from private.catalogue_published_releases where module_id=old.module_id and release=old.release)))
    or (tg_op<>'DELETE' and (exists(select 1 from private.catalogue_imported_releases where module_id=new.module_id and release=new.release)
     or exists(select 1 from private.catalogue_published_releases where module_id=new.module_id and release=new.release))) then
  raise exception 'Catalogue release is immutable';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

-- Require readiness on every selected item, including a direct RPC attempt.
create or replace function public.save_paper_selection(target_module text,target_release text,expected_revision integer,selected_ids text[]) returns integer
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
   or exists(select 1 from unnest(selected_ids) x where not exists(
      select 1 from public.catalogue_summaries c
      where c.module_id=target_module and c.release=target_release and c.entry_id=x))
   then raise exception 'Invalid question selection'; end if;
 if exists(select 1 from unnest(selected_ids) x where not exists(
      select 1 from public.catalogue_ordering_readiness r
      where r.module_id=target_module and r.release=target_release and r.entry_id=x and r.orderable))
   then raise exception 'Question is not available to order'; end if;
 insert into public.paper_selections(user_id,school_id,module_id,release,entry_ids)
   select auth.uid(),s,target_module,target_release,selected_ids where expected_revision=0
   on conflict(user_id,school_id,module_id) do nothing returning revision into next_revision;
 if next_revision is null then
   update public.paper_selections set release=target_release,entry_ids=selected_ids,revision=revision+1,updated_at=now()
     where user_id=auth.uid() and school_id=s and module_id=target_module and revision=expected_revision returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'Selection changed. Reload before saving'; end if;
 return next_revision;
end $$;

-- Search is an allowlisted public projection and carries only readiness.
drop function public.search_teacher_catalogue(text);
create function public.search_teacher_catalogue(search_text text)
returns table(module_id text,module_name text,release text,is_demo boolean,entry_id text,title text,topic text,description text,marks_min integer,marks_max integer,thumbnail_alt text,preview jsonb,orderable boolean)
language sql stable security invoker set search_path='' as $$
 select m.id,m.name,c.release,m.is_demo,c.entry_id,c.title,c.topic,c.description,c.marks_min,c.marks_max,c.thumbnail_alt,c.preview,c.orderable
 from public.teacher_catalogue_summaries c join public.curriculum_modules m on m.id=c.module_id and m.current_release=c.release
 where public.approved_school_id() is not null and length(trim(search_text)) between 1 and 120
   and not exists(select 1 from regexp_split_to_table(lower(trim(search_text)), '\s+') as terms(term)
     where strpos(lower(m.name||' '||m.id||' '||c.title||' '||c.topic||' '||c.description||' '||c.entry_id),term)=0)
 order by m.id,c.title,c.entry_id limit 51;
$$;
revoke all on function public.search_teacher_catalogue(text) from public,anon,authenticated;
grant execute on function public.search_teacher_catalogue(text) to authenticated;

commit;
