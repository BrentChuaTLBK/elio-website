# Elio full-system disaster recovery

This runbook covers loss of the Supabase project or its database, Storage and deployment configuration. The operational Google Sheet/proof archive described in `order-backup.md` remains useful for fulfillment continuity, but does not reconstruct the complete system.

## Verified state and remaining limits

Inventory captured on 2026-10-03 Asia/Manila identifies project `dzxyhckkkrzqpwpavngn` (Elio System), region `ap-southeast-1`, PostgreSQL `17.6.1.166`, and the Pro plan. The user reported the latest successful dashboard backup as **01 Oct 2026 23:25:10** and **no PITR**. The displayed timezone and retention were not provided. These backup facts are user-reported, not independently verified through the Management API. Do not calculate the backup age or assume its timezone from this record.

The current connected tools expose no backup-list/PITR endpoint. Actual retention remains **unverified**; the documented Pro-plan seven-day daily-backup window is not evidence of this project's current recovery points. Database backups exclude Storage object bytes. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)

The current Storage export is complete at its checked inventory point: three public product images, **592,276 bytes**, with per-object SHA-256 checksums. The other three buckets were empty, and a fresh database metadata read confirmed that objects/counts had not changed after export. This local export is not an encrypted offsite copy. No production database dump, Auth secret export, paid recovery project or production restore was performed.

An isolated application restore rehearsal passed. It proves recovery of the application schema and synthetic fixture data with separately restored Storage bytes. It does not prove hosted Supabase recovery, actual Auth login/OAuth/TOTP, Vault key recovery, external integrations, DNS cutover or a production recovery-time objective.

## What must be preserved

| Component | Recovery material and dependency |
| --- | --- |
| Application database | Entire `elio` schema, not selected order rows: all orders/statuses, allocations, payments, POS, accounting, affiliates/payouts, newsletters/consent/vouchers, audit history, catalog, stock, settings, integration connections and `elio.secrets`. Preserve keys, constraints, sequences, indexes, functions, triggers, grants and policies. |
| Public database API | `public.shop_api`, `public.shop_service`, worker authorization functions and their ownership/grants. Restore the matching application release and complete migration history. |
| Auth | Hosted `auth` schema and user/identity/password state, account links, MFA factors/recovery data and session policy. The inventory counts were 3 users, 4 identities, 4 sessions and 0 MFA factors before the approved MFA release. Real Auth configuration and secrets require a protected backup method; none appear in this report. |
| Storage | Bucket definitions, access policy, metadata and **separate object bytes**. Preserve object names and media types so database paths still resolve. Keep versioned copies long enough to cover every retained database recovery point. |
| Hosted database services | `supabase_migrations`, extensions, `cron`, `net`, `vault`, Realtime/publications and other managed schemas. Local tests only emulate selected platform surfaces. The live schema inventory lists 12 schemas; managed-table inventory is separate. |
| Encryption | `elio.secrets` is needed to decrypt existing private order links. Supabase Vault additionally relies on project encryption-root material outside ordinary backup files. Keep it in approved secret custody, never this repository. For a manual restore to a different project, follow the current provider procedure while the source is still available; a hosted clone handles keys differently. [Supabase manual backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) |
| Functions and website | Matching Git release, migrations, eight application Edge Function source trees, shared modules, templates, dependency locks, Supabase config, Cloudflare config and CI workflow. Ten functions were deployed at inventory time: eight application functions plus two audit cleanup utilities. Audit utilities are not automatically part of a recovery deployment. |
| External configuration | Supabase Auth URLs/redirect allowlist, Google OAuth client configuration, SMTP/Resend sender setup and domain DNS, analytics property/service account, Calendar ID/sharing, backup Sheet/folder access, Cloudflare route/TLS, GitHub deployment access and secret values in the approved secret manager. Names/hashes are inventoried; values are not exported. |

Storage buckets:

| Bucket | Public | Objects at inventory | Bytes |
| --- | --- | ---: | ---: |
| `product-images` | Yes | 3 | 592,276 |
| `website-images` | Yes | 0 | 0 |
| `payment-proofs` | No | 0 | 0 |
| `affiliate-payout-proofs` | No | 0 | 0 |

All four currently allow PNG/JPEG/HEIC/HEIF/WebP with a 20 MiB object limit. The source inventory records these settings and policy names. Private proof buckets must remain private after recovery.

Deployment environment names found in the application are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEYS`, `ALLOWED_ORIGINS`, `EMAIL_FROM`, `NEWSLETTER_EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_BROADCAST_API_KEY`, `GA_PROPERTY_ID`, `GA_SERVICE_ACCOUNT_JSON` and `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON`. Calendar/backup can share the configured Google service account; restore the actual chosen access and file-sharing configuration. There are three Vault worker credentials and three enabled schedules: email and Calendar every minute, operational backup every five minutes. Only credential names and command hashes were inventoried.

## Re-run the isolated drill

From the repository root with its existing Node dependencies:

```powershell
node scripts/disaster-recovery-drill.mjs
```

To include the three verified public object exports in addition to synthetic files for every bucket:

```powershell
node scripts/disaster-recovery-drill.mjs --public-storage-export=work/approved-batches-2026-10-03/disaster-recovery/storage-export
```

`tests/disaster-recovery.test.mjs` runs the fully synthetic variant in the normal release suite. Each run creates a fresh local artifact directory; it has no network calls, production credentials, enabled worker schedule or external send. The optional export input is checked against its public-only manifest before it is used.

The drill builds the complete application migration chain, records the three hosted-only schedule migrations it cannot execute, seeds paid and unpaid orders, stock, settings, newsletter state and synthetic Auth identities/passwords/MFA sessions, then snapshots the whole local PostgreSQL data directory. It restores that verified snapshot into a new database and copies separately verified Storage files into a new filesystem destination. The source settings are deliberately changed and the original database is closed before restoration.

The latest measured rehearsal restored **66 tables, 173 functions and seven Storage objects** in ten check groups. It compares every table's row digest, constraints, indexes, RLS flags, grants and policy definitions; exercises owner/customer/anonymous authorization; checks private-link decryption and password/identity relationships; and matches object bytes, metadata and bucket privacy. Missing/truncated files, corrupted database bytes, a changed manifest and unsafe paths are rejected. The manifest SHA must be kept in separately trusted custody; a checksum alone is not a backup signature.

The sample run took about **0.51 seconds to package**, **0.64 seconds to restore locally**, and **4.48 seconds overall**. These tiny synthetic/local timings are not estimates for production downtime. PGlite uses its documented full-data-directory export/import mechanism; the artifact is an isolated test format, not a Supabase hosted backup. [PGlite API](https://pglite.dev/docs/api#dumpdatadir)

## Production rehearsal and incident procedure

1. **Assign the people and destination.** The Elio business owner approves the recovery point and acceptable data loss. Name a technical restore operator and a second reviewer, an encrypted offsite destination, its key custodian, and an isolated Supabase destination before any real restore. Those assignments and a production RPO/RTO are not yet confirmed.
2. **Confirm the recovery evidence.** In this project's Database → Backups, record successful backup date/time **with timezone**, actual retention/recovery points, backup type and PITR state. Capture a fresh successful backup for a maintenance window. Read-only Management API evidence can alternatively come from `GET /v1/projects/dzxyhckkkrzqpwpavngn/database/backups` if approved management access is available. This step is also the SEC002 database-upgrade preflight.
3. **Take a coordinated recovery set.** Preserve roles, the complete application schema/data, hosted Auth data and customizations, migration history and necessary deployment configuration through the provider-supported backup/export path. Use the installed CLI's `--help` and the current manual guide for logical exports. Copy every Storage bucket through its supported API/S3 interface with complete pagination; record bucket/name, byte count, content type and SHA-256. Repeat listing after export, and reconcile changes or briefly pause uploads while taking the set. A metadata-only SQL export cannot recover files. [Supabase Storage S3 support](https://supabase.com/docs/guides/storage/s3/compatibility)
4. **Protect and independently read back the set.** Encrypt database/Auth/private-object material before placing it offsite. Preserve all object versions required by retained database snapshots. Verify the archive manifest and a complete byte/count readback using a separate recovery identity. The current local public-image export does not complete this offsite step.
5. **Restore in quarantine.** Restore into the preapproved isolated destination with the correct platform/extension versions and encryption requirements. Keep email, newsletter, Calendar and backup workers and all cron schedules disabled; block outbound delivery. Recreate the four bucket definitions and access rules, restore object bytes without deleting unrelated destination content, then reconcile database paths and hashes. Restore migration history and custom policies/triggers as well as data. Do not direct copied cron commands, callbacks or service accounts at production integrations.
6. **Validate the complete application.** Compare schema/migration inventory, table counts, keys/foreign keys, monetary totals, unpaid/paid/POS/affiliate history, catalog/stock, newsletters/consent and settings. Check real Auth login, OAuth callbacks, recovery and owner MFA in the isolated environment. Verify guest private order links, owner/staff/customer boundaries, both private proof buckets, public images, download/print/export and disabled integration behavior. Use synthetic test addresses and controlled sinks until the business owner authorizes real outbound delivery.
7. **Record measured RPO/RTO and cut over.** Record the last durable database and compatible Storage recovery points, any reconciled gap, start/end times and remaining failures. The owner authorizes reopening after the reviewer signs off. Update the website's target project/config, Auth redirects, DNS and integration targets together. Resume workers one at a time, checking idempotency and queues before enabling the next; avoid duplicate email, Calendar or backup runs.
8. **Keep rollback available.** Retain the original recovery set and old deployment configuration until acceptance. For a failed rehearsal, keep production unchanged and repeat with a new isolated destination. During an actual incident, the rollback point and any writes made after cutover must be reconciled before switching back.

Planning assumptions for owner review: a **24-hour database RPO** is only a target when a daily backup actually succeeds and is available; it is not a promise for the reported backup. Storage must have an equally recent compatible versioned copy. **Eight hours RTO** is a proposed planning budget for operator access, restore, validation and cutover, not a measured capability. A five-minute operational Sheet interval does not establish either full-system objective. With no PITR reported, recovery to an arbitrary intervening minute is not available from that feature.

## Evidence and handoff

- `work/approved-batches-2026-10-03/disaster-recovery/backup-preflight.json`: user-reported backup/PITR evidence and exact remaining SEC002 preflight items.
- `live-inventory.json`: 100 application/Auth/Storage/operational tables/views, 168 live application/public functions, 490 application columns, schemas/extensions/policies, 87 deployed migrations, buckets, cron metadata and credential names at inventory time. `storage-export-validation.json` adds the seven managed tables omitted from that focused list and confirms the object export remained complete.
- `deployment-inventory.json`: 56 source/config/template/workflow/dependency files with SHA-256 and required environment names. This is a configuration inventory; deploy from the matching release after the release owner completes it.
- `storage-export/manifest.json` and its object files: complete current public Storage-byte export. No private object existed at the checked snapshot.
- `test-results/approved-batches-2026-10-03/disaster-recovery/latest-report.json`: latest local rehearsal, migration hashes, exact counts, artifact directory, checks and timings. Release tests may update this to the fully synthetic four-object variant; the dated seven-object run remains available alongside it.

Remaining acceptance items are actual retention/timezone confirmation, named recovery owners and agreed objectives, protected offsite custody/readback, and a real isolated hosted database/Auth/integration restore. Record these as pending; do not report the synthetic drill as completion of a production restore.
