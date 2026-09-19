# Teacher orders and background worker

This branch connects an authenticated, approved teacher's internal order to the private content service. It does not issue paid orders or implement checkout. Only an owner-provisioned `internal_test` entitlement exists; the browser cannot create it or unlock a parameter form itself.

## Journey and boundaries

`awaiting_answers → queued → generating → awaiting_memo_review → queued → rendering → awaiting_release → released`

An order freezes the teacher, school, module, catalogue release, private adapter key, authored form and formatting snapshot. Exact answers and a submission key are saved atomically. Repeating the same submission returns the same order; changing an already submitted request is refused. The teacher can close the page and return to `/teacher/orders`. Active pages refresh progress every five seconds.

The gateway authenticates a worker bearer secret and uses a server-only service credential. Worker leases last 90 seconds and are renewed every 20 seconds. Reclaim requires the same worker identity and its persistent private volume. The generation engine retains its existing budget ledger and six-stage workflow. A separate network-disabled process renders the four documents.

Paper reviewers are explicitly registered in `private.paper_reviewers`; account-reviewer permission alone is insufficient. They sign in, inspect the memo, and approve its exact hash before generation resumes. They retrieve all four files before approving the pack hash. They cannot approve their own teacher order. The test's reviewer actions are synthetic protocol assertions, not educational certification.

Teacher reads and downloads use the signed-in teacher's own database client. Current account, school and curriculum access is checked, and files stay unavailable until release. Another school, an anonymous caller, or a teacher attempting reviewer access cannot fetch them. Suspension revokes access even after release. All documents are private and responses prohibit caching.

## Configuration

Apply migrations through `202609190008_teacher_jobs.sql` using the existing reviewed migration process. Configure the existing Supabase server settings, `SITE_URL`, and a private random `CONTENT_WORKER_TOKEN` of at least 32 characters. Set the same token on the content worker. Never use a `NEXT_PUBLIC_` variable for either the worker token or service-role credential.

Owner provisioning must select the approved teacher and their current school/module, the reviewed release and adapter, the authored form, and a server-created school formatting snapshot. There is intentionally no general teacher order-creation endpoint. See `generation/PLATFORM-WORKER.md` in content-service for the private registry and persistent state.

## Reusable verification

Ordinary checks: `npm run typecheck`, `npm test`, `npm run build`. `tests/database/jobs.test.ts` exercises submission atomicity, school isolation, leases, review hashes, upload retries and private-table restrictions.

Full local proof: `npm run test:jobs:integration` (after build). Requires a disposable local Supabase database with all migrations and a Linux arm64 Docker worker image built from the matching service branch. The test refuses remote database addresses. It creates synthetic users, schools and an internal order, invokes two separate worker containers and an offline renderer, and saves four Word files, desktop/mobile screenshots and `journey-evidence.json` in ignored `test-results/`. It makes no paid model calls. It also checks anonymous access, bad worker authentication, cross-origin submission, premature download, duplicate submission, other-school access and account revocation.

Set these private environment variables in the test process, never in a committed file:

- Existing application settings: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL=http://127.0.0.1:3101`, `CONTENT_WORKER_TOKEN`.
- `AUTH_TEST_DATABASE_URL` and `AUTH_TEST_SERVICE_KEY` for disposable local owner provisioning. The Playwright configuration removes these two variables from the application server environment.
- `JOB_TEST_DRIVER`: absolute path to content-service `generation/tests/platform_driver.py` on the test host.
- `JOB_TEST_ROOT`: a new Linux directory beginning `/tmp/teacher-job-proof-` for each run.
- `JOB_TEST_SERVICE_ROOT`: Linux checkout containing the matching service tests.
- `JOB_TEST_IMAGE`: sealed image tag, default `reviseit-renderer:teacher-jobs`.
- `JOB_TEST_ENV_FILE`: private file on the Linux host containing `CONTENT_WORKER_TOKEN` and `TEACHER_PLATFORM_URL=http://127.0.0.1:3101`.
- Optional `JOB_TEST_COMMAND_PREFIX`: JSON argument array to execute Linux commands through a local virtual machine. Without it, the driver runs locally. Docker commands use `sudo`.

