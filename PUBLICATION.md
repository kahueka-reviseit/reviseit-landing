# Catalogue publication delivery

This adapter connects a reviewed private catalogue release to the teacher database. It does not approve content. Migration `202609130006_catalogue_publication.sql` adds a restricted importer, gate receipts and immutable import history. It follows migrations 001 through 005 and has not been applied to the hosted project.

The real catalogue is still a migration candidate. Original business content remains authoritative. No real release, school access assignment, automatic publication workflow or source cutover is included here.

## Three responsibilities

1. **Existing content gate:** the content owner or founder approves through the existing `publishCatalogue` procedure. Its trusted executor checks the current library version and content digest, complete private parameter-form bindings, duplicate-skill pairings, safe descriptions, accurate preview metadata and reviewed raster thumbnails. The release is the existing library version, not a separate application version.
2. **Receipt registration:** the trusted gate operator records that decision in `private.catalogue_gate_receipts`, including the exact safe payload and expected current release. This requires database-owner access. There is deliberately no browser or publisher approval endpoint. Operational registration remains manual until the existing gate executor is connected; this branch does not manufacture approval from a draft candidate.
3. **Delivery:** a dedicated database login inheriting `reviseit_catalogue_publisher` submits that exact payload and receipt identifier. The function validates, inserts and activates it in one transaction. That role cannot approve receipts, directly edit catalogue tables or grant school access. Teacher requests continue to use their own authenticated client and existing row policies.

The importer's receipt check proves an authorised operator registered the exact payload. It does **not** independently prove that the private source is still current, that the forms are complete or that prose/images are safe. Those checks belong to the existing gate. The executor must compare source state again before delivery and revoke unused stale approvals. The digest and approval identity are retained for audit and never sent in teacher responses.

## Safe transport format

The input is the published form of `reviseit/catalogue@2`. Root fields are exactly `schema`, `status`, `module`, `release`, `contentDigest` and `entries`. Status must be `published`; changing a draft status alone never grants publication permission.

`module` has an identifier and name. Each entry has `id`, `code`, `kind`, `paper`, `title`, `topic`, non-empty `description`, and integer `marks: {min,max}`. Its identifier is `structured:<code>` or `mcq:<code>`, qualified by the module and release in storage. Optional `preview` follows [WORKSPACE.md](WORKSPACE.md#question-outlines-and-blooms-categories). Optional `thumbnail` contains only base64 `png` and `alt`. Delivery must rasterize and review private thumbnail sources before creating this transport; private paths or raw SVG are rejected.

The importer rejects unknown fields, duplicate identifiers, invalid bounds, unsupported cognitive labels, empty releases and oversized manifests. Limits are 500 entries, 20 MB of JSON, 350,000 base64 characters per thumbnail, and the existing preview bounds. PNG checks verify the signature and encoding; they do not replace image decoding, rasterization or human review in the gate. The CLI also bounds the input file before parsing. Private forms, source evidence, specifications and generator instructions must never enter this payload or the public repository.

## Record the existing gate decision

Use a trusted administrative connection and bound parameters. Do not put connection strings or real payloads in this repository, shell history, application environment variables or GitHub logs. The following is the registration statement for an already completed gate decision, not a means of approving one:

```sql
insert into private.catalogue_gate_receipts (
  id, gate_action, gate_record_id, reviewer_id, approved_at,
  expected_previous_release, forms_digest,
  duplicate_skill_pairings_flagged, payload
) values ($1::uuid, 'publishCatalogue', $2, $3, $4::timestamptz,
          $5, $6, true, $7::jsonb);
```

Supply the receipt UUID, durable gate-record identifier, real reviewer identifier, approval time, expected current library release (null only for a new module), SHA-256 digest of the reviewed private form bindings, and exact approved transport. The digest is evidence of the gate's checks, not a substitute for performing them. Retain the gate record and private bindings in the private content system. An operator can revoke an unused receipt by setting its `revoked_at`; revocation does not automatically withdraw an already imported release.

The delivery login must be provisioned separately with only `LOGIN`, database connection permission and membership of `reviseit_catalogue_publisher`. Use a secret-managed password and encrypted remote connection. Do not grant browser roles membership or use a database owner/service-role credential for routine delivery. Role membership is inherited; the CLI does not need to switch roles. Receipt registration and publisher provisioning are not run by application startup or migrations.

## Dry run and apply

Use Node 24 and install this repository's development dependencies (`npm ci`); the operational CLI uses `pg`. Set `CATALOGUE_DATABASE_URL` securely to the dedicated publisher connection. This variable belongs to the operator/worker environment, not the deployed teacher application.

```sh
node scripts/import-catalogue.mjs /private/path/approved-catalogue.json <receipt-uuid>
node scripts/import-catalogue.mjs /private/path/approved-catalogue.json <receipt-uuid> --apply
```

The first command performs the full import inside a transaction and rolls it back. Only `--apply` commits. Both use a 30-second statement timeout and 10-second lock timeout. Success output includes status, module, release and entry count when newly imported, with `mode` distinguishing rollback from committed delivery. Errors intentionally omit connection details and payloads.

A dry run temporarily takes publication locks; it is not a lock-free read. The apply operation repeats every check, so a successful dry run is not a reservation. Exact payload comparison uses PostgreSQL JSONB equality: object key order is irrelevant, while array order and field values matter.

## Atomicity, retries and teacher behaviour

Imports for the same module serialize, including first publication. The receipt names the expected predecessor. If another release wins first, a stale import fails; the operator must return to the existing gate rather than rewrite the expected predecessor to force it through.

All entries, their diagrams and previews, import history and the current-release pointer commit together. Failure leaves the previous catalogue active. Readers on other connections see the previous committed release until commit. A lost success response can be retried with the same receipt and payload: it returns `already-imported`. Retrying an older imported release never reactivates it. Imported catalogue rows cannot be inserted into, edited or deleted through ordinary database writes; corrections require a new reviewed library release. Database owners can technically alter these protections, so owner access remains trusted administration.

No teacher application deployment is needed for a content update. Newly loaded workspace/search requests use the current release. Existing selections from an older release require explicit review and saving again. Old-release thumbnails are unavailable through teacher row policies. Publication never assigns curricula to schools and never establishes purchase permission. No parameter forms become accessible.

## Verification and remaining integration

`npm test` covers role denial, exact/revoked receipts, draft and private-field rejection, image/preview import, predecessor checks, immutable releases, retries and forced mid-import failure rollback using an embedded PostgreSQL database.

`npm run test:auth:integration` uses disposable local Supabase only. It checks the real teacher session updating to a new release without restarting the application, stale selection review and response privacy. Two additional PostgreSQL tests verify competing publishers with independent connections and rollback-by-default delivery. GitHub Actions runs this suite; no hosted data is touched.

Before real publication, complete the private forms and human content review, connect receipt registration to the existing gate's source checks, provision the separate delivery login, and adopt/apply the migration stack through the normal deployment process. Those are outstanding integration steps. This adapter does not implement pricing, checkout, paid parameter access, paper generation, final rendering or delivery.
