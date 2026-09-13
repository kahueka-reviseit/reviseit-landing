begin;
-- Read one consistent, caller-scoped version. This grants no generation right.
create function public.read_render_formatting(target_module text, expected_revision integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb;
begin
  if expected_revision is null or expected_revision < 0 then raise exception 'Invalid formatting revision'; end if;
  select jsonb_build_object('schemaVersion',1,'schoolId',s.id,'schoolName',s.name,
    'moduleId',a.module_id,'revision',coalesce(f.revision,0),'preferences',f.preferences)
  into snapshot
  from public.school_curriculum_access a
  join public.schools s on s.id=a.school_id
  left join public.school_formatting f on f.school_id=a.school_id and f.module_id=a.module_id
  where a.school_id=public.approved_school_id() and a.module_id=target_module and a.active;
  if snapshot is null then raise exception 'Curriculum access required'; end if;
  if (snapshot->>'revision')::integer <> expected_revision then raise exception 'Formatting changed. Reload before rendering'; end if;
  return snapshot;
end; $$;
revoke all on function public.read_render_formatting(text,integer) from public,anon,authenticated;
grant execute on function public.read_render_formatting(text,integer) to authenticated;
commit;
