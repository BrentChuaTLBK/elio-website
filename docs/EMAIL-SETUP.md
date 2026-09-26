# Elio email setup

## Account confirmation

Use `supabase/templates/confirmation.html` in Elio's Supabase dashboard → Authentication → Email → Templates → Confirm sign up. Set the subject to **Confirm your Elio account** and save. The `{{ .ConfirmationURL }}` values must remain intact. They support both the customer and staff redirect URLs supplied by the account form.

All email templates share the dark brown ELIO header, gold wordmark, warm ivory background, serif headings, and bronze action buttons. They have no marketing opt-in or promotional offer. The account page newsletter checkbox is disabled; creating an account does not subscribe anyone.

Run `node --experimental-transform-types scripts/build-auth-emails.mjs` on Node 24 after changing the shared design. This generates all six authentication templates and seven optional security-notification templates in `supabase/templates/`; `manifest.json` lists their dashboard labels and subjects. Changing a template does not enable a feature or notification. Preserve existing notification settings. Signup, recovery, invite, magic-link and email-change templates retain `{{ .ConfirmationURL }}`; reauthentication retains `{{ .Token }}`.

`supabase/config.toml` records the template for local development. Publishing the website or syncing the GitHub fork does **not** apply hosted Auth templates. Avoid pushing an incomplete Auth config over existing Google or SMTP settings; use the dashboard or a narrowly scoped Management API patch.

Account confirmation and password-reset messages use Supabase Auth's SMTP connection when requested. They do not wait for the order worker or its cron schedule. Turn off click tracking for authentication links in the email provider.

## Order email worker

The `email-worker` Edge Function runs on Elio's project (`dzxyhckkkrzqpwpavngn`). The `elio-email-worker` cron job uses **`* * * * *` (every minute)**. It performs order maintenance and processes up to three queued messages per invocation. Leases prevent overlapping runs from claiming the same message. Retries retain the same provider idempotency key and stop before its 24-hour window expires.

Required Elio Edge Function secrets:

- `RESEND_API_KEY`: an Elio-only Resend key with Sending access, restricted to the verified Elio domain.
- `EMAIL_FROM`: a sender on that verified domain, `Elio Basque Cheesecake <orders@eliocheesecakes.com>`.

Order emails set Reply-To to `elio.cheesecakes@gmail.com`. Their main action links to the secure order page for proof uploads and status updates. A separate orders mailbox is not required for outbound sending through a verified Resend domain.

The scheduler credential is generated privately in Supabase Vault by the migration. It is not stored in GitHub, browser code, or the cron command. The worker verifies it through a service-role-only RPC before maintenance, claims, or sending. Gateway JWT verification is disabled because the handler implements this separate private credential check. Browser publishable keys and user sessions cannot authorize it.

Missing Resend configuration returns HTTP 503 **before claiming messages**. Check the pg_net HTTP response and Edge Function logs as well as the cron status: a successful SQL invocation alone does not prove that a message was accepted or delivered. No emails are sent by deployment tests.

The secure order view and payment proof integration use `/order.html`; the worker’s customer links target that route. The newsletter is not handled by this worker.

Every order event uses `_shared/email-design.ts`: order received, payment approval/rejection, cancellation, expiry, scheduled-day reminder, ready for pickup, out for delivery, order amendments, and staff payment review. Product photos sit beside the saved names and flavors. Fulfillment details and payment totals sit side by side on desktop and stack on phones. Missing photos omit the image cell; item names and contents remain visible when an email client blocks remote images.

The private `prepare_email` operation snapshots the current ordered products’ public cover URLs into the outbox payload after lease and recipient checks. Retries reuse that map, including an empty map. It does not replace saved names, recipes, prices, contact details, or instructions. URLs reference public catalog photos; private payment proofs are never embedded. Deploy the photo migration and the worker together when no messages are awaiting retry, since the rendered HTML changes with this release.

## Verification

Run `node --experimental-transform-types tests/email-worker.test.mjs` and `node --experimental-transform-types tests/email-design.test.mjs` on Node 24. The backend suite also checks photo snapshots, missing images, reminder retries, cancellation checks, and service-only preparation. The regular PGlite backend suite intentionally skips the hosted-only scheduling migration because PGlite does not supply pg_cron, pg_net, or Supabase Vault.

On September 26, 2026, an authorized live test verified guest checkout, private proof upload, manual payment approval, production counts, confirmation delivery, and cancellation with stock restored. All four order/staff emails were delivered. A separate signup verified the previously saved branded Auth template; the unconfirmed test account was removed. The new dark-header Auth templates require a separate hosted save. The redesign was checked in Chrome at 760, 390 and 320 pixels, including public image loading; this is not a full Outlook or Apple Mail client certification.

On hosted Supabase, verify the schedule and execution without selecting Vault values or HTTP request headers:

```sql
select jobname, schedule, active from cron.job where jobname = 'elio-email-worker';
select status, start_time, end_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'elio-email-worker')
order by start_time desc limit 3;
select status_code, timed_out, error_msg from net._http_response order by created desc limit 3;
```
