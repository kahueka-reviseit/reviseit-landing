# Curriculum Studio foundation (assignment 02)

Candidate for Codex review. Not deployed; the migration is not applied to any hosted database.

## What exists

- `supabase/migrations/202610080039_studio_foundation.sql`: additive schema and commands. Private
  `studio_*` tables (row security on, no direct grants); every command is a security-definer function.
  Editors (`authenticated` + confirmed account reviewer + `private.studio_editors`), the Studio worker
  gateway (`service_role`, reached only through `STUDIO_WORKER_TOKEN`) and the local operator
  (`reviseit_studio_operator`) each get only their own functions.
- `lib/studio/`: storage interface with local emulation and private R2 (S3 Signature Version 4),
  upload finalisation, verified reads, explicit recovery, reconciliation, the worker gateway handler and
  strict coverage arithmetic. Rollback SQL in `rollback/`.
- `app/api/internal/studio/route.ts`: worker gateway. Refuses to run without its own token of at least
  32 characters, or when that token equals `CONTENT_WORKER_TOKEN`.
- `app/(accounts)/admin/studio/`: sources, persistent runs, stage attempts, revisions, the five reviews,
  explicit retry and cancellation, controlled file reads. Reached at `/admin/studio`; no navigation link.

## Authority (C01)

The accepted bank is the business working tree on the operator's Mac. Studio storage holds verified
immutable copies (snapshots, sources, outputs) and proposals (change sets). Only the operator apply tool
(worker checkout `studio/operator/`) writes the bank, and only after a G5 authorisation. Candidate
snapshots and rehearsal runs can never update the accepted pointer or pass release eligibility.

## Configuration (server-only)

`STUDIO_WORKER_TOKEN`; `STUDIO_STORAGE=r2` with `STUDIO_R2_ENDPOINT`, `STUDIO_R2_BUCKET`,
`STUDIO_R2_ACCESS_KEY_ID`, `STUDIO_R2_SECRET_ACCESS_KEY`; or, outside production only,
`STUDIO_STORAGE=local` with `STUDIO_LOCAL_STORAGE_DIR` and `STUDIO_LOCAL_SIGNING_SECRET`. Owner SQL
provisions editors: `insert into private.studio_editors(user_id) values ('USER_UUID');` (the person must
already be a confirmed account reviewer). The operator enrols a module with `studio_enrol_module`.

## Tests

```sh
npm ci
npx vitest run tests/database/studio-*.test.ts tests/unit/studio-*.test.ts
REVISEIT_CONCURRENCY_DATABASE_URL=postgresql://USER:PASS@127.0.0.1:PORT/postgres npx vitest run --config concurrency.config.mts --no-file-parallelism
STUDIO_E2E_WORKER=/path/to/worker-checkout STUDIO_E2E_PYTHON=python3 npx vitest run tests/database/studio-worker-e2e.test.ts
STUDIO_S3_TEST_ENDPOINT=http://127.0.0.1:PORT npx vitest run tests/database/studio-r2-emulator.test.ts   # loopback S3 emulator
```

The storage tests use local emulation; the emulator test uses a local S3-compatible service. Neither is
evidence of real R2 behaviour. Provider calls are mocked throughout.

## Rollback

Back up and export any Studio evidence, then run `rollback/202610080039_studio_foundation.down.sql`
and remove the migration history record with the process that applied it. Forward recovery is simply
re-applying the migration; `tests/database/studio-migration.test.ts` proves both leave every existing
object byte-identical. Storage objects under `studio/` are removed separately and only after export.
