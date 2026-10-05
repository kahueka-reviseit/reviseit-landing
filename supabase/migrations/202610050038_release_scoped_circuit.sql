-- Grade 11 structured:P1-CIRC-01: release-scoped admission.
--
-- The item was excluded in every release because its four authored power/energy
-- choices had no rule tying "electricity cost" to the cost step. The corrected
-- definition (Grade 11 release 5.6.0 onwards) carries classification rule
-- form-power-electricity-cost: electricity cost requires part X.7 and rules out the
-- answer "no cost step". This migration admits the circuit ONLY where the item's
-- current classification binding is such a corrected definition and is bound to the
-- exact registered form, bundle and workflow. Older circuit definitions, which lack
-- the rule, stay refused in every release. The Grade 10 joint-section exclusion
-- (P2-CHEM-04/05) is unchanged. Existing orders, snapshots and readiness rows are
-- not rewritten; readiness changes only when an operator registers a corrected
-- definition and runs public.sync_supported_catalogue_readiness.

-- True only for the corrected circuit rule, checked by content rather than by name.
create function private.corrected_circuit_rule(classification jsonb) returns boolean
language sql immutable set search_path='' as $$
 with cost as (
  select p->>'id' as id from jsonb_array_elements(classification->'parts') p
  where p->>'label'='X.7' and jsonb_typeof(p->'id')='string' and p->>'id'<>''
 )
 select coalesce(exists(
  select 1 from jsonb_array_elements(classification->'rules') r
  where r->>'id'='form-power-electricity-cost' and r->>'kind'='constraint' and r->>'activation'='active'
   and (select count(*) from cost)=1
   and r->'when'='{"facet":"power_calculation","is":"electricity_cost"}'::jsonb
   and exists(select 1 from jsonb_array_elements(r->'then') t
              where t='{"excludeOptions":{"facet":"cost_calculation","options":["no"]}}'::jsonb)
   and exists(select 1 from jsonb_array_elements(r->'then') t
              where t=jsonb_build_object('requireParts',(select jsonb_agg(id) from cost)))),false);
$$;

-- The item's current classification is corrected AND bound to the exact registered
-- form, private bundle and workflow that an order would generate from.
create function private.circuit_definition_corrected(target_module text,target_release text,target_entry text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.catalogue_form_bindings b
  join private.catalogue_authored_forms f on (f.module_id,f.release,f.entry_id,f.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256)
  join private.catalogue_executions e on (e.module_id,e.release,e.manifest_sha256)=(b.module_id,b.release,b.manifest_sha256)
  join private.catalogue_classification_bindings cb on (cb.module_id,cb.release,cb.entry_id)=(b.module_id,b.release,b.entry_id)
  join private.catalogue_classifications c on (c.module_id,c.release,c.entry_id,c.sha256)=(cb.module_id,cb.release,cb.entry_id,cb.sha256)
  where (b.module_id,b.release,b.entry_id)=(target_module,target_release,target_entry)
   and private.corrected_circuit_rule(c.payload)
   and c.source_binding=private.line_source_binding(f.payload,e.workflow_sha256));
$$;

create or replace function private.catalogue_item_supported(target_module text,target_release text,target_entry text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.catalogue_form_bindings b
  join private.catalogue_authored_forms f on (f.module_id,f.release,f.entry_id,f.manifest_sha256)=(b.module_id,b.release,b.entry_id,b.manifest_sha256)
  join private.catalogue_executions e on (e.module_id,e.release,e.manifest_sha256)=(b.module_id,b.release,b.manifest_sha256)
  where (b.module_id,b.release,b.entry_id)=(target_module,target_release,target_entry)
   and f.payload->>'formRevision'=b.form_revision and f.payload->>'bundleDigest'=b.private_bundle_sha256
   and f.payload->>'sharedFormsSha256'=b.shared_forms_sha256)
 and not (target_module='caps-grade-11-physical-sciences' and target_entry='structured:P1-CIRC-01'
          and not private.circuit_definition_corrected(target_module,target_release,target_entry))
 and not (target_module='caps-grade-10-physical-sciences' and target_entry in ('structured:P2-CHEM-04','structured:P2-CHEM-05'));
$$;

create or replace function private.freeze_new_catalogue_execution() returns trigger
language plpgsql security definer set search_path='' as $$
declare w text; f jsonb; expected text;
begin
 expected:=case new.adapter_key when 'authored-bundle-v1' then 'reviseit/frozen-authored-inputs@1'
  when 'configured-bundle-v1' then 'reviseit/configured-authored-inputs@1' end;
 if expected is null then return new; end if;
 if new.snapshot->>'schema' is distinct from expected
  or new.snapshot->>'module' is distinct from new.module_id or new.snapshot->>'release' is distinct from new.release
 then raise exception 'Catalogue snapshot identity required'; end if;
 select workflow_sha256 into w from private.catalogue_executions
 where module_id=new.module_id and release=new.release and manifest_sha256=new.snapshot->>'manifestSha256';
 if w is null then raise exception 'Connected workflow registration required'; end if;
 -- A circuit line is admitted only with the corrected classification pinned to the
 -- exact form, bundle and workflow; every other circuit line (including every
 -- authored-bundle-v1 line, which pins no classification) stays refused.
 if exists(select 1 from jsonb_array_elements(new.snapshot->'lines') l where
  (new.module_id='caps-grade-11-physical-sciences' and l->>'entryId'='structured:P1-CIRC-01'
   and (new.adapter_key='configured-bundle-v1'
            and private.corrected_circuit_rule(l->'classification'->'payload')
            and l->'classification'->'sourceBinding'=private.line_source_binding(l->'binding',w)) is not true) or
  (new.module_id='caps-grade-10-physical-sciences' and l->>'entryId' in ('structured:P2-CHEM-04','structured:P2-CHEM-05')))
 then raise exception 'Selected item input mapping remains unresolved'; end if;
 select jsonb_build_object('schemaVersion',1,'schoolId',s.id,'schoolName',s.name,'moduleId',new.module_id,
  'revision',coalesce(p.revision,0),'preferences',p.preferences) into f
 from public.schools s left join public.school_formatting p on p.school_id=s.id and p.module_id=new.module_id
 where s.id=new.school_id;
 if f is null then raise exception 'School formatting identity required'; end if;
 new.snapshot:=new.snapshot||jsonb_build_object('execution',jsonb_build_object('workflowManifestSha256',w),'formatting',f);
 return new;
end $$;

revoke all on function private.corrected_circuit_rule(jsonb) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
revoke all on function private.circuit_definition_corrected(text,text,text) from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
