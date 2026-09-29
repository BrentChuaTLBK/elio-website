# Elio order recovery

The independent recovery copy is the private Google Sheet **Elio · Orders and affiliate recovery** in the owner's chosen Drive folder. This is an operational order backup, not a complete Supabase project restore.

## Automatic operation

- Supabase Cron checks every five minutes. Changed records and failed attempts are retried; unchanged data is skipped. A daily refresh restores the generated sheet if someone edits it accidentally.
- The worker uses Elio's existing Google service account, with Editor access to the spreadsheet and two proof archives. No Apps Script, local computer, browser, or assistant is needed.
- Website orders are authoritative. Nothing edited in the sheet is written back to the website.
- A database snapshot is validated, written in one Google Sheets batch, read back, reassembled and checksum-verified before success is recorded.
- A lease prevents overlapping backup workers. Changes arriving during a run remain pending for the next run.
- Failed saves do not first clear the spreadsheet. The last success time remains visible. A failed verification reports an error and retains earlier history.

## Tabs

| Tab | Contents |
| --- | --- |
| Orders | Paid and payment-under-review orders still awaiting service, including overdue orders; explicit payment status, customer/contact, date, delivery address, totals and affiliate attribution. |
| Items | Exact item quantities, fixed/custom flavors and prices for those active orders. |
| Affiliates | Affiliate-related orders, payment/fulfillment status and estimated/earned commissions. |
| Recovery | Full structured snapshot: all paid-order history, payment-review orders, affiliate-related order details, payments, allocations, referenced inventory/products, affiliates, attribution, ledger and payouts. A link opens the matching proof archive. |
| History | Earlier successful structured snapshots retained for 30 days. |

Completed, cancelled, expired and Refund-labelled orders leave the active list on the next successful sync. Completion does **not** delete the website order or its paid-order recovery history. The latest Recovery snapshot retains historical paid orders; the 30-day limit applies to earlier snapshots in History.

Payment-under-review orders remain explicitly unconfirmed. The backup does not approve payment or create commission earnings. Rejecting a proof returns an order to awaiting payment and removes it from the next active backup until another proof is submitted or payment is confirmed.

## Actual payment-proof files

Two private binary ZIP files, **Elio payment proofs - A.zip** and **B.zip**, alternate. The worker writes the inactive file and verifies Google's stored SHA-256/size, then publishes its reference in the spreadsheet. A failed write does not first overwrite the current referenced archive. Google Drive API must be enabled in the same service-account project, and the account needs Editor permission on both archives.

Each ZIP includes `recovery.json`, `payment-proofs-index.csv`, `README.txt`, and actual uploaded image bytes in paths such as `proofs/ELIO-ABC123/ELIO-ABC123-payment-proof-1.png`. The index contains order reference/ID, customer, scheduled date, payment status, filename and SHA-256. Proofs belong to active paid or under-review orders. Cash/POS orders can legitimately have no attached file. A missing, oversized or invalid referenced proof fails the run rather than claiming a complete backup.

The two slots normally hold the current and preceding ZIP, **not** 30 days of image history. A failed run can replace the inactive slot, while the currently referenced ZIP remains intact. Older spreadsheet History entries retain structured data and hashes; their former archive slot might have been reused. Completed-order proofs leave the current archive on the next successful backup. Keep a separate permanent export if longer image retention is needed.

## Admin controls

The owner has **Shop & team → Order backup**: connection/last-success status, Back up now, Open backup sheet, Open payment-proof backup, and manual downloads. Prepare current backup fetches fresh data. Download order data creates a JSON envelope with a SHA-256 checksum; Download fulfilment list creates a CSV of active orders, including payment status, flavor and affiliate details. Download the linked ZIP separately for the actual images. Customer and ordinary staff access is rejected server-side.

## Verification on 30 September 2026

- Automatic scheduled runs succeeded at 03:30 and 03:35 Manila time. Both completed Google write/readback verification. The second run retained the first snapshot in History.
- After enabling Drive API, the expanded proof-archive run succeeded at 04:00 Manila time. An independent download verified ZIP CRCs, the recovery JSON SHA-256, and the archive SHA-256/size recorded in the spreadsheet. The live source contained zero paid or under-review orders, so this was an empty-proof integration check.
- The next scheduled run at 04:05 Manila time succeeded without a manual invocation, switched the current archive from A to B, and retained the 04:00 snapshot in History. The database reported no error and no unsynced changes. Deployed order-backup v8 was read back and matched the final worker files.
- A real PNG fixture was preserved byte-for-byte in an independently opened ZIP, with an order-labelled path and index. Isolated tests also covered under-review status, completion, corrupt/missing proofs, cross-order path misuse, and upload/checksum/spreadsheet failures. The current archive stayed intact in those failure scenarios.
- Google omits parent metadata for file-only sharing. The worker accepts the two privately configured archive IDs without requiring folder-wide access; a visible conflicting parent is rejected. Both file locations and private sharing were independently checked through the owner connection.
- Source database and Google copy had zero paid orders at verification. The existing affiliate configuration was included. This is not a claim that a populated production paid-order lifecycle was exercised; populated order, completion, commission and error scenarios were tested in isolation.
- All five tabs were read via Google Sheets and visually inspected through a freshly exported workbook.
- Live grants deny anonymous/customer direct reads of the connection table and snapshot function. The worker-secret verifier is service-role only.

## Limits and recovery procedure

There can be up to one polling interval of unsaved changes in normal operation; an outage can extend that. This is not a zero-loss guarantee. Check last successful backup before relying on a copy.

Actual active-order payment-proof images are included in the separate ZIP. Affiliate payout-proof images are not bundled. Auth accounts, credentials, awaiting-payment non-affiliate orders and complete shop settings are not included. Keep Supabase database backups and separate Storage backups as well. Hosted full-database restoration/PITR was not proven by this work.

The sheet writer has a 5 MB atomic-request cap and a 39,995-row cap per generated tab; each ZIP is capped at 32 MiB to fit the worker's memory/runtime. Each proof is capped at 5 MiB. Exceeding a limit reports an error instead of publishing an incomplete success. Use manual exports and plan an archive/storage change if growth approaches these limits. Manual exports also depend on the source database being available.

For an outage, first use Orders and Items to fulfill already-paid commitments. Save a private copy of the spreadsheet before any recovery work. Reassemble Recovery JSON by snapshot/part number and verify its SHA-256 with `decodeRecoveryRows` in `supabase/functions/order-backup/sheets.js`; manual JSON uses `recoveryEnvelope` in `dist/assets/admin/recovery-data.js`. Reconcile IDs, revisions, payments, commissions and orders served since the snapshot in an isolated environment before restoring anything to production. No automatic overwrite/import is exposed in admin.

The isolated test restores paid-order JSON into a temporary database table and compares counts and totals. It is an operational-data drill, not a complete hosted Supabase restore.
