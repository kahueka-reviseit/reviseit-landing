begin;
create function public.valid_catalogue_preview(v jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; q jsonb; m jsonb;
begin
 if v is null then return true; end if;
 if jsonb_typeof(v) <> 'object' or not (v ? 'subquestions') or (v - array['subquestions','outline']::text[]) <> '{}'::jsonb then return false; end if;
 q:=v->'subquestions';
 if jsonb_typeof(q) <> 'object' or not(q ?& array['min','max']) or (q-array['min','max']::text[]) <> '{}'::jsonb then return false; end if;
 if jsonb_typeof(q->'min') <> 'number' or jsonb_typeof(q->'max') <> 'number' or (q->>'min')::numeric <> trunc((q->>'min')::numeric) or (q->>'max')::numeric <> trunc((q->>'max')::numeric) or (q->>'min')::numeric < 1 or (q->>'max')::numeric < (q->>'min')::numeric or (q->>'max')::numeric > 30 then return false; end if;
 if v ? 'outline' then
  if jsonb_typeof(v->'outline') <> 'array' then return false; end if;
  if jsonb_array_length(v->'outline') < (q->>'min')::int or jsonb_array_length(v->'outline') > (q->>'max')::int then return false; end if;
  for r in select value from jsonb_array_elements(v->'outline') loop
   if jsonb_typeof(r) <> 'object' or not(r ?& array['summary','bloom']) or (r-array['summary','bloom','marks']::text[]) <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(r->'summary') <> 'string' or length(trim(r->>'summary')) not between 1 and 160 or jsonb_typeof(r->'bloom') <> 'string' or r->>'bloom' not in ('Remember','Understand','Apply','Analyse','Evaluate','Create') then return false; end if;
   if r ? 'marks' then
    m:=r->'marks';
    if jsonb_typeof(m) <> 'object' or not(m ?& array['min','max']) or (m-array['min','max']::text[]) <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(m->'min') <> 'number' or jsonb_typeof(m->'max') <> 'number' or (m->>'min')::numeric <> trunc((m->>'min')::numeric) or (m->>'max')::numeric <> trunc((m->>'max')::numeric) or (m->>'min')::numeric < 1 or (m->>'max')::numeric < (m->>'min')::numeric or (m->>'max')::numeric > 100 then return false; end if;
   end if;
  end loop;
 end if;
 return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_catalogue_preview(jsonb) from public,anon,authenticated;
grant execute on function public.valid_catalogue_preview(jsonb) to authenticated;
alter table public.catalogue_summaries add column preview jsonb;
alter table public.catalogue_summaries add constraint catalogue_preview_valid check (public.valid_catalogue_preview(preview));
drop function public.search_teacher_catalogue(text);
create function public.search_teacher_catalogue(search_text text)
returns table(module_id text,module_name text,release text,is_demo boolean,entry_id text,title text,topic text,description text,marks_min integer,marks_max integer,thumbnail_alt text,preview jsonb)
language sql stable security invoker set search_path='' as $$
  select m.id,m.name,c.release,m.is_demo,c.entry_id,c.title,c.topic,c.description,c.marks_min,c.marks_max,c.thumbnail_alt,c.preview
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
