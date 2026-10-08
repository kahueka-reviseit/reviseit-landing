begin;
-- Curriculum Studio foundation (assignment 02, contract addendum C1). Additive only: no existing
-- table, function or grant changes. Every Studio object is private.studio_* or public.studio_*.
-- The Mac business bank stays the accepted authority (C01). Storage holds verified immutable copies
-- and proposals; this schema records what was verified, never assumes R2 and Postgres commit together.
-- Rollback: lib/studio/rollback/202610080039_studio_foundation.down.sql (drops only Studio objects).

do $$ begin
 if not exists(select 1 from pg_roles where rolname='reviseit_studio_operator') then
  -- Local operator login for snapshot import, apply receipts and acceptance. Never a browser role.
  create role reviseit_studio_operator nologin;
 end if;
end $$;

-- ───────────────────────────── access and configuration ─────────────────────────────
create table private.studio_editors (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table private.studio_settings (
 id boolean primary key default true check (id),
 max_running integer not null default 2 check (max_running between 0 and 16),
 lease_seconds integer not null default 90 check (lease_seconds between 30 and 600),
 upload_seconds integer not null default 900 check (upload_seconds between 60 and 3600),
 max_upload_bytes bigint not null default 52428800 check (max_upload_bytes between 1 and 52428800)
);
insert into private.studio_settings default values;
create table private.studio_subject_adapters (
 id text primary key check (id ~ '^[a-z0-9-]+@[0-9]+$'),
 validator text not null,
 notes text not null
);
-- Only the existing Physical Sciences structural validator is supported. Other subjects fail explicitly.
insert into private.studio_subject_adapters values
 ('caps-physical-sciences@1','skill-snapshot scripts/validate_bank.py','Physical Sciences identifiers PHYS/CHEM/MCQ and P1/P2 specifications. Structural only.');
create table private.studio_modules (
 module_id text primary key references public.curriculum_modules(id),
 subject_adapter text not null references private.studio_subject_adapters(id),
 accepted_snapshot_id uuid,
 revision integer not null default 1,
 updated_at timestamptz not null default now()
);
create table private.studio_skill_contracts (
 id text primary key check (id ~ '^[a-z0-9-]+@[a-z0-9.-]+$'),
 contract_sha256 text not null check (contract_sha256 ~ '^[a-f0-9]{64}$'),
 skill_sha256 text not null check (skill_sha256 ~ '^[a-f0-9]{64}$'),
 validator_sha256 text not null check (validator_sha256 ~ '^[a-f0-9]{64}$'),
 files jsonb not null,
 created_at timestamptz not null default now()
);
-- The frozen seven-file working-tree snapshot named by C08 (evidence/isolated-checkouts.json).
-- contract_sha256 is SHA-256 of the sorted "path  sha256" lines below, one per line with a trailing newline.
with f(files) as (select '{"SKILL.md":"8f5e59dcbab656af333f23581f5dfcca048141fe1082ed8ba68e4946e3700c1a",
  "references/output-formats.md":"57d502160562a2a98ef0102f6e1e0d22926f1746b4ffd50a0489894583f28871",
  "references/spec-template.md":"36e44e8e2114b19411f649b28fcf6c5d4f97338b27fa644f436a1fc9373f0ee2",
  "references/task-type-template.md":"9edbe6e03bf0b05848344008e3de578440497f8b58885c7385a3f7b31c6fe36f",
  "references/validation-checklist.md":"77da5c6a488f6b9378e51342f67890abd537734c0c691a9ea1a816c356185230",
  "scripts/test_validate_bank.py":"bf663261639eb0d93232a1b45d8d3511aeeca85f5a4b285fae0ce4ae6d25a584",
  "scripts/validate_bank.py":"4c927946377193eca3b7f3558aa2abb590abae0771d5f498a97cb281df50cd7f"}'::jsonb)
insert into private.studio_skill_contracts(id,contract_sha256,skill_sha256,validator_sha256,files)
 select 'past-paper-analysis@2026-10-07',
  encode(sha256(convert_to((select string_agg(key||'  '||value, E'\n' order by key collate "C")||E'\n' from jsonb_each_text(f.files)),'UTF8')),'hex'),
  f.files->>'SKILL.md', f.files->>'scripts/validate_bank.py', f.files from f;
create table private.studio_provider_profiles (
 id text primary key check (id ~ '^[a-z0-9-]+$'),
 mode text not null check (mode in ('mock','live')),
 adapter_version text not null,
 prompt_version text not null,
 enabled boolean not null default false
);
-- Assignment 02 has no provider calls. Live profiles are added later, disabled until authorised.
insert into private.studio_provider_profiles values ('mock-v0','mock','studio-mock@0','none@0',true);

-- ───────────────────────────── bytes: uploads and verified blobs (C02) ─────────────────────────────
create table private.studio_blobs (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint not null check (size_bytes >= 0),
 media_type text not null check (media_type in ('application/pdf','image/png','image/jpeg','image/svg+xml',
  'text/markdown','text/plain','text/x-python','text/csv','application/json','application/octet-stream')),
 immutable_key text not null unique,
 integrity text not null default 'verified' check (integrity in ('verified','missing','inaccessible','corrupt','recovering')),
 integrity_detail text,
 verified_at timestamptz not null default now(),
 checked_at timestamptz,
 created_at timestamptz not null default now(),
 unique (module_id, sha256),
 check (immutable_key = 'studio/blobs/'||module_id||'/'||sha256)
);
create table private.studio_upload_sessions (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 owner uuid not null references auth.users(id),
 provisional_key text not null unique,
 purpose text not null check (purpose in ('source','revision')),
 claimed_sha256 text not null check (claimed_sha256 ~ '^[a-f0-9]{64}$'),
 claimed_size bigint not null check (claimed_size between 1 and 52428800),
 media_type text not null check (media_type in ('application/pdf','image/png','image/jpeg','text/markdown','application/json','text/x-python')),
 original_filename text not null check (length(original_filename) between 1 and 255 and original_filename !~ '[\x01-\x1f/\\]'),
 state text not null default 'open' check (state in ('open','verifying','finalised','rejected','expired')),
 verified_sha256 text check (verified_sha256 ~ '^[a-f0-9]{64}$'),
 target_key text,
 blob_id uuid references private.studio_blobs(id),
 rejection text,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (provisional_key = 'studio/uploads/'||module_id||'/'||id::text),
 check (state <> 'finalised' or blob_id is not null)
);
-- A garbage-collection claim on an object key. Finalisation and output registration refuse a key
-- while it is claimed, and the claim itself refuses keys that have, or are acquiring, a reference.
create table private.studio_gc_claims (
 object_key text primary key,
 claimed_at timestamptz not null default now()
);

-- ───────────────────────────── sources ─────────────────────────────
create table private.studio_sources (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 title text not null check (length(trim(title)) between 3 and 200),
 current_revision integer not null default 1,
 state text not null default 'active' check (state in ('active','retired')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table private.studio_source_revisions (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references private.studio_sources(id),
 revision integer not null check (revision >= 1),
 identity jsonb not null default '{}'::jsonb check (jsonb_typeof(identity)='object'),
 source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
 reason text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (source_id, revision)
);
create table private.studio_source_files (
 source_revision_id uuid not null references private.studio_source_revisions(id),
 blob_id uuid not null references private.studio_blobs(id),
 role text not null check (role in ('question_paper','memorandum','combined','supplement')),
 original_filename text not null check (length(original_filename) between 1 and 255),
 primary key (source_revision_id, blob_id, role)
);

-- ───────────────────────────── bank snapshots (verified copies of the Mac bank) ─────────────────────────────
create table private.studio_snapshots (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
 manifest_blob_id uuid not null references private.studio_blobs(id),
 origin text not null check (origin in ('operator_import','candidate')),
 purpose text not null check (purpose in ('canonical','rehearsal')),
 subject_adapter text not null references private.studio_subject_adapters(id),
 parent_snapshot_id uuid references private.studio_snapshots(id),
 changeset_id uuid,
 file_count integer not null check (file_count >= 0),
 created_by text not null,
 created_at timestamptz not null default now(),
 unique (module_id, manifest_sha256, origin, purpose),
 -- Candidate snapshots exist only for explicitly isolated rehearsal (C01).
 check (origin = 'operator_import' or purpose = 'rehearsal')
);
alter table private.studio_modules add constraint studio_modules_accepted_fk foreign key (accepted_snapshot_id) references private.studio_snapshots(id);
create table private.studio_snapshot_acceptances (
 id bigint generated always as identity primary key,
 module_id text not null references private.studio_modules(module_id),
 snapshot_id uuid not null references private.studio_snapshots(id),
 previous_snapshot_id uuid references private.studio_snapshots(id),
 accepted_by text not null,
 accepted_at timestamptz not null default now()
);
-- Derived projections of a snapshot manifest. Rebuildable from the named manifest bytes; never edited.
create table private.studio_snapshot_files (
 snapshot_id uuid not null references private.studio_snapshots(id),
 path text not null,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 blob_id uuid not null references private.studio_blobs(id),
 primary key (snapshot_id, path)
);
create table private.studio_record_index (
 snapshot_id uuid not null references private.studio_snapshots(id),
 record_kind text not null check (record_kind in ('task_type','task_variant','specification','form_source','index','reference')),
 record_id text not null check (record_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'),
 parent_record_id text not null default '' check (parent_record_id ~ '^([A-Za-z0-9][A-Za-z0-9_.-]{0,159})?$'),
 path text not null,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'active' check (status in ('active','retired')),
 primary key (snapshot_id, record_kind, record_id, parent_record_id),
 -- A variant is identified only together with its parent family.
 check ((record_kind = 'task_variant') = (parent_record_id <> ''))
);
create table private.studio_record_links (
 snapshot_id uuid not null references private.studio_snapshots(id),
 from_kind text not null, from_id text not null,
 to_kind text not null, to_id text not null,
 required boolean not null,
 primary key (snapshot_id, from_kind, from_id, to_kind, to_id)
);

-- ───────────────────────────── runs, pinned inputs and durable stages (C03, C04) ─────────────────────────────
create table private.studio_runs (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 source_id uuid not null references private.studio_sources(id),
 purpose text not null check (purpose in ('canonical','rehearsal')),
 state text not null default 'active' check (state in ('active','completed','cancelled')),
 current_input_revision integer not null default 1,
 idempotency_key uuid not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (module_id, idempotency_key)
);
create table private.studio_run_inputs (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references private.studio_runs(id),
 input_revision integer not null check (input_revision >= 1),
 source_revision_id uuid not null references private.studio_source_revisions(id),
 source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
 snapshot_id uuid not null references private.studio_snapshots(id),
 bank_manifest_sha256 text not null check (bank_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 policy_sha256 text not null check (policy_sha256 ~ '^[a-f0-9]{64}$'),
 skill_contract_id text not null references private.studio_skill_contracts(id),
 skill_sha256 text not null check (skill_sha256 ~ '^[a-f0-9]{64}$'),
 validator_sha256 text not null check (validator_sha256 ~ '^[a-f0-9]{64}$'),
 subject_adapter text not null references private.studio_subject_adapters(id),
 provider_profile_id text not null references private.studio_provider_profiles(id),
 adapter_version text not null,
 prompt_version text not null,
 reason text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (run_id, input_revision)
);
create table private.studio_stages (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 run_id uuid not null references private.studio_runs(id),
 stage_key text not null check (stage_key in ('S1_extract','S2_task_match','S3_spec_match','S4_prioritise','S5_draft','S6_assemble_validate','S7_package')),
 input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
 upstream jsonb not null,
 created_for_input_revision integer not null,
 kind text not null check (kind in ('deterministic','provider')),
 state text not null default 'queued' check (state in ('queued','running','succeeded','failed','uncertain','cancelled','stale','blocked')),
 current_attempt_id uuid,
 attempt_count integer not null default 0,
 max_attempts integer not null default 3 check (max_attempts between 1 and 20),
 blocked_reason text,
 error text,
 queued_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 -- Enqueueing identical inputs returns the same stage (idempotent enqueue and extraction reuse).
 unique (run_id, stage_key, input_digest)
);
create table private.studio_stage_attempts (
 id uuid primary key default gen_random_uuid(),
 stage_id uuid not null references private.studio_stages(id),
 attempt_number integer not null check (attempt_number >= 1),
 worker_id text not null check (worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'),
 lease uuid not null,
 lease_until timestamptz not null,
 state text not null default 'claimed' check (state in ('claimed','completed','failed','lease_expired','uncertain','cancelled','superseded')),
 error text,
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 unique (stage_id, attempt_number)
);
alter table private.studio_stages add constraint studio_stages_attempt_fk foreign key (current_attempt_id) references private.studio_stage_attempts(id);
-- Provider work: logical operation identity, separate numbered attempts, and command idempotency
-- (studio_commands) as a third identity (C03 shape).
create table private.studio_provider_operations (
 id uuid primary key default gen_random_uuid(),
 stage_id uuid not null references private.studio_stages(id),
 operation text not null check (operation ~ '^[a-z0-9_:.-]{1,120}$'),
 logical_key text not null unique check (logical_key ~ '^[a-f0-9]{64}$'),
 request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
 current_attempt_id uuid,
 created_at timestamptz not null default now()
);
create table private.studio_provider_attempts (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references private.studio_provider_operations(id),
 attempt_number integer not null check (attempt_number >= 1),
 stage_attempt_id uuid references private.studio_stage_attempts(id),
 profile_id text not null references private.studio_provider_profiles(id),
 dispatch_state text not null default 'prepared' check (dispatch_state in ('prepared','dispatched','succeeded','failed_before_dispatch','failed','uncertain')),
 provider_request_id text check (length(provider_request_id) <= 200),
 result_digest text check (result_digest ~ '^[a-f0-9]{64}$'),
 usage jsonb,
 possible_charge boolean not null default false,
 late boolean not null default false,
 retry_reason text,
 retried_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 dispatched_at timestamptz,
 settled_at timestamptz,
 unique (operation_id, attempt_number)
);
alter table private.studio_provider_operations add constraint studio_provider_current_fk foreign key (current_attempt_id) references private.studio_provider_attempts(id);

-- ───────────────────────────── revisions, reviews and change sets (C04 to C06) ─────────────────────────────
create table private.studio_artifacts (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references private.studio_runs(id),
 module_id text not null references private.studio_modules(module_id),
 logical_key text not null check (logical_key ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]+){0,4}$' and length(logical_key) <= 300),
 kind text not null check (kind in ('inventory','task_matches','spec_matches','gap_list','draft_record','changeset_manifest','validation_result','package_file','page_text','evidence')),
 revision integer not null check (revision >= 1),
 parent_id uuid references private.studio_artifacts(id),
 blob_id uuid not null references private.studio_blobs(id),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 schema text check (length(schema) <= 120),
 record_kind text check (record_kind in ('task_type','specification','form_source')),
 record_id text check (record_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'),
 parent_record_id text not null default '',
 record_path text,
 stage_id uuid references private.studio_stages(id),
 stage_attempt_id uuid references private.studio_stage_attempts(id),
 provider_attempt_id uuid references private.studio_provider_attempts(id),
 author_kind text not null check (author_kind in ('worker','user')),
 author_id text not null,
 meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta)='object'),
 rationale text,
 state text not null default 'current' check (state in ('current','superseded','discarded')),
 created_at timestamptz not null default now(),
 unique (run_id, logical_key, revision),
 check ((kind = 'draft_record') = (record_kind is not null and record_id is not null and record_path is not null))
);
create unique index studio_artifacts_one_current on private.studio_artifacts(run_id, logical_key) where state = 'current';
create table private.studio_gates (
 run_id uuid not null references private.studio_runs(id),
 gate text not null check (gate in ('G1_inventory','G2_matches','G3_records','G4_content','G5_integration')),
 version integer not null default 0,
 primary key (run_id, gate)
);
create table private.studio_changesets (
 id uuid primary key default gen_random_uuid(),
 module_id text not null references private.studio_modules(module_id),
 run_id uuid references private.studio_runs(id),
 kind text not null check (kind in ('analysis','maintenance')),
 purpose text not null check (purpose in ('canonical','rehearsal')),
 base_snapshot_id uuid not null references private.studio_snapshots(id),
 manifest jsonb not null,
 manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
 stage_id uuid references private.studio_stages(id),
 validation_artifact_id uuid references private.studio_artifacts(id),
 state text not null default 'draft' check (state in ('draft','authorised','applied','already_applied','rejected','superseded')),
 authorised_by uuid references auth.users(id),
 authorised_at timestamptz,
 self_reviewed boolean,
 apply_receipt jsonb,
 created_by text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((kind = 'analysis') = (run_id is not null))
);
alter table private.studio_snapshots add constraint studio_snapshots_changeset_fk foreign key (changeset_id) references private.studio_changesets(id);
create table private.studio_changeset_entries (
 changeset_id uuid not null references private.studio_changesets(id),
 path text not null,
 action text not null check (action in ('add','replace','retire')),
 record_kind text not null check (record_kind in ('task_type','specification','form_source')),
 record_id text not null,
 parent_record_id text not null default '',
 before_sha256 text check (before_sha256 ~ '^[a-f0-9]{64}$'),
 after_sha256 text not null check (after_sha256 ~ '^[a-f0-9]{64}$'),
 after_blob_id uuid not null references private.studio_blobs(id),
 artifact_id uuid references private.studio_artifacts(id),
 primary key (changeset_id, path),
 -- Published files are never deleted by a change set; retirement replaces them with a retired record.
 check ((action = 'add') = (before_sha256 is null))
);
create table private.studio_decisions (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references private.studio_runs(id),
 gate text not null check (gate in ('G1_inventory','G2_matches','G3_records','G4_content','G5_integration')),
 input_revision integer not null,
 outcome text not null check (outcome in ('approved','returned','rejected')),
 bound jsonb not null,
 bound_digest text not null check (bound_digest ~ '^[a-f0-9]{64}$'),
 dependency_digest text not null check (dependency_digest ~ '^[a-f0-9]{64}$'),
 gate_version integer not null,
 reviewer uuid not null references auth.users(id),
 self_reviewed boolean not null,
 rationale text not null check (length(trim(rationale)) between 3 and 4000),
 authorisation jsonb not null,
 items jsonb not null default '[]'::jsonb,
 changeset_id uuid references private.studio_changesets(id),
 invalidated_at timestamptz,
 invalidated_reason text,
 created_at timestamptz not null default now(),
 check ((invalidated_at is null) = (invalidated_reason is null))
);
create unique index studio_decisions_one_live on private.studio_decisions(run_id, gate) where outcome = 'approved' and invalidated_at is null;
create table private.studio_content_judgments (
 id uuid primary key default gen_random_uuid(),
 decision_id uuid not null references private.studio_decisions(id),
 run_id uuid not null references private.studio_runs(id),
 record_kind text not null check (record_kind in ('task_type','specification','form_source')),
 record_id text not null,
 parent_record_id text not null default '',
 aspect text not null check (aspect in ('purpose','method','scope','variant','science_constraints','mark_logic','cognitive','diagram')),
 verdict text not null check (verdict in ('accepted','rejected','unresolved')),
 reason text not null check (length(trim(reason)) between 3 and 2000),
 disposition text check (disposition in ('blocks_integration','scoped_exception')),
 exception_rationale text,
 -- An unresolved judgment must carry a recorded disposition; it never silently becomes approval (C06).
 check ((verdict = 'unresolved') = (disposition is not null)),
 check (disposition is distinct from 'scoped_exception' or length(trim(coalesce(exception_rationale,''))) >= 10)
);

-- ───────────────────────────── audit and command idempotency ─────────────────────────────
create table private.studio_events (
 id bigint generated always as identity primary key,
 module_id text,
 run_id uuid,
 actor_kind text not null check (actor_kind in ('editor','worker','operator','system')),
 actor text not null,
 event text not null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table private.studio_commands (
 actor text not null,
 command_key uuid not null,
 command text not null,
 request_digest text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key (actor, command_key)
);

do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='private' and tablename like 'studio\_%' loop
  execute format('alter table private.%I enable row level security', t);
  execute format('revoke all on private.%I from public, anon, authenticated, service_role, reviseit_studio_operator', t);
 end loop;
end $$;

-- Immutable history: revisions, pins, sources, decisions (except invalidation), events and acceptances.
create function private.studio_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op = 'DELETE' then raise exception 'Studio history is immutable'; end if;
 if tg_table_name = 'studio_decisions' then
  if old.invalidated_at is null and new.invalidated_at is not null
   and (to_jsonb(new) - 'invalidated_at' - 'invalidated_reason') = (to_jsonb(old) - 'invalidated_at' - 'invalidated_reason') then return new; end if;
 elsif tg_table_name = 'studio_artifacts' then
  if (to_jsonb(new) - 'state') = (to_jsonb(old) - 'state')
   and ((old.state = 'current' and new.state in ('superseded','discarded')) or (old.state = 'superseded' and new.state = 'discarded')) then return new; end if;
 end if;
 raise exception 'Studio history is immutable';
end $$;
create trigger studio_immutable before update or delete on private.studio_artifacts for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_decisions for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_run_inputs for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_source_revisions for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_source_files for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_events for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_snapshot_acceptances for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_content_judgments for each row execute function private.studio_immutable();
create trigger studio_immutable before update or delete on private.studio_changeset_entries for each row execute function private.studio_immutable();

-- ───────────────────────────── helpers ─────────────────────────────
create function private.studio_sha(value text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(value,'UTF8')),'hex');
$$;
create function private.studio_is_editor() returns boolean language sql stable security definer set search_path='' as $$
 select private.is_reviewer() and exists(select 1 from private.studio_editors e join auth.users u on u.id=e.user_id
  where e.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
-- Existing administrator access (confirmed account reviewer) plus explicit Studio editor provisioning.
create function private.studio_require_editor() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.studio_is_editor() then raise exception 'Studio editor access required'; end if;
 return auth.uid();
end $$;
create function private.studio_event(p_module text, p_run uuid, p_kind text, p_actor text, p_event text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path='' as $$
 insert into private.studio_events(module_id,run_id,actor_kind,actor,event,detail) values(p_module,p_run,p_kind,p_actor,p_event,coalesce(p_detail,'{}'::jsonb));
$$;
create function private.studio_replay(p_actor text, p_key uuid, p_command text, p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.studio_commands;
begin
 if p_key is null then raise exception 'Command key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reviseit:studio-command:'||p_actor||':'||p_key::text,0));
 select * into c from private.studio_commands where actor=p_actor and command_key=p_key;
 if not found then return null; end if;
 if c.command <> p_command or c.request_digest <> private.studio_sha(p_request::text) then
  raise exception 'Command key reused for a different request';
 end if;
 return c.result;
end $$;
create function private.studio_remember(p_actor text, p_key uuid, p_command text, p_request jsonb, p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 insert into private.studio_commands(actor,command_key,command,request_digest,result) values(p_actor,p_key,p_command,private.studio_sha(p_request::text),p_result);
 return p_result;
end $$;
create function private.studio_key_lock(p_key text) returns void language sql security definer set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended('reviseit:studio-object:'||p_key,0));
$$;
-- Module-relative bank path. Rejects traversal, absolute paths, archive, odd characters (C07).
create function private.studio_safe_path(p_path text, p_kind text default null) returns boolean language sql immutable set search_path='' as $$
 select p_path is not null and length(p_path) <= 300
  and p_path ~ '^data/[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$'
  and p_path !~ '(^|/)\.\.?(/|$)' and p_path !~ '^data/archive(/|$)'
  and (p_kind is null
   or (p_kind = 'task_type' and p_path ~ '^data/task-types/[a-z0-9-]+/[^/]+\.md$')
   or (p_kind = 'specification' and p_path ~ '^data/specs/[a-z0-9-]+/[^/]+\.md$')
   or (p_kind = 'form_source' and p_path ~ '^data/forms/'));
$$;
create function private.studio_blob_ok(p_blob uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.studio_blobs where id=p_blob and integrity='verified');
$$;
create function private.studio_require_blobs(p_blobs uuid[]) returns void language plpgsql stable security definer set search_path='' as $$
declare b record;
begin
 for b in select id,integrity from private.studio_blobs where id=any(p_blobs) and integrity<>'verified' loop
  raise exception 'Integrity blocked: % is %', b.id, b.integrity;
 end loop;
end $$;

-- Level digests: which pinned inputs a stage or review depends on (C04).
-- extract: source bytes, skill, subject adapter, provider adapter/prompt.
-- match: extract + complete bank manifest + policy. Any bank-manifest change invalidates matching.
-- validate: match + validator.
create function private.studio_level_digest(i private.studio_run_inputs, p_level text) returns text language sql stable set search_path='' as $$
 select private.studio_sha(concat_ws('|', 'extract', i.source_digest, i.skill_sha256, i.subject_adapter, i.adapter_version, i.prompt_version,
  case when p_level in ('match','validate') then concat_ws('|','match',i.bank_manifest_sha256,i.policy_sha256) end,
  case when p_level = 'validate' then concat_ws('|','validate',i.validator_sha256) end));
$$;
create function private.studio_stage_level(p_key text) returns text language sql immutable set search_path='' as $$
 select case when p_key in ('S1_extract','G1_inventory') then 'extract'
  when p_key in ('S6_assemble_validate','S7_package','G3_records','G4_content','G5_integration') then 'validate' else 'match' end;
$$;
create function private.studio_gate_index(p_gate text) returns integer language sql immutable set search_path='' as $$
 select array_position(array['G1_inventory','G2_matches','G3_records','G4_content','G5_integration'], p_gate);
$$;
create function private.studio_live_decision(p_run uuid, p_gate text) returns private.studio_decisions language sql stable security definer set search_path='' as $$
 select d.* from private.studio_decisions d join private.studio_runs r on r.id=d.run_id
  join private.studio_run_inputs i on i.run_id=r.id and i.input_revision=r.current_input_revision
  where d.run_id=p_run and d.gate=p_gate and d.outcome='approved' and d.invalidated_at is null
   and d.dependency_digest = private.studio_level_digest(i, private.studio_stage_level(p_gate));
$$;
create function private.studio_artifact_list(p_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'logicalKey',a.logical_key,'sha256',a.sha256,'blobId',a.blob_id) order by a.logical_key collate "C"),'[]'::jsonb)
 from private.studio_artifacts a where a.id=any(p_ids);
$$;
-- Current revisions of every logical key a stage produced (user corrections keep the logical key).
create function private.studio_stage_outputs(p_stage uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(c.id),'{}') from private.studio_artifacts c
 where c.state='current' and (c.run_id,c.logical_key) in (select a.run_id,a.logical_key from private.studio_artifacts a where a.stage_id=p_stage);
$$;
create function private.studio_drafts(p_run uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(id),'{}') from private.studio_artifacts where run_id=p_run and kind='draft_record' and state='current';
$$;

-- The exact upstream evidence a stage consumes, or null when it is not yet runnable.
create function private.studio_stage_upstream(p_run uuid, p_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d private.studio_decisions; s private.studio_stages;
begin
 if p_key = 'S1_extract' then return '[]'::jsonb;
 elsif p_key in ('S2_task_match','S3_spec_match') then d := private.studio_live_decision(p_run,'G1_inventory'); return d.bound;
 elsif p_key = 'S4_prioritise' then d := private.studio_live_decision(p_run,'G2_matches'); return d.bound;
 elsif p_key = 'S5_draft' then
  s := private.studio_current_stage(p_run,'S4_prioritise');
  if s.id is null or s.state <> 'succeeded' then return null; end if;
  return private.studio_artifact_list(private.studio_stage_outputs(s.id));
 elsif p_key = 'S6_assemble_validate' then
  s := private.studio_current_stage(p_run,'S5_draft');
  if s.id is null or s.state <> 'succeeded' then return null; end if;
  return private.studio_artifact_list(private.studio_drafts(p_run));
 elsif p_key = 'S7_package' then d := private.studio_live_decision(p_run,'G4_content'); return d.bound;
 end if;
 raise exception 'Unknown stage';
end $$;
create function private.studio_stage_digest(p_run uuid, p_key text) returns text language plpgsql stable security definer set search_path='' as $$
declare i private.studio_run_inputs; up jsonb;
begin
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and x.input_revision=r.current_input_revision where r.id=p_run;
 up := private.studio_stage_upstream(p_run, p_key);
 if up is null then return null; end if;
 return private.studio_sha(p_key||'|'||private.studio_level_digest(i, private.studio_stage_level(p_key))||'|'||up::text);
end $$;
create function private.studio_current_stage(p_run uuid, p_key text) returns private.studio_stages language plpgsql stable security definer set search_path='' as $$
declare dg text; s private.studio_stages;
begin
 dg := private.studio_stage_digest(p_run, p_key);
 if dg is null then return s; end if;
 select * into s from private.studio_stages where run_id=p_run and stage_key=p_key and input_digest=dg;
 return s;
end $$;
create function private.studio_current_changeset(p_run uuid) returns private.studio_changesets language plpgsql stable security definer set search_path='' as $$
declare s private.studio_stages; c private.studio_changesets;
begin
 s := private.studio_current_stage(p_run,'S6_assemble_validate');
 if s.id is null then return c; end if;
 select * into c from private.studio_changesets where stage_id=s.id and state<>'superseded' order by created_at desc limit 1;
 return c;
end $$;

-- What a gate binds: the exact current revisions the reviewer must have seen.
create function private.studio_gate_binding(p_run uuid, p_gate text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s1 private.studio_stages; s2 private.studio_stages; c private.studio_changesets; ids uuid[];
begin
 if p_gate = 'G1_inventory' then
  s1 := private.studio_current_stage(p_run,'S1_extract');
  if s1.id is null or s1.state<>'succeeded' then return null; end if;
  ids := private.studio_stage_outputs(s1.id);
 elsif p_gate = 'G2_matches' then
  s1 := private.studio_current_stage(p_run,'S2_task_match'); s2 := private.studio_current_stage(p_run,'S3_spec_match');
  if s1.id is null or s2.id is null or s1.state<>'succeeded' or s2.state<>'succeeded' then return null; end if;
  ids := private.studio_stage_outputs(s1.id) || private.studio_stage_outputs(s2.id);
 elsif p_gate in ('G3_records','G4_content') then
  s1 := private.studio_current_stage(p_run,'S6_assemble_validate');
  if s1.id is null or s1.state<>'succeeded' then return null; end if;
  ids := private.studio_drafts(p_run) || private.studio_stage_outputs(s1.id);
 elsif p_gate = 'G5_integration' then
  s1 := private.studio_current_stage(p_run,'S7_package');
  if s1.id is null or s1.state<>'succeeded' then return null; end if;
  s2 := private.studio_current_stage(p_run,'S6_assemble_validate');
  c := private.studio_current_changeset(p_run);
  if c.id is null or s2.id is null then return null; end if;
  -- Integration binds the package, the change set and the validation result it was checked against.
  ids := private.studio_stage_outputs(s1.id) || private.studio_stage_outputs(s2.id);
  return jsonb_build_object('artifacts',private.studio_artifact_list(ids),'changeset',jsonb_build_object('id',c.id,'manifestSha256',c.manifest_sha256));
 else raise exception 'Unknown gate';
 end if;
 return jsonb_build_object('artifacts',private.studio_artifact_list(ids));
end $$;

create function private.studio_invalidate_from(p_run uuid, p_gate text, p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare g text; cur uuid;
begin
 for g in select x from unnest(array['G1_inventory','G2_matches','G3_records','G4_content','G5_integration']) x
  where private.studio_gate_index(x) >= private.studio_gate_index(p_gate) loop
  if exists(select 1 from private.studio_decisions where run_id=p_run and gate=g and outcome='approved' and invalidated_at is null) then
   update private.studio_decisions set invalidated_at=now(), invalidated_reason=p_reason
    where run_id=p_run and gate=g and outcome='approved' and invalidated_at is null;
   update private.studio_gates set version=version+1 where run_id=p_run and gate=g;
   perform private.studio_event((select module_id from private.studio_runs where id=p_run), p_run, 'system', 'studio', 'decision_invalidated', jsonb_build_object('gate',g,'reason',p_reason));
  end if;
 end loop;
 -- G5 is always within the cascade: an authorised change set loses its authorisation. It returns to
 -- draft only when its assembly stage is still current; otherwise it is superseded by newer inputs.
 cur := (private.studio_current_stage(p_run,'S6_assemble_validate')).id;
 update private.studio_changesets set state=case when stage_id is not distinct from cur then 'draft' else 'superseded' end, updated_at=now()
  where run_id=p_run and state in ('draft','authorised') and (state='authorised' or stage_id is distinct from cur);
end $$;

-- Drive the fixed pipeline: S1 G1 (S2 S3) G2 S4 S5 S6 G3 G4 S7 G5. Enqueue the next runnable stage,
-- mark unfinished non-current stages stale, and fence their attempts out.
create function private.studio_advance(p_run uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.studio_runs; step text; dg text; up jsonb; st private.studio_stages; cur uuid[] := '{}';
 blocked boolean := false; pending boolean := false; c private.studio_changesets;
 steps text[] := array['S1_extract','G1_inventory','S2_task_match','S3_spec_match','G2_matches','S4_prioritise','S5_draft','S6_assemble_validate','G3_records','G4_content','S7_package','G5_integration'];
begin
 select * into r from private.studio_runs where id=p_run for update;
 if r.state <> 'active' then return; end if;
 foreach step in array steps loop
  exit when blocked;
  if step like 'G%' then
   if pending then blocked := true; exit; end if;
   if step = 'G5_integration' then
    c := private.studio_current_changeset(p_run);
    continue when c.id is not null and not exists(select 1 from private.studio_changeset_entries where changeset_id=c.id)
     and (private.studio_live_decision(p_run,'G4_content')).id is not null;
   end if;
   if (private.studio_live_decision(p_run, step)).id is null then blocked := true; end if;
  else
   up := private.studio_stage_upstream(p_run, step);
   if up is null then blocked := true; exit; end if;
   dg := private.studio_stage_digest(p_run, step);
   select * into st from private.studio_stages where run_id=p_run and stage_key=step and input_digest=dg for update;
   if not found then
    insert into private.studio_stages(run_id,stage_key,input_digest,upstream,created_for_input_revision,kind,max_attempts)
     values(p_run,step,dg,up,r.current_input_revision,
      case when step in ('S1_extract','S2_task_match','S3_spec_match','S5_draft') then 'provider' else 'deterministic' end, 3)
     returning * into st;
    perform private.studio_event(r.module_id, p_run, 'system', 'studio', 'stage_queued', jsonb_build_object('stage',st.id,'key',step));
   elsif st.state = 'stale' then
    update private.studio_stages set state='queued', current_attempt_id=null, updated_at=now() where id=st.id returning * into st;
   end if;
   cur := cur || st.id;
   if st.state <> 'succeeded' then
    if step = 'S2_task_match' then pending := true; else blocked := true; end if;
   end if;
  end if;
 end loop;
 update private.studio_stage_attempts a set state='superseded', ended_at=now()
  from private.studio_stages s where a.id=s.current_attempt_id and s.run_id=p_run and s.state='running' and not (s.id = any(cur)) and a.state='claimed';
 update private.studio_stages set state='stale', updated_at=now()
  where run_id=p_run and state in ('queued','running','blocked') and not (id = any(cur));
 if not blocked and not pending then
  update private.studio_runs set state='completed', updated_at=now() where id=p_run;
  perform private.studio_event(r.module_id, p_run, 'system', 'studio', 'run_completed', '{}'::jsonb);
 end if;
end $$;

-- Lease expiry. A stage whose attempt dispatched a provider request becomes uncertain; it is never
-- replayed because a lease expired (C03). Deterministic work is requeued within its attempt limit.
create function private.studio_expire_leases() returns integer language plpgsql security definer set search_path='' as $$
declare s record; n integer := 0;
begin
 for s in select st.id stage_id, st.run_id, st.attempt_count, st.max_attempts, a.id attempt_id
  from private.studio_stages st join private.studio_stage_attempts a on a.id=st.current_attempt_id
  where st.state='running' and a.state='claimed' and a.lease_until < now()
  for update of st, a skip locked loop
  n := n + 1;
  if exists(select 1 from private.studio_provider_attempts p where p.stage_attempt_id=s.attempt_id and p.dispatch_state='dispatched') then
   update private.studio_provider_attempts set dispatch_state='uncertain' where stage_attempt_id=s.attempt_id and dispatch_state='dispatched';
   update private.studio_stage_attempts set state='uncertain', ended_at=now(), error='Lease expired after provider dispatch' where id=s.attempt_id;
   update private.studio_stages set state='uncertain', error='Provider outcome uncertain after lease expiry', updated_at=now() where id=s.stage_id;
  else
   update private.studio_stage_attempts set state='lease_expired', ended_at=now() where id=s.attempt_id;
   update private.studio_stages set state=case when s.attempt_count < s.max_attempts then 'queued' else 'failed' end,
    error=case when s.attempt_count < s.max_attempts then null else 'Attempts exhausted after lease expiry' end, updated_at=now() where id=s.stage_id;
  end if;
  perform private.studio_event((select module_id from private.studio_runs where id=s.run_id), s.run_id, 'system', 'studio', 'lease_expired', jsonb_build_object('stage',s.stage_id,'attempt',s.attempt_id));
 end loop;
 return n;
end $$;

-- Stale-writer fence: lease, attempt state, lease time, current attempt and running stage all match.
create function private.studio_fence(p_attempt uuid, p_lease uuid) returns private.studio_stages language plpgsql security definer set search_path='' as $$
declare s private.studio_stages;
begin
 select st.* into s from private.studio_stages st join private.studio_stage_attempts a on a.id=st.current_attempt_id
  join private.studio_runs r on r.id=st.run_id
  where a.id=p_attempt and a.lease=p_lease and a.state='claimed' and a.lease_until > now() and st.state='running' and r.state='active'
  for update of st, a;
 if not found then raise exception 'Studio lease lost'; end if;
 return s;
end $$;

create function public.studio_is_editor() returns boolean language sql stable security definer set search_path='' as $$ select private.studio_is_editor(); $$;

-- ───────────────────────────── editor: uploads (C02) ─────────────────────────────
create function public.studio_create_upload(p_module text, p_sha256 text, p_size bigint, p_media_type text, p_filename text, p_purpose text, p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; sid uuid := gen_random_uuid(); s private.studio_upload_sessions; lim private.studio_settings;
begin
 req := jsonb_build_object('module',p_module,'sha256',p_sha256,'size',p_size,'mediaType',p_media_type,'filename',p_filename,'purpose',p_purpose);
 res := private.studio_replay(me::text, p_command, 'create_upload', req); if res is not null then return res; end if;
 if not exists(select 1 from private.studio_modules where module_id=p_module) then raise exception 'Module not enrolled in Studio'; end if;
 select * into lim from private.studio_settings;
 if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_size is null or p_size < 1 or p_size > lim.max_upload_bytes
  or p_purpose not in ('source','revision')
  or (p_purpose='source' and p_media_type not in ('application/pdf','image/png','image/jpeg'))
  or (p_purpose='revision' and p_media_type not in ('text/markdown','application/json','text/x-python'))
  or p_filename is null or length(p_filename) not between 1 and 255 or p_filename ~ '[\x01-\x1f/\\]' then raise exception 'Invalid upload'; end if;
 -- Every request is its own session, even for identical bytes; a claimed digest reserves nothing.
 insert into private.studio_upload_sessions(id,module_id,owner,provisional_key,purpose,claimed_sha256,claimed_size,media_type,original_filename,expires_at)
  values(sid,p_module,me,'studio/uploads/'||p_module||'/'||sid::text,p_purpose,p_sha256,p_size,p_media_type,p_filename,now()+make_interval(secs=>lim.upload_seconds))
  returning * into s;
 perform private.studio_event(p_module,null,'editor',me::text,'upload_created',jsonb_build_object('session',sid,'claimed',p_sha256));
 return private.studio_remember(me::text,p_command,'create_upload',req,
  jsonb_build_object('sessionId',s.id,'provisionalKey',s.provisional_key,'expiresAt',s.expires_at,'mediaType',s.media_type,'size',s.claimed_size));
end $$;

create function public.studio_upload_session(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); s private.studio_upload_sessions;
begin
 select * into s from private.studio_upload_sessions where id=p_session and owner=me;
 if not found then raise exception 'Upload session not found'; end if;
 return jsonb_build_object('sessionId',s.id,'moduleId',s.module_id,'provisionalKey',s.provisional_key,'state',s.state,'claimedSha256',s.claimed_sha256,
  'claimedSize',s.claimed_size,'mediaType',s.media_type,'expiresAt',s.expires_at,'expired',s.expires_at < now(),'targetKey',s.target_key,'blobId',s.blob_id,'rejection',s.rejection);
end $$;

-- The server has read the provisional bytes and computed their digest, size and detected type.
-- A mismatch rejects the session; a match fixes the distinct immutable target key.
create function public.studio_prepare_commit(p_session uuid, p_sha256 text, p_size bigint, p_detected_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); s private.studio_upload_sessions; target text; b private.studio_blobs;
begin
 select * into s from private.studio_upload_sessions where id=p_session and owner=me for update;
 if not found then raise exception 'Upload session not found'; end if;
 if s.state = 'finalised' then return jsonb_build_object('state','finalised','blobId',s.blob_id,'targetKey',s.target_key); end if;
 if s.state not in ('open','verifying') then raise exception 'Upload session is %', s.state; end if;
 if s.state = 'open' and s.expires_at < now() then
  update private.studio_upload_sessions set state='expired', updated_at=now() where id=s.id;
  return jsonb_build_object('state','expired');
 end if;
 if p_sha256 is distinct from s.claimed_sha256 or p_size is distinct from s.claimed_size or p_detected_type is distinct from s.media_type then
  update private.studio_upload_sessions set state='rejected', verified_sha256=case when p_sha256 ~ '^[a-f0-9]{64}$' then p_sha256 end,
   rejection=case when p_sha256 is distinct from s.claimed_sha256 then 'digest mismatch' when p_size is distinct from s.claimed_size then 'size mismatch' else 'type mismatch' end,
   updated_at=now() where id=s.id;
  perform private.studio_event(s.module_id,null,'editor',me::text,'upload_rejected',jsonb_build_object('session',s.id));
  return jsonb_build_object('state','rejected','reason',(select rejection from private.studio_upload_sessions where id=s.id));
 end if;
 target := 'studio/blobs/'||s.module_id||'/'||p_sha256;
 perform private.studio_key_lock(target);
 if exists(select 1 from private.studio_gc_claims where object_key=target) then raise exception 'Storage cleanup in progress; retry'; end if;
 update private.studio_upload_sessions set state='verifying', verified_sha256=p_sha256, target_key=target, updated_at=now() where id=s.id;
 select * into b from private.studio_blobs where module_id=s.module_id and sha256=p_sha256;
 return jsonb_build_object('state','verifying','targetKey',target,'existingBlob',
  case when b.id is null then null else jsonb_build_object('id',b.id,'integrity',b.integrity) end);
end $$;

-- The server has written (or found and verified) the exact bytes at the immutable key. Deduplicate
-- only verified blobs; finalisation is idempotent for a lost acknowledgement or a database retry.
create function public.studio_commit_upload(p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); s private.studio_upload_sessions; b private.studio_blobs; existed boolean;
begin
 select * into s from private.studio_upload_sessions where id=p_session and owner=me for update;
 if not found then raise exception 'Upload session not found'; end if;
 if s.state = 'finalised' then
  select * into b from private.studio_blobs where id=s.blob_id;
  return jsonb_build_object('state','finalised','blobId',b.id,'sha256',b.sha256,'duplicate',true);
 end if;
 if s.state <> 'verifying' then raise exception 'Upload session is %', s.state; end if;
 perform private.studio_key_lock(s.target_key);
 if exists(select 1 from private.studio_gc_claims where object_key=s.target_key) then raise exception 'Storage cleanup in progress; retry'; end if;
 select * into b from private.studio_blobs where module_id=s.module_id and sha256=s.verified_sha256 for update;
 existed := found;
 if not existed then
  insert into private.studio_blobs(module_id,sha256,size_bytes,media_type,immutable_key) values(s.module_id,s.verified_sha256,s.claimed_size,s.media_type,s.target_key) returning * into b;
 elsif b.size_bytes <> s.claimed_size then raise exception 'Stored blob size conflict';
 elsif b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %; use explicit recovery', b.id, b.integrity;
 end if;
 update private.studio_upload_sessions set state='finalised', blob_id=b.id, updated_at=now() where id=s.id;
 perform private.studio_event(s.module_id,null,'editor',me::text,'upload_finalised',jsonb_build_object('session',s.id,'blob',b.id,'duplicate',existed));
 return jsonb_build_object('state','finalised','blobId',b.id,'sha256',b.sha256,'duplicate',existed);
end $$;

-- ───────────────────────────── editor: controlled reads, integrity and explicit recovery ─────────────────────────────
create function public.studio_read_blob(p_blob uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); b private.studio_blobs;
begin
 select * into b from private.studio_blobs where id=p_blob;
 if not found then raise exception 'Blob not found'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 return jsonb_build_object('blobId',b.id,'moduleId',b.module_id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type);
end $$;
create function public.studio_read_artifact(p_artifact uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); a private.studio_artifacts; b private.studio_blobs;
begin
 select * into a from private.studio_artifacts where id=p_artifact;
 if not found then raise exception 'Revision not found'; end if;
 select * into b from private.studio_blobs where id=a.blob_id;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 return jsonb_build_object('id',a.id,'runId',a.run_id,'moduleId',a.module_id,'logicalKey',a.logical_key,'kind',a.kind,'revision',a.revision,
  'state',a.state,'sha256',a.sha256,'key',b.immutable_key,'size',b.size_bytes,'mediaType',b.media_type,'schema',a.schema,
  'record',case when a.record_kind is null then null else jsonb_build_object('moduleId',a.module_id,'kind',a.record_kind,'id',a.record_id,'parentId',nullif(a.parent_record_id,''),'path',a.record_path) end,
  'author',jsonb_build_object('kind',a.author_kind,'id',a.author_id),'parentId',a.parent_id,'meta',a.meta,'blobId',b.id);
end $$;
create function private.studio_set_integrity(p_blob uuid, p_state text, p_detail text, p_kind text, p_actor text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.studio_blobs;
begin
 if p_state not in ('missing','inaccessible','corrupt') then raise exception 'Invalid integrity state'; end if;
 update private.studio_blobs set integrity=p_state, integrity_detail=left(p_detail,500), checked_at=now() where id=p_blob and integrity in ('verified',p_state) returning * into b;
 if not found then
  select * into b from private.studio_blobs where id=p_blob;
  if not found then raise exception 'Blob not found'; end if;
 end if;
 perform private.studio_event(b.module_id,null,p_kind,p_actor,'integrity_reported',jsonb_build_object('blob',p_blob,'state',p_state));
 return jsonb_build_object('blobId',b.id,'integrity',b.integrity);
end $$;
create function public.studio_report_integrity(p_blob uuid, p_state text, p_detail text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor();
begin return private.studio_set_integrity(p_blob,p_state,p_detail,'editor',me::text); end $$;
create function public.studio_worker_report_integrity(p_blob uuid, p_state text, p_detail text) returns jsonb language plpgsql security definer set search_path='' as $$
begin return private.studio_set_integrity(p_blob,p_state,p_detail,'worker','gateway'); end $$;
-- Recovery restores verified bytes for an integrity failure. It is an explicit, audited command;
-- ordinary finalisation never overwrites differing bytes.
create function public.studio_begin_recovery(p_blob uuid, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); b private.studio_blobs;
begin
 if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'Recovery reason required'; end if;
 select * into b from private.studio_blobs where id=p_blob for update;
 if not found then raise exception 'Blob not found'; end if;
 if b.integrity not in ('missing','inaccessible','corrupt','recovering') then raise exception 'Blob does not need recovery'; end if;
 perform private.studio_key_lock(b.immutable_key);
 update private.studio_blobs set integrity='recovering', integrity_detail=left(p_reason,500) where id=b.id;
 perform private.studio_event(b.module_id,null,'editor',me::text,'recovery_started',jsonb_build_object('blob',b.id,'previous',b.integrity,'reason',p_reason));
 return jsonb_build_object('blobId',b.id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes);
end $$;
create function public.studio_complete_recovery(p_blob uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); b private.studio_blobs;
begin
 update private.studio_blobs set integrity='verified', integrity_detail=null, verified_at=now(), checked_at=now() where id=p_blob and integrity='recovering' returning * into b;
 if not found then raise exception 'Blob is not being recovered'; end if;
 perform private.studio_event(b.module_id,null,'editor',me::text,'recovery_completed',jsonb_build_object('blob',b.id));
 return jsonb_build_object('blobId',b.id,'integrity',b.integrity);
end $$;

-- ───────────────────────────── editor: sources ─────────────────────────────
create function private.studio_source_files_from(p_module text, p_files jsonb) returns table(blob_id uuid, role text, filename text, sha256 text)
language plpgsql stable security definer set search_path='' as $$
declare f jsonb; b private.studio_blobs;
begin
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 8 then raise exception 'Invalid source files'; end if;
 for f in select * from jsonb_array_elements(p_files) loop
  select * into b from private.studio_blobs where id=(f->>'blobId')::uuid and module_id=p_module;
  if not found then raise exception 'Source file not found in this module'; end if;
  if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
  if b.media_type not in ('application/pdf','image/png','image/jpeg') or f->>'role' not in ('question_paper','memorandum','combined','supplement')
   or length(coalesce(f->>'filename','')) not between 1 and 255 then raise exception 'Invalid source files'; end if;
  blob_id := b.id; role := f->>'role'; filename := f->>'filename'; sha256 := b.sha256; return next;
 end loop;
end $$;
create function public.studio_create_source(p_module text, p_title text, p_files jsonb, p_identity jsonb, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; src private.studio_sources; rev private.studio_source_revisions; dg text;
begin
 req := jsonb_build_object('module',p_module,'title',p_title,'files',p_files,'identity',p_identity);
 res := private.studio_replay(me::text,p_command,'create_source',req); if res is not null then return res; end if;
 if not exists(select 1 from private.studio_modules where module_id=p_module) then raise exception 'Module not enrolled in Studio'; end if;
 if jsonb_typeof(coalesce(p_identity,'{}'::jsonb)) <> 'object' then raise exception 'Invalid identity'; end if;
 select private.studio_sha(string_agg(f.role||':'||f.sha256, E'\n' order by f.role, f.sha256)) into dg from private.studio_source_files_from(p_module,p_files) f;
 insert into private.studio_sources(module_id,title,created_by) values(p_module,p_title,me) returning * into src;
 insert into private.studio_source_revisions(source_id,revision,identity,source_digest,reason,created_by) values(src.id,1,coalesce(p_identity,'{}'::jsonb),dg,'created',me) returning * into rev;
 insert into private.studio_source_files select rev.id,f.blob_id,f.role,f.filename from private.studio_source_files_from(p_module,p_files) f;
 perform private.studio_event(p_module,null,'editor',me::text,'source_created',jsonb_build_object('source',src.id,'digest',dg));
 return private.studio_remember(me::text,p_command,'create_source',req,jsonb_build_object('sourceId',src.id,'revision',1,'revisionId',rev.id,'sourceDigest',dg));
end $$;
create function public.studio_revise_source(p_source uuid, p_expected_revision integer, p_files jsonb, p_identity jsonb, p_reason text, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; src private.studio_sources; rev private.studio_source_revisions; dg text;
begin
 req := jsonb_build_object('source',p_source,'expected',p_expected_revision,'files',p_files,'identity',p_identity,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'revise_source',req); if res is not null then return res; end if;
 select * into src from private.studio_sources where id=p_source for update;
 if not found then raise exception 'Source not found'; end if;
 if src.current_revision <> p_expected_revision then raise exception 'Source changed'; end if;
 if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Revision reason required'; end if;
 select private.studio_sha(string_agg(f.role||':'||f.sha256, E'\n' order by f.role, f.sha256)) into dg from private.studio_source_files_from(src.module_id,p_files) f;
 insert into private.studio_source_revisions(source_id,revision,identity,source_digest,reason,created_by)
  values(src.id,src.current_revision+1,coalesce(p_identity,'{}'::jsonb),dg,p_reason,me) returning * into rev;
 insert into private.studio_source_files select rev.id,f.blob_id,f.role,f.filename from private.studio_source_files_from(src.module_id,p_files) f;
 update private.studio_sources set current_revision=rev.revision, updated_at=now() where id=src.id;
 perform private.studio_event(src.module_id,null,'editor',me::text,'source_revised',jsonb_build_object('source',src.id,'revision',rev.revision,'digest',dg));
 return private.studio_remember(me::text,p_command,'revise_source',req,jsonb_build_object('sourceId',src.id,'revision',rev.revision,'revisionId',rev.id,'sourceDigest',dg));
end $$;

-- ───────────────────────────── editor: runs, rebase, retry and cancellation ─────────────────────────────
create function private.studio_check_snapshot_for(p_module text, p_purpose text, p_snapshot uuid) returns private.studio_snapshots
language plpgsql stable security definer set search_path='' as $$
declare s private.studio_snapshots; m private.studio_modules;
begin
 select * into m from private.studio_modules where module_id=p_module;
 select * into s from private.studio_snapshots where id=p_snapshot and module_id=p_module;
 if not found then raise exception 'Snapshot not found in this module'; end if;
 if p_purpose = 'canonical' and m.accepted_snapshot_id is distinct from s.id then raise exception 'Canonical runs must pin the current accepted bank snapshot'; end if;
 if p_purpose = 'canonical' and (s.origin <> 'operator_import' or s.purpose <> 'canonical') then raise exception 'Canonical runs cannot use a rehearsal snapshot'; end if;
 perform private.studio_require_blobs(array[s.manifest_blob_id]);
 return s;
end $$;
create function private.studio_build_inputs(p_run uuid, p_revision integer, p_source_revision uuid, p_snapshot uuid, p_skill text, p_profile text, p_reason text, p_actor uuid)
returns private.studio_run_inputs language plpgsql security definer set search_path='' as $$
declare r private.studio_runs; sr private.studio_source_revisions; s private.studio_snapshots; k private.studio_skill_contracts; p private.studio_provider_profiles;
 policy text; i private.studio_run_inputs;
begin
 select * into r from private.studio_runs where id=p_run;
 select * into sr from private.studio_source_revisions where id=p_source_revision and source_id=r.source_id;
 if not found then raise exception 'Source revision not found for this run'; end if;
 perform private.studio_require_blobs(array(select blob_id from private.studio_source_files where source_revision_id=sr.id));
 s := private.studio_check_snapshot_for(r.module_id, r.purpose, p_snapshot);
 select * into k from private.studio_skill_contracts where id=p_skill;
 if not found then raise exception 'Skill contract not registered'; end if;
 select * into p from private.studio_provider_profiles where id=p_profile and enabled;
 if not found then raise exception 'Provider profile not enabled'; end if;
 select sha256 into policy from private.studio_snapshot_files where snapshot_id=s.id and path='data/reference/curriculum-policy.md';
 if policy is null then raise exception 'Snapshot has no curriculum policy file'; end if;
 insert into private.studio_run_inputs(run_id,input_revision,source_revision_id,source_digest,snapshot_id,bank_manifest_sha256,policy_sha256,skill_contract_id,
  skill_sha256,validator_sha256,subject_adapter,provider_profile_id,adapter_version,prompt_version,reason,created_by)
  values(r.id,p_revision,sr.id,sr.source_digest,s.id,s.manifest_sha256,policy,k.id,k.skill_sha256,k.validator_sha256,s.subject_adapter,p.id,p.adapter_version,p.prompt_version,p_reason,p_actor)
  returning * into i;
 return i;
end $$;
create function public.studio_start_run(p_source uuid, p_expected_source_revision integer, p_purpose text, p_snapshot uuid, p_skill_contract text, p_profile text, p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; src private.studio_sources; r private.studio_runs; i private.studio_run_inputs; m private.studio_modules;
begin
 req := jsonb_build_object('source',p_source,'expected',p_expected_source_revision,'purpose',p_purpose,'snapshot',p_snapshot,'skill',p_skill_contract,'profile',p_profile);
 res := private.studio_replay(me::text,p_command,'start_run',req); if res is not null then return res; end if;
 if p_purpose not in ('canonical','rehearsal') then raise exception 'Run purpose must be canonical or rehearsal'; end if;
 select * into src from private.studio_sources where id=p_source and state='active';
 if not found then raise exception 'Source not found'; end if;
 if src.current_revision <> p_expected_source_revision then raise exception 'Source changed'; end if;
 select * into m from private.studio_modules where module_id=src.module_id;
 insert into private.studio_runs(module_id,source_id,purpose,idempotency_key,created_by) values(src.module_id,src.id,p_purpose,p_command,me) returning * into r;
 i := private.studio_build_inputs(r.id,1,(select id from private.studio_source_revisions where source_id=src.id and revision=src.current_revision),p_snapshot,p_skill_contract,p_profile,'started',me);
 insert into private.studio_gates(run_id,gate) select r.id,g from unnest(array['G1_inventory','G2_matches','G3_records','G4_content','G5_integration']) g;
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'run_started',jsonb_build_object('purpose',p_purpose,'inputs',i.id,'snapshot',i.snapshot_id));
 perform private.studio_advance(r.id);
 return private.studio_remember(me::text,p_command,'start_run',req,jsonb_build_object('runId',r.id,'inputRevision',1,'purpose',r.purpose));
end $$;

-- A correction or rebase creates a new immutable input revision. Old pins and decisions remain as
-- history; decisions whose dependencies changed are explicitly invalidated, never left looking current.
create function public.studio_rebase_run(p_run uuid, p_expected_input_revision integer, p_source_revision uuid, p_snapshot uuid, p_skill_contract text, p_profile text, p_reason text, p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs; old private.studio_run_inputs; i private.studio_run_inputs; g text; d private.studio_decisions; invalid text[] := '{}';
begin
 req := jsonb_build_object('run',p_run,'expected',p_expected_input_revision,'source',p_source_revision,'snapshot',p_snapshot,'skill',p_skill_contract,'profile',p_profile,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'rebase_run',req); if res is not null then return res; end if;
 select * into r from private.studio_runs where id=p_run for update;
 if not found then raise exception 'Run not found'; end if;
 if r.state <> 'active' then raise exception 'Run is %', r.state; end if;
 if r.current_input_revision <> p_expected_input_revision then raise exception 'Run changed'; end if;
 if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Rebase reason required'; end if;
 select * into old from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 i := private.studio_build_inputs(r.id, r.current_input_revision+1, coalesce(p_source_revision,old.source_revision_id), coalesce(p_snapshot,old.snapshot_id),
  coalesce(p_skill_contract,old.skill_contract_id), coalesce(p_profile,old.provider_profile_id), p_reason, me);
 if private.studio_level_digest(i,'validate') = private.studio_level_digest(old,'validate') then raise exception 'No pinned input changed'; end if;
 update private.studio_runs set current_input_revision=i.input_revision, updated_at=now() where id=r.id;
 foreach g in array array['G1_inventory','G2_matches','G3_records','G4_content','G5_integration'] loop
  select * into d from private.studio_decisions where run_id=r.id and gate=g and outcome='approved' and invalidated_at is null;
  if found and d.dependency_digest <> private.studio_level_digest(i, private.studio_stage_level(g)) then
   perform private.studio_invalidate_from(r.id, g, 'Pinned inputs changed in revision '||i.input_revision);
   invalid := invalid || g; exit;
  end if;
 end loop;
 -- Any matching-level change also supersedes an unauthorised or authorised change set from older pins.
 if private.studio_level_digest(i,'match') <> private.studio_level_digest(old,'match') then
  update private.studio_changesets set state='superseded', updated_at=now() where run_id=r.id and state in ('draft','authorised');
 end if;
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'run_rebased',jsonb_build_object('from',old.input_revision,'to',i.input_revision,'invalidatedFrom',invalid,'reason',p_reason));
 perform private.studio_advance(r.id);
 return private.studio_remember(me::text,p_command,'rebase_run',req,jsonb_build_object('runId',r.id,'inputRevision',i.input_revision,'invalidatedFrom',to_jsonb(invalid)));
end $$;

create function public.studio_cancel_stage(p_stage uuid, p_reason text, p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; s private.studio_stages; r private.studio_runs;
begin
 req := jsonb_build_object('stage',p_stage,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'cancel_stage',req); if res is not null then return res; end if;
 select * into s from private.studio_stages where id=p_stage for update;
 if not found then raise exception 'Stage not found'; end if;
 if s.state not in ('queued','running','blocked') then raise exception 'Stage is %', s.state; end if;
 select * into r from private.studio_runs where id=s.run_id;
 update private.studio_stage_attempts set state='cancelled', ended_at=now() where id=s.current_attempt_id and state='claimed';
 update private.studio_stages set state='cancelled', error=left(coalesce(p_reason,'cancelled'),500), updated_at=now() where id=s.id;
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'stage_cancelled',jsonb_build_object('stage',s.id,'reason',p_reason));
 return private.studio_remember(me::text,p_command,'cancel_stage',req,jsonb_build_object('stageId',s.id,'state','cancelled'));
end $$;
create function public.studio_cancel_run(p_run uuid, p_reason text, p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs;
begin
 req := jsonb_build_object('run',p_run,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'cancel_run',req); if res is not null then return res; end if;
 select * into r from private.studio_runs where id=p_run for update;
 if not found then raise exception 'Run not found'; end if;
 if r.state <> 'active' then raise exception 'Run is %', r.state; end if;
 update private.studio_stage_attempts a set state='cancelled', ended_at=now() from private.studio_stages s where s.run_id=r.id and a.id=s.current_attempt_id and a.state='claimed';
 update private.studio_stages set state='cancelled', updated_at=now() where run_id=r.id and state in ('queued','running','blocked');
 update private.studio_runs set state='cancelled', updated_at=now() where id=r.id;
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'run_cancelled',jsonb_build_object('reason',p_reason));
 return private.studio_remember(me::text,p_command,'cancel_run',req,jsonb_build_object('runId',r.id,'state','cancelled'));
end $$;

create function private.studio_next_provider_attempt(p_op uuid, p_expected integer, p_reason text, p_actor uuid) returns private.studio_provider_attempts
language plpgsql security definer set search_path='' as $$
declare op private.studio_provider_operations; cur private.studio_provider_attempts; nxt private.studio_provider_attempts;
begin
 select * into op from private.studio_provider_operations where id=p_op for update;
 if not found then raise exception 'Provider operation not found'; end if;
 select * into cur from private.studio_provider_attempts where id=op.current_attempt_id;
 if cur.attempt_number <> p_expected then raise exception 'Provider operation changed'; end if;
 if cur.dispatch_state not in ('uncertain','failed','failed_before_dispatch','dispatched') then raise exception 'Provider attempt is %, not retryable', cur.dispatch_state; end if;
 -- The earlier attempt, its evidence and any possible charge are retained.
 if cur.dispatch_state = 'dispatched' then update private.studio_provider_attempts set dispatch_state='uncertain' where id=cur.id; end if;
 insert into private.studio_provider_attempts(operation_id,attempt_number,profile_id,retry_reason,retried_by)
  values(op.id,cur.attempt_number+1,cur.profile_id,p_reason,p_actor) returning * into nxt;
 update private.studio_provider_operations set current_attempt_id=nxt.id where id=op.id;
 return nxt;
end $$;
create function public.studio_retry_provider_operation(p_operation uuid, p_expected_attempt integer, p_reason text, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; nxt private.studio_provider_attempts; s private.studio_stages;
begin
 req := jsonb_build_object('operation',p_operation,'expected',p_expected_attempt,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'retry_provider',req); if res is not null then return res; end if;
 if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'Retry reason required'; end if;
 select st.* into s from private.studio_stages st join private.studio_provider_operations o on o.stage_id=st.id where o.id=p_operation for update of st;
 if s.state = 'running' then raise exception 'Stage is running'; end if;
 nxt := private.studio_next_provider_attempt(p_operation,p_expected_attempt,p_reason,me);
 perform private.studio_event((select module_id from private.studio_runs where id=s.run_id),s.run_id,'editor',me::text,'provider_retry',jsonb_build_object('operation',p_operation,'attempt',nxt.attempt_number,'reason',p_reason));
 return private.studio_remember(me::text,p_command,'retry_provider',req,jsonb_build_object('operationId',p_operation,'attemptId',nxt.id,'attemptNumber',nxt.attempt_number));
end $$;
-- Explicit stage retry. For uncertain or failed provider work it creates the next provider attempt
-- for each unsettled operation, keeping the earlier uncertain attempt and its possible charge.
create function public.studio_retry_stage(p_stage uuid, p_expected_attempts integer, p_reason text, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; s private.studio_stages; cur private.studio_stages; op record; retried jsonb := '[]'::jsonb; nxt private.studio_provider_attempts;
begin
 req := jsonb_build_object('stage',p_stage,'expected',p_expected_attempts,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'retry_stage',req); if res is not null then return res; end if;
 if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'Retry reason required'; end if;
 select * into s from private.studio_stages where id=p_stage for update;
 if not found then raise exception 'Stage not found'; end if;
 if s.attempt_count <> p_expected_attempts then raise exception 'Stage changed'; end if;
 if s.state not in ('failed','uncertain','cancelled','blocked') then raise exception 'Stage is %, not retryable', s.state; end if;
 if (select state from private.studio_runs where id=s.run_id) <> 'active' then raise exception 'Run is not active'; end if;
 cur := private.studio_current_stage(s.run_id, s.stage_key);
 if cur.id is distinct from s.id then raise exception 'Stage is stale; its inputs changed'; end if;
 for op in select o.id, a.attempt_number from private.studio_provider_operations o join private.studio_provider_attempts a on a.id=o.current_attempt_id
  where o.stage_id=s.id and a.dispatch_state in ('dispatched','uncertain','failed','failed_before_dispatch') loop
  nxt := private.studio_next_provider_attempt(op.id, op.attempt_number, p_reason, me);
  retried := retried || jsonb_build_object('operationId',op.id,'attemptNumber',nxt.attempt_number);
 end loop;
 update private.studio_stages set state='queued', error=null, max_attempts=greatest(max_attempts, attempt_count+1), current_attempt_id=null, updated_at=now() where id=s.id;
 perform private.studio_event((select module_id from private.studio_runs where id=s.run_id),s.run_id,'editor',me::text,'stage_retry',jsonb_build_object('stage',s.id,'reason',p_reason,'providerAttempts',retried));
 return private.studio_remember(me::text,p_command,'retry_stage',req,jsonb_build_object('stageId',s.id,'state','queued','providerAttempts',retried));
end $$;

-- ───────────────────────────── editor: revisions and record CRUD ─────────────────────────────
-- Invalidate the earliest live gate whose binding contains any of the given revisions.
create function private.studio_invalidate_binding(p_run uuid, p_ids uuid[], p_reason text) returns text language plpgsql security definer set search_path='' as $$
declare g text;
begin
 for g in select gate from private.studio_decisions d where d.run_id=p_run and d.outcome='approved' and d.invalidated_at is null
  and exists(select 1 from jsonb_array_elements(coalesce(d.bound->'artifacts','[]'::jsonb)) x where (x->>'id')::uuid = any(p_ids))
  order by private.studio_gate_index(gate) limit 1 loop
  perform private.studio_invalidate_from(p_run, g, p_reason);
  return g;
 end loop;
 return null;
end $$;
create function public.studio_revise_artifact(p_artifact uuid, p_blob uuid, p_rationale text, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; a private.studio_artifacts; b private.studio_blobs; n private.studio_artifacts; r private.studio_runs; g text;
begin
 req := jsonb_build_object('artifact',p_artifact,'blob',p_blob,'rationale',p_rationale);
 res := private.studio_replay(me::text,p_command,'revise_artifact',req); if res is not null then return res; end if;
 select * into a from private.studio_artifacts where id=p_artifact;
 if not found then raise exception 'Revision not found'; end if;
 select * into r from private.studio_runs where id=a.run_id for update;
 if r.state <> 'active' then raise exception 'Run is %', r.state; end if;
 select * into a from private.studio_artifacts where id=p_artifact for update;
 if a.state <> 'current' then raise exception 'Revision changed'; end if;
 if a.kind not in ('inventory','task_matches','spec_matches','gap_list','draft_record','evidence') then raise exception 'Derived outputs are rebuilt, not edited'; end if;
 if length(trim(coalesce(p_rationale,''))) < 3 then raise exception 'Revision rationale required'; end if;
 select * into b from private.studio_blobs where id=p_blob and module_id=a.module_id;
 if not found then raise exception 'Revision bytes not found in this module'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 if b.sha256 = a.sha256 then raise exception 'Revision has identical bytes'; end if;
 update private.studio_artifacts set state='superseded' where id=a.id;
 insert into private.studio_artifacts(run_id,module_id,logical_key,kind,revision,parent_id,blob_id,sha256,schema,record_kind,record_id,parent_record_id,record_path,stage_id,author_kind,author_id,meta,rationale)
  values(a.run_id,a.module_id,a.logical_key,a.kind,a.revision+1,a.id,b.id,b.sha256,a.schema,a.record_kind,a.record_id,a.parent_record_id,a.record_path,a.stage_id,'user',me::text,'{}'::jsonb,p_rationale)
  returning * into n;
 g := private.studio_invalidate_binding(a.run_id, array[a.id], 'Revision '||a.logical_key||' corrected');
 if a.kind = 'draft_record' and g is null then perform private.studio_invalidate_from(a.run_id,'G3_records','Draft '||a.logical_key||' corrected'); end if;
 perform private.studio_event(a.module_id,a.run_id,'editor',me::text,'revision_created',jsonb_build_object('logicalKey',a.logical_key,'from',a.id,'to',n.id,'invalidatedFrom',g));
 perform private.studio_advance(a.run_id);
 return private.studio_remember(me::text,p_command,'revise_artifact',req,jsonb_build_object('artifactId',n.id,'revision',n.revision,'invalidatedFrom',g));
end $$;
-- Create a record proposal. Identity is (module, record kind, record id, parent id); an existing record
-- must resolve in the run's pinned snapshot at the same path, a new record must not collide.
create function public.studio_create_draft(p_run uuid, p_record_kind text, p_record_id text, p_parent_record_id text, p_path text, p_blob uuid, p_rationale text, p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs; i private.studio_run_inputs; b private.studio_blobs; idx private.studio_record_index; n private.studio_artifacts; lk text;
begin
 req := jsonb_build_object('run',p_run,'kind',p_record_kind,'id',p_record_id,'parent',p_parent_record_id,'path',p_path,'blob',p_blob,'rationale',p_rationale);
 res := private.studio_replay(me::text,p_command,'create_draft',req); if res is not null then return res; end if;
 select * into r from private.studio_runs where id=p_run for update;
 if not found then raise exception 'Run not found'; end if;
 if r.state <> 'active' then raise exception 'Run is %', r.state; end if;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 if p_record_kind not in ('task_type','specification','form_source') or p_record_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'
  or coalesce(p_parent_record_id,'') !~ '^([A-Za-z0-9][A-Za-z0-9_.-]{0,159})?$' then raise exception 'Invalid record identity'; end if;
 if not private.studio_safe_path(p_path, p_record_kind) then raise exception 'Unsafe or out-of-scope record path'; end if;
 select * into b from private.studio_blobs where id=p_blob and module_id=r.module_id;
 if not found then raise exception 'Record bytes not found in this module'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 select * into idx from private.studio_record_index where snapshot_id=i.snapshot_id and record_kind=p_record_kind and record_id=p_record_id and parent_record_id=coalesce(p_parent_record_id,'');
 if found and idx.path <> p_path then raise exception 'Record % resolves to a different path in the pinned snapshot', p_record_id; end if;
 if not found and exists(select 1 from private.studio_snapshot_files where snapshot_id=i.snapshot_id and path=p_path) then raise exception 'Path already holds another record'; end if;
 lk := 'record:'||p_record_kind||':'||p_record_id||case when coalesce(p_parent_record_id,'')<>'' then ':'||p_parent_record_id else '' end;
 if exists(select 1 from private.studio_artifacts where run_id=r.id and logical_key=lk and state='current') then raise exception 'A current proposal for this record exists; revise it instead'; end if;
 insert into private.studio_artifacts(run_id,module_id,logical_key,kind,revision,blob_id,sha256,schema,record_kind,record_id,parent_record_id,record_path,author_kind,author_id,rationale)
  values(r.id,r.module_id,lk,'draft_record',coalesce((select max(revision) from private.studio_artifacts where run_id=r.id and logical_key=lk),0)+1,
   b.id,b.sha256,'reviseit/bank-record-markdown@1',p_record_kind,p_record_id,coalesce(p_parent_record_id,''),p_path,'user',me::text,p_rationale)
  returning * into n;
 perform private.studio_invalidate_from(r.id,'G3_records','Draft '||lk||' added');
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'draft_created',jsonb_build_object('artifact',n.id,'logicalKey',lk));
 perform private.studio_advance(r.id);
 return private.studio_remember(me::text,p_command,'create_draft',req,jsonb_build_object('artifactId',n.id,'logicalKey',lk,'revision',n.revision));
end $$;
-- Discard an unreferenced draft. Bytes are retained until a separate retention protocol.
create function public.studio_discard_draft(p_artifact uuid, p_reason text, p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; a private.studio_artifacts; r private.studio_runs;
begin
 req := jsonb_build_object('artifact',p_artifact,'reason',p_reason);
 res := private.studio_replay(me::text,p_command,'discard_draft',req); if res is not null then return res; end if;
 select * into a from private.studio_artifacts where id=p_artifact;
 if not found then raise exception 'Revision not found'; end if;
 select * into r from private.studio_runs where id=a.run_id for update;
 select * into a from private.studio_artifacts where id=p_artifact for update;
 if a.kind <> 'draft_record' then raise exception 'Only drafts can be discarded'; end if;
 if a.state = 'discarded' then raise exception 'Draft already discarded'; end if;
 if exists(select 1 from private.studio_decisions d where d.run_id=a.run_id and exists(select 1 from jsonb_array_elements(coalesce(d.bound->'artifacts','[]'::jsonb)) x where (x->>'id')::uuid=a.id))
  or exists(select 1 from private.studio_changeset_entries where artifact_id=a.id) then
  raise exception 'Draft is referenced by a review or change set and cannot be discarded';
 end if;
 update private.studio_artifacts set state='discarded' where id=a.id;
 if a.state = 'current' then perform private.studio_invalidate_from(a.run_id,'G3_records','Draft '||a.logical_key||' discarded'); end if;
 perform private.studio_event(a.module_id,a.run_id,'editor',me::text,'draft_discarded',jsonb_build_object('artifact',a.id,'reason',p_reason));
 perform private.studio_advance(a.run_id);
 return private.studio_remember(me::text,p_command,'discard_draft',req,jsonb_build_object('artifactId',a.id,'state','discarded'));
end $$;

-- ───────────────────────────── change sets (C05 to C07) ─────────────────────────────
-- Validates entries against the pinned base snapshot: module-relative safe paths, exact base digests,
-- identity resolution scoped to the module snapshot, no deletion, and required-reference protection.
create function private.studio_check_entries(p_module text, p_snapshot uuid, p_entries jsonb) returns table(
 path text, action text, record_kind text, record_id text, parent_record_id text, before_sha256 text, after_sha256 text, after_blob_id uuid, artifact_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare e jsonb; b private.studio_blobs; idx private.studio_record_index; f private.studio_snapshot_files; seen text[] := '{}'; retiring text[] := '{}'; l record;
begin
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) > 500 then raise exception 'Invalid change set entries'; end if;
 for e in select * from jsonb_array_elements(p_entries) loop
  if e->>'action' = 'retire' then retiring := retiring || ((e->>'recordKind')||':'||(e->>'recordId')); end if;
 end loop;
 for e in select * from jsonb_array_elements(p_entries) loop
  path := e->>'path'; action := e->>'action'; record_kind := e->>'recordKind'; record_id := e->>'recordId'; parent_record_id := coalesce(e->>'parentRecordId','');
  artifact_id := nullif(e->>'artifactId','')::uuid;
  if action not in ('add','replace','retire') then raise exception 'Unsupported change set action'; end if;
  if record_kind not in ('task_type','specification','form_source') or record_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$' then raise exception 'Invalid record identity'; end if;
  if not private.studio_safe_path(path, record_kind) then raise exception 'Unsafe or out-of-scope path: %', left(coalesce(path,'(null)'),120); end if;
  if path = any(seen) then raise exception 'Duplicate change set path'; end if;
  seen := seen || path;
  select * into b from private.studio_blobs where id=(e->>'blobId')::uuid and module_id=p_module;
  if not found then raise exception 'Change set bytes not found in this module'; end if;
  if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
  after_blob_id := b.id; after_sha256 := b.sha256;
  select * into f from private.studio_snapshot_files sf where sf.snapshot_id=p_snapshot and sf.path=e->>'path';
  select * into idx from private.studio_record_index ri where ri.snapshot_id=p_snapshot and ri.record_kind=e->>'recordKind' and ri.record_id=e->>'recordId' and ri.parent_record_id=coalesce(e->>'parentRecordId','');
  if action = 'add' then
   if f.path is not null then raise exception 'Path already exists in the base snapshot'; end if;
   if idx.record_id is not null then raise exception 'Record % already exists in the base snapshot', record_id; end if;
   before_sha256 := null;
  else
   if f.path is null or idx.record_id is null or idx.path <> path then raise exception 'Record % does not resolve at that path in the base snapshot', record_id; end if;
   before_sha256 := f.sha256;
   if before_sha256 = after_sha256 then raise exception 'Change set entry does not change the file'; end if;
   if action = 'retire' then
    if idx.status <> 'active' then raise exception 'Record % is already retired', record_id; end if;
    for l in select * from private.studio_record_links rl where rl.snapshot_id=p_snapshot and rl.to_kind=e->>'recordKind' and rl.to_id=e->>'recordId' and rl.required loop
     if not ((l.from_kind||':'||l.from_id) = any(retiring))
      and exists(select 1 from private.studio_record_index x where x.snapshot_id=p_snapshot and x.record_kind=l.from_kind and x.record_id=l.from_id and x.status='active') then
      raise exception 'Retiring % would break the required reference from %', record_id, l.from_id;
     end if;
    end loop;
   end if;
  end if;
  return next;
 end loop;
end $$;
create function private.studio_manifest(p_module text, p_snapshot uuid, p_entries jsonb, p_extra jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','reviseit/studio-changeset@1','moduleId',p_module,'baseSnapshotId',p_snapshot,
  'baseManifestSha256',(select manifest_sha256 from private.studio_snapshots where id=p_snapshot),
  'entries',coalesce((select jsonb_agg(jsonb_build_object('path',x->>'path','action',x->>'action','recordKind',x->>'recordKind','recordId',x->>'recordId',
   'parentRecordId',coalesce(x->>'parentRecordId',''),'before',x->>'before','after',x->>'after') order by x->>'path' collate "C") from jsonb_array_elements(p_entries) x),'[]'::jsonb)) || p_extra;
$$;
create function public.studio_create_maintenance_changeset(p_module text, p_base_snapshot uuid, p_entries jsonb, p_rationale text, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; m private.studio_modules; c private.studio_changesets; rows jsonb; man jsonb;
begin
 req := jsonb_build_object('module',p_module,'base',p_base_snapshot,'entries',p_entries,'rationale',p_rationale);
 res := private.studio_replay(me::text,p_command,'create_maintenance_changeset',req); if res is not null then return res; end if;
 select * into m from private.studio_modules where module_id=p_module for update;
 if not found then raise exception 'Module not enrolled in Studio'; end if;
 if m.accepted_snapshot_id is distinct from p_base_snapshot then raise exception 'Maintenance must start from the current accepted snapshot'; end if;
 if jsonb_array_length(p_entries) = 0 then raise exception 'Empty maintenance change set'; end if;
 select jsonb_agg(jsonb_build_object('path',x.path,'action',x.action,'recordKind',x.record_kind,'recordId',x.record_id,'parentRecordId',x.parent_record_id,
  'before',x.before_sha256,'after',x.after_sha256,'blobId',x.after_blob_id)) into rows from private.studio_check_entries(p_module,p_base_snapshot,p_entries) x;
 man := private.studio_manifest(p_module,p_base_snapshot,rows,jsonb_build_object('kind','maintenance','purpose','canonical'));
 insert into private.studio_changesets(module_id,kind,purpose,base_snapshot_id,manifest,manifest_sha256,created_by)
  values(p_module,'maintenance','canonical',p_base_snapshot,man,private.studio_sha(man::text),me::text) returning * into c;
 insert into private.studio_changeset_entries(changeset_id,path,action,record_kind,record_id,parent_record_id,before_sha256,after_sha256,after_blob_id)
  select c.id,x->>'path',x->>'action',x->>'recordKind',x->>'recordId',x->>'parentRecordId',x->>'before',x->>'after',(x->>'blobId')::uuid from jsonb_array_elements(rows) x;
 perform private.studio_event(p_module,null,'editor',me::text,'changeset_created',jsonb_build_object('changeset',c.id,'kind','maintenance','rationale',p_rationale));
 return private.studio_remember(me::text,p_command,'create_maintenance_changeset',req,jsonb_build_object('changesetId',c.id,'manifestSha256',c.manifest_sha256));
end $$;
create function private.studio_valid_authorisation(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p)='object' and p->>'provenance' in ('explicit_review','standing_authorisation')
  and length(trim(coalesce(p->>'reference',''))) >= 3 and length(trim(coalesce(p->>'scope',''))) >= 3;
$$;
create function public.studio_authorise_changeset(p_changeset uuid, p_expected_manifest_sha256 text, p_rationale text, p_authorisation jsonb, p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; c private.studio_changesets; m private.studio_modules; ents jsonb;
begin
 req := jsonb_build_object('changeset',p_changeset,'expected',p_expected_manifest_sha256,'rationale',p_rationale,'authorisation',p_authorisation);
 res := private.studio_replay(me::text,p_command,'authorise_changeset',req); if res is not null then return res; end if;
 select * into c from private.studio_changesets where id=p_changeset for update;
 if not found then raise exception 'Change set not found'; end if;
 if c.kind <> 'maintenance' then raise exception 'Analysis change sets are authorised through the integration review'; end if;
 if c.state <> 'draft' then raise exception 'Change set is %', c.state; end if;
 if c.manifest_sha256 <> p_expected_manifest_sha256 then raise exception 'Change set changed'; end if;
 if not private.studio_valid_authorisation(p_authorisation) or length(trim(coalesce(p_rationale,''))) < 3 then raise exception 'Authorisation provenance and rationale required'; end if;
 select * into m from private.studio_modules where module_id=c.module_id for update;
 if m.accepted_snapshot_id is distinct from c.base_snapshot_id then raise exception 'Bank changed since this change set was prepared; rebase required'; end if;
 select jsonb_agg(jsonb_build_object('path',e.path,'action',e.action,'recordKind',e.record_kind,'recordId',e.record_id,'parentRecordId',e.parent_record_id,'blobId',e.after_blob_id))
  into ents from private.studio_changeset_entries e where e.changeset_id=c.id;
 perform count(*) from private.studio_check_entries(c.module_id,c.base_snapshot_id,ents);
 update private.studio_changesets set state='authorised', authorised_by=me, authorised_at=now(), self_reviewed=(c.created_by=me::text), updated_at=now() where id=c.id;
 perform private.studio_event(c.module_id,null,'editor',me::text,'changeset_authorised',jsonb_build_object('changeset',c.id,'selfReviewed',c.created_by=me::text,'authorisation',p_authorisation,'rationale',p_rationale));
 return private.studio_remember(me::text,p_command,'authorise_changeset',req,jsonb_build_object('changesetId',c.id,'state','authorised','selfReviewed',c.created_by=me::text));
end $$;

-- ───────────────────────────── editor: review decisions (C06) ─────────────────────────────
create function public.studio_gate_view(p_run uuid, p_gate text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); g private.studio_gates; prev text; c private.studio_changesets;
begin
 select * into g from private.studio_gates where run_id=p_run and gate=p_gate;
 if not found then raise exception 'Gate not found'; end if;
 prev := (array['G1_inventory','G2_matches','G3_records','G4_content'])[private.studio_gate_index(p_gate)-1];
 c := private.studio_current_changeset(p_run);
 return jsonb_build_object('gate',p_gate,'version',g.version,'binding',private.studio_gate_binding(p_run,p_gate),
  'previousApproved',prev is null or (private.studio_live_decision(p_run,prev)).id is not null,
  'live',(select to_jsonb(d) - 'bound' from private.studio_decisions d where d.id=(private.studio_live_decision(p_run,p_gate)).id),
  'changeset',case when c.id is null then null else jsonb_build_object('id',c.id,'manifestSha256',c.manifest_sha256,'state',c.state,
   'records',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.record_kind,'id',e.record_id,'parentId',nullif(e.parent_record_id,''),'action',e.action,'path',e.path) order by e.path),'[]'::jsonb)
    from private.studio_changeset_entries e where e.changeset_id=c.id)) end);
end $$;

create function public.studio_record_decision(p_run uuid, p_gate text, p_expected_version integer, p_bound uuid[], p_outcome text, p_rationale text, p_authorisation jsonb, p_items jsonb, p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs; i private.studio_run_inputs; g private.studio_gates; binding jsonb; ids uuid[];
 prev text; dep text; c private.studio_changesets; m private.studio_modules; d private.studio_decisions; selfr boolean; v private.studio_artifacts; it jsonb; missing text;
begin
 req := jsonb_build_object('run',p_run,'gate',p_gate,'version',p_expected_version,'bound',to_jsonb(p_bound),'outcome',p_outcome,'rationale',p_rationale,'authorisation',p_authorisation,'items',p_items);
 res := private.studio_replay(me::text,p_command,'record_decision',req); if res is not null then return res; end if;
 select * into r from private.studio_runs where id=p_run for update;
 if not found then raise exception 'Run not found'; end if;
 if r.state <> 'active' then raise exception 'Run is %', r.state; end if;
 select * into g from private.studio_gates where run_id=p_run and gate=p_gate for update;
 if not found then raise exception 'Gate not found'; end if;
 -- Concurrent reviewers: the second decision against the same version loses (no last-writer-wins).
 if g.version <> p_expected_version then raise exception 'Gate changed'; end if;
 if p_outcome not in ('approved','returned','rejected') then raise exception 'Invalid outcome'; end if;
 if not private.studio_valid_authorisation(p_authorisation) then raise exception 'Authorisation provenance required'; end if;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 binding := private.studio_gate_binding(p_run,p_gate);
 if binding is null then raise exception 'Gate is not ready for review'; end if;
 select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')),'{}') into ids from jsonb_array_elements(binding->'artifacts') x;
 if ids is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(coalesce(p_bound,'{}')) x) then raise exception 'Review binding changed'; end if;
 perform private.studio_require_blobs(array(select blob_id from private.studio_artifacts where id=any(ids)));
 if (private.studio_live_decision(p_run,p_gate)).id is not null then
  if p_outcome = 'approved' then raise exception 'Gate already approved'; end if;
  perform private.studio_invalidate_from(p_run,p_gate,'Returned by a later review');
 end if;
 prev := (array['G1_inventory','G2_matches','G3_records','G4_content'])[private.studio_gate_index(p_gate)-1];
 if p_outcome = 'approved' and prev is not null and (private.studio_live_decision(p_run,prev)).id is null then raise exception 'Earlier review required'; end if;
 c := private.studio_current_changeset(p_run);
 if p_outcome = 'approved' and p_gate in ('G3_records','G4_content','G5_integration') then
  -- Structural validation of the complete isolated candidate precedes record and content review.
  select * into v from private.studio_artifacts where id=any(ids) and kind='validation_result' and state='current';
  if v.id is null or v.meta->>'exitStatus' is distinct from '0' or v.meta->>'scope' is distinct from 'complete_candidate' then raise exception 'Passing validation of the complete candidate required'; end if;
  if c.id is null or c.validation_artifact_id is distinct from v.id then raise exception 'Change set and validation do not match'; end if;
 end if;
 if p_gate = 'G4_content' and p_outcome = 'approved' then
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Content judgments required'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
   if not exists(select 1 from private.studio_changeset_entries e where e.changeset_id=c.id and e.record_kind=it->>'recordKind' and e.record_id=it->>'recordId' and e.parent_record_id=coalesce(it->>'parentRecordId',''))
    then raise exception 'Judgment for a record outside the change set'; end if;
   if it->>'verdict' = 'unresolved' and it->>'disposition' is null then raise exception 'Unresolved judgment needs a recorded disposition'; end if;
  end loop;
  -- A standing permission to work is not a scientific judgment: every changed record needs one.
  select string_agg(e.record_id, ', ') into missing from private.studio_changeset_entries e where e.changeset_id=c.id
   and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'recordKind'=e.record_kind and x->>'recordId'=e.record_id and coalesce(x->>'parentRecordId','')=e.parent_record_id);
  if missing is not null then raise exception 'Content judgment missing for %', missing; end if;
 end if;
 if p_gate = 'G5_integration' and p_outcome = 'approved' then
  if binding->'changeset'->>'id' is distinct from c.id::text or c.state <> 'draft' then raise exception 'Change set changed'; end if;
  select * into m from private.studio_modules where module_id=r.module_id for update;
  if r.purpose = 'canonical' and m.accepted_snapshot_id is distinct from c.base_snapshot_id then raise exception 'Bank changed since this run was pinned; rebase required'; end if;
  select string_agg(distinct j.record_id, ', ') into missing from private.studio_content_judgments j join private.studio_changeset_entries e
   on e.changeset_id=c.id and e.record_kind=j.record_kind and e.record_id=j.record_id and e.parent_record_id=j.parent_record_id
   where j.decision_id=(private.studio_live_decision(p_run,'G4_content')).id and (j.verdict='rejected' or (j.verdict='unresolved' and j.disposition<>'scoped_exception'));
  if missing is not null then raise exception 'Content judgments block integration of %', missing; end if;
 end if;
 selfr := exists(select 1 from private.studio_artifacts where id=any(ids) and author_kind='user' and author_id=me::text);
 dep := private.studio_level_digest(i, private.studio_stage_level(p_gate));
 insert into private.studio_decisions(run_id,gate,input_revision,outcome,bound,bound_digest,dependency_digest,gate_version,reviewer,self_reviewed,rationale,authorisation,items,changeset_id)
  values(r.id,p_gate,i.input_revision,p_outcome,binding,private.studio_sha(binding::text||'|'||dep),dep,g.version+1,me,selfr,p_rationale,p_authorisation,coalesce(p_items,'[]'::jsonb),
   case when p_gate in ('G3_records','G4_content','G5_integration') then c.id end) returning * into d;
 update private.studio_gates set version=version+1 where run_id=r.id and gate=p_gate;
 if p_gate = 'G4_content' and p_outcome = 'approved' then
  insert into private.studio_content_judgments(decision_id,run_id,record_kind,record_id,parent_record_id,aspect,verdict,reason,disposition,exception_rationale)
   select d.id,r.id,x->>'recordKind',x->>'recordId',coalesce(x->>'parentRecordId',''),x->>'aspect',x->>'verdict',x->>'reason',x->>'disposition',x->>'exceptionRationale'
   from jsonb_array_elements(p_items) x;
 end if;
 if p_gate = 'G5_integration' and p_outcome = 'approved' then
  update private.studio_changesets set state='authorised', authorised_by=me, authorised_at=now(), self_reviewed=selfr, updated_at=now() where id=c.id;
 end if;
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'decision_recorded',jsonb_build_object('gate',p_gate,'outcome',p_outcome,'decision',d.id,'selfReviewed',selfr,'authorisation',p_authorisation));
 perform private.studio_advance(r.id);
 return private.studio_remember(me::text,p_command,'record_decision',req,jsonb_build_object('decisionId',d.id,'gate',p_gate,'outcome',p_outcome,'gateVersion',g.version+1,'selfReviewed',selfr));
end $$;

-- ───────────────────────────── editor: reads for the administration screens ─────────────────────────────
create function public.studio_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor();
begin
 return jsonb_build_object(
  'modules',(select coalesce(jsonb_agg(jsonb_build_object('moduleId',m.module_id,'subjectAdapter',m.subject_adapter,'acceptedSnapshotId',m.accepted_snapshot_id,
    'acceptedManifestSha256',(select manifest_sha256 from private.studio_snapshots where id=m.accepted_snapshot_id)) order by m.module_id),'[]'::jsonb) from private.studio_modules m),
  'snapshots',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'moduleId',s.module_id,'manifestSha256',s.manifest_sha256,'origin',s.origin,'purpose',s.purpose,'fileCount',s.file_count,'createdAt',s.created_at) order by s.created_at desc),'[]'::jsonb) from private.studio_snapshots s),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'moduleId',s.module_id,'title',s.title,'revision',s.current_revision,'state',s.state,'createdAt',s.created_at) order by s.created_at desc),'[]'::jsonb) from private.studio_sources s),
  'runs',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'moduleId',r.module_id,'sourceId',r.source_id,'purpose',r.purpose,'state',r.state,'inputRevision',r.current_input_revision,'createdAt',r.created_at,'updatedAt',r.updated_at,
    'stages',(select coalesce(jsonb_object_agg(x.stage_key,x.state),'{}'::jsonb) from (select distinct on (stage_key) stage_key,state from private.studio_stages where run_id=r.id order by stage_key,seq desc) x)) order by r.created_at desc),'[]'::jsonb) from private.studio_runs r));
