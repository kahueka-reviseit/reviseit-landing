# Grouped questionnaire integration

This is the teacher-visible version 2 form contract and reusable input component. It is connected locally to the order screen, submission endpoint and database validation through migration 009. Migration 010 adds the private generation plan consumed by the local multi-question worker integration. Neither change has been deployed.

A form has a frozen revision, one section per selected order line, and shared paper settings. Field identifiers are scoped to their order line, so selecting the same specification twice cannot mix its answers. Marks are frozen display values. Choice labels are separate from stable identifiers. Each authored field explicitly permits or refuses automatic choice, free text and omission. The component makes no default selections on behalf of the teacher.

The closed form deliberately excludes private source paths, specifications, source hashes, generation prompts and provenance. Source bindings remain in the private order snapshot. A matching revision is a consistency check, not proof of publication or payment.

The validator enforces exact fields, choice membership, explicit answer variants and a 64,000-byte encoded answer ceiling. The database must independently enforce the same contract against the purchased order before dispatch. Client validation is not an access or payment gate.

Before activation:

1. Deploy the database migration together with the application only when the worker capability is ready. Existing version 1 orders remain supported.
2. Bind a purchased order to its frozen reviewed form and private generation snapshot. Do not expose the form from the pre-purchase catalogue.
3. Verify the purchased order endpoint through the hosted screen. The local endpoint has a bounded body, database validation and readable submitted-answer receipts.
4. Enable dispatch only for a worker capable of processing every selected item and assembling the complete reviewed paper.
5. Exercise the real hosted selection, purchase entitlement, answer, generation and four-document review journey.

Current tests exercise repeated field names, closed data boundaries, exact revision and section binding, optional/automatic/written choices, encoded size bounds, independent input controls, frozen mark display and disabled inputs. Database and order-screen tests additionally cover submission retries, exact purchased-form matching, cross-school isolation and labelled receipts. They do not prove payment gating, authored content quality, publication approval or generation support.


Migration 010 binds the private generation plan to the form revision, ordered line identifiers, marks, module and release. Once assigned, the plan cannot be changed or cleared; it must be assigned before submission. Worker claims include it, while teacher order listings exclude it. Legacy orders without a plan retain their existing claim shape. Four database tests cover worker-only disclosure, immutability, late assignment and inconsistent marks. These are local database tests, not evidence of a completed purchase or deployment.

Migration 011 adds authored admission policies to new version-two private generation plans. The content service derives `answerPolicy` from each registered profile, includes it in the frozen form revision and checks it against the original profile again before generation. The policy never enters the teacher form or order read model. Prior version-one internal test plans remain supported; they do not gain a policy retrospectively.

On submission the database checks exact instance scope and authored choice dependencies before changing order state or creating a submission event. Transitive dependencies account for delegated choices without rewriting the submitted answers. A rejection identifies the question and field with an authored clarification, preserving the paid order in `awaiting_answers`. Source-policy validation, queue refusal, retries and response privacy are covered by saved tests. This remains undeployed and does not add purchasing, content approval or Jev blocking authority.


Migration 012 adds **local, opt-in shadow evidence storage**, with no automatic caller yet. An operator can call `capture_semantic_observation(order_id, checks_sha256)` after successful submission in a separate transaction. It captures the exact accepted answers, issued form, private generation plan, release and submission identity. The returned SHA-256 identifies the database's canonical JSON snapshot, not a provider request. Checks must be content-addressed by the caller; the database does not verify the check file exists. The result recorder binds to that snapshot and preserves a raw response, a confirmed non-dispatch, or an uncertain outcome. It does not interpret probabilities or claim provider authenticity.

Both functions are service-role-only; neither is exposed by the existing worker gateway. Captures and results are immutable, duplicate receipts are idempotent, and changed inputs or replacement results are refused. An uncertain outcome remains uncertain. There is no observer queue claim or automated retry. Neither function updates orders, answers, generation events, payments, reviews or document access. No trigger runs during teacher submission, so observation work cannot roll back admission. They are not spending controls or permission to send private data.

Saved database tests cover opt-in defaults, accepted-input binding, teacher/anonymous refusal, idempotency, stale input/result refusal, evidence immutability, and generation continuing despite a synthetic warning. No real provider transport is tested. Before live integration: add an independently authenticated observer process with reviewed checks, request-level identity, durable pre-dispatch accounting, bounded spending and no ambiguous retries; obtain permission for any private data transfer; test hosted isolation. Migration 012 is undeployed. Teacher-facing clarification stays disabled until held-out evaluation meets the recorded quality criteria.


The local `/api/internal/observations` endpoint exposes only `capture` and `record`, using a separate `SEMANTIC_OBSERVER_TOKEN` of at least 32 characters. It refuses configuration that reuses `CONTENT_WORKER_TOKEN`. Keep it unset until an observer is intentionally enabled. Only the application server holds the database service credential; the observer receives its own token. A capture supplies `{action:"capture", id:orderId, checksHash}`; a result supplies `{action:"record", id:observationId, inputHash, outcome, evidence}`. Unknown fields/actions are refused. Actual streamed bodies are bounded to 70,000 bytes; JSON evidence is bounded to 64,000 bytes and the database independently enforces its canonical-text size limit. Responses are private and non-cacheable.

Nineteen saved endpoint tests cover missing/shared/incorrect credentials, forbidden generation actions, exact operation mapping, raw uncertainty preservation, malformed/oversized evidence, streamed-body limits, private error handling and no automatic retry. These use mocked database transport; the separate database suite exercises the actual functions and role boundaries. An end-to-end hosted observer run remains unproven. No observer credential was created and no deployment or model request accompanies this endpoint.
