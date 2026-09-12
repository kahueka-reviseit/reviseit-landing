# Teacher workspace

Approved teachers can choose an assigned curriculum, browse safe catalogue summaries, save a personal paper selection and share formatting preferences with teachers at the same school for that curriculum. Selections show question count and total marks. There is no price calculation, checkout, parameter access or content generation in this slice.

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