end $$;
create function public.studio_run_view(p_run uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.studio_require_editor(); r private.studio_runs;
begin
 select * into r from private.studio_runs where id=p_run;
 if not found then raise exception 'Run not found'; end if;
 return jsonb_build_object('run',to_jsonb(r),
  'inputs',(select jsonb_agg(to_jsonb(i) order by i.input_revision) from private.studio_run_inputs i where i.run_id=r.id),
  'stages',(select coalesce(jsonb_agg(to_jsonb(s) - 'upstream' || jsonb_build_object('attempts',(select coalesce(jsonb_agg(to_jsonb(a) - 'lease' order by a.attempt_number),'[]'::jsonb) from private.studio_stage_attempts a where a.stage_id=s.id)) order by s.seq),'[]'::jsonb) from private.studio_stages s where s.run_id=r.id),
  'artifacts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'logicalKey',a.logical_key,'kind',a.kind,'revision',a.revision,'state',a.state,'sha256',a.sha256,'author',a.author_kind,'authorId',a.author_id,
    'record',case when a.record_kind is null then null else jsonb_build_object('kind',a.record_kind,'id',a.record_id,'parentId',nullif(a.parent_record_id,''),'path',a.record_path) end,
    'integrity',(select integrity from private.studio_blobs where id=a.blob_id),'meta',a.meta,'createdAt',a.created_at) order by a.logical_key,a.revision),'[]'::jsonb) from private.studio_artifacts a where a.run_id=r.id),
  'gates',(select jsonb_agg(jsonb_build_object('gate',g.gate,'version',g.version,'live',(private.studio_live_decision(r.id,g.gate)).id is not null) order by private.studio_gate_index(g.gate)) from private.studio_gates g where g.run_id=r.id),
  'decisions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at, private.studio_gate_index(d.gate), d.gate_version),'[]'::jsonb) from private.studio_decisions d where d.run_id=r.id),
  'providerOperations',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'stageId',o.stage_id,'operation',o.operation,'currentAttemptId',o.current_attempt_id,
    'attempts',(select jsonb_agg(to_jsonb(p) order by p.attempt_number) from private.studio_provider_attempts p where p.operation_id=o.id))),'[]'::jsonb)
    from private.studio_provider_operations o join private.studio_stages s on s.id=o.stage_id where s.run_id=r.id),
  'changesets',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]'::jsonb) from private.studio_changesets c where c.run_id=r.id),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from private.studio_events e where e.run_id=r.id));
