-- C10A: configurator classification version 3 (additive).
-- Version 3 adds `structure`: the source's alternative structures (variants), their stated
-- sub-question counts, required parts and allowance for subquestions the source does not list, plus
-- choice effects outside the rule grammar. The server engine reads it; the database stores it as
-- part of the immutable payload. Versions 1 and 2 stay valid and every registered row is unchanged.
alter table private.catalogue_classifications drop constraint catalogue_classifications_schema_version_check;
alter table private.catalogue_classifications add constraint catalogue_classifications_schema_version_check check(schema_version in (1,2,3));

-- Unchanged from migration 021 except that schemaVersion 3 is accepted.
create or replace function public.register_catalogue_classification_bound(target_module text,target_release text,target_entry text,target_sha256 text,envelope jsonb,target_requirements_sha256 text,binding jsonb,
 bundle_sources jsonb,catalogue_digest text) returns void
language plpgsql security definer set search_path='' as $$
declare f jsonb; w text; expected jsonb; prov jsonb; req_ref text; kind text; prior private.catalogue_classifications; src jsonb; bsrc jsonb; n integer:=0;
begin
 if target_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(envelope) is distinct from 'object' or octet_length(envelope::text)>200000
  or envelope->'schemaVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb) or jsonb_typeof(binding) is distinct from 'object' or jsonb_typeof(bundle_sources) is distinct from 'array'
 then raise exception 'Invalid classification'; end if;
 kind:=case envelope->>'kind' when 'structured' then 'structured:' when 'multiple_choice' then 'mcq:' end;
 if kind is null or envelope->>'moduleId' is distinct from target_module or envelope->>'release' is distinct from target_release
  or kind||(envelope->>'itemId') is distinct from target_entry then raise exception 'Classification identity mismatch'; end if;
 if catalogue_digest is null or catalogue_digest is distinct from (select payload->>'contentDigest' from private.catalogue_published_releases x where x.module_id=target_module and x.release=target_release)
 then raise exception 'Classification catalogue release mismatch'; end if;
 select payload into f from private.catalogue_authored_forms x where (x.module_id,x.release,x.entry_id,x.manifest_sha256)=(target_module,target_release,target_entry,binding->>'privateManifestSha256');
 if f is null then raise exception 'Classification source version mismatch'; end if;
 select workflow_sha256 into w from private.catalogue_executions x where (x.module_id,x.release,x.manifest_sha256)=(target_module,target_release,binding->>'privateManifestSha256');
 expected:=private.line_source_binding(f,w);
 if w is null or binding<>expected then raise exception 'Classification source version mismatch'; end if;
 if envelope->'formBinding'->'itemForm'->>'formRevision' is distinct from f->>'formRevision' then raise exception 'Classification source version mismatch'; end if;
 -- bundle_sources: the publisher's reading of the registered bundle, each
 -- {role,path,originalPath,sha256}; it must restate the registered sources exactly.
 if jsonb_array_length(bundle_sources)<>jsonb_array_length(f->'sources') then raise exception 'Classification source version mismatch'; end if;
 for bsrc in select value from jsonb_array_elements(bundle_sources) loop
  if not private.form_keys(bsrc,array['role','path','originalPath','sha256']) or bsrc->>'originalPath' not like 'our content/'||target_module||'/%'
   or not exists(select 1 from jsonb_array_elements(f->'sources') s where s->'role'=bsrc->'role' and s->'path'=bsrc->'path' and s->'sha256'=bsrc->'sha256')
  then raise exception 'Classification source version mismatch'; end if;
 end loop;
 -- Every specification/task source the classification describes is a registered
 -- source with identical bytes, and vice versa; top-level and dependencies alike.
 for src in select value from jsonb_array_elements(envelope->'provenance'->'sources') loop
  if src->>'role' in ('specification','task-type','task-dependency') then
   n:=n+1;
   if not exists(select 1 from jsonb_array_elements(bundle_sources) b where b->'originalPath'=src->'path' and b->'sha256'=src->'sha256')
   then raise exception 'Classification source version mismatch'; end if;
  end if;
 end loop;
 if n<>jsonb_array_length(bundle_sources) then raise exception 'Classification source version mismatch'; end if;
 if jsonb_typeof(envelope->'curriculumRequirementsRef')='object' then
  req_ref:=(envelope->'curriculumRequirementsRef'->>'profileId')||'@'||(envelope->'curriculumRequirementsRef'->>'version');
  if target_requirements_sha256 is null or not exists(select 1 from private.curriculum_requirement_profiles r where r.ref=req_ref and r.sha256=target_requirements_sha256)
  then raise exception 'Registered requirements profile required'; end if;
 else raise exception 'Invalid classification'; end if;
 select * into prior from private.catalogue_classifications x where (x.module_id,x.release,x.entry_id,x.sha256)=(target_module,target_release,target_entry,target_sha256);
 if found and (prior.payload<>envelope or prior.source_binding is distinct from binding) then raise exception 'Registered classification is immutable'; end if;
 insert into private.catalogue_classifications(module_id,release,entry_id,sha256,schema_version,requirements_ref,payload,source_binding)
 values(target_module,target_release,target_entry,target_sha256,(envelope->>'schemaVersion')::integer,req_ref,envelope,binding) on conflict do nothing;
 insert into private.catalogue_classification_bindings(module_id,release,entry_id,sha256,requirements_sha256)
 values(target_module,target_release,target_entry,target_sha256,target_requirements_sha256)
 on conflict(module_id,release,entry_id) do update set sha256=excluded.sha256,requirements_sha256=excluded.requirements_sha256,bound_at=now();
end $$;
