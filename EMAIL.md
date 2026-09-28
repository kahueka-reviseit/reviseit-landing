# Transactional email

Paper: Revise It Website, page 8 "Email journey"; Design System, Components 12 "Email".

## Who sends what

| Moment | Sender | Template |
| --- | --- | --- |
| Confirm school email, request the link again | Supabase Auth through Resend SMTP | `supabase/templates/confirmation.html` |
| Password recovery | Supabase Auth through Resend SMTP | `supabase/templates/recovery.html` |
| School access approved (a committed change to `approved`) | This application, `access_approved` | `lib/email/templates.ts` |
| All four documents released | This application, `paper_ready` | `lib/email/templates.ts` |
| Order held during creation | This application, `paper_attention` | `lib/email/templates.ts` |
| Payment and refund receipts | Stripe, if enabled in Stripe's customer email settings | Stripe |

Nothing is sent for pending, rejected or paused accounts, payment alone, submission, or creation stages. The screens say those things.

## How delivery works

1. **Intent.** Migration `202609280026_email_notifications.sql` adds triggers on `public.teacher_accounts` and `private.paper_orders`. They insert one row into `private.email_notifications` in the same transaction as the event. A rollback leaves nothing; a commit survives any crash. A unique logical key (`access-approved:{user}:{revision}`, `paper-ready:{order}:{pack hash}`, `paper-attention:{order}`) prevents a second message for the same event. A trigger error is downgraded to a warning, so email never blocks the event.
2. **Dispatch.** `POST /api/internal/email/dispatch` (bearer `EMAIL_DISPATCH_TOKEN`) calls `claim_email_notifications`. The claim rechecks eligibility (address unchanged, account still approved for that school, pack still released, hold still in place, address not suppressed) and leases each row for two minutes. The first rendered payload is frozen with `record_email_payload`, so every retry sends the same bytes with the same `Idempotency-Key` (`reviseit-email/{notification id}`).
3. **Scheduling.** The database calls the endpoint every minute with `pg_cron` and `pg_net`, which both run inside the existing Supabase project. If the application or a dispatch dies midway, the lease expires and the next minute reclaims the row. A crashed or timed-out attempt is marked ambiguous. After 23 hours, which is inside Resend's 24-hour idempotency window, it becomes `unknown` instead of being resent. At most five attempts are made, with backoff of 1, 5, 20 and 60 minutes.
4. **Callbacks.** `POST /api/resend/webhook` verifies the Svix signature over the raw body with `RESEND_WEBHOOK_SECRET`, then calls `record_email_event`. Events are stored once by `svix-id`. They never move a message backwards, and they are applied late if they arrive before the acceptance is recorded. A permanent bounce or a complaint suppresses that address for later messages.
5. **Staff.** The admin overview lists messages that need a look, and the paper record shows the email state. `resolve_email_notification` records a staff outcome for `unknown` or `failed` messages. A resend is not implemented.

States: `skipped` (never sendable), `queued`, `sending`, `accepted` (Resend took it), `delayed`, `delivered` (the receiving mail server accepted it, which does not mean it was read), `bounced`, `complained`, `failed`, `suppressed`, `cancelled` (no longer eligible), `unknown` (acceptance uncertain; needs a decision), and `resolved`.

## Switching it on

The migration starts with mode `off`. Events are recorded as `skipped`, so turning delivery on later never backfills old approvals or releases. Change the mode only as the database owner:

```sql
select private.set_email_mode('allowlist', array['person@example.org'], 'Why, who authorised it');
select private.set_email_mode('on', '{}', 'Why, who authorised it');
select private.set_email_mode('off', '{}', 'Why');
```

`off` also pauses dispatch; queued rows wait, and they expire if they were never attempted within 48 hours. Every change is kept in `private.email_setting_changes`.

## Environment (server only, never `NEXT_PUBLIC_`)

`RESEND_API_KEY` (a sending-only key limited to the sending domain), `RESEND_WEBHOOK_SECRET`, `EMAIL_DISPATCH_TOKEN` (32 or more random characters), `EMAIL_FROM` (`Revise It <notifications@auth.reviseit.io>`), `EMAIL_REPLY_TO` (a monitored mailbox), and the existing `SITE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Without them the endpoints return 503 and nothing is claimed.

## Scheduler (run once in the Supabase SQL editor)

Store the dispatch token in Vault first (`select vault.create_secret('<token>', 'email_dispatch_token');`) using the dashboard's hidden input, never in Git. Then:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('reviseit-email-dispatch', '* * * * *', $$
  select net.http_post(
    url := 'https://pilot.reviseit.io/api/internal/email/dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_dispatch_token'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 25000);
$$);
```

To remove it: `select cron.unschedule('reviseit-email-dispatch');`.

## Rollback

Drop the triggers `teacher_account_email_intent` and `paper_order_email_intent`, unschedule the cron job, and unset `RESEND_API_KEY`. The tables can remain as evidence. No existing order, grant, payment or answer is modified by the migration.

## Tests

`tests/database/email-notifications.test.ts` runs the real migration stack in PGlite: event ownership, prospective activation, rollback, leases and crash recovery, frozen payloads, retries and the idempotency window, recipient changes, revocation, callbacks (duplicate, out of order, early, bounce, complaint) and permissions. `tests/unit/email.test.ts` covers templates, escaping, links, Resend classification, the dispatcher, signature verification, both routes and the signed-out return path.