end $$;

-- ───────────────────────────── worker gateway (service_role through STUDIO_WORKER_TOKEN only) ─────────────────────────────
create function public.studio_claim(p_worker text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.studio_settings; s private.studio_stages; i private.studio_run_inputs; r private.studio_runs; token uuid := gen_random_uuid(); a private.studio_stage_attempts; bad uuid;
begin
 if p_worker is null or p_worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 -- Studio capacity is separate from paid generation: its own queue table and its own running limit.
 perform pg_advisory_xact_lock(hashtextextended('reviseit:studio-claim',0));
 perform private.studio_expire_leases();
 select * into cfg from private.studio_settings;
 if (select count(*) from private.studio_stages where state='running') >= cfg.max_running then return null; end if;
 loop
  select st.* into s from private.studio_stages st join private.studio_runs x on x.id=st.run_id
   where st.state='queued' and x.state='active' order by st.seq for update of st skip locked limit 1;
  if not found then return null; end if;
  select * into r from private.studio_runs where id=s.run_id;
  select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
  -- Missing, inaccessible or corrupt committed bytes block dependent consumption.
  select b.id into bad from private.studio_blobs b where b.integrity<>'verified' and (
   b.id in (select blob_id from private.studio_source_files where source_revision_id=i.source_revision_id)
   or b.id = (select manifest_blob_id from private.studio_snapshots where id=i.snapshot_id)
   or b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else coalesce(s.upstream->'artifacts','[]'::jsonb) end) x)) limit 1;
  exit when bad is null;
  update private.studio_stages set state='blocked', blocked_reason='Integrity blocked: '||bad, updated_at=now() where id=s.id;
  perform private.studio_event(r.module_id,r.id,'system','studio','stage_blocked',jsonb_build_object('stage',s.id,'blob',bad));
 end loop;
 insert into private.studio_stage_attempts(stage_id,attempt_number,worker_id,lease,lease_until)
  values(s.id,s.attempt_count+1,p_worker,token,now()+make_interval(secs=>cfg.lease_seconds)) returning * into a;
 update private.studio_stages set state='running', current_attempt_id=a.id, attempt_count=a.attempt_number, blocked_reason=null, updated_at=now() where id=s.id;
 perform private.studio_event(r.module_id,r.id,'worker',p_worker,'stage_claimed',jsonb_build_object('stage',s.id,'attempt',a.id,'number',a.attempt_number));
 return jsonb_build_object('stageId',s.id,'attemptId',a.id,'attemptNumber',a.attempt_number,'lease',token,'leaseSeconds',cfg.lease_seconds,
  'runId',r.id,'moduleId',r.module_id,'purpose',r.purpose,'stageKey',s.stage_key,'kind',s.kind,'inputDigest',s.input_digest,
  'pins',jsonb_build_object('inputRevision',i.input_revision,'sourceDigest',i.source_digest,'snapshotId',i.snapshot_id,'bankManifestSha256',i.bank_manifest_sha256,
   'policySha256',i.policy_sha256,'skillContract',i.skill_contract_id,'skillSha256',i.skill_sha256,'validatorSha256',i.validator_sha256,
   'subjectAdapter',i.subject_adapter,'providerProfile',i.provider_profile_id,'adapterVersion',i.adapter_version,'promptVersion',i.prompt_version),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('blobId',b.id,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type,'role',f.role) order by f.role,b.sha256),'[]'::jsonb)
   from private.studio_source_files f join private.studio_blobs b on b.id=f.blob_id where f.source_revision_id=i.source_revision_id),
  'snapshot',(select jsonb_build_object('id',x.id,'manifestSha256',x.manifest_sha256,'manifestBlobId',x.manifest_blob_id,'origin',x.origin,'purpose',x.purpose) from private.studio_snapshots x where x.id=i.snapshot_id),
  'upstream',s.upstream);