The worker must reach the test server on Linux loopback port 3101. If the browser/server runs on a separate host, establish a local reverse tunnel first. The renderer has no network. Tests retain private evidence and stop their renderer; they do not erase the local database. Do not run simultaneous proofs against the same renderer name.

## Deployment limitations

This is a verified local integration, not a hosted rollout. Production still needs reviewed migration deployment, persistent worker hosting, secrets provisioning, entitlement/checkout integration and operational backup/retention. Document storage currently uses private database bytes and buffered downloads, bounded to 10 MiB each; hosting response limits must be checked and private object storage or streamed delivery provided before supporting large hosted packs. No performance or multi-worker capacity claim is made. A generation interrupted during an uncertain paid call remains held; it is not retried automatically. An interrupted renderer can require operator recovery. Completion email notifications remain a separately planned later feature.

## Account-only hosted development upgrade

`node scripts/prepare-hosted-migrations.mjs NEW_OUTPUT_DIRECTORY` prepares the seven reviewed migrations after `202609120001`, with hashes and an exact history/schema baseline guard. It never connects to a database. The generated batch preserves the original account migration record, applies all seven missing migrations and their history records in one transaction, and refuses a second application. Three saved database tests exercise preserved accounts/history, changed-baseline refusal and full rollback after an injected late failure.

Before execution, verify the destination is development project `tgaganmgccvrphpfipgy`, take a private database backup, inspect the generated manifest, and confirm the live history still has only the account migration. The SQL guard validates schema/history, not the external project identity; the operator must bind the target connection separately. Never apply it to another project or as a general-purpose migration runner. The standard Supabase command-line migration workflow remains available when authenticated access is configured.

## Separate hosted acceptance proof

`npm run test:jobs:hosted` uses `hosted-jobs.config.ts`. It deliberately starts no local application server and cannot target localhost or a production domain. It requires the exact isolated origin `https://reviseit-teacher-test.vercel.app`, development project `tgaganmgccvrphpfipgy`, and an explicit `synthetic-replay-only` acknowledgement through `HOSTED_JOB_TEST_ORIGIN`, `HOSTED_JOB_TEST_PROJECT`, and `HOSTED_JOB_TEST_CONFIRM`. Keep `VERCEL_AUTOMATION_BYPASS_SECRET` private; browser interception sends it only to that origin and blocks other destinations. Direct test requests disable redirects.

`HOSTED_JOB_TEST_FIXTURE` points to an ignored private JSON file containing `origin`, `project`, `mode: replay`, `entitlement: internal_test`, `serverId`, order/school/otherSchool identifiers, the authored synthetic form, and distinct synthetic teacher/other/reviewer identities with passwords. The test does not provision accounts or modify database schemas. The original local test and its local-only database guard remain unchanged.

`HOSTED_JOB_TEST_DRIVER` must point to a reviewed remote operator driver. Its required commands are `inspect ORDER`, `restart-at-memo ORDER`, and `report ORDER`. The driver is not implemented yet. It must bind the purchased server and prepared order, verify the actual running Compose configuration and absence of paid provider credentials, inspect the persisted ledger and database events, and perform a real host reboot only at the memorandum checkpoint. No constant or invented evidence satisfies this interface. The returned server, boot, worker, memo and ledger identities must come from the live host. The final report must derive submission count and reviewer identities from database events and generation stages from the saved replay receipt.

The hosted test checks a duplicate submission, leaving and returning, server reboot with preserved state, authenticated memo approval and release, identical reviewer/teacher document hashes, and denial of all four downloads to another school. It preserves state on failure and never deletes a hosted resource. Passing its admission unit tests and type checking is preparation only. No hosted journey has yet been executed.
