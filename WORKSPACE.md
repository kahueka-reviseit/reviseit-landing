# Teacher workspace

Approved teachers can choose an assigned curriculum, browse safe catalogue summaries, save a personal paper selection and share formatting preferences with teachers at the same school for that curriculum. Selections show question count and the combined minimum-to-maximum mark range. There is no price calculation, checkout, parameter access or content generation in this slice.

## Data and access

Apply `supabase/migrations/202609120002_teacher_workspace.sql` through the migration workflow after the account migration. This migration is tested against disposable databases; it has not been applied to hosted development by this branch.

- `curriculum_modules` identifies a curriculum and its current release. `catalogue_summaries` stores only public-safe titles, topics, descriptions and marks, keyed by module, release and entry identifier. Full specifications, prompts and parameter schemas must never be stored in these tables or this public repository.
- `school_curriculum_access` is an explicit administrator-managed catalogue access assignment. It is not proof of payment, a subscription billing system or permission to read parameter forms. No self-service entitlement grant exists.
- `school_formatting` is shared per school and curriculum. Supported preferences are A4 portrait, Arial or Times New Roman, 11 or 12 point text, standard or relaxed spacing, a school heading and answer lines. Reference-file uploads, exact template fitting and final document rendering are future work. The on-screen illustration is not a document rendering guarantee.
- `paper_selections` stores one resumable selection per teacher, school and curriculum. Each contains at most 30 distinct catalogue entries. Its saved release must match the current release when written. Old selections require explicit review and save after a release change.
- Browser roles can only read rows allowed by current approved membership and curriculum access. Saves use narrow database functions, derive school and teacher from the authenticated identity, validate values and reject stale revisions. Direct writes and cross-school reads are denied. Formatting and selection functions lock the school/curriculum access row to serialise first-save races.
- `/teacher` checks approval before loading. `/api/teacher/workspace` repeats the account check, uses no-store responses and checks request origin against the configured site address for writes. Responses project an explicit catalogue field list. Revoked curriculum access and suspended accounts lose access on subsequent requests.

Future publishing must import only reviewed summaries from the existing private content publication gate, using its library version as the release. This slice does not implement that importer, authored-form completeness checks or private feasibility rules. Do not manually promote the demonstration catalogue to a real published curriculum. When quotes are implemented, freeze the catalogue release, chosen entries and formatting snapshot on the order; later school preference changes must not alter a paid order.

## Demonstration and tests

`npm run preview:workspace` opens an isolated sample-data interface at `http://127.0.0.1:3103`. It uses the actual workspace component, with an explicitly synthetic browser-local save adapter. It is outside the Next.js application, has no hosted credentials and adds no authentication bypass. Its saves only demonstrate the interface; database persistence is proved by the integration tests.

`tests/fixtures/workspace.sql` contains synthetic Grade 10/11 entries for tests. It grants no school access. The real identity integration test explicitly assigns these modules to its synthetic school after human-review flow verification, then checks selection and formatting saves across reloads, curriculum separation and loss of endpoint access after suspension. It captures desktop/mobile screenshots. These fixtures must never be substituted for reviewed production content.

`npm run check` covers type checking, application/database tests, build and ordinary desktop/mobile browser checks. `npm run test:auth:integration` uses a disposable local Supabase instance, never the hosted project. The development server uses `.next-dev`, independently of the production build in `.next`, so a live preview cannot corrupt browser-test output.

The initial workspace verification passed 76 application/database tests and 16 ordinary browser tests locally. The expanded identity integration runs in GitHub Actions because Docker is not installed on this machine. No production merge, deployment, payment or real school curriculum assignment is included.

## Catalogue diagrams and search

The authenticated workspace supports optional PNG diagram previews and a search across the school's assigned curricula. Search matches all entered words against curriculum name/identifier, entry title/identifier, topic and description, case-insensitively. Results are grouped by curriculum; switching retains the existing unsaved-change confirmation. Searching or clearing a search never changes a selection. The first 50 matches are returned, with a prompt to refine broader searches.

Apply migration `202609120003_catalogue_discovery.sql` after the workspace migration. It adds bounded PNG preview bytes and alternative text to safe catalogue rows. These are teacher-facing publication derivatives, not raw SVGs or specification diagrams imported wholesale. The approved publication process must rasterize and review the previews before import. Small thumbnails live with their release in the initial implementation; a larger library can move bytes into protected object storage behind the same endpoint.

`/api/teacher/catalogue/search` uses an invoker-rights database function, preserving school and current-release row policies. `/api/teacher/catalogue/thumbnail` fetches a specific module/release/entry through the teacher's authenticated client and returns only a bounded PNG with private, no-store and nosniff headers. Neither endpoint has a service-role bypass. Search responses include only safe metadata and an authenticated image URL; they never contain image bytes, parameters or specifications. Missing images leave the item selectable.

The isolated demonstration has six synthetic illustrations. Existing curriculum thumbnail sources remain in the private content repositories pending reviewed publication; they have not been copied into this public application's assets. This branch does not connect the real catalogue, migrate hosted data or deploy to production.

Run `npm run test:workspace:e2e` for desktop/mobile diagram loading, search, curriculum switching and preserved selections. The real Supabase identity journey also checks authenticated thumbnail loading, database-backed search and access denial after suspension.

## Mark ranges

Migration `202609120004_catalogue_mark_ranges.sql` replaces the fixed mark column with non-null `marks_min` and `marks_max`, preserving previous fixed allocations as equal bounds. Catalogue and search responses use `marks: {min, max}`, matching the private draft catalogue contract. Cards, search results and selected-item rows display the range; the paper summary sums both bounds and labels a ranged result as possible marks. A fixed value is shown once, not as `2–2`. Search and filtering never alter this total. Final supported mark allocations must be resolved before payment; a source range does not assert that every integer within it is feasible.
