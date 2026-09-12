# Running the tests

This is the test foundation for the existing landing site. It does not yet test the planned payment gate, private questionnaires, school accounts or content generation, because those features are not implemented here.

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

Open the Testing panel (the beaker). Vitest discovers `tests/unit/*.test.tsx`. Playwright discovers `tests/e2e/*.spec.ts` through `playwright.config.ts`; select the desktop and mobile projects in its test settings as needed. Refresh the panel after first installation. If the folder is in Restricted Mode, review and trust this checkout to enable its test runners.

Component tests run directly from the panel. Before running browser tests there, run **Tasks: Run Task → Build for browser tests** (or `npm run build`). Repeat the build after application changes: these tests deliberately exercise the production output. Playwright starts/stops its own local server. Use **Tasks: Run Test Task → Check everything** for the full sequence with a fresh build.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run component tests once |
| `npm run test:watch` | Rerun component tests as files change |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Build production output for browser testing |
| `npm run test:e2e` | Run desktop/mobile browser tests against that build |
| `npm run test:e2e:ui` | Open Playwright's interactive runner |
| `npm run check` | Run every required check, including a fresh build |

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

## Existing dependency maintenance

The initial install on 12 September 2026 reported four dependency audit findings in the existing application dependency tree (Next.js, marked, PostCSS and postcss-selector-parser), including a critical Next.js finding. The application still uses Next.js 14.2.5. This test setup does not resolve those advisories or certify deployment security; review and update the application dependencies before building the authenticated/payment service.
