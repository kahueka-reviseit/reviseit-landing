begin;
-- Small reviewed PNG previews only; never SVG markup, remote URLs or specification data.
alter table public.catalogue_summaries add column thumbnail_png text;
alter table public.catalogue_summaries add column thumbnail_alt text;
alter table public.catalogue_summaries add constraint catalogue_thumbnail_valid check (
  (thumbnail_png is null and thumbnail_alt is null) or
  (thumbnail_png is not null and thumbnail_alt is not null and
   length(thumbnail_png) between 12 and 350000 and thumbnail_png ~ '^iVBORw0KGgo[A-Za-z0-9+/=]+$' and
   length(trim(thumbnail_alt)) between 1 and 300)
);

-- SECURITY INVOKER preserves the existing current-release and school-access row policies.
create function public.search_teacher_catalogue(search_text text)
returns table(module_id text,module_name text,release text,is_demo boolean,entry_id text,title text,topic text,description text,marks integer,thumbnail_alt text)
language sql stable security invoker set search_path='' as $$
  select m.id,m.name,c.release,m.is_demo,c.entry_id,c.title,c.topic,c.description,c.marks,c.thumbnail_alt
  from public.catalogue_summaries c join public.curriculum_modules m on m.id=c.module_id and m.current_release=c.release
  where public.approved_school_id() is not null
    and length(trim(search_text)) between 1 and 120
    and not exists (
      select 1 from regexp_split_to_table(lower(trim(search_text)), '\s+') as terms(term)
      where strpos(lower(m.name||' '||m.id||' '||c.title||' '||c.topic||' '||c.description||' '||c.entry_id),term)=0
    )
  order by m.id,c.title,c.entry_id limit 51;
$$;
revoke all on function public.search_teacher_catalogue(text) from public,anon,authenticated;
grant execute on function public.search_teacher_catalogue(text) to authenticated;
commit;
