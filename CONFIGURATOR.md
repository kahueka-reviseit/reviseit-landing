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

## Activation order

1. Deploy a worker whose private registry has a `configured-bundle-v1` adapter of
   kind `product_workflow` (service branch `codex/configurator-01`). It declares
   the capability; configured orders are never claimed by older workers.
2. Apply migration 020 after taking the usual backup. It changes no existing row.
3. Deploy this application. With the switch off, checkout behaves as before.
4. Register requirements profiles and classifications through the publisher
   role (prepared privately; never from this repository).
5. `select public.configure_configurator(true,'reason')` as the database owner.

Rollback: switch off (new checkouts return to the migration-019 path). Already
configured orders keep their pinned definitions and remain editable/submittable;
keep the capable worker until they are released.

## Tests

`npm test` (engine, contract, journey, Jev, database). Private conformance:
`CONFIGURATOR_CONTRACT_DIR=<verified contract copy> npx vitest run tests/unit/configurator-conformance.test.ts`.
Real content: `CONFIGURATOR_CONTENT_REGISTRATIONS=<private file>`. Real PostgreSQL
races: `REVISEIT_CONCURRENCY_DATABASE_URL=postgres://...@127.0.0.1:PORT/postgres npx vitest run --config concurrency.config.mts`.
Synthetic screens: `npm run preview:configurator`.
