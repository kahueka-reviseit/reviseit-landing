# School accounts

This branch implements Supabase email/password accounts and an independently verified school membership. It does not connect to the retiring Bubble application. Version one supports one school department per teacher account; schools and departments are shared records. Subscription and paid-order entitlements are separate future features.

## Teacher journey

1. `/register` collects name, school, department and school email. Common personal providers receive a helpful validation message; an unfamiliar domain is allowed to apply. A domain is never proof of school affiliation.
2. Supabase sends an email confirmation. `/auth/confirm` asks the teacher to continue before consuming the link, so ordinary email scanners do not use it by opening the address.
3. Confirmed teachers can log in and see their pending account at `/account`.
4. An authorised human checks affiliation, assigns the correct shared school department and records evidence at `/admin/accounts`. Decisions are audited with reviewer, timestamp and revision. A reviewer cannot approve themselves.
5. An approved teacher can enter `/teacher`. That workspace is a protected starting page; catalogue selection, payments and paper generation are not implemented here.
6. Updating school details or the account email revokes approval. Suspension takes effect on the next request, including with an already issued session. Password recovery does not clear a suspension.

The account pages contain no marketing widgets. Confirmation tokens use a fixed destination, private responses are not cached, and signup metadata cannot grant permissions.

## Connect a hosted project

No hosted project has been configured by this change. Use a new development project before production.

- Apply `supabase/migrations/202609120001_teacher_accounts.sql` once through the project's database migration workflow. The migration is for a new independent account database, with no Bubble data import.
- Copy `.env.example` to ignored `.env.local` and set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and the exact `SITE_URL`. Use the project's publishable key or legacy anon key. The running application needs **no service-role key**.
- Enable email confirmations, disable anonymous sign-in, use at least 12-character passwords and enable confirmation on both addresses for email changes. Keep refresh-token rotation enabled.
- Set the Supabase site URL and exact allowed confirmation addresses to match the deployment. Copy `supabase/templates/confirmation.html` and `recovery.html` into the corresponding hosted email templates. The templates use `TokenHash` and `/auth/confirm`, not a session fragment in the URL. Configure a real email sender and confirm delivery to the school's inbox before inviting teachers.
- Choose hosted authentication rate limits and abuse controls for launch. The generous limits in `supabase/config.toml` are for disposable local tests only.
- Create and email-confirm the first internal reviewer through the normal account flow. The project owner then runs the following SQL with that person's actual user identifier. Do not use email metadata, browser flags or a public signup option to grant this role.

```sql
insert into private.account_reviewers(user_id) values ('REVIEWER_AUTH_USER_UUID');
```

The reviewer can log in, open account review, register the canonical school and department, and assess teachers. A reviewer role does not automatically create an approved teacher membership. Remove reviewer authority by deleting their private reviewer row; access checks consult it on every request.

## Permission boundaries

- Next.js validates identity with Supabase `getUser()` and reads the current account before each protected page or endpoint. Middleware only refreshes sessions; it is not the sole permission boundary.
- PostgreSQL row policies restrict account reads to the teacher or an internal reviewer. Teachers have no direct write privilege on approval, school assignment, reviewers or audit history. Restricted database procedures perform authorised mutations.
- `approved_school_id()` reads current membership and confirmed email. Future school-owned tables must add explicit row policies using this function, and future server actions/routes must call `requireTeacher()` or the equivalent endpoint guard. A parent layout is insufficient protection for future actions.
- Payment and subscription checks must be added independently before parameter forms, generation or downloads exist. Approved membership alone must never unlock those assets.
- The public repository contains only application code and synthetic tests. Private specifications, parameter questions and school documents remain outside it.

## Tests and their limits

`npm run check` runs TypeScript, application/database tests, a production build, and desktop/mobile browser tests. The PostgreSQL tests use PGlite with a minimal simulated Supabase identity schema and execute the actual migration. They verify self-approval denial, school isolation, audit records, stale review protection, email changes and suspension. They do not replace an identity-provider integration test.

`npm run test:auth:integration` requires Supabase CLI 2.117.0 and Docker, with `supabase start` and `supabase db reset --local` run in a disposable local project first. It refuses non-local provider/database addresses. It uses the real Supabase authentication and data services plus the real browser application to test registration, confirmation, pending access, reviewer approval, suspension, logout and recovery. Synthetic confirmation links come from the local admin test client; actual hosted email delivery must still be checked separately. The test admin key is excluded from the web-server process.

GitHub Actions runs both suites. The integration job creates its own local Supabase instance and needs no hosted project or repository secrets. No hosted service, reviewer or real school has been provisioned by committing this code.
