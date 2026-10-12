-- Rollback for 202610080039_studio_foundation.sql. Drops only Curriculum Studio objects; no existing
-- table, function, grant or row is touched. Studio rows (sources, runs, decisions, audit) are lost, so
-- take a backup first and export any evidence that must be kept. R2 objects are NOT deleted by this
-- script; the bucket prefix studio/ is removed separately (and only after the evidence export).
-- After rollback, remove the migration's history record with the same process that applied it.
begin;
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'studio\_%' loop
  execute format('drop function %s cascade', f.sig);
 end loop;
end $$;
-- Full local decommission includes remote provider evidence and later budget evidence; never use this as a financial reset.
drop table if exists private.studio_provider_evidence_parts, private.studio_provider_evidence cascade;
drop table if exists private.studio_budget_receipts, private.studio_budget_reservations,
 private.studio_run_budgets, private.studio_budget_trials, private.studio_budget_contracts cascade;
drop table if exists private.studio_content_judgments, private.studio_decisions, private.studio_changeset_entries, private.studio_gates,
 private.studio_snapshot_acceptances, private.studio_record_links, private.studio_record_index, private.studio_snapshot_files,
 private.studio_events, private.studio_commands, private.studio_gc_claims cascade;
alter table if exists private.studio_snapshots drop constraint if exists studio_snapshots_changeset_fk;
alter table if exists private.studio_modules drop constraint if exists studio_modules_accepted_fk;
drop table if exists private.studio_changesets, private.studio_artifacts, private.studio_provider_operations, private.studio_provider_attempts,
 private.studio_stage_attempts, private.studio_stages, private.studio_run_inputs, private.studio_runs, private.studio_source_files,
 private.studio_source_revisions, private.studio_sources, private.studio_upload_sessions, private.studio_snapshots, private.studio_blobs,
 private.studio_provider_profiles, private.studio_skill_contracts, private.studio_modules, private.studio_subject_adapters,
 private.studio_settings, private.studio_editors cascade;
do $$ begin
 if exists(select 1 from pg_roles where rolname='reviseit_studio_operator') then
  revoke usage on schema public from reviseit_studio_operator;
  drop role reviseit_studio_operator;
 end if;
end $$;
commit;
