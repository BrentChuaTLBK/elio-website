# Elio order recovery

The independent recovery copy is the private Google Sheet **Elio · Orders and affiliate recovery** in the owner's chosen Drive folder. This is an operational order backup, not a complete Supabase project restore.

## Automatic operation

- Supabase Cron checks every five minutes. Changed records and failed attempts are retried; unchanged data is skipped. A daily refresh restores the generated sheet if someone edits it accidentally.
- The worker uses Elio's existing Google service account, with Editor access to the spreadsheet and two proof archives. No Apps Script, local computer, browser, or assistant is needed.
- Website orders are authoritative. Nothing edited in the sheet is written back to the website.
- A database snapshot is validated, written in one Google Sheets batch, read back, reassembled and checksum-verified before success is recorded.
- A three-minute lease prevents overlapping backup workers. The worker renews it before each proof read, upload chunk, revision pin and final publication; an expired/replaced lease cannot be revived. Changes arriving during a run remain pending for the next run. A 150-second work guard stops further writes and reports a timeout.
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

Two private binary ZIP files, **Elio payment proofs - A.zip** and **B.zip**, alternate. The worker streams into the inactive file through Google's resumable upload protocol in 8 MiB chunks, verifies Google's stored SHA-256 and size, pins the verified immutable revision, then publishes its file/revision reference in the spreadsheet. The current verified revision is pinned before any alternate upload starts. A delayed or interrupted upload cannot delete those pinned bytes. Google Drive API must be enabled in the same service-account project, and the account needs Editor permission on both existing archives. No additional Drive files or folder-wide permission are required.

New archives use format version 2. The outer ZIP contains `manifest.json`, `recovery.json`, `payment-proofs-index.csv`, `README.txt`, and numbered `proof-parts/part-0001.zip` files. Extract the outer ZIP and then each part to find exact uploaded image bytes under paths such as `proofs/ELIO-ABC123/ELIO-ABC123-payment-proof-1.png`. The manifest records each part's SHA-256, size and proof count; recovery data records every original private Storage path, inner filename, part and proof SHA-256. The outer SHA-256 is stored in the spreadsheet. Proofs belong to active paid or under-review orders. Cash/POS orders can legitimately have no attached file. A missing, oversized or invalid referenced proof fails the run rather than claiming a complete backup.

The two slots normally hold the current and preceding verified ZIP, **not** 30 days of image history. After spreadsheet readback and database completion, cleanup deletes only the app-tracked superseded pinned revision in the newly written slot. Failed cleanup retains an extra revision; it never invalidates the verified success. Repeated interrupted runs can leave extra pinned revisions and consume Drive storage. Google permits 200 pinned revisions per file; an operator can compare the two database-tracked revisions against Drive history before removing obsolete extras. Older spreadsheet History entries retain structured data and hashes; their former archive revisions might have been retired. Completed-order proofs leave the current archive on the next successful backup. Keep a separate permanent export if longer image retention is needed.

## Admin controls

The owner has **Shop & team → Order backup**: connection/last-success status, Back up now, Open backup sheet, Open proof ZIP, and manual downloads. **Download with proofs (ZIP)** creates the same version 2 container; **Download Excel** includes order details, flavors and lossless recovery-data chunks; **Download recovery data** creates the checksummed JSON envelope. The selector includes paid/under-review unserved orders or all unserved orders. ZIP downloads assemble a Blob from bounded segments without flattening the complete archive into a second byte buffer. Customer and ordinary staff access is rejected server-side.

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

The sheet writer has a 5 MB atomic-request cap and a 39,995-row cap per generated tab. Each original proof may be up to **20 MiB (20,971,520 bytes)**. Each inner proof ZIP is limited to 32 MiB, and the complete recovery container is limited to **96 MiB** including metadata. Recovery JSON is limited to 8 MiB, proof count to 20,000, and part count to 16. The 96 MiB bound keeps a margin for the hosted worker's 2-second CPU and 256 MB memory limits; local synthetic checks are not a hosted capacity guarantee. The worker retains one bounded proof part and two reusable upload buffers, rather than materializing the entire ZIP. Exceeding a size, runtime or provider limit reports an error and leaves the last verified success recorded. Manual exports also depend on the source database being available. Larger capacity requires continuation across requests or a worker with a larger execution budget.

For an outage, first use Orders and Items to fulfill already-paid commitments. Save a private copy of the spreadsheet before any recovery work. Reassemble Recovery JSON by snapshot/part number and verify its SHA-256 with `decodeRecoveryRows` in `supabase/functions/order-backup/sheets.js`; manual JSON uses `recoveryEnvelope` in `dist/assets/admin/recovery-data.js`. `readRecoveryArchive` in `dist/assets/admin/recovery-archive-reader.js` verifies both the original flat ZIP format and the new version 2 container, including bounded stored-ZIP layout, all part/proof hashes, original paths and expected active proofs. It rejects compressed/ZIP64/encrypted entries, duplicate or unsafe names, unlisted entries, missing proofs and oversized manifests/parts. Verify the external outer checksum from the trusted spreadsheet when available. If a Drive head was replaced, download the exact pinned `proof_archive.revision_id` through Drive's revisions API. Reconcile IDs, revisions, payments, commissions and orders served since the snapshot in an isolated environment before restoring anything to production. No automatic overwrite/import is exposed in admin.

The isolated test restores paid-order JSON into a temporary database table and compares counts and totals. It is an operational-data drill, not a complete hosted Supabase restore.

Version 2 validation (3 October 2026): 40 MiB of synthetic proof images restores with independent ZIP CRC and SHA checks; 94 MiB exercises Storage reads, streaming archive generation, resumable upload, Google checksum metadata, revision pinning, atomic sheet publication and readback in mocked transport. Interrupted/partial uploads, ambiguous responses, quota errors, bad checksums, expired/replaced leases and legacy recovery are covered. These are isolated tests; populated hosted capacity still requires release validation. Full-project recovery is covered separately in [disaster-recovery.md](disaster-recovery.md).

Protocol references: [Google resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Google revision retention](https://developers.google.com/workspace/drive/api/guides/manage-revisions), [Supabase runtime limits](https://supabase.com/docs/guides/functions/limits). Browser hashing/CRC dependencies are pinned and vendored with integrity manifests; reproduce them with `node scripts/vendor-backup-hashes.mjs`. The server uses native SHA-256 and the same CRC implementation to avoid native CRC compatibility differences in older Deno runtimes.
