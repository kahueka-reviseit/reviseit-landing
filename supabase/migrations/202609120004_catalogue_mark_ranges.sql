begin;
-- Preserve existing fixed allocations as equal bounds until a reviewed ranged release is imported.
alter table public.catalogue_summaries rename column marks to marks_min;
alter table public.catalogue_summaries add column marks_max integer;
update public.catalogue_summaries set marks_max=marks_min;
alter table public.catalogue_summaries alter column marks_max set not null;
alter table public.catalogue_summaries add constraint catalogue_mark_range_valid check (marks_max between marks_min and 100);
drop function public.search_teacher_catalogue(text);
create function public.search_teacher_catalogue(search_text text)
returns table(module_id text,module_name text,release text,is_demo boolean,entry_id text,title text,topic text,description text,marks_min integer,marks_max integer,thumbnail_alt text)
language sql stable security invoker set search_path='' as $$
  select m.id,m.name,c.release,m.is_demo,c.entry_id,c.title,c.topic,c.description,c.marks_min,c.marks_max,c.thumbnail_alt
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
