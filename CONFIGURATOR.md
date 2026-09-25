# Editable paper configuration (CFG01)

New paid orders can keep marks, parts and authored details editable until the
teacher submits. Payment pins what was bought; submission freezes what is
generated. The existing checkout, orders and claims are unchanged while the
configurator is switched off, which is the default.

## Shape

- **Migration `202609240020_configured_orders.sql`** (additive). An operator
  switch (`configure_configurator`, off by default); private classification and
  curriculum-requirements registries (publisher role only, immutable by hash);
  `begin_configured_checkout`, which pins definitions in a
  `reviseit/configured-authored-inputs@1` snapshot under adapter
  `configured-bundle-v1` and stores the teacher's marks as revision 1; every
  accepted revision in `private.paper_configuration_revisions`; server-only
  `save_paper_configuration` (expected revision) and `submit_configured_paper`,
  which locks payment intent, payment, order and configuration in the same order
  as the refund and payment recorders and freezes one
  `reviseit/configured-generation-plan@1`. `claim_paper_job(worker, capabilities)`
  gives configured orders only to workers declaring `configured-plan@1`; a worker
  declaring nothing receives exactly the previous payload. The migration-018
  answer path refuses configured orders.
- **Server engine** (`lib/configurator/`). `contract-v1.ts` evaluates the content
  producer's closed rule grammar and matches every private conformance result.
  `engine.ts` adds order arithmetic, authored fields, readiness and the browser
  projection. Private definitions are read with the service client and never
  returned; the browser receives only `project()` output.
- **Routes.** `GET|PUT /api/teacher/orders/[id]/configuration`,
  `POST .../configuration/submit`, optional `POST .../configuration/hints`.
  Checkout accepts `targets` for the configured path and checks marks against the
  definitions it will pin before any order exists.
- **Jev** (`lib/jev/advisor.ts`). Direct `https://api.typesafe.ai/v1/systemone`,
  never a gateway. `JEV_MODE` is `off` unless set to `shadow` or `advisory` and
  `TYPESAFE_API_KEY` is present. Hints are authored wording; suggestions need a
  click; nothing blocks payment or submission.

## Exact source binding (CFG01A, migration 021)

- `register_catalogue_classification_bound` replaces the unbound registration (now
  withdrawn from the publisher). It requires the classification's specification and
  task sources (module path and SHA-256, top level and dependencies) to equal the
  registered generation bundle's sources for that entry, with the same form revision,
  private manifest, bundle digest, registered workflow and published catalogue content
  digest. Anything else fails with `Classification source version mismatch`.
- Checkout pins a classification only with that exact binding; a classification bound
  to another bundle fails checkout loudly rather than silently dropping the item.
- Plan `reviseit/configured-generation-plan@2` carries each line's `sourceBinding` and
  the teacher's `order`. The database checks both at submission; claims route version 2
  plans only to workers declaring `configured-plan@2`. The worker re-checks the binding
  against the pinned snapshot, its retained bundle and workflow, and the prepared source
  bytes, and never substitutes its own.
- Only supported multiple-choice types may repeat in a selection, and only while the
  configurator is on; the migration-018 checkout refuses repeated selections.
- Contract version 2 classifications (grouped Bloom candidates) are evaluated with their
  groups kept as separate buckets; curriculum mappings stay in profile data.

Worker registry for a coherent candidate (private, additive): retain its bundles under
`bundles/<private manifest SHA-256>` and add its workflow directory to the `workflows`
map under its manifest hash. Existing entries stay for issued orders.

## Activation order

1. Pass the sealed Linux image suites for the service branch (see below).
2. Deploy a worker whose private registry has a `configured-bundle-v1` adapter of
   kind `product_workflow`, with the candidate bundles and workflows retained. It
   declares `configured-plan@1` and `@2`; older workers never claim configured orders.
3. Back up, then apply migrations 020 and 021. Neither changes an existing row.
4. Deploy this application. With the switch off, checkout behaves as before.
5. Publish the candidate catalogue releases and register their forms and workflows
   through the existing publication path (a separate, coordinated step), then
   register profiles and bound classifications through the publisher role.
6. `select public.configure_configurator(true,'reason')` as the database owner.

Rollback: switch off (new checkouts return to the migration-019 path). Already
configured orders keep their pinned definitions and remain editable/submittable;
keep the capable worker until they are released.

## Tests

`npm test` (engine, contract, journey, Jev, database). Private conformance:
`CONFIGURATOR_CONTRACT_DIR=<verified contract copy> npx vitest run tests/unit/configurator-conformance.test.ts`.
Real content: `CONFIGURATOR_CONTENT_REGISTRATIONS=<private file>`. Real PostgreSQL
races: `REVISEIT_CONCURRENCY_DATABASE_URL=postgres://...@127.0.0.1:PORT/postgres npx vitest run --config concurrency.config.mts --no-file-parallelism`
(the two files create the same roles, so run them one after another). Version 2
conformance: `CONFIGURATOR_CONTRACT_V2_DIR=<verified contract-v2 copy>`. Bound
registrations: `CONFIGURATOR_BOUND_REGISTRATIONS` and `CONFIGURATOR_OLD_BOUND_REGISTRATIONS`.
Synthetic screens: `npm run preview:configurator`.
