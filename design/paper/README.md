# Paper alignment

Source: **Revise It Website**, Paper file `01M36MRM9HCJ4T87N081XDT4MX`, read on 28 September 2026 after the BEM naming sweep. Token export hash: `d68b1774`.

## What is linked

- `snapshot.json` records the 16 exported tokens and selected computed styles used by browser checks.
- `layers.json` records 621 named layers with representative Paper node identifiers.
- `class-map.json` traces 765 existing class names to their replacement across 13 CSS modules. 353 mappings have a corresponding captured Paper layer. The other 412 are explicitly marked application extensions. This is a migration map, not an exhaustive index of every newly added class.
- `app/paper-tokens.css` contains the exact token values. Existing global variable aliases point to these values.

Components use `block__element--modifier` names. CSS Modules remain in use, so browser class names include generated hashes. Repeated Paper layers with the same name can have different context-specific dimensions; the node mapping identifies vocabulary, not a guarantee that every instance has identical styling.

The teacher navigation, catalogue card, questionnaire choices, status layout and switches use values inspected in the current design. Public, account and teacher modules share the exported colours and fonts. This work does not claim a pixel-for-pixel recreation of every artboard. Responsive layout, dynamic content and code-only states remain explicit application responsibilities.

The separate table-and-side-panel proposal and the separate Design System 1.0 proposal were not substituted for the current implemented journey. No question-generation or payment rules were changed.

## Maintaining the link

1. Read the changed artboard through Paper and obtain its layer names, computed styles and token export.
2. Update the recorded source and the corresponding code together. Record new application-only names honestly rather than inventing a Paper node reference.
3. Run `npm run check:paper`, `npm run typecheck` and the browser checks relevant to the changed component.
4. Review screenshots at desktop and phone widths, especially long text and optional states.

`check:paper` checks BEM syntax in all application CSS modules, literal CSS Module references in application and test TypeScript, and token equality against the saved export. It does not contact Paper, validate every dynamic class expression, or prove full visual equivalence. Browser tests exercise the dynamic states.

Browser coverage: `tests/workspace-browser/paper-alignment.spec.ts` compares representative computed values with the saved Paper source and checks long questionnaire hints for overlap. Existing workspace and public browser suites cover interaction continuity. All use local synthetic data.
