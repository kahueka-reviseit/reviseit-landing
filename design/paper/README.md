# Paper alignment

> **Read the section "Linked components (C15)" first.** It replaces the manual steps under "Maintaining the link" for tokens and for every family that has a master. The older sections record how each earlier screen was aligned.

Source: **Revise It Website**, Paper file `01M36MRM9HCJ4T87N081XDT4MX`, re-read on 28 September 2026 for the C08 renewal. Token export hash: `b9f678ac` (Design System file `01M39C8ME02J6YMB2BGFQFE1V4`, hash `9065ba3a`, uses the same names and values).

## Border and font migration (C08)

The old Website `--color-border` (#898780) meant a control outline. In the accepted system that meaning belongs to `--color-border-strong`; `--color-border` is now the lighter divider (#D5D1C8). Before the change, every application use was inventoried: seven declarations, all input or textarea outlines (`accounts.module.css` 1, `paper.module.css` 2, `configure.module.css` 3 plus the brief text input). All seven now use `--color-border-strong`, so outline contrast is unchanged. The 23 `system-ui` declarations inherited from page 7 now use `var(--font-body)`; Paper page 7 was re-read and its nodes use the body font. `question-context.json` and `paragraph-styles.json` record the refreshed values.

## What is linked

- `snapshot.json` records the 175 exported tokens and selected computed styles used by browser checks.
- `layers.json` records 621 named layers with representative Paper node identifiers.
- `class-map.json` traces 765 existing class names to their replacement across 13 CSS modules. 353 mappings have a corresponding captured Paper layer. The other 412 are explicitly marked application extensions. This is a migration map, not an exhaustive index of every newly added class.
- `app/paper-tokens.css` contains the exact token values. Existing global variable aliases point to these values.

Components use `block__element--modifier` names. CSS Modules remain in use, so browser class names include generated hashes. Repeated Paper layers with the same name can have different context-specific dimensions; the node mapping identifies vocabulary, not a guarantee that every instance has identical styling.

The teacher navigation, catalogue card, questionnaire choices, status layout and switches use values inspected in the current design. Public, account and teacher modules share the exported colours and fonts. This work does not claim a pixel-for-pixel recreation of every artboard. Responsive layout, dynamic content and code-only states remain explicit application responsibilities.

The separate table-and-side-panel proposal and the separate Design System 1.0 proposal were not substituted for the current implemented journey. No question-generation or payment rules were changed.

## Catalogue context (C06)

`question-context.json` records the exported layout and typography of the question-editor reminder (D9 `9R5-0`, D10 `A31-0`, D11 `AFC-0`) and the prompt block, keyed by Paper node with each layer's BEM name. `tests/workspace-browser/question-context.spec.ts` compares the rendered editor with these values. The Paper summary and starter sentence are proposed copy, not published catalogue text, so the application shows the published description or an explicit fallback, and lists the item's authored form questions as prompts.

## Maintaining the link

1. Read the changed artboard through Paper and obtain its layer names, computed styles and token export.
2. Update the recorded source and the corresponding code together. Record new application-only names honestly rather than inventing a Paper node reference.
3. Run `npm run check:paper`, `npm run typecheck` and the browser checks relevant to the changed component.
4. Review screenshots at desktop and phone widths, especially long text and optional states.

`check:paper` checks BEM syntax in all application CSS modules, literal CSS Module references in application and test TypeScript, and token equality against the saved export. It does not contact Paper, validate every dynamic class expression, or prove full visual equivalence. Browser tests exercise the dynamic states.

Browser coverage: `tests/workspace-browser/paper-alignment.spec.ts` compares representative computed values with the saved Paper source and checks long questionnaire hints for overlap. Existing workspace and public browser suites cover interaction continuity. All use local synthetic data.

## Renewed experience (C08)

`experience.json` records the Paper artboards and representative nodes behind `app/(accounts)/experience.module.css`, which carries the shell, notices, status markers, My papers, the paper page, account access, school formatting and the staff workspace. It also lists the deliberate differences where the application shows only data the server actually provides. `accounts.module.css` and `account-nav.tsx` were deleted; `tests/preview/screens.html` renders My papers and the paper page with synthetic orders, and `tests/workspace-browser/experience.spec.ts` checks them at desktop and phone widths.

## Linked components (C15)

Paper 0.5.14 has one native link: a token bound to a node updates that node when the token changes, inside the same file. It has no master and instance link (a duplicate or a clone is a detached copy) and tokens are not shared between files. Everything else here is **synchronisation**: an explicit command with a preview, never automatic inheritance.

### Who owns what

| Property | Owner | How it reaches its uses |
| --- | --- | --- |
| Token values | Design System file in Paper | Native inside that file. `paper:apply` mirrors them into the Website file. `paper:pull` exports them to `app/paper-tokens.css` and the email colour block. |
| Component layers, spacing, type, colour bindings | The master frame on the Design System page "5 Linked components · masters (C15)" | `paper:apply` updates every registered instance in both files. `paper:pull` exports each visual value to `app/paper-components.css`. |
| Variants (tone, density, collapsed, narrow) | `design/paper/components.json` | Same two commands. |
| Behaviour, markup, accessibility, typed inputs | The shared module under `app/(accounts)/system/` | Ordinary imports. |
| Content and state | Each instance | Never synchronised. In Paper: slot text, images, declared overridable properties. In the application: props. |

Nothing flows from code to Paper, and no Paper edit deploys anything.

### Commands

```sh
npm run paper:status                      # compare Paper with the registry; exit 1 on any difference
npm run paper:plan -- --out plan.json     # write the preview
npm run paper:apply -- --plan plan.json   # apply it; refused per instance if Paper changed since the preview
npm run paper:pull                        # export tokens and master values to code (only when status is clean)
npm run paper:pull -- --check             # report whether code is behind Paper, write nothing
npm run paper:restore -- --journal <file> # undo one application, interrupted or complete, after checking Paper
npm run check:paper                       # offline: single definitions, generated files, lock (no Paper needed)
```

Paper must be running with both files open. `apply` takes `--adopt <id,…|all>` for the first synchronisation of an instance, `--accept-master <id,…>` to overwrite a reported manual edit with the master, and `--accept-removal <id,…>` to remove a layer the master dropped even though it holds work (pass the same flag to `plan`). Previews and journals are written to `.paper-link/journal` (ignored by Git) or to `PAPER_LINK_JOURNAL`.

### What is protected

- **Unrecognised edits.** The lock (`link-lock.json`) keeps one hash per synchronised layer. A layer that differs from both its master and its last synchronised state was edited by hand: it is reported as drift and never overwritten without `--accept-master`.
- **Stale previews.** `apply` reads Paper again. An instance or master that changed after the preview is refused.
- **Layers the master drops.** A layer is removed from an instance only when every layer in its subtree is unchanged since the last synchronisation and holds nothing the instance owns (slot text, declared overrides). Otherwise the instance is refused with the reasons, including a hint when the master looks renamed. `--accept-removal` removes it after review; the journal keeps the whole subtree.
- **Interrupted applications (C15A).** Before the first write to a token file or instance, its before-state and every intended operation are saved to the journal. Each operation is marked sent, then acknowledged. If Paper does not confirm a call, that operation is marked uncertain, the journal interrupted, and nothing further is attempted; `apply` exits with code 2. The lock is saved after each verified item only. `status` fails and `apply` refuses to start while such a journal is unrecovered.
- **Recovery is journalled like applying (C15B).** Only Paper's confirmed "not on the canvas" counts as absence; a failed read marks the operation unknown and stops recovery of that item. Each recovery write is recorded as sent before the call and acknowledged after. A recreated layer is recorded with its parent's children before the write, so a retry after a lost reply finds the layer instead of making another. The journal closes as recovered only when every operation is settled. A registered instance that cannot be read is reported as unreadable, not detached.
- **Recovery inspects first.** `paper:restore` puts a change back only where Paper still shows the value that application wrote. Where Paper shows the earlier value, the change never landed. Anything else is left alone and reported, and the journal stays open as `recovery-incomplete`. An insert whose reply was lost is found by layer name and compared by structure. Running it again does nothing more.
- **Missed and detached instances.** `status` searches every active page for frames named like a registered component. An unregistered one, or a registered node that no longer exists, fails the check. Paper keeps a deleted layer readable with no parent, so the reader treats a node without a parent as gone. Every page must be classified as active, illustration or historical.
- **Hand-edited generated files.** `paper-tokens.css` and `paper-components.css` carry a hash of their own content. `check:paper` fails on a hand edit and `paper:pull` refuses to overwrite one without `--force`.
- **Private copies in code.** `check:paper` fails when a stylesheet outside the owner redefines a shared block, when an import site is missing from the registry, or when a stylesheet reads a value no master exports. Deliberate exceptions are listed in the registry with a reason.

### Adding a component or an instance

1. Draw or duplicate the master on the masters page, with `block__element` layer names. Name every layer; names are the addresses.
2. Add it under `masters` in `components.json`: `slots` (text each instance owns), `overridable` (properties each instance owns), `repeat`, `variants`, and its `instances` by file and node identifier.
3. `npm run paper:plan`, read the preview, then `npm run paper:apply -- --plan … --adopt <id>`.
4. `npm run paper:pull`, use the new `--pc-*` values in the one shared stylesheet, and add the family's `code` entry.

Exploratory masters (`"export": false`) are synchronised in Paper but not exported to code.

## Curriculum Studio connected journey (14 October 2026)

Paper file `01M36MRM9HCJ4T87N081XDT4MX`, page `p-L-0`, token hash
`a19978d2`. The five `studio-*.jsx.txt` files are direct Paper exports, not hand-authored
mockups. The build maps Sources (M7Q) to `/admin/studio`, Past paper (K98) to
`/admin/studio/sources/[id]`, Inventory (QQK) to `/admin/studio/runs/[id]/inventory`,
Work queue (MD2) to `/admin/studio/queue`, and Execution history (QVF) to
`/admin/studio/runs/[id]/execution`. Imported historical collections also use the Studio shell.

The shell uses the exported 288 px sidebar, 40 px main inset, 24 px gaps, bone surfaces,
navy admin bar and existing font tokens. Responsive stacking, search/filter interactions,
empty/error states, source download routes and correction controls are application extensions.
The existing shared staff header adds a Studio-only 56 px variant. Other staff headers retain
their existing dimensions. The shared token/component generated files were not rewritten.

Counts, source revisions, artifacts, checkpoints and costs come from authenticated Studio reads.
No example count or approval in Paper is treated as application data. Migration 057 adds only
an editor-protected source-detail read, including retained revision/file metadata; private
object keys are not returned to browser components. Original downloads verify module-owned,
source-linked bytes through the existing storage integrity check. Migration 057 was rehearsed
in a rolled-back hosted transaction and applied on 14 October 2026. Its checks verified editor
permissions and unchanged existing records. The build is deployed to the protected Studio
preview at `https://reviseit-teacher-test-studio-kahuekas-projects.vercel.app`
(deployment `dpl_Exa5VqCPpW3mK5gBsUQZDxqgHcv2`); the teacher production deployment is unchanged.

Marks and Bloom’s use two explicit saves because the existing commands each create a revision.
The source image, classification reason/provenance, original observations, corrections and
revision history remain accessible. Saves retain the existing hash/CAS and approval invalidation
rules. Inventory approval requires a chosen outcome, rationale and acknowledgement. Later
checkpoint controls remain available; Library and Releases are labelled in development.
Uncertain provider outcomes require operator reconciliation, not an automatic resend.

Run `npm run preview:studio` to view the isolated localhost UI at port 3107. Its synthetic
fixtures and action mocks live only under tests; it cannot authenticate to production, upload,
spend, save a correction or approve a real run. It is not a substitute for a signed-in smoke
test after deployment. `npm run test:studio:e2e` checks the connected journey, review controls,
and desktop/mobile layout using the same presentation components. Unit and database suites
cover correction bindings, stale review, permissions and source history. Production build,
typecheck and `check:paper` are also required.

Hosted verification covered the real Limpopo inventory, question/page navigation, a loaded
original page image, source metadata, Grade 10 and Grade 11 imported collections, work queue
and execution history. Chrome blocked the attachment download with `ERR_BLOCKED_BY_CLIENT`,
so an end-to-end original PDF download is not confirmed. No correction or approval was saved;
the inventory remains revision 1 at G1. Final database checks found zero new provider attempts,
zero review decisions, six retained runs and ten teacher orders. Deployment/migration receipts
are in `../studio-design-release/` relative to the app checkout's parent workspace.

### Library and release inspection (14 October 2026)

Direct exports for Library (LZR), Item (M3I), Folder (JF1), File (JNI), Releases (MIH)
and Activation history (QBC) are retained alongside the first five journey boards.
`/admin/studio/library` reads current catalogue entries independently of a chosen bank
snapshot. Item links pin module, release and entry; file links pin snapshot and exact path.
Variants retain their parent IDs. Rehearsal copies require explicit selection when no
accepted snapshot exists. The file reader verifies stored bytes and escapes raw source text.

Migration 058 adds four editor-only read functions. It does not create publication commands
or infer a release-to-bank relationship from names. The item view reads the registered form,
including explicit no-input forms, exact generation source bindings and safe catalogue copy.
`/admin/studio/releases` shows published/imported records, current catalogue selection and
registration counts. These records are not activation history or evidence of worker health.

At migration 058, the designs' authoring and publication commands remained unimplemented.
The UI explained those boundaries instead of showing executable controls. This was the
inspection part of the Library and Releases journey. Hosted receipts for that update are
in the sibling `studio-library-release/` workspace directory.

The hosted rollout applied 058 after a rolled-back rehearsal verified real reads and unchanged
rows. Signed-in checks confirmed 131 Grade 10 catalogue items, Grade 11 release 5.7.0 with 89
available items, the optics item's ten teacher fields and three pinned generation sources,
publication history, and verified PHYS_13 source text from the explicit rehearsal snapshot.
A hosted path-encoding failure on catalogue IDs was corrected with one decode plus strict ID
validation; the final preview deployment is `dpl_HSABc5KkjcAZjbknetWNfkLxXamo`.
Checks: 21 unit/database tests, 26 desktop/mobile browser checks, typecheck, Paper alignment,
and Vercel's production build. No content approval, model dispatch, readiness change or
teacher production deployment was part of this rollout.

### Private bank-file drafts · 14 October 2026

The File → Edit private draft → Difference → History journey now follows the exported
File, Edit form, History and Change boards. Exports for MSN, MNR, JY8 and KJH are retained
for authoring work; their broader form-builder and new-task-type flows are not claimed as built.

Migration 059 adds `studio_maintenance_drafts` and immutable `studio_maintenance_revisions`.
A draft has one existing snapshot/file owner; module, purpose and base bytes derive from that
snapshot, rather than two nullable owners or an unrelated analysis run. Each revision has one
draft owner, verified blob, reason, author and optional exact restoration source. Only an
explicit command can change the current revision; revision/hash comparisons prevent stale
saves and discards. Replays are idempotent. Discard preserves history. Restore creates a new
revision. Originals, source observations, run approvals and teacher definitions are unaffected.

The server uses the existing verified-upload protocol: provisional bytes → digest verification
→ immutable blob → final database reference. Reads verify retained bytes. Storage garbage
collection already refuses all registered blobs, including these revisions. Editor-only RPCs
and authenticated server actions enforce access; workers, ordinary reviewers and teachers
cannot use these commands. Read-only opening of the editor creates no draft.

This slice edits existing active Markdown/JSON files up to 256 KiB. A rehearsal remains a
rehearsal. Its draft cannot be passed off as canonical work. The UI provides byte-format and
JSON-syntax feedback and visual comparison; it does **not** record skill, science, dependency,
teacher-form compatibility or generation approval. There is no implicit review receipt that
could become stale. A later review/integration implementation must bind the exact draft ID,
revision, blob digest and base manifest and reject superseded revisions.

At migration 059, remaining work included structured teacher-form editing, new record allocation, dependency impact,
proposed-bank validation, maintenance review/integration commands, candidate builds,
activation and rollback. Migration 039's full local decommission script was updated to include
the new tables; it is destructive and was tested only in a throwaway database, never hosted.
Hosted receipts for this step live in sibling `studio-draft-release/`.

The private-draft preview is deployed as `dpl_3egcr1J8nzkdjcjrwoXMbvKNEiEv`.
Verification: 36 unit/database tests and 30 desktop/mobile browser checks passed, with
typecheck, Paper alignment and both builds. A signed-in browser opened the real PHYS_13
source from R2 in the new editor, with no changes, no saved revisions and Save disabled.
Mutation tests used synthetic local storage. Hosted checks left zero maintenance drafts,
zero decisions, six runs and ten teacher orders; no new provider attempts or teacher
production change occurred. Receipts: `studio-draft-release/verification.json`.

### Structured teacher-form editing · 14 October 2026

The existing draft editor now recognises `reviseit/authored-form@1` item sources with an
exact module/kind/identifier-to-path match. It presents the Paper Edit form board's field
selector, question wording, hint, choice labels, answer settings, teacher preview, source
evidence and difference/history tabs. Shared forms and unsupported records retain the
generic source editor; this is not a replacement form schema or a second draft store.

Editors can change existing labels, hints, required/automatic/own-words settings and text
limits. Field IDs, choice IDs, order and types stay fixed in the structured command.
Adding/removing fields or choices awaits dependency and source review. The item screen
opens an explicit source-copy chooser; source identity and recomputed field fingerprint
are checked before comparing a bank form to the selected teacher release. No equivalence
between rehearsal/accepted snapshots and published definitions is assumed.

The structured server action reads the hash-bound revision, reuses the teacher platform's
field validator, preserves source evidence and findings, records the reason for each changed
field, bumps `meta.last_updated`, and recomputes `form_revision` with the producer's sorted
compact JSON encoding of fields and identity. It then uses the same verified immutable
storage and compare-and-save protocol from migration 059. No database migration is needed.

The teacher preview uses `answersMatchQuestionnaire` for individual field behaviour.
It expressly does not evaluate cross-field rules, source consistency or generation. A passed
preview is not approval. Saved source status is retained as source metadata, never treated
as an approval of the private draft. Integration must still obtain revision-bound reviews.

Offline compatibility check: all 109 authored item form sources in the current Grade 10/11
business folders parsed successfully and their fingerprints matched the existing producer.
Only read access was used; no business source, teacher definition or worker file was changed.
Deployment and verification receipts live in sibling `studio-form-release/`.

The structured-form preview is deployed as `dpl_DMnYtk9vTaKanGGrUG8Rh2kVBpPL`.
Verification: 46 unit/database tests and 32 desktop/mobile browser checks passed, along
with typecheck, Paper alignment and the production build. The signed-in live check opened
P1-WAVE-02 from its explicit rehearsal copy, matched its fields to teacher release 5.7.0,
showed all 10 fields and preview controls, retained field evidence and findings, and linked
all three matching pinned sources. No real content was edited or saved. Hosted checks
confirmed zero drafts, zero decisions, six runs, ten teacher orders and no new provider
attempts; teacher production and deployment protection were unchanged.
Receipts: `studio-form-release/verification.json`.

### Dependency impact inspection · 14 October 2026

Migration 060 adds an editor-only, read-only impact query and three lookup indexes over
existing evidence. There is no duplicate dependency store, publication write, model call
or review decision. The source-file screen and draft editor link to the report, using the
existing Paper library/change-review panels, typography and spacing.

The report binds the source snapshot, bank manifest, index projection and exact saved draft
revision/hash. Superseded, discarded, foreign-owner or hash-mismatched draft links fail
closed. An open report is a point-in-time inspection, not a reusable approval receipt.
Refresh rechecks the binding. Unsaved changes and new references within draft text are
explicitly outside this inspection.

Reverse traversal includes optional links and transitive dependents, terminates cycles, and
never invents a parent for unqualified variant links. Shared-file variants retain their parent
identity. Unresolved links are counted across the snapshot. Published source reuse uses exact
SHA-256 matches within the module and the selected form binding for each release. Current
and historical releases are distinguished. Byte equality does not establish file identity;
other source versions are outside this match. Authored form filename matches are separate
identity-only candidates. Order counts use frozen source bindings, count distinct orders,
expose no teacher identities, and do not imply that frozen orders will be modified.

Coverage shows missing current bindings, unresolvable bank links and unrecognised order
snapshots. No matches never means no impact. Source-text relationships, shared forms, images
and generated outputs can require additional review. Candidate-bank validation, content
judgement, integration approval and publication remain separate implementation steps.
Receipts: sibling `studio-dependency-release/`.

Deployed as `dpl_HR3vguwz4N4Nf9a4ynyFUgNBZeNk` after 41 unit/database tests, 34
desktop/mobile browser checks, Paper alignment and the production build passed. The
transactional rehearsal and application both verified unchanged existing rows. The live
signed-in PHYS_13 report identifies its five variants, dependent P1-WAVE-02 specification,
and exact source reuse by teacher release 5.7.0. The form report separates five historical/
current item-identifier matches from byte reuse. Coverage includes the module's one order
with an unrecognised snapshot format. No private edits, approvals, model calls or teacher
production changes occurred. Evidence: `studio-dependency-release/verification.json`.
