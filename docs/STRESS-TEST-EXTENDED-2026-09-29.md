# Extended live stress test — 29 September 2026

The extended test found and fixed two performance problems: catalog reads were unnecessarily serialized with other requests, and administration lists fetched every order's full audit history. Both backend changes are deployed. No incorrect stock deduction, duplicated payment, promo-limit bypass, or accounting/affiliate total was found in the completed scenarios.

The user subsequently lowered the requested test limit to 500 and expressed concern about Supabase usage. All additional load testing stopped immediately. A 1,024-request **static-page** burst had already completed under the earlier authorization; it triggered the automatic stop. The 2,000-request stage and further database peak stages did not run.

## What changed

Migration: `20260928185225_elio_stress_read_performance.sql`.

1. Catalog and quote reads check whether default stock needs refreshing or website reservations have expired. They acquire the existing transaction lock only when this maintenance is actually needed. Ordinary reads can run concurrently. Homepage, flavor collection and FAQ reads also avoid the write lock. Checkout, stock, promo and other mutations retain their existing serialization.
2. Dashboard and POS order lists omit audit-history snapshots. Opening an individual order still loads its complete history, including before/after records. Order totals, item details, status and other list data remain available. New private helper functions have no browser-role execution grants.

Three new regression checks verify list/detail parity, retained order history, default inventory refresh without overwriting configured stock, and expiry when a customer loads the catalog. The complete isolated backend run passed **70 migrations and 229 checks**.

## Measured live performance

All timings are from this client and this test window. They are not guaranteed production capacity.

| Workload | Before | After |
| --- | ---: | ---: |
| 96 concurrent mixed catalog/quote requests, p95 | 2,265 ms | 1,101 ms |
| 64 concurrent mixed catalog/quote requests, p95 | 1,424 ms | 564 ms |
| Sustained 3,000 mixed requests, concurrency 32 | 102.9 requests/s | 173.4 requests/s |
| Same sustained batch, p95 | 357 ms | 241 ms |
| Additional burst at concurrency 192 | Not run | 384 requests; all 200; p95 1,616 ms |
| Dashboard at approximately 1,000 orders, database execution | 588 ms | 261 ms |
| Dashboard response at approximately 1,000 orders | 4.75 MB | 2.44 MB |
| POS history at 1,000 orders, database execution | 66 ms | 24 ms |

The dashboard comparison includes 1,010 total rows before and 1,025 after because separate committed contention fixtures existed at those points. Approximately half the response size was removed despite the extra rows.

A database snapshot during the original read load found 18 sessions waiting on the advisory lock. The post-change snapshot found active queries without advisory-lock waits. Connection counts observed during the read tests stayed around 33–34; the configured database maximum was 60.

### Upper burst result

Static pages passed at 256 and 512 concurrent requests. At **1,024 concurrent page requests**, 1,021 returned HTTP 200 and three encountered client transport failures. P95 was 2,228 ms, p99 4,731 ms and the maximum elapsed time was 11,831 ms. The stop threshold was reached, so no 2,000-request burst ran.

These were transport errors, not observed HTTP 5xx responses. This run does not establish whether they originated in the client connection load, network or hosting. No additional reproduction was attempted after the user reduced the test limit.

The database API's highest completed concurrency was **192**, not 1,024 or 2,000. Final checks returned HTTP 200 for the homepage, dashboard shell, POS shell and catalog in 193–432 ms.

## Correctness under contention and volume