end $$;
create function public.studio_heartbeat(p_attempt uuid, p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; secs integer := (select lease_seconds from private.studio_settings);
begin
 s := private.studio_fence(p_attempt,p_lease);
 update private.studio_stage_attempts set lease_until=now()+make_interval(secs=>secs) where id=p_attempt;
 return jsonb_build_object('stageId',s.id,'runId',s.run_id,'moduleId',(select module_id from private.studio_runs where id=s.run_id),'stageKey',s.stage_key,'leaseSeconds',secs);
end $$;
-- Bytes a fenced worker may read: its pinned sources, pinned snapshot and the stage's upstream revisions.
create function public.studio_worker_read(p_attempt uuid, p_lease uuid, p_blob uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; r private.studio_runs; i private.studio_run_inputs; b private.studio_blobs;
begin
 s := private.studio_fence(p_attempt,p_lease);
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 select * into b from private.studio_blobs where id=p_blob and module_id=r.module_id;
 if not found or not (
  b.id in (select blob_id from private.studio_source_files where source_revision_id=i.source_revision_id)
  or b.id in (select manifest_blob_id from private.studio_snapshots where id=i.snapshot_id union all select blob_id from private.studio_snapshot_files where snapshot_id=i.snapshot_id)
  or b.id in (select (x->>'blobId')::uuid from jsonb_array_elements(case when jsonb_typeof(s.upstream)='array' then s.upstream else coalesce(s.upstream->'artifacts','[]'::jsonb) end) x)
  or b.id in (select blob_id from private.studio_artifacts where id=any(private.studio_drafts(r.id)) and s.stage_key in ('S6_assemble_validate'))
 ) then raise exception 'Input not available to this stage'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %', b.id, b.integrity; end if;
 return jsonb_build_object('blobId',b.id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type);
end $$;
-- The gateway has written and verified the bytes at the immutable key before this call.
create function private.studio_register_blob(p_module text, p_sha256 text, p_size bigint, p_media_type text) returns private.studio_blobs
language plpgsql security definer set search_path='' as $$
declare k text := 'studio/blobs/'||p_module||'/'||p_sha256; b private.studio_blobs;
begin
 perform private.studio_key_lock(k);
 if exists(select 1 from private.studio_gc_claims where object_key=k) then raise exception 'Storage cleanup in progress; retry'; end if;
 insert into private.studio_blobs(module_id,sha256,size_bytes,media_type,immutable_key) values(p_module,p_sha256,p_size,p_media_type,k) on conflict (module_id,sha256) do nothing;
 select * into b from private.studio_blobs where module_id=p_module and sha256=p_sha256 for update;
 if b.size_bytes <> p_size then raise exception 'Stored blob size conflict'; end if;
 if b.integrity <> 'verified' then raise exception 'Integrity blocked: % is %; use explicit recovery', b.id, b.integrity; end if;
 return b;
end $$;
create function public.studio_put_output(p_attempt uuid, p_lease uuid, p_logical_key text, p_kind text, p_sha256 text, p_size bigint, p_media_type text, p_schema text,
 p_record jsonb, p_meta jsonb, p_provider_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; r private.studio_runs; i private.studio_run_inputs; b private.studio_blobs; prev private.studio_artifacts; n private.studio_artifacts; pa private.studio_provider_attempts; idx private.studio_record_index; expected_key text;
begin
 s := private.studio_fence(p_attempt,p_lease);
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 if p_kind in ('draft_record') and s.stage_key <> 'S5_draft' then raise exception 'Only drafting produces record proposals'; end if;
 if p_kind in ('changeset_manifest','validation_result') and s.stage_key <> 'S6_assemble_validate' then raise exception 'Only assembly produces change sets and validation'; end if;
 if p_provider_attempt is not null then
  select p.* into pa from private.studio_provider_attempts p join private.studio_provider_operations o on o.id=p.operation_id
   where p.id=p_provider_attempt and o.stage_id=s.id and o.current_attempt_id=p.id and p.dispatch_state='succeeded' and p.stage_attempt_id=p_attempt;
  -- A late or superseded provider result can be stored on its attempt but never accepted here.
  if not found then raise exception 'Provider result is not the current settled attempt of this stage'; end if;
 end if;
 if p_kind = 'draft_record' then
  if p_record is null or p_record->>'kind' not in ('task_type','specification','form_source') or p_record->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$'
   or not private.studio_safe_path(p_record->>'path', p_record->>'kind') then raise exception 'Invalid record proposal'; end if;
  select * into idx from private.studio_record_index where snapshot_id=i.snapshot_id and record_kind=p_record->>'kind' and record_id=p_record->>'id' and parent_record_id=coalesce(p_record->>'parentId','');
  if found and idx.path <> p_record->>'path' then raise exception 'Record resolves to a different path in the pinned snapshot'; end if;
  expected_key := 'record:'||(p_record->>'kind')||':'||(p_record->>'id')||coalesce(':'||nullif(p_record->>'parentId',''),'');
  if p_logical_key is distinct from expected_key then raise exception 'Record logical key mismatch'; end if;
 end if;
 b := private.studio_register_blob(r.module_id,p_sha256,p_size,p_media_type);
 select * into prev from private.studio_artifacts where run_id=r.id and logical_key=p_logical_key and state='current' for update;
 if prev.id is not null then update private.studio_artifacts set state='superseded' where id=prev.id; end if;
 insert into private.studio_artifacts(run_id,module_id,logical_key,kind,revision,parent_id,blob_id,sha256,schema,record_kind,record_id,parent_record_id,record_path,
  stage_id,stage_attempt_id,provider_attempt_id,author_kind,author_id,meta)
  values(r.id,r.module_id,p_logical_key,p_kind,coalesce((select max(revision) from private.studio_artifacts where run_id=r.id and logical_key=p_logical_key),0)+1,prev.id,b.id,b.sha256,p_schema,
   p_record->>'kind',p_record->>'id',coalesce(p_record->>'parentId',''),p_record->>'path',s.id,p_attempt,p_provider_attempt,'worker',
   (select worker_id from private.studio_stage_attempts where id=p_attempt),coalesce(p_meta,'{}'::jsonb)) returning * into n;
 return jsonb_build_object('artifactId',n.id,'revision',n.revision,'blobId',b.id);
end $$;
create function public.studio_put_changeset(p_attempt uuid, p_lease uuid, p_entries jsonb, p_validation_artifact uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; r private.studio_runs; i private.studio_run_inputs; v private.studio_artifacts; rows jsonb; man jsonb; c private.studio_changesets; drafts uuid[]; listed uuid[];
begin
 s := private.studio_fence(p_attempt,p_lease);
 if s.stage_key <> 'S6_assemble_validate' then raise exception 'Only assembly produces change sets'; end if;
 select * into r from private.studio_runs where id=s.run_id;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 select * into v from private.studio_artifacts where id=p_validation_artifact and stage_attempt_id=p_attempt and kind='validation_result' and state='current';
 if not found then raise exception 'Validation result from this attempt required'; end if;
 if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Invalid change set entries'; end if;
 drafts := private.studio_drafts(r.id);
 select coalesce(array_agg((x->>'artifactId')::uuid),'{}') into listed from jsonb_array_elements(p_entries) x;
 -- The change set covers exactly the current proposals: none omitted, none stale.
 if (select coalesce(array_agg(x order by x),'{}') from unnest(drafts) x) is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(listed) x) then raise exception 'Change set must list exactly the current proposals'; end if;
 select jsonb_agg(jsonb_build_object('path',x.path,'action',x.action,'recordKind',x.record_kind,'recordId',x.record_id,'parentRecordId',x.parent_record_id,
  'before',x.before_sha256,'after',x.after_sha256,'blobId',x.after_blob_id,'artifactId',a.id)) into rows
  from jsonb_array_elements(p_entries) e
  join private.studio_artifacts a on a.id=(e->>'artifactId')::uuid
  cross join lateral private.studio_check_entries(r.module_id,i.snapshot_id,jsonb_build_array(jsonb_build_object('path',a.record_path,'action',e->>'action','recordKind',a.record_kind,
   'recordId',a.record_id,'parentRecordId',a.parent_record_id,'blobId',a.blob_id,'artifactId',a.id))) x;
 rows := coalesce(rows,'[]'::jsonb);
 perform count(*) from private.studio_check_entries(r.module_id,i.snapshot_id,rows);
 man := private.studio_manifest(r.module_id,i.snapshot_id,rows,jsonb_build_object('kind','analysis','purpose',r.purpose,'runId',r.id,'inputRevision',i.input_revision,'validationSha256',v.sha256));
 update private.studio_changesets set state='superseded', updated_at=now() where run_id=r.id and state='draft';
 insert into private.studio_changesets(module_id,run_id,kind,purpose,base_snapshot_id,manifest,manifest_sha256,stage_id,validation_artifact_id,created_by)
  values(r.module_id,r.id,'analysis',r.purpose,i.snapshot_id,man,private.studio_sha(man::text),s.id,v.id,'worker') returning * into c;
 insert into private.studio_changeset_entries(changeset_id,path,action,record_kind,record_id,parent_record_id,before_sha256,after_sha256,after_blob_id,artifact_id)
  select c.id,x->>'path',x->>'action',x->>'recordKind',x->>'recordId',x->>'parentRecordId',x->>'before',x->>'after',(x->>'blobId')::uuid,(x->>'artifactId')::uuid from jsonb_array_elements(rows) x;
 return jsonb_build_object('changesetId',c.id,'manifestSha256',c.manifest_sha256,'entries',jsonb_array_length(rows));
end $$;
-- Outputs must already be durable rows with verified bytes before the stage can succeed.
create function public.studio_complete(p_attempt uuid, p_lease uuid, p_outputs uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; produced uuid[];
begin
 s := private.studio_fence(p_attempt,p_lease);
 select coalesce(array_agg(id order by id),'{}') into produced from private.studio_artifacts where stage_attempt_id=p_attempt;
 if produced is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(coalesce(p_outputs,'{}')) x) then raise exception 'Completion must list exactly the outputs persisted by this attempt'; end if;
 perform private.studio_require_blobs(produced);
 if exists(select 1 from private.studio_artifacts where id=any(produced) and state<>'current') then raise exception 'An output was superseded before completion'; end if;
 if exists(select 1 from private.studio_provider_attempts where stage_attempt_id=p_attempt and dispatch_state in ('prepared','dispatched')) then raise exception 'Provider attempt unsettled'; end if;
 if s.stage_key = 'S6_assemble_validate' and not exists(select 1 from private.studio_changesets where stage_id=s.id and state='draft') then raise exception 'Assembly must persist its change set'; end if;
 if private.studio_current_stage(s.run_id,s.stage_key) is distinct from s then
  -- Defensive: inputs moved after claim. Advance would have fenced this attempt; never accept it.
  raise exception 'Studio lease lost';
 end if;
 update private.studio_stage_attempts set state='completed', ended_at=now() where id=p_attempt;
 update private.studio_stages set state='succeeded', completed_at=now(), error=null, updated_at=now() where id=s.id;
 perform private.studio_event((select module_id from private.studio_runs where id=s.run_id),s.run_id,'worker',(select worker_id from private.studio_stage_attempts where id=p_attempt),'stage_succeeded',jsonb_build_object('stage',s.id,'outputs',to_jsonb(produced)));
 perform private.studio_advance(s.run_id);
 return jsonb_build_object('stageId',s.id,'state','succeeded');
end $$;
create function public.studio_fail(p_attempt uuid, p_lease uuid, p_error text, p_retryable boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; st text;
begin
 s := private.studio_fence(p_attempt,p_lease);
 if exists(select 1 from private.studio_provider_attempts where stage_attempt_id=p_attempt and dispatch_state='dispatched') then
  -- Failure after dispatch is uncertainty about a possibly billed request, not a clean failure.
  update private.studio_provider_attempts set dispatch_state='uncertain' where stage_attempt_id=p_attempt and dispatch_state='dispatched';
  st := 'uncertain';
 elsif s.kind='deterministic' and coalesce(p_retryable,false) and s.attempt_count < s.max_attempts then st := 'queued';
 else st := 'failed'; end if;
 update private.studio_provider_attempts set dispatch_state='failed_before_dispatch', settled_at=now() where stage_attempt_id=p_attempt and dispatch_state='prepared';
 update private.studio_stage_attempts set state=case when st='uncertain' then 'uncertain' else 'failed' end, error=left(p_error,1000), ended_at=now() where id=p_attempt;
 update private.studio_stages set state=st, error=left(p_error,1000), current_attempt_id=case when st='queued' then null else current_attempt_id end, updated_at=now() where id=s.id;
 perform private.studio_event((select module_id from private.studio_runs where id=s.run_id),s.run_id,'worker','gateway','stage_'||st,jsonb_build_object('stage',s.id,'error',left(p_error,300)));
 return jsonb_build_object('stageId',s.id,'state',st);
end $$;
create function public.studio_mark_uncertain(p_attempt uuid, p_lease uuid, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages;
begin
 s := private.studio_fence(p_attempt,p_lease);
 update private.studio_provider_attempts set dispatch_state='uncertain' where stage_attempt_id=p_attempt and dispatch_state='dispatched';
 update private.studio_stage_attempts set state='uncertain', error=left(p_reason,1000), ended_at=now() where id=p_attempt;
 update private.studio_stages set state='uncertain', error=left(p_reason,1000), updated_at=now() where id=s.id;
 perform private.studio_event((select module_id from private.studio_runs where id=s.run_id),s.run_id,'worker','gateway','stage_uncertain',jsonb_build_object('stage',s.id,'reason',left(p_reason,300)));
 return jsonb_build_object('stageId',s.id,'state','uncertain');
end $$;

-- Provider calls (mocked in assignment 02). Intent is durable before the external side effect.
create function public.studio_provider_prepare(p_attempt uuid, p_lease uuid, p_operation text, p_request_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; i private.studio_run_inputs; lk text; op private.studio_provider_operations; pa private.studio_provider_attempts;
begin
 s := private.studio_fence(p_attempt,p_lease);
 if s.kind <> 'provider' then raise exception 'Deterministic stages make no provider calls'; end if;
 if p_operation !~ '^[a-z0-9_:.-]{1,120}$' or p_request_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid provider operation'; end if;
 select x.* into i from private.studio_run_inputs x join private.studio_runs r on r.id=x.run_id and x.input_revision=r.current_input_revision where r.id=s.run_id;
 lk := private.studio_sha(s.input_digest||'|'||p_operation);
 insert into private.studio_provider_operations(stage_id,operation,logical_key,request_digest) values(s.id,p_operation,lk,p_request_digest) on conflict (logical_key) do nothing;
 select * into op from private.studio_provider_operations where logical_key=lk for update;
 if op.request_digest <> p_request_digest then raise exception 'Provider request changed for the same operation'; end if;
 if op.current_attempt_id is null then
  insert into private.studio_provider_attempts(operation_id,attempt_number,stage_attempt_id,profile_id) values(op.id,1,p_attempt,i.provider_profile_id) returning * into pa;
  update private.studio_provider_operations set current_attempt_id=pa.id where id=op.id;
  return jsonb_build_object('operationId',op.id,'providerAttemptId',pa.id,'attemptNumber',1,'action','dispatch');
 end if;
 select * into pa from private.studio_provider_attempts where id=op.current_attempt_id for update;
 if pa.dispatch_state = 'succeeded' then
  -- Never resend a settled request; reuse its recorded result.
  update private.studio_provider_attempts set stage_attempt_id=p_attempt where id=pa.id and stage_attempt_id is distinct from p_attempt;
  return jsonb_build_object('operationId',op.id,'providerAttemptId',pa.id,'attemptNumber',pa.attempt_number,'action','reuse','resultDigest',pa.result_digest);
 elsif pa.dispatch_state = 'prepared' then
  -- Prepared means intent was recorded but nothing was sent; a later attempt may adopt it.
  update private.studio_provider_attempts set stage_attempt_id=p_attempt where id=pa.id;
  return jsonb_build_object('operationId',op.id,'providerAttemptId',pa.id,'attemptNumber',pa.attempt_number,'action','dispatch');
 elsif pa.dispatch_state in ('dispatched','uncertain') then raise exception 'Provider outcome uncertain; explicit retry required';
 else raise exception 'Provider attempt failed; explicit retry required';
 end if;
end $$;
create function public.studio_provider_dispatched(p_attempt uuid, p_lease uuid, p_provider_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_stages; pa private.studio_provider_attempts;
begin
 s := private.studio_fence(p_attempt,p_lease);
 select p.* into pa from private.studio_provider_attempts p join private.studio_provider_operations o on o.id=p.operation_id
  where p.id=p_provider_attempt and o.stage_id=s.id and o.current_attempt_id=p.id and p.stage_attempt_id=p_attempt for update of p, o;
 if not found or pa.dispatch_state <> 'prepared' then raise exception 'Provider attempt is not dispatchable'; end if;
 update private.studio_provider_attempts set dispatch_state='dispatched', possible_charge=true, dispatched_at=now() where id=pa.id;
 return jsonb_build_object('providerAttemptId',pa.id,'dispatchState','dispatched');
end $$;
-- A result settles its own attempt even when late. It never moves the stage; acceptance needs a valid lease.
create function public.studio_provider_result(p_provider_attempt uuid, p_outcome text, p_provider_request_id text, p_result_digest text, p_usage jsonb, p_attempt uuid, p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pa private.studio_provider_attempts; fenced boolean;
begin
 if p_outcome not in ('succeeded','failed') then raise exception 'Invalid provider outcome'; end if;
 if p_outcome = 'succeeded' and coalesce(p_result_digest,'') !~ '^[a-f0-9]{64}$' then raise exception 'Result digest required'; end if;
 select * into pa from private.studio_provider_attempts where id=p_provider_attempt for update;
 if not found then raise exception 'Provider attempt not found'; end if;
 if pa.dispatch_state in ('succeeded','failed') then
  if pa.dispatch_state = p_outcome and pa.result_digest is not distinct from p_result_digest then return jsonb_build_object('providerAttemptId',pa.id,'dispatchState',pa.dispatch_state,'late',pa.late); end if;
  raise exception 'Provider attempt already settled';
 end if;
 if pa.dispatch_state not in ('dispatched','uncertain') then raise exception 'Provider attempt was never dispatched'; end if;
 fenced := exists(select 1 from private.studio_stages st join private.studio_stage_attempts a on a.id=st.current_attempt_id
  where a.id=p_attempt and a.lease=p_lease and a.state='claimed' and a.lease_until>now() and st.state='running' and pa.stage_attempt_id=p_attempt)
  and pa.dispatch_state='dispatched';
 update private.studio_provider_attempts set dispatch_state=p_outcome, provider_request_id=left(p_provider_request_id,200), result_digest=p_result_digest,
  usage=p_usage, late=not fenced, settled_at=now() where id=pa.id;
 return jsonb_build_object('providerAttemptId',pa.id,'dispatchState',p_outcome,'late',not fenced);
end $$;
create function public.studio_expire_leases() returns integer language sql security definer set search_path='' as $$ select private.studio_expire_leases(); $$;

-- ───────────────────────────── storage reconciliation (service_role) ─────────────────────────────
create function public.studio_expire_uploads() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update private.studio_upload_sessions set state='expired', updated_at=now()
  where (state='open' and expires_at < now()) or (state='verifying' and expires_at < now()-interval '1 hour');
 get diagnostics n = row_count;
 return n;
end $$;
-- Claim an orphan object key for deletion. Referenced blobs, keys being finalised and open uploads
-- are refused. The claim blocks finalisation of the same key until studio_gc_finish.
create function public.studio_gc_claim(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_key !~ '^studio/(uploads|blobs)/[a-z0-9-]+/[A-Za-z0-9-]+$' then raise exception 'Invalid object key'; end if;
 perform private.studio_key_lock(p_key);
 if p_key like 'studio/uploads/%' then
  if exists(select 1 from private.studio_upload_sessions where provisional_key=p_key and state in ('open','verifying') and expires_at > now()-interval '1 hour') then return false; end if;
 else
  if exists(select 1 from private.studio_blobs where immutable_key=p_key) then return false; end if;
  if exists(select 1 from private.studio_upload_sessions where target_key=p_key and state='verifying') then return false; end if;
 end if;
 insert into private.studio_gc_claims(object_key) values(p_key) on conflict do nothing;
 return true;
end $$;
create function public.studio_gc_finish(p_key text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.studio_key_lock(p_key);
 delete from private.studio_gc_claims where object_key=p_key;
 perform private.studio_event(null,null,'system','reconciler','object_deleted',jsonb_build_object('key',p_key));
end $$;
create function public.studio_storage_inventory() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'claims',(select coalesce(jsonb_agg(jsonb_build_object('key',object_key,'claimedAt',claimed_at)),'[]'::jsonb) from private.studio_gc_claims),
  'blobs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',immutable_key,'sha256',sha256,'size',size_bytes,'integrity',integrity)),'[]'::jsonb) from private.studio_blobs),
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',provisional_key,'state',state,'targetKey',target_key)),'[]'::jsonb) from private.studio_upload_sessions));
$$;

-- ───────────────────────────── operator (local login on the canonical machine) ─────────────────────────────
create function public.studio_enrol_module(p_module text, p_subject_adapter text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.studio_subject_adapters where id=p_subject_adapter) then raise exception 'Unsupported subject adapter: %', p_subject_adapter; end if;
 if not exists(select 1 from public.curriculum_modules where id=p_module) then raise exception 'Curriculum module not found'; end if;
 insert into private.studio_modules(module_id,subject_adapter) values(p_module,p_subject_adapter)
  on conflict (module_id) do update set subject_adapter=excluded.subject_adapter where private.studio_modules.subject_adapter=excluded.subject_adapter;
 if (select subject_adapter from private.studio_modules where module_id=p_module) <> p_subject_adapter then raise exception 'Module already enrolled with another subject adapter'; end if;
 perform private.studio_event(p_module,null,'operator',session_user,'module_enrolled',jsonb_build_object('adapter',p_subject_adapter));
 return jsonb_build_object('moduleId',p_module,'subjectAdapter',p_subject_adapter);
end $$;
-- Canonical manifest bytes: {"files":{path:sha,...},"module":id,"schema":"reviseit/studio-bank-manifest@1"}
-- with keys sorted and no whitespace; identical to Python json.dumps(sort_keys=True, separators=(',',':'))
-- for the ASCII-only paths that studio_safe_path admits.
create function private.studio_manifest_text(p_module text, p_files jsonb) returns text language sql immutable set search_path='' as $$
 select '{"files":{'||coalesce((select string_agg(to_json(f->>'path')::text||':'||to_json(f->>'sha256')::text, ',' order by f->>'path' collate "C") from jsonb_array_elements(p_files) f),'')
  ||'},"module":'||to_json(p_module)::text||',"schema":"reviseit/studio-bank-manifest@1"}';
$$;
create function public.studio_register_snapshot(p_module text, p_manifest_sha256 text, p_files jsonb, p_records jsonb, p_links jsonb, p_origin text, p_purpose text,
 p_parent uuid, p_changeset uuid, p_created_by text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.studio_modules; s private.studio_snapshots; mb private.studio_blobs; mt text; fe jsonb;
begin
 select * into m from private.studio_modules where module_id=p_module;
 if not found then raise exception 'Module not enrolled in Studio'; end if;
 if p_origin not in ('operator_import','candidate') or p_purpose not in ('canonical','rehearsal') then raise exception 'Invalid snapshot origin or purpose'; end if;
 if p_origin = 'candidate' and p_purpose <> 'rehearsal' then raise exception 'Candidate snapshots are valid for rehearsal only'; end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then raise exception 'Snapshot needs files'; end if;
 for fe in select * from jsonb_array_elements(p_files) loop
  if not private.studio_safe_path(fe->>'path') and fe->>'path' !~ '^data/archive/[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$' then raise exception 'Unsafe snapshot path: %', left(fe->>'path',120); end if;
  if coalesce(fe->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid snapshot digest'; end if;
 end loop;
 mt := private.studio_manifest_text(p_module,p_files);
 if private.studio_sha(mt) <> p_manifest_sha256 then raise exception 'Manifest digest does not match the file list'; end if;
 select * into s from private.studio_snapshots where module_id=p_module and manifest_sha256=p_manifest_sha256 and origin=p_origin and purpose=p_purpose;
 if found then return jsonb_build_object('snapshotId',s.id,'created',false,'manifestSha256',s.manifest_sha256); end if;
 for fe in select * from jsonb_array_elements(p_files) loop
  perform private.studio_register_blob(p_module,fe->>'sha256',(fe->>'size')::bigint,coalesce(fe->>'mediaType','application/octet-stream'));
 end loop;
 mb := private.studio_register_blob(p_module,p_manifest_sha256,octet_length(convert_to(mt,'UTF8')),'application/json');
 insert into private.studio_snapshots(module_id,manifest_sha256,manifest_blob_id,origin,purpose,subject_adapter,parent_snapshot_id,changeset_id,file_count,created_by)
  values(p_module,p_manifest_sha256,mb.id,p_origin,p_purpose,m.subject_adapter,p_parent,p_changeset,jsonb_array_length(p_files),coalesce(p_created_by,session_user)) returning * into s;
 insert into private.studio_snapshot_files(snapshot_id,path,sha256,blob_id)
  select s.id,f->>'path',f->>'sha256',b.id from jsonb_array_elements(p_files) f join private.studio_blobs b on b.module_id=p_module and b.sha256=f->>'sha256';
 perform public.studio_replace_snapshot_index(s.id,p_records,p_links);
 perform private.studio_event(p_module,null,'operator',session_user,'snapshot_registered',jsonb_build_object('snapshot',s.id,'manifest',p_manifest_sha256,'origin',p_origin,'purpose',p_purpose));
 return jsonb_build_object('snapshotId',s.id,'created',true,'manifestSha256',s.manifest_sha256);
end $$;
-- Rebuild the derived record projection from the named snapshot (adapter output). Never edited by hand.
create function public.studio_replace_snapshot_index(p_snapshot uuid, p_records jsonb, p_links jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.studio_snapshots; rec jsonb; n integer;
begin
 select * into s from private.studio_snapshots where id=p_snapshot;
 if not found then raise exception 'Snapshot not found'; end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_typeof(coalesce(p_links,'[]'::jsonb)) <> 'array' then raise exception 'Invalid record projection'; end if;
 for rec in select * from jsonb_array_elements(p_records) loop
  if not exists(select 1 from private.studio_snapshot_files where snapshot_id=s.id and path=rec->>'path' and sha256=rec->>'sha256') then
   raise exception 'Record % does not match a snapshot file', rec->>'recordId';
  end if;
 end loop;
 delete from private.studio_record_links where snapshot_id=s.id;
 delete from private.studio_record_index where snapshot_id=s.id;
 insert into private.studio_record_index(snapshot_id,record_kind,record_id,parent_record_id,path,sha256,status)
  select s.id,x->>'recordKind',x->>'recordId',coalesce(x->>'parentRecordId',''),x->>'path',x->>'sha256',coalesce(x->>'status','active') from jsonb_array_elements(p_records) x;
 insert into private.studio_record_links(snapshot_id,from_kind,from_id,to_kind,to_id,required)
  select distinct on (x->>'fromKind',x->>'fromId',x->>'toKind',x->>'toId') s.id,x->>'fromKind',x->>'fromId',x->>'toKind',x->>'toId',coalesce((x->>'required')::boolean,false)
  from jsonb_array_elements(coalesce(p_links,'[]'::jsonb)) x;
 get diagnostics n = row_count;
 return jsonb_build_object('snapshotId',s.id,'records',jsonb_array_length(p_records),'links',n);
end $$;
-- Snapshot acceptance is separate from live-release activation. Rehearsal lineage can never be accepted.
create function public.studio_accept_snapshot(p_module text, p_snapshot uuid, p_expected_previous uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.studio_modules; s private.studio_snapshots; c private.studio_changesets;
begin
 select * into m from private.studio_modules where module_id=p_module for update;
 if not found then raise exception 'Module not enrolled in Studio'; end if;
 select * into s from private.studio_snapshots where id=p_snapshot and module_id=p_module;
 if not found then raise exception 'Snapshot not found in this module'; end if;
 if s.purpose <> 'canonical' or s.origin <> 'operator_import' then raise exception 'Rehearsal snapshots cannot update the canonical pointer'; end if;
 if m.accepted_snapshot_id is not distinct from s.id then return jsonb_build_object('acceptedSnapshotId',s.id,'changed',false); end if;
 if m.accepted_snapshot_id is distinct from p_expected_previous then raise exception 'Accepted bank changed'; end if;
 if s.changeset_id is not null then
  select * into c from private.studio_changesets where id=s.changeset_id;
  if c.state not in ('applied','already_applied') or c.purpose <> 'canonical' then raise exception 'Snapshot lineage change set is not applied'; end if;
 end if;
 perform private.studio_require_blobs(array[s.manifest_blob_id]);
 insert into private.studio_snapshot_acceptances(module_id,snapshot_id,previous_snapshot_id,accepted_by) values(p_module,s.id,m.accepted_snapshot_id,session_user);
 update private.studio_modules set accepted_snapshot_id=s.id, revision=revision+1, updated_at=now() where module_id=p_module;
 perform private.studio_event(p_module,null,'operator',session_user,'snapshot_accepted',jsonb_build_object('snapshot',s.id,'previous',m.accepted_snapshot_id));
 return jsonb_build_object('acceptedSnapshotId',s.id,'changed',true,'previous',m.accepted_snapshot_id);
end $$;
-- Releases (assignment 04) may only build from accepted canonical lineage. This check is the boundary.
create function public.studio_release_eligibility(p_snapshot uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.studio_snapshots;
begin
 select * into s from private.studio_snapshots where id=p_snapshot;
 if not found then raise exception 'Snapshot not found'; end if;
 if s.purpose <> 'canonical' or s.origin <> 'operator_import' then raise exception 'Rehearsal lineage cannot be registered or activated'; end if;
 if not exists(select 1 from private.studio_snapshot_acceptances where snapshot_id=s.id) then raise exception 'Snapshot has no accepted lineage'; end if;
 return jsonb_build_object('snapshotId',s.id,'eligible',true,'manifestSha256',s.manifest_sha256);
end $$;
create function public.studio_export_changeset(p_changeset uuid, p_purpose text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c private.studio_changesets; s private.studio_snapshots;
begin
 select * into c from private.studio_changesets where id=p_changeset;
 if not found then raise exception 'Change set not found'; end if;
 if c.state <> 'authorised' then raise exception 'Change set is %, not authorised', c.state; end if;
 if c.purpose <> p_purpose then raise exception 'Change set purpose is %; refusing % apply', c.purpose, p_purpose; end if;
 perform private.studio_require_blobs(array(select after_blob_id from private.studio_changeset_entries where changeset_id=c.id));
 select * into s from private.studio_snapshots where id=c.base_snapshot_id;
 return jsonb_build_object('changesetId',c.id,'moduleId',c.module_id,'purpose',c.purpose,'manifest',c.manifest,'manifestText',c.manifest::text,'manifestSha256',c.manifest_sha256,
  'base',jsonb_build_object('snapshotId',s.id,'manifestSha256',s.manifest_sha256,
   'files',(select coalesce(jsonb_object_agg(path,sha256),'{}'::jsonb) from private.studio_snapshot_files where snapshot_id=s.id)),
  'entries',(select coalesce(jsonb_agg(jsonb_build_object('path',e.path,'action',e.action,'before',e.before_sha256,'after',e.after_sha256,'key',b.immutable_key) order by e.path),'[]'::jsonb)
   from private.studio_changeset_entries e join private.studio_blobs b on b.id=e.after_blob_id where e.changeset_id=c.id));
end $$;
create function public.studio_record_apply_result(p_changeset uuid, p_manifest_sha256 text, p_result text, p_receipt jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_changesets;
begin
 if p_result not in ('applied','already_applied','rejected') then raise exception 'Invalid apply result'; end if;
 select * into c from private.studio_changesets where id=p_changeset for update;
 if not found then raise exception 'Change set not found'; end if;
 if c.manifest_sha256 <> p_manifest_sha256 then raise exception 'Change set changed'; end if;
 if c.state = p_result then return jsonb_build_object('changesetId',c.id,'state',c.state,'changed',false); end if;
 if c.state <> 'authorised' then raise exception 'Change set is %', c.state; end if;
 update private.studio_changesets set state=p_result, apply_receipt=p_receipt, updated_at=now() where id=c.id;
 perform private.studio_event(c.module_id,c.run_id,'operator',session_user,'changeset_'||p_result,jsonb_build_object('changeset',c.id,'receipt',p_receipt));
 return jsonb_build_object('changesetId',c.id,'state',p_result,'changed',true);
end $$;

-- ───────────────────────────── grants ─────────────────────────────
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'studio\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated, service_role, reviseit_studio_operator', f.sig);
 end loop;
end $$;
grant usage on schema public to reviseit_studio_operator;
grant execute on function public.studio_is_editor(), public.studio_create_upload(text,text,bigint,text,text,text,uuid), public.studio_upload_session(uuid),
 public.studio_prepare_commit(uuid,text,bigint,text), public.studio_commit_upload(uuid), public.studio_read_blob(uuid), public.studio_read_artifact(uuid),
 public.studio_report_integrity(uuid,text,text), public.studio_begin_recovery(uuid,text), public.studio_complete_recovery(uuid),
 public.studio_create_source(text,text,jsonb,jsonb,uuid), public.studio_revise_source(uuid,integer,jsonb,jsonb,text,uuid),
 public.studio_start_run(uuid,integer,text,uuid,text,text,uuid), public.studio_rebase_run(uuid,integer,uuid,uuid,text,text,text,uuid),
 public.studio_cancel_stage(uuid,text,uuid), public.studio_cancel_run(uuid,text,uuid), public.studio_retry_stage(uuid,integer,text,uuid),
 public.studio_retry_provider_operation(uuid,integer,text,uuid), public.studio_revise_artifact(uuid,uuid,text,uuid),
 public.studio_create_draft(uuid,text,text,text,text,uuid,text,uuid), public.studio_discard_draft(uuid,text,uuid),
 public.studio_create_maintenance_changeset(text,uuid,jsonb,text,uuid), public.studio_authorise_changeset(uuid,text,text,jsonb,uuid),
 public.studio_gate_view(uuid,text), public.studio_record_decision(uuid,text,integer,uuid[],text,text,jsonb,jsonb,uuid),
 public.studio_overview(), public.studio_run_view(uuid) to authenticated;
grant execute on function public.studio_claim(text), public.studio_heartbeat(uuid,uuid), public.studio_worker_read(uuid,uuid,uuid),
 public.studio_put_output(uuid,uuid,text,text,text,bigint,text,text,jsonb,jsonb,uuid), public.studio_put_changeset(uuid,uuid,jsonb,uuid),
 public.studio_complete(uuid,uuid,uuid[]), public.studio_fail(uuid,uuid,text,boolean), public.studio_mark_uncertain(uuid,uuid,text),
 public.studio_provider_prepare(uuid,uuid,text,text), public.studio_provider_dispatched(uuid,uuid,uuid),
 public.studio_provider_result(uuid,text,text,text,jsonb,uuid,uuid), public.studio_expire_leases(), public.studio_worker_report_integrity(uuid,text,text),
 public.studio_expire_uploads(), public.studio_gc_claim(text), public.studio_gc_finish(text), public.studio_storage_inventory() to service_role;
grant execute on function public.studio_enrol_module(text,text), public.studio_register_snapshot(text,text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text),
 public.studio_replace_snapshot_index(uuid,jsonb,jsonb), public.studio_accept_snapshot(text,uuid,uuid), public.studio_release_eligibility(uuid),
 public.studio_export_changeset(uuid,text), public.studio_record_apply_result(uuid,text,text,jsonb), public.studio_expire_uploads(),
 public.studio_storage_inventory() to reviseit_studio_operator;
commit;
