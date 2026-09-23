begin;

-- Readiness alone is not enough to unlock a catalogue item. The binding keeps
-- the usable form and private source bundle versioned outside browser-readable
-- catalogue rows. A later form update can change future readiness while
-- already issued forms and generation plans retain their own frozen hashes.
create table private.catalogue_form_bindings (
  module_id text not null,
  release text not null,
  entry_id text not null,
  form_revision text not null check(form_revision ~ '^[a-f0-9]{64}$'),
  private_bundle_sha256 text not null check(private_bundle_sha256 ~ '^[a-f0-9]{64}$'),
  shared_forms_sha256 text not null check(shared_forms_sha256 ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz not null default now(),
  primary key(module_id,release,entry_id),
  foreign key(module_id,release,entry_id)
    references public.catalogue_summaries(module_id,release,entry_id)
);
alter table private.catalogue_form_bindings enable row level security;
revoke all on private.catalogue_form_bindings from public,anon,authenticated,reviseit_catalogue_publisher;

-- The restricted publisher records the complete private binding and its
-- orderability together. Browser roles cannot create bindings or mark entries
-- selectable. Every value is a fixed digest, never a source path or form body.
create function public.set_catalogue_form_binding(
  target_module text,target_release text,target_entry text,
  target_form_revision text,target_private_bundle_sha256 text,target_shared_forms_sha256 text,
  target_orderable boolean
) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.catalogue_summaries
   where module_id=target_module and release=target_release and entry_id=target_entry) then
  raise exception 'Unknown catalogue entry';
 end if;
 if target_form_revision !~ '^[a-f0-9]{64}$'
   or target_private_bundle_sha256 !~ '^[a-f0-9]{64}$'
   or target_shared_forms_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid form binding digest';
 end if;
 insert into private.catalogue_form_bindings(
   module_id,release,entry_id,form_revision,private_bundle_sha256,shared_forms_sha256
 ) values(
   target_module,target_release,target_entry,target_form_revision,target_private_bundle_sha256,target_shared_forms_sha256
 ) on conflict(module_id,release,entry_id) do update set
   form_revision=excluded.form_revision,
   private_bundle_sha256=excluded.private_bundle_sha256,
   shared_forms_sha256=excluded.shared_forms_sha256,
   bound_at=now();
 insert into public.catalogue_ordering_readiness(module_id,release,entry_id,orderable)
   values(target_module,target_release,target_entry,target_orderable)
   on conflict(module_id,release,entry_id) do update set orderable=excluded.orderable,updated_at=now();
end $$;
revoke all on function public.set_catalogue_form_binding(text,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.set_catalogue_form_binding(text,text,text,text,text,text,boolean) to reviseit_catalogue_publisher;

-- Existing catalogue rows without a private binding remain visible, but cannot
-- be selected even if an accidental readiness row says otherwise.
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
      join private.catalogue_form_bindings b
        on b.module_id=r.module_id and b.release=r.release and b.entry_id=r.entry_id
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

-- Existing grouped forms already use an exact empty answer object for an empty
-- paper section. Apply that same rule to an item explicitly authored with zero
-- fields. Missing items remain invalid because item count and identifiers stay
-- fixed.
create or replace function private.valid_questionnaire(f jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; seen text[]:='{}'; total integer;
begin
 if not private.form_keys(f,array['schemaVersion','revision','items','paperFields'])
  or f->'schemaVersion' is distinct from '2'::jsonb or not private.form_text(f->'revision',64)
  or f->>'revision' !~ '^[a-f0-9]{64}$' or jsonb_typeof(f->'items') is distinct from 'array'
  or not private.valid_questionnaire_fields(f->'paperFields',20) then return false; end if;
 if jsonb_array_length(f->'items') not between 1 and 30 then return false; end if;
 total:=jsonb_array_length(f->'paperFields');
 for item in select value from jsonb_array_elements(f->'items') loop
  if not private.form_keys(item,array['id','title','marks','fields']) or not private.form_id(item->'id')
   or item->>'id'=any(seen) or not private.form_text(item->'title',160)
   or jsonb_typeof(item->'marks') is distinct from 'number' or (item->>'marks')::numeric not between 1 and 100
   or trunc((item->>'marks')::numeric)<>(item->>'marks')::numeric
   or not private.valid_questionnaire_fields(item->'fields',30) then return false; end if;
  seen:=array_append(seen,item->>'id');total:=total+jsonb_array_length(item->'fields');
  if total>200 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

commit;
