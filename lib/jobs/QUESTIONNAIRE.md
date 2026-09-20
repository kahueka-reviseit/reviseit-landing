# Grouped questionnaire integration

This is the teacher-visible version 2 form contract and reusable input component. It is not yet connected to order submission or hosted generation.

A form has a frozen revision, one section per selected order line, and shared paper settings. Field identifiers are scoped to their order line, so selecting the same specification twice cannot mix its answers. Marks are frozen display values. Choice labels are separate from stable identifiers. Each authored field explicitly permits or refuses automatic choice, free text and omission. The component makes no default selections on behalf of the teacher.

The closed form deliberately excludes private source paths, specifications, source hashes, generation prompts and provenance. Source bindings remain in the private order snapshot. A matching revision is a consistency check, not proof of publication or payment.

The validator enforces exact fields, choice membership, explicit answer variants and a 64,000-byte encoded answer ceiling. The database must independently enforce the same contract against the purchased order before dispatch. Client validation is not an access or payment gate.

Before activation:

1. Add database validation and tests for version 2 while preserving existing version 1 orders.
2. Bind a purchased order to its frozen reviewed form and private generation snapshot. Do not expose the form from the pre-purchase catalogue.
3. Connect the order screen, answer endpoint and byte limit together; preserve submission idempotency and submitted-answer readability.
4. Enable dispatch only for a worker capable of processing every selected item and assembling the complete reviewed paper.
5. Exercise the real hosted selection, purchase entitlement, answer, generation and four-document review journey.

Current tests exercise repeated field names, closed data boundaries, exact revision and section binding, optional/automatic/written choices, encoded size bounds, independent input controls, frozen mark display and disabled inputs. They do not prove payment gating, authored content quality, publication approval or generation support.
