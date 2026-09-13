# Running the tests

The suite covers the landing site, school account verification, protected teacher workspace and catalogue publication adapter. Payment, private questionnaires and content generation remain unimplemented.

## First setup

Use Node.js 24.11.0 (recorded in `.nvmrc`). With a Node version manager, run `nvm use`. Then:

```sh
npm ci
npx playwright install chromium
npm run check
```

The dependency lockfile belongs in Git. `npm run check` performs the type check, component tests, production build and desktop/mobile browser tests. Browser tests use a local production server on port 3100; stop anything else using that port. No existing server is silently reused.

## Visual Studio Code

Open this repository as a folder, or add it to your existing workspace. Install the recommended **Vitest** (`vitest.explorer`) and **Playwright Test for VSCode** (`ms-playwright.playwright`) extensions.

Open the Testing panel (the beaker). Vitest discovers component and account tests under `tests/unit/`, and database permission tests under `tests/database/`. Playwright discovers `tests/e2e/*.spec.ts` through `playwright.config.ts`; select the desktop and mobile projects in its test settings as needed. Refresh the panel after first installation. If the folder is in Restricted Mode, review and trust this checkout to enable its test runners.

Component tests run directly from the panel. Before running browser tests there, run **Tasks: Run Task → Build for browser tests** (or `npm run build`). Repeat the build after application changes: these tests deliberately exercise the production output. Playwright starts/stops its own local server. Use **Tasks: Run Test Task → Check everything** for the full sequence with a fresh build.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run component, endpoint and database tests once |
| `npm run test:watch` | Rerun component tests as files change |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Build production output for browser testing |
| `npm run test:e2e` | Run desktop/mobile browser tests against that build |
| `npm run test:e2e:ui` | Open Playwright's interactive runner |
| `npm run check` | Run the local suite, including a fresh build |
| `npm run test:auth:integration` | Run real Supabase/browser account tests with disposable local Supabase |

## What is covered

- Catalogue previews and request forms appear only after a curriculum is selected; resetting the selection clears them.
- Coming-soon curricula cannot be requested.
- Pilot comparison content changes through clicks and keyboard input.
- Home, pilot and privacy pages load and navigation works in desktop and mobile Chromium.
- Catalogue preview images load successfully and browser JavaScript errors fail the tests.

Browser tests stub all non-local network requests, including Tally and external assets. They never submit a live enquiry or depend on third-party availability. This tests our site behaviour, not the Tally integration itself. Component tests do not contact those services either.

The GitHub Actions workflow runs the same checks on pushes and pull requests, and saves browser failure reports. It runs when the branch is pushed. Passing it does not certify the future teacher platform or scientific quality.

## Growing the suite

Add behavioural tests as each feature is implemented: quote locking, verified payment before parameter access, school isolation, duplicate-event recovery, persistent generation budgets and all-four-document release. Keep real specifications, parameter libraries, private prompts and school documents out of this public repository and its test output. Use synthetic fixtures here and private reviewed content evaluations in the content service.

## Account tests

Account registration screens, server validation and unauthenticated page protection run in both browser sizes. Endpoint tests cover pending, rejected, suspended and approved accounts. The real migration is executed in PostgreSQL tests to check permissions and review history. A separate GitHub Actions job runs the full account journey with a disposable real Supabase instance. The separate `identity.config.ts` is run explicitly by the integration command, so the editor’s normal Run All does not require Docker. See [AUTH.md](AUTH.md) for setup and the remaining hosted-email check. Neither suite uses live school data.

## Dependency maintenance

The account change updates Next.js to 15.5.25 and marked to 18.0.12, and applies compatible PostCSS and selector-parser fixes. The dependency audit on 12 September 2026 reports zero known vulnerabilities after these changes. The PostCSS override keeps the patched compatible version in Next.js 15; review it when upgrading Next.js again.


## Catalogue publication tests

`tests/database/publication.test.ts` exercises the full migration stack, restricted delivery permissions, exact approval receipts, immutable releases, stale predecessor rejection and rollback after a partial insertion failure. All payloads are synthetic.

The separate integration command also runs `tests/auth/publication.spec.ts`: two independent publisher connections prove transaction isolation and ordering, and the operational importer is checked for rollback by default. The account journey imports a new synthetic release while the same application process stays running, checks the updated catalogue, and confirms old selections require review. See [PUBLICATION.md](PUBLICATION.md) for the publication boundary and remaining gate integration.
