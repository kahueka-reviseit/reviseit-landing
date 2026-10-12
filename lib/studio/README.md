# Curriculum Studio foundation (assignment 02)

Corrected local candidate. Studio migrations 039–043 are local-only; this build does not deploy them.

## What exists

- `supabase/migrations/202610080039_studio_foundation.sql`: additive schema and commands. Private
  `studio_*` tables (row security on, no direct grants); every command is a security-definer function.
  Editors (`authenticated` + confirmed account reviewer + `private.studio_editors`), the Studio worker
  gateway (`service_role`, reached through `STUDIO_WORKER_TOKEN`) and the local operator
  (`reviseit_studio_operator`) each get only their own functions.
- `202610080040_studio_verification_and_apply.sql` closes verification and apply boundaries. Only
  server-side `service_role` calls can attest an upload or recovery; their actor is derived from the
  authenticated editor by `requireStudioEditor().verifiedRpc`. The database rechecks that actor's
  editor status and upload ownership. Browser-role direct attestations are refused. The same server
  service client is used by the worker gateway, whose closed action list never exposes attestations.
  Completion resolves artifact-to-blob identities; the gateway rereads output bytes immediately
  before completion, and the database locks/checks their integrity rows. There is still no R2/Postgres
  transaction; later deletion is discovered by verified reads/reconciliation and blocks consumption.
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

For full Studio decommission only, back up and export all Studio and financial evidence before
running `rollback/202610080039_studio_foundation.down.sql`. Remove the corresponding Studio migration
history records with the process that applied them. Forward recovery applies all Studio migrations
in order (currently 039–043); `tests/database/studio-migration.test.ts` proves they leave every existing
object byte-identical. Storage objects under `studio/` are removed separately and only after export.
This destructive rollback is not a financial reset or the routine downgrade path for migration 043.

Migration 040 replaces only Studio functions. Deploy it with its matching server callers; old callers
lack the trusted actor argument and fail closed. Existing pre-040 change sets do not have the newly
bound change-set ID and must be recreated and reviewed before local apply. Do not backfill approved
hashes or roll back to the vulnerable attestation grants. This candidate has no production Studio data.
The existing funded-order/teacher queue surface is checked for unchanged definitions and behaviour.

## Recorded execution budget (migration 043)

Five private tables hold immutable recorded-mode capability/pricing contracts, shared trial caps,
immutable run bindings, per-attempt reservations and append-only reconciliation receipts. Values are
integer micro-US dollars. A trial row serializes admission across runs; the normal run/stage lease
fence is acquired first. Stage caps span replacement stage IDs within the same run and stage key.

The operator grants a run allowance before its first dispatch. The worker can reserve and settle,
but cannot grant, change caps, release uncertain charges or operate on the tables directly. The
gateway derives request limits from reconstructed bytes, including images, tools and retained history,
and checks bundle/model/capability/pricing pins against the immutable contract. No live pricing or
endpoint capability is inferred from synthetic fixtures. The current gateway's body limit is lower
than the execution helper's four-MiB ceiling; large papers require batches.

A reservation is held until known actual cost is recorded or an operator reconciles evidence.
Unknown cost blocks output acceptance and further admission. Over-bound actual cost is recorded and
halts work. Cancellation does not refund a sent request. Explicit retries use separately numbered
attempts; earlier reservations/charges remain, and an unreconciled ended/uncertain attempt prevents
the next dispatch. Operators can release only provably unsent reservations as unsent. A replay uses
the existing receipt without reserving or billing twice.

The new exchange always requires a budget. Original mock-v0 protocol fixtures without a budget remain
available. Every live profile is disabled at dispatch, and contracts accept only recorded mode.
No contract provisioning interface, spending UI or OpenRouter network adapter is included.

Migration 043 also qualifies provider operations by stage identity: separate runs pinning identical
bytes no longer share an attempt. Historical operation rows are reused by their own stage/key tuple;
their keys and settlement history are not rewritten.
