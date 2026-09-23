# Elio backend

Elio uses project `dzxyhckkkrzqpwpavngn` in the existing TLB Supabase organization. Its database, authentication users, storage, keys, migrations, and order data are separate from TLB. Only organization billing and organization administration are shared.

The admin entry point is `/manage.html`; team accounts use `/admin-account.html`, and customers use `/account.html`. Both account pages share Elio's Supabase Auth project. Signing up as a customer does not grant staff access. Owner access is assigned to an explicitly allowed, email-verified Elio user. It is not granted to the first person who registers. The initial owner allowlist is stored privately in the database, not in this public repository.

First-owner activation consumes only that verified account's pending reservation, using a filtered delete compatible with Supabase API sessions' `safeupdate` protection. Other reservations remain untouched and cannot grant access after the initial owner exists. The regression covers verified-email checks, preservation of unrelated reservations, repeated dashboard access, and denial of a subsequent owner claim. Hosted bootstrap was also checked using transaction-local authenticated claims with rollback; this is a database check, not a browser sign-in test.

`/manage.html?preview=1` provides a read-only dashboard preview using the existing public catalog. It makes no backend requests, loads no private records, and cannot save changes. Remove the preview parameter to sign in to the connected admin.

## Adaptation from TLB

Source: `BrentChuaTLBK/bakery-website`, commit `7e81baa1a6ef9ae179662aeea7cc238e59e37764`. The foundation consolidates its ordering migration and subsequent contact, payment-window, delivery, booking-calendar, same-day, promo, cutoff, email-outbox, and daily-quantity fixes. The admin reuses its overview, orders, analytics, promos, settings, daily-quantity calendar, team permissions, order amendments, and print summaries. No TLB customer records, accounts, API keys, business settings, or payment instructions are copied.

Elio changes:

- `kind=flavor`: price is the extra charge per individual piece; active and in-rotation flags determine custom-box availability.
- `kind=custom_box`: base price plus exactly three flavor surcharges per box. Each flavor's piece count is multiplied by the number of boxes.
- `kind=set`: one set consumes one unit of its own stock. It does not consume flavor-piece stock.
- Saved line items include trusted stock requirements and price snapshots. Unchanged configurations retain their saved unit prices during amendments. New configurations use current prices.
- Reservations aggregate all cart lines. A database transaction lock serializes stock, promo, cancellation, and amendment mutations. Failed updates roll back all stock changes.
- Unpaid cancellation/expiry releases holds. Paid cancellation explicitly chooses whether to restore stock. Redeemed promo usage remains counted after paid cancellation.
- Prices start as unconfirmed drafts. The shop starts paused, with no payment account, pickup address, delivery fees, or stock limits assumed.
- Blank daily quantities mean unlimited, as in TLB. Zero means sold out. Flavors and fixed sets have separate quantity rows; custom boxes do not have a quantity row.

## Security

All business tables are in the unexposed `elio` schema, with RLS enabled and no direct browser grants. Public RPC wrappers use invoker security; private dispatchers perform role checks and trusted price calculation. Only the service role can invoke service actions. The public browser config contains only Elio's publishable key. Elio uses its own auth storage key. Customer access checks use the signed-in user ID or a strong guest token, never an order reference or an email match alone.

Owners manage catalog, promos, settings, and team access. Staff manage orders and daily quantities and can read operational analytics. The last owner cannot remove their own remaining owner role.

## Setup still required before customer launch

1. Verify Elio Resend/SMTP delivery and add both customer and staff account redirect URLs in hosted Supabase Auth settings. Follow [Google sign-in setup](GOOGLE-SIGN-IN.md) to create Elio's own Google OAuth client and enable its provider. Never reuse TLB keys or store secrets in `dist`.
2. The privately designated owner account is verified and has claimed its role. Future staff accounts still require explicit authorization in Team access.
3. Set confirmed prices, flavor surcharges, stock limits, production policy, pickup details, delivery zones, and payment instructions.
4. Connect the customer storefront and proof-upload/proof-read Edge Functions to the tested RPC contract. The existing shop remains a preview; this change does not enable checkout.
5. Deploy the email worker and schedule maintenance before opening orders. An outbox alone does not send emails. The existing lazy expiry check frees overdue holds on subsequent API calls.
6. Connect an Elio analytics property if website visitor reporting is wanted. Sales/order analytics already reads only Elio orders.

Supabase Auth Site URL: `https://eliocheesecakes.com`. Allowed redirect URLs: `https://eliocheesecakes.com/admin-account.html`, `https://eliocheesecakes.com/account.html`, and their `http://127.0.0.1:4173` counterparts for local testing. Set these in the hosted dashboard; editing `supabase/config.toml` alone does not change the hosted project.

## Local checks

Run `npm run check`. In `tests/backend`, run `npm ci` then `npm test`. PGlite is pinned at 0.5.8. A scratch dependency install can be selected with `PGLITE_PACKAGE_ROOT`. Tests execute the real migrations with mocked Supabase platform roles, including permission-denial checks. PGlite executes serially and does not prove cross-connection locking performance; a concurrent hosted smoke test is documented separately when run.

The global transaction lock follows the TLB implementation. Measure response time and lock waits before increasing throughput; per-resource locking can be introduced if measured traffic warrants it.

The first hosted installation passed the anonymous catalog and permission checks. Security advisors returned no warnings or errors. Informational “RLS Enabled No Policy” entries are expected for the private, deny-by-default `elio` tables: browser roles have no table grants, and access goes through the checked RPCs. See [the Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Unused-index notices are expected in an empty database. Auth currently uses the default absolute connection allocation; review [production configuration](https://supabase.com/docs/guides/deployment/going-into-prod) when scaling compute.
