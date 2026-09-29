# Focused live analytics and backup verification — 30 September 2026

This follow-up checks the newly added marketing reports, analytics behavior and order recovery. It is not a repeat of the complete site audit and makes no claim of exhaustive coverage.

## Live evidence

- Real account signup, delivered verification email, verification-link redirect and authenticated checkout.
- Live mobile custom delivery order ELIO-GW2C6K: two boxes, each one Vanilla and two Cocoa; base PHP 811.11 plus two PHP 12.34 modifiers = PHP 835.79 per box; products PHP 1,671.58, capped discount PHP 100, delivery PHP 300, total PHP 1,871.58. Browser, database and delivered customer email matched.
- Live desktop fixed pickup order ELIO-JPEMH3: products PHP 811.11, 10% discount rounded to PHP 81.11, total PHP 730. Browser, database and delivered customer email matched.
- Exact saved custom selections, quantities and held flavor allocations reconciled: Vanilla remaining 26/30 and Cocoa 25/30. Synthetic proof images clearly stated no money was paid and no fulfillment was required. Both uploads converted to WebP and became under review. No payment was actually made or approved.
- Browser refresh did not create another order. Repeated API submission returned the existing order. Two simultaneous identical requests created one additional order, recorded in the fixture manifest as 044a9031-68c5-4a57-a1df-1c5d58f60cef.
- Fourteen live API checks: anonymous order privacy; customer denial for all four marketing-report actions and both backup actions; closed date; excessive quantity; invalid promo; invalid product; authoritative price recalculation; retry; simultaneous idempotency. The extra test order was expired by moving only its server deadline into the past, then executing the normal expiry routine. This checks server expiry/restoration, not a full wall-clock countdown endurance test.
- Cancellation of the two under-review orders restored both flavor stocks to 30/30. Normal order, payment-review, cancellation and expiry email jobs reached sent state; the two customer order emails and verification emails were independently checked in Resend as delivered.
- Google backup's independent scheduler captured both under-review orders and both actual proof images without a manual trigger. Verified server status at 05:15 Manila: active orders 2, under-review 2, proof files 2, successful provider readback. After cleanup, a successful copy showed active orders 0, proof files 0, no pending changes and no error.
- Owner reports and anonymous/customer denial were checked against production. Positive and negative 30-day cohort calculations, attribution, paid source-order drilldowns and affiliate reconciliation use deterministic isolated fixtures; there are no mature live cohorts to validate those outcomes conclusively.
- GA4 browser output still has page views only. Test collection was intercepted, so these checks do not prove GA4 DebugView ingestion. No new tracker or paid-purchase event was enabled.

## Cleanup

Deleted the exact three test orders, two test flavors, fixed/custom products, promo, stock rows and two uploaded proof blobs through Storage. Restored the October menu. Product, settings and inventory checksums matched the pre-test baseline. Both disposable test accounts were removed after email verification. No actual customer/order settings were changed. Email-provider logs and the normal historical backup snapshots retain their audit history. A narrowly scoped cleanup endpoint was retired to an unconditional HTTP 410 with gateway JWT validation enabled.

## Requested backup UI

Two aligned cards show Google Drive status and manual downloads; a full-width explanation follows. Cards stack on narrow screens. The default download selection is paid or under-review orders awaiting service; the optional selection adds all unserved website/direct orders including unpaid. Automatic backup eligibility remains unchanged.

Each download fetches a fresh owner-only snapshot. ZIP includes actual receipt bytes grouped by order reference, a proof index and checked recovery JSON. A changed, missing, oversized or inaccessible proof fails the download instead of silently claiming a complete archive. Excel contains Orders, Items, Read me and losslessly chunked Recovery data tabs. JSON includes its SHA-256 checksum. Paid and affiliate history remains in recovery data even after completion; this is not a full database backup.

Validation includes both selection scopes, owner/customer permissions, preserved reservations and automatic backup rules; Excel money/flavor/literal-cell values and large JSON reconstruction; ZIP CRC, image bytes, names and SHA-256; failed/changed proof downloads; responsive buttons/downloads at 320, 390, 768 and 1440 pixels. The isolated release suite is rerun before publication. Live frontend verification requires the deployment fork to be synced.

## Account email branding

The first actual verification email used the old text header; live order emails used the current image-backed header. The user updated the hosted Supabase Confirm signup template using the prepared template picker. A second actual signup email was delivered with the current header image, brown background image and Gmail button blend styling. Its confirmation link successfully verified the new test account. Gmail on a physical iOS device is not available in this environment; final device-specific appearance remains a user check. Other hosted Auth template types were not silently assumed updated.

## Bug found during final live verification

**Medium — false stale-backup warning after an idle period.** With an otherwise healthy copy two hours old, requesting a new backup immediately reported `stale`. Reproduced with a rollback-only production transaction before the fix. The old status calculation compared the age of the last successful copy with 15 minutes, although unchanged copies are deliberately skipped. This confused a fresh request with changes waiting too long.

The correction records `pending_since` when the connection moves from synchronized to pending. Further changes keep the oldest pending timestamp; a fully successful copy clears it, and partial success starts a new window for remaining changes. Provider failures still report errors and preserve the last successful copy. First-copy requests also alert if they remain pending over 15 minutes. Changed: `20260929215000_elio_backup_pending_age.sql`; regression coverage: `62-backup-pending-age.test.mjs`. Retested fresh requests after idle, repeated requests, genuinely old pending changes, completion, partial completion, failure preservation and first-copy delay. No customer order or payment behavior changes.

Production re-test: the same newly requested copy returned `connected` with `pending=true`; genuinely 16-minute-old work still returned `stale`. The existing connected backup remained successful with no pending work afterward.

**Medium — Unicode loss at an Excel recovery-cell boundary.** The new Excel export initially split JSON at fixed UTF-16 offsets. Placing an emoji across the 24,000-character split reproduced a changed value after saving and reopening the workbook. The exporter now keeps surrogate pairs together. The regression reopens the actual XLSX and reconstructs the full JSON, comparing it byte-for-byte at the string level, including the boundary emoji. Changed: `backup-export.js`; regression: `manual-backup.test.mjs`. This was caught before the deployment fork was synced.

## Evidence and release

Evidence: `test-results/marketing-live-fixtures`, `test-results/backup-ui`, `test-results/release`. Sensitive temporary access tokens and email links were kept out of published files. Earlier source CI run 36630460405 passed after the catalog test synchronization fix. The final backup release results are recorded in the completion message.


Final local release: 41 suites passed, zero failures; 83 migration entries and 264 backend checks. After a final current-count label refinement, all backup browser checks were rerun at four widths. Production manual scope was also checked with a rollback-only order: default and automatic counts stayed zero, all-unserved returned one with exact items, and no access token was included. Anonymous HTTP access returned 401.

Pending-age follow-up: the complete local release passed 41 suites with 84 migration entries and 266 backend checks. The subsequent Unicode boundary correction passed actual-file reconstruction and all four related browser widths. Final hosted CI runs the full suite against the final published commit.
