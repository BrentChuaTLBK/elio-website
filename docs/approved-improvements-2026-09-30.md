# Approved improvements — 30 September 2026

This report covers the approved improvement batch and Google backup follow-up. It does not replace the earlier production audit or claim exhaustive coverage of every website path.

## Changes

| Approval | Result |
| --- | --- |
| P1 | Responsive WebP variants for known photos, used by shop cards, home boxes, flavor photos and order thumbnails. New/unlisted photo URLs retain their original image until added to the build manifest. |
| P2 | Content-hashed images, fonts and CSS receive immutable caching. APIs, prices, stock, orders and customer data are not cached by this change. New builds use new asset URLs; public config is no-store and the responsive map is revalidated. |
| P3 | Measurement-first phase completed in isolated PGlite: bootstrap returns all orders; payload grew from 20,520 bytes at 1 order to 1,478,952 bytes at 1,000. Median local query time was 8.4/23.7/156.2 ms at 1/100/1,000 orders. This is not hosted performance. Pagination/summary redesign was not silently introduced. |
| E1 | Basket repeats chosen fulfillment date/method and gives a Change date control; relevant stock/date feedback appears together. |
| E3 | A lost checkout response explains the order may already exist. Retrying retains the same idempotency key. The test commits the first order, loses its response, retries, and verifies one order and one stock deduction. |
| B1 | Account order refresh has a busy state, disabled repeated refresh and an actionable accessible error. |
| B2 | Concept photos remain placeholders for the owner to replace later. |
| A1 | Order-edit confirmation compares current/after date, method, items, flavors and totals, including equal-price changes. Paid-order copy explains manual settlement and no automatic refund transfer. Existing server quote/revision checks remain. |
| A2 | Needs attention summarizes older payment reviews, unpaid separately quoted delivery charges, email errors and Calendar connection status. It explicitly describes loaded records, rather than claiming an exhaustive queue. |
| T1 | Pinned test dependencies, one release runner and GitHub Actions workflow. It runs isolated database, unit and browser fixtures without sending production orders or emails. |
| T3 | Provider DELETE is followed by a read check. Delayed deletion remains queued for retry. Contacts subscribed to another brand are retained; Elio consent/opt-out records remain locally to prevent accidental resubscription. Deployed email-worker v28 preserves the other nine deployed files exactly. |
| S1 | Browser CSP is report-only. Other headers add nosniff and strict-origin referrer behavior. No CSP enforcement or claimed complete live compatibility test before fork deployment. |
| S2 | Live automatic Google recovery for paid and under-review orders awaiting service, order-labelled proof-image ZIPs, affiliate/order history, owner-only manual exports and isolated recovery checks; see order-backup.md for scope and limits. |
| SEO1 | Build prepares public canonical URLs, organization metadata and a public-page sitemap. Prelaunch noindex remains; private/admin routes stay excluded. Search launch and Search Console submission remain a separate decision. |

## Verification

