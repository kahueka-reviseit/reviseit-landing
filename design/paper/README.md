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
