# Hosted questionnaire admission test

`npm run test:questionnaire:hosted` runs the grouped questionnaire test against the isolated hosted development deployment. It does not run the existing reboot-and-release journey. It does not start a local application or invoke a model.

Use the existing `requireHostedTarget` environment restrictions and a private `HOSTED_GROUPED_FIXTURE` file. The fixture contains:

- `base`: an existing valid synthetic `requireHostedFixture` account fixture, including distinct approved school identities. Never commit its passwords.
- `order`: a newly provisioned `internal_test` order, distinct from `base.order`.
- `worker`: `questionnaire-probe-<UUID>`, preassigned to `private.paper_orders.worker_id`. No running worker may use this identity.
- `form`: the issued version-two synthetic questionnaire.
- `error`: the authored rule's teacher error text, without the question and field prefixes added by the database.

The synthetic form has `first` (8 marks) with required yes/no `graph` and `reading` fields, `second` (12 marks) with optional `setting` (classroom choice, free text and explicit delegation), and an optional paper-level `notes` text field. Use the exact labels asserted in the test. The private generation plan has the rule: reading yes requires graph yes. Use the synthetic sentinel specification name asserted by the privacy checks. This is an admission fixture, not a supported real generation profile.

Before the browser test, the operator must inspect the actual linked development database and verify that this order is `awaiting_answers`, has no answers or lease, and its worker identity exactly matches the fixture. Merely checking the fixture file is insufficient. Save the pre-existing orders for preservation comparison. Never call the worker claim function with the probe identity.

After success, inspect the database for exactly one `submitted` event despite duplicate submission, zero leases, zero documents, zero semantic observations, and the unchanged worker identity. Cancel only this synthetic order in a guarded transaction and append a `synthetic_probe_cancelled` event. Preserve answers, events and the fixture as private evidence. Confirm all pre-existing orders are unchanged. A failed or interrupted test requires inspection before rerunning; a submitted order needs a fresh fixture, not a reset.

Browser evidence is written through Playwright's output directory, which must be private and ignored. Trace, video and automatic screenshots remain disabled. The proof covers anonymous and other-school denial, private-plan exclusion, grouped fields, exact-rule refusal, focused accessible errors, preserved answers, corrected submission and idempotent replay. It does not prove payment, real-content generation, scientific quality or delivery.

Recorded hosted run, 20 September 2026: application deployment at `e20ecf5`, development project `tgaganmgccvrphpfipgy`, order `98bae620-559b-4ffe-8990-039c0e245942`. Two initial harness failures were corrected: the expected error omitted authored label prefixes, and its alert selector also matched Next.js's route announcer. Neither required a deployed application change. The third run passed. See the business repository's `our product/teacher-worker-hosted/` evidence index for the database follow-up.
