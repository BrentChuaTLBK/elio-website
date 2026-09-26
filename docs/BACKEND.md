# Elio backend

Elio uses project `dzxyhckkkrzqpwpavngn` in the existing TLB Supabase organization. Its database, authentication users, storage, keys, migrations, and order data are separate from TLB. Only organization billing and organization administration are shared.

The admin entry point is `/manage.html`; team accounts use `/admin-account.html`, and customers use `/account.html`. Both account pages share Elio's Supabase Auth project. Signing up as a customer does not grant staff access. Owner access is assigned to an explicitly allowed, email-verified Elio user. It is not granted to the first person who registers. The initial owner allowlist is stored privately in the database, not in this public repository.

First-owner activation consumes only that verified account's pending reservation, using a filtered delete compatible with Supabase API sessions' `safeupdate` protection. Other reservations remain untouched and cannot grant access after the initial owner exists. The regression covers verified-email checks, preservation of unrelated reservations, repeated dashboard access, and denial of a subsequent owner claim. Hosted bootstrap was also checked using transaction-local authenticated claims with rollback; this is a database check, not a browser sign-in test.

`/manage.html?preview=1` provides a read-only dashboard preview using the existing public catalog. It makes no backend requests, loads no private records, and cannot save changes. Remove the preview parameter to sign in to the connected admin.

## Adaptation from TLB

Source: `BrentChuaTLBK/bakery-website`, commit `7e81baa1a6ef9ae179662aeea7cc238e59e37764`. The foundation consolidates its ordering migration and subsequent contact, payment-window, delivery, booking-calendar, same-day, promo, cutoff, email-outbox, and daily-quantity fixes. The admin reuses its overview, orders, analytics, promos, settings, daily-quantity calendar, team permissions, order amendments, and print summaries. No TLB customer records, accounts, or API keys are copied. At the owner’s explicit request, pickup information, delivery zones/fees, production weekdays/cutoff, and manual-payment instructions were copied into Elio as editable defaults. Account numbers remain in the private database, outside this repository.

Elio changes:

- `kind=flavor`: price is the extra charge per individual piece in custom boxes. A saved surcharge, a published lineup for the fulfillment month, visibility, and daily stock all determine availability for boxes using that flavor.
- `kind=custom_box`: base price plus exactly three flavor surcharges per box. Each flavor's piece count is multiplied by the number of boxes.
- `kind=set`: the owner selects three flavor IDs in `box_flavors` (repeats allowed) and enters one fixed total price. Customers cannot substitute flavors. Each set consumes the included flavors’ piece quantities; no separate box inventory exists. Any unavailable component makes the set unavailable.
- Saved line items include trusted per-box `stock_requirements`, `flavor_contents` (IDs, names, quantities), and price snapshots. Multiply flavor quantities by ordered boxes for production totals. Unchanged configurations retain their saved recipes and unit prices during amendments. New configurations use current prices and recipes.
- Reservations aggregate all cart lines. A database transaction lock serializes stock, promo, cancellation, and amendment mutations. Failed updates roll back all stock changes.
- Unpaid cancellation/expiry releases holds. Paid cancellation explicitly chooses whether to restore stock. Redeemed promo usage remains counted after paid cancellation.
- Saved prices take effect automatically; legacy `price_confirmed` is always derived true. The shop starts paused, with no payment account, pickup address, delivery fees, or stock limits assumed.
- Unsaved daily quantities mean zero. An explicitly saved blank / No limit means unlimited. Daily quantities shows only the selected month's lineup; all fixed and custom boxes share individual flavor limits. `configured` distinguishes explicit zero from a not-yet-configured date, so bulk fill can preserve saved values.
- `catalog` accepts optional `fulfillment_date` and returns `stock_available`, `remaining_boxes`, and flavor stock for that date. These are stock indicators; the quote still enforces lead time, closures, pickup/delivery rules, and paused ordering.
- Customer date selection and server quotes are limited to this month and next month in Asia/Manila. Staff calendars and authorized amendments retain their separate date rules.
- Owners can upload JPEG/PNG/WebP product photos up to 5 MB in the public `product-images` bucket. An INSERT-only Storage policy checks the current database owner role and their own UUID folder. Removing a photo from a product detaches it; it does not delete the stored object.

## Security

All business tables are in the unexposed `elio` schema, with RLS enabled and no direct browser grants. Public RPC wrappers use invoker security; private dispatchers perform role checks and trusted price calculation. Only the service role can invoke service actions. The public browser config contains only Elio's publishable key. Elio uses its own auth storage key. Customer access checks use the signed-in user ID or a strong guest token, never an order reference or an email match alone.

Owners manage catalog, promos, settings, and team access. Staff manage orders and daily quantities and can read operational analytics. The last owner cannot remove their own remaining owner role.

The customer account page shows a Staff dashboard link only after `shop_api('account_access')` returns an owner or staff role. This lightweight read uses the authenticated user ID and the private team table, ignores caller-supplied roles and user IDs, and returns no dashboard data. The dashboard continues to enforce access independently.

## Setup still required before customer launch