- Final isolated release runner: **38 suites passed**, including the backend corpus of 81 migration files and 253 checks, unit checks, and 15 browser suites. Hosted-only Cron/Vault infrastructure was verified separately on Supabase. A run initially stopped because the local Playwright browser was not installed; the final complete run used the installed Chrome executable through BROWSER_EXECUTABLE_PATH.
- Browser suites cover loading/retry, flavor list/search, pickup/delivery checkout, lost-response retry, account/conversions, voucher preview/density, POS feedback, payment methods, proof-upload progress, calendar, maintenance status, accounting and affiliates. Relevant widths include 320, 390, 768 and 1440 pixels. This is Chrome testing, not a new Safari/Firefox/Edge certification.
- Backup-specific checks cover owner access, paid and under-review inclusion, exact allocations/items, completed-order removal from the active list, retained financial history, checksums, Unicode chunks, formula-looking text, overlapping leases, changes during a run, failure/retry, disconnect and manual downloads. Proof tests independently open actual image bytes in a ZIP, match filenames to orders, and reject corrupt, missing and cross-order proof references. Transport tests cover A/B rotation and preservation of the current archive after upload, checksum and spreadsheet failures.
- Found and fixed during backup verification: empty selection_labels masked fixed-box flavor_contents in the readable export. Reproduced with a three-Matcha box, fixed CSV and Items mapping, then reran the test. The order-edit comparison now also shows fixed-box flavors.
- Found and fixed during live Drive verification: the service account could edit the approved ZIP but could not see its parent folder metadata. Requiring that hidden field blocked the archive. The worker now checks the explicitly configured files, their type and edit permission, and rejects conflicting parent metadata when visible. No broader sharing was granted. Google write/readback and an independently downloaded archive then passed.
- Updated stale test fixtures for the new Calendar status read and the existing short voucher-preview code. These were fixture failures, not hidden production errors.
- Built 59 hashed media/style assets and 17 responsive photo sets. In an actual built flavor-page fixture, Chrome selected an 8,100-byte thumbnail instead of the 52,688-byte original (85% less for that sample). This is not a site-wide speed percentage or Core Web Vitals claim.
- Existing photo crops and premium styling remain. Live Google backup permission, scheduled runs, readback, checksums, history and sheet formatting were verified.

## Answers to the approval notes

**P2:** Correct: this changes static asset loading. It does not cache checkout/API responses, reserve stock, change prices, or alter orders. A freshly deployed asset gets a new URL; an already-open page still requires navigation/reload to load new application code.

**T3:** After unsubscribe, Elio's promotional consent is stopped and provider cleanup is queued. A provider contact is deleted only when no other-brand subscribed topic needs it. A temporary provider failure is retried. Local opt-out history is retained. A DELETE acknowledgement alone is no longer treated as proof of completed cleanup.

**SEO1:** Canonical URLs tell search engines the preferred public URL; the sitemap lists public pages. Both are prepared now. Prelaunch noindex still tells engines not to index those pages. Public launch needs a deliberate removal of noindex and a later indexing check.

## Still proposals — not implemented

- **C2:** Compare popup and checkout signups through original welcome-code redemption and a later paid order, using equal observation windows. Existing subscribers do not count as new or earn repeated welcome offers. This measures association, not proven incremental revenue. No additional prompts proposed yet.
- **T2:** A concrete future example is extracting order-edit form rendering and draft-field reading from manage.js into order-edit-form.js when that feature next changes. Same API sequence, stock/pricing rules and validation; before/after tests required. No standalone refactor now.
- **N1:** Check an actual GA4 DebugView session against shop view → add box → checkout → order saved → payment approved. Verify consent and deduplication, and exclude private customer details. Browser events are not proof GA4 received them; analytics is not the accounting ledger. No new tracking implemented.
- **N2:** Preview campaign issue groups and affiliate sales/earned commission/payout/balance, with totals linked to source records. Use equally aged groups; distinguish estimated from earned, revenue from profit, and attributed sales from incremental sales. The separate UI sample uses invented numbers.
- **H1:** After launch, inspect existing Cloudflare real-user measurements first. Consider extra collection only for a demonstrated gap. Measure content appearance, tap response and layout shift by coarse route/device groups; avoid email/address/private order URLs. No new collector installed.

## Remaining checks and limits

- The source/frontend release requires the deployment fork to sync before live frontend and HTTP headers can be verified. Live backup and email-worker deployments are independent of that sync.
- GitHub Actions is configured; its first hosted run is separate from the completed local run. A clean CI result must be checked before claiming reproducibility across environments.
- No production stress run, real order creation, new email send or hosted full-database restore was performed in this improvement pass.
- Existing leaked-password protection warning remains unchanged per owner preference. Private schema tables intentionally deny direct access and are reached through checked RPCs; the backup table follows that model.
- The live operational Google backup currently has no paid or under-review orders to demonstrate. Nonempty paid/review/completed/affiliate and image scenarios were verified using isolated fixtures. Active-order payment-proof image bytes are now backed up; affiliate payout-proof images, all other Storage objects and full project state remain outside this operational backup.