- **100 retries of one checkout at concurrency 50:** one order, one reservation and the expected PHP 900 total.
- **100 distinct checkouts competing for nine remaining boxes:** nine accepted, 91 correctly rejected; no overselling.
- **32 parallel promo contenders:** exactly five accepted for a five-use cap, each with the expected PHP 810 discounted total.
- **Event sales:** the initial closed-cash-session test correctly refused all sales. After opening the test cash session, 16 contenders consumed exactly ten stock units. Each PHP 130 sale paid with PHP 200 returned PHP 70 change. Accounting recorded PHP 1,300; no event sales entered the calendar or consumed website stock.
- **Payment and cancellation retries:** 11 completed parallel transactions replayed the same payment and cancellation requests. One additional connector call was cancelled and is excluded from the result count. The paid order retained exactly one payment; cancelled orders retained zero payments and zero allocations. In the competing pay/cancel race, cancellation won and stale payment attempts were refused.
- **3,000 paid direct orders, rollback-only:** all 3,000 produced the expected accounting and calendar records. Their sales totaled PHP 303,000. At 3,000 orders, database execution was 798 ms for dashboard data, 247 ms for accounting, 1,069 ms for calendar data and 23 ms for the capped POS history. These are database timings, not HTTP throughput. The temporary rows were never committed or published to Google.
- **500 unpaid website orders, rollback-only:** exactly 1,500 flavor pieces were reserved. Expiry processed all 500 in 690 ms, restored every piece, and queued one expiry notification per order. A repeated sweep made no further changes. The creation batch took 6,823 ms in PostgreSQL.
- **Affiliate completion/refund batch, rollback-only:** 20 completed BRENT-code orders and ten refunds left PHP 405 net commission and PHP 8,100 sales after discounts for the ten retained orders. Only the transaction's test allowance was temporarily raised; original promo terms were restored by rollback.
- **Order email queue, rollback-only:** a request to claim 9,999 jobs was capped at ten. A second claim selected ten different jobs, with 20 distinct active leases.

## Email, newsletter and calendar coverage

The live run sent **15 order-received emails and three actual expiry emails** to the authorized test address. Resend reported **all 18 delivered**, each on its first worker attempt. Retrieved content included HTML and order details without unresolved template placeholders. Seven additional queued test-expiry messages were removed during cleanup, avoiding unnecessary sends.

Newsletter consent, welcome-code rules, duplicate signup handling, broadcast exclusivity, stale leases, payload freezing and retry behavior passed in the isolated regression suite. The larger proposed live newsletter dataset was **not run** after the user asked to reduce usage. No broadcast was sent to customers.

The committed paid direct-order sample synced to Google Calendar. Its deletion also synced successfully during cleanup. Event sales remained excluded.

Template, conversion and UI coverage from the earlier audit was not repeated wholesale in this run. This was an extension focused on concurrency, report volume, expiry, financial consistency and queue behavior; it is not a claim of complete code-path coverage.

## Usage and remaining limits

Before the final reduced limit arrived, the recorded HTTP batches had already issued **12,432 requests** in total: approximately 10,160 database API requests and 2,272 website page requests. Their decoded response bodies totaled **151,975,971 bytes** (about 145 MiB). This is **not** a Supabase billing figure: page traffic uses a different service, transfer compression can differ, and database/connector tests are additional work. No further load batches were run after the reduction.

Database storage was approximately 21.6 MB at baseline and 25.2 MB after cleanup. Rollback prevents persistent test business records; PostgreSQL can retain freed pages for reuse.

Two scaling limits remain relevant:

- Dashboard startup still loads all orders. Even with audit snapshots removed, 3,025 total rows produced about 7.1 MB. Server-side pagination and dedicated aggregate queries are the next improvement if the order history grows substantially.
- Checkout and other mutations deliberately retain the global transaction lock. This test preserved its stock/promo guarantees; it did not prove high sustained write capacity or support for thousands of simultaneous buyers.

## Cleanup and final state

Removed all **28 committed test orders**, the test event and its stock/item, two website test products, and the temporary promo. All bulk report, affiliate and expiry datasets were rolled back.

Final verification found:

- Zero orders, POS events, accounting rows and affiliate ledger entries.
- Zero pending order/newsletter emails.
- Zero pending calendar changes and zero calendar errors.
- Google acknowledged deletion of the test calendar event.
- Original product, inventory and shop-setting hashes matched baseline.
- BRENT remained at its original 10% discount, per-account limit 1 and global limit 1,000.

Provider delivery logs and acknowledged calendar deletion records remain as normal history. The declined password-protection setting was not changed.