1. Verify Elio Resend/SMTP delivery and add both customer and staff account redirect URLs in hosted Supabase Auth settings. Follow [Google sign-in setup](GOOGLE-SIGN-IN.md) to create Elio's own Google OAuth client and enable its provider. Never reuse TLB keys or store secrets in `dist`.
2. The privately designated owner account is verified and has claimed its role. Future staff accounts still require explicit authorization in Team access.
3. Confirm actual prices and flavor surcharges, activate the intended flavors and boxes, set daily piece quantities, and review the copied fulfillment/payment defaults before unpausing orders.
4. Sync the deployment fork to publish the connected storefront. `proof-upload` and `proof-url` are deployed independently to Elio. Keep new orders paused while confirming the catalog and testing a real email delivery.
5. Configure Elio's email worker secrets and verify delivery before opening orders. The worker and private scheduler use a one-minute interval. Follow [email setup](EMAIL-SETUP.md) for the Auth confirmation template, worker configuration, and secure customer-order links. The existing lazy expiry check also frees overdue holds on subsequent API calls.
6. Connect an Elio analytics property if website visitor reporting is wanted. Sales/order analytics already reads only Elio orders.

Supabase Auth Site URL: `https://eliocheesecakes.com`. Allowed redirect URLs: `https://eliocheesecakes.com/admin-account.html`, `https://eliocheesecakes.com/account.html`, and their `http://127.0.0.1:4173` counterparts for local testing. Set these in the hosted dashboard; editing `supabase/config.toml` alone does not change the hosted project.

## Checkout and order references

The shop defaults to Pickup and the earliest date with sufficient stock, including all saved basket lines. It supports custom and fixed boxes, delivery address/fee review, full manual payment, private receipt upload within 15 minutes, and staff approval. Proof storage is private; upload authorization is checked before storage and again at commit. Staff proof URLs expire after five minutes. Order emails distinguish awaiting payment from payment approved.

The visible reference uses `ELIO-` plus six random characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. After five collisions it tries a longer length (up to nine), under the existing order transaction lock and unique reference index. Existing references remain unchanged. The separate UUID and 256-bit guest access token remain the authorization mechanism; references cannot view orders or upload proof.

## Local checks

Run `npm run check`, `node tests/shop-rules.test.mjs`, `node --experimental-transform-types tests/proof-functions.test.mjs`, and `node --experimental-transform-types tests/email-worker.test.mjs`. In `tests/backend`, run `npm ci` then `npm test`. PGlite is pinned at 0.5.8. A scratch dependency install can be selected with `PGLITE_PACKAGE_ROOT`. Tests execute the real migrations with mocked Supabase platform roles, including permission-denial checks. PGlite executes serially and does not prove cross-connection locking performance; a concurrent hosted smoke test is documented separately when run.

The global transaction lock follows the TLB implementation. Measure response time and lock waits before increasing throughput; per-resource locking can be introduced if measured traffic warrants it.

The first hosted installation passed the anonymous catalog and permission checks. Security advisors returned no warnings or errors. Informational “RLS Enabled No Policy” entries are expected for the private, deny-by-default `elio` tables: browser roles have no table grants, and access goes through the checked RPCs. See [the Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Unused-index notices are expected in an empty database. Auth currently uses the default absolute connection allocation; review [production configuration](https://supabase.com/docs/guides/deployment/going-into-prod) when scaling compute.


## Monthly menus, categories and production

The monthly-menu migration adds private `elio.flavor_menus` and explicit inventory configuration state. Unconfigured dated stock is zero. Membership changes reset only unsold stock while preserving reservations. Publication gates customer ordering, and existing shop closures remain authoritative. There is no rollover scheduler: queries resolve current/next months in Manila and retain the saved month records.

Categories follow TLB’s multi-category approach, adapted to separate `flavors` and `boxes` scopes. Product JSON stores `category_ids`, `category_sort_orders`, and the independent All-list `sort_order`. Owner-only `reorder_catalog` requires complete scoped memberships and an optimistic snapshot under the existing transaction lock. Product editing preserves saved positions. Category removal never deletes a product or touches inventory. Public collection responses expose only flavor categories and visible flavor metadata.

The removal-impact RPC returns aggregate outstanding paid/confirmed order counts and saved flavor-piece requirements to the owner before lineup removal. Completed orders are already served and excluded from this reminder. Production includes completed orders in range totals and shows served quantities separately; its date range is the fulfillment date. Analytics Top Flavors retains the order-placement date filter.

Additional checks: `node tests/daily-quantities.test.mjs`, `node tests/production.test.mjs`, and `node tests/top-flavors.test.mjs`. Backend suites cover monthly stock gates, closure priority, reset/re-add behavior, atomic bulk updates, scoped multi-category ordering, stale edits, and removal-impact counts.

Production groups custom boxes by the saved per-box flavor counts within each box product. Selection order does not affect grouping: Vanilla/Gorgonzola/Vanilla and Vanilla/Vanilla/Gorgonzola both mean 2 Vanilla + 1 Gorgonzola. Overall and daily tables show each combination with total and served box counts. Distinct recipes stay separate.


`preview_flavor_lineup` and `save_flavor_lineup` are owner-only actions. Saving checks the calendar month and expected membership/publication before applying both fields atomically. Existing membership triggers clear only added/removed flavors’ unsold stock. Flavor `active` and `in_rotation` are derived compatibility fields, not independent ordering switches; boxes retain their listing switch.


The public flavor collection returns every non-hidden flavor, independently of monthly membership. Only published menus expose membership IDs; the response omits the former `collection_only` flag so draft assignments remain private. The This Month tab derives current and next sections from published menus; Full Collection uses the complete visible list. Uploaded `photos[0]` is the shared cover. Box `active` means “Show this product in shop”; hiding also prevents new orders without rewriting existing order snapshots.
