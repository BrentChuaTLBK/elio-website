# Live stress test — 29 September 2026

The tested order, inventory, POS, promotion, affiliate, accounting, newsletter and calendar scenarios passed. No application correction was required by these scenarios. The dashboard navigation was reorganized afterward.

The deployment fork and live POS stylesheet were verified at commit efd0585 before testing.

## Live load and concurrency

| Scenario | Result |
| --- | --- |
| 120 catalog/quote requests, batches of 4, 8 and 16 concurrent requests | All HTTP 200. P95 by batch: 184 ms, 185 ms, 447 ms. |
| 60 live page requests at concurrency 8 | All HTTP 200. P95 783 ms. |
| Same checkout submitted 20 times at concurrency 10 | One order and one reservation. All retries returned the same order. P95 353 ms. |
| 16 distinct checkouts competing for two remaining boxes | Exactly two accepted; 14 correctly rejected for insufficient pieces. P95 235 ms. |
| Eight parallel database requests competing for a three-use promo | Exactly three accepted; five rejected at the configured limit. |
| The same eight requests competing for five event-stock units | Exactly five sales; three stock rejections. No website-stock deductions. |
| Cash sale: PHP 130 paid with PHP 200 | PHP 70 change each. Five sales posted PHP 650; reconciliation included the PHP 1,000 opening float. |
| Ten simultaneous newsletter signups for one temporary test address | One acceptance and nine HTTP 429 responses; one welcome offer and one welcome email. |
| Unauthorized requests to six administration systems | Rejected. Invalid order tokens, missing newsletter consent, malformed email addresses and unsubscribe tokens were also rejected. |

No network or HTTP 5xx failures were observed in these request batches. Expected validation and stock/rate-limit rejections are successful protection checks.

## Live order lifecycles

36 assertions ran against production PostgreSQL business functions in a rollback-only transaction, including:

- Unpaid website expiry closes the order and releases flavor inventory and the reserved promo use.
- Cancellation restores unpaid stock once; repeated cancellation cannot restore it again.
- Fifty direct-order retries retain one order and one allocation.
- Direct payment links have no automatic deadline and survive the website expiry sweep.
- Guest payment links work with their valid order token.
- Cash underpayment is refused. Retried payment records create one payment with correct change.
- Paid direct pickup and delivery orders produce calendar updates. Completed pickup orders remain marked completed; in-person sales do not enter the calendar.
- A later delivery fee stays separate from product payment. Courier-paid delivery is excluded from Elio income. Recording and retrying an Elio delivery receipt posts income once; correcting it reverses income.
- Refunded orders are excluded from accounting.
- BRENT's actual current terms were tested: 10% customer discount, subject to its configured cap, and 5% affiliate commission. A PHP 900 order discounted to PHP 810 earned PHP 40.50 only after completion. Unrelated updates did not duplicate earnings; a refund reversed the commission.
- Event products with flavors charge the selected surcharge and deduct only that flavor's stock. Sold-out flavors are refused.
- A batch of 100 paid direct orders plus 100 repeated submissions retained exactly 100 orders, PHP 10,100 accounting income, and 100 calendar entries. The batch took 680 ms inside the database transaction; this is not end-to-end HTTP throughput.
- Optional direct-order emails remained disabled for the bulk batch.

These rollback-only tests did not persist the bulk orders or publish their temporary calendar changes.

## External delivery and browser checks

- Six actual order emails and one newsletter welcome email were accepted on the first worker attempt. Resend reported all seven delivered. Provider content contained the expected order/payment details and no unresolved template placeholders.
- Two committed direct-order samples—pickup completed and delivery confirmed—were acknowledged by the Google Calendar worker at their latest revisions.
- The temporary newsletter contact was unsubscribed through the normal workflow; contact removal completed and the provider no longer returned the contact.
- 24 live page/viewport checks at 1440, 390 and 320 pixels found no JavaScript page errors, broken loaded images, or horizontal overflow.
- The full isolated regression suite also passed: 69 migrations and 226 backend checks. The configured Node test run passed all 20 reported entries, covering email templates/workers, newsletter, calendar, proof handling, accounting/Excel, quantities, production and analytics.

## Cleanup verified

Removed all 13 committed stress orders, the event, its stock and product, the two temporary website products, test promo, newsletter subscriber and welcome promo. Both Google Calendar deletions were acknowledged.

Final checks found zero orders, zero POS events, zero accounting rows for the test period, no pending email jobs, no pending calendar changes, and no calendar errors. Hash comparisons confirmed the original website product records, configured inventory and shop settings were unchanged. Historical provider delivery logs remain as normal email records.

## Other findings and limits

- October's flavor menu is published with no selected flavors. This existing configuration prevents ordering products that depend on that menu until it is populated. It was left unchanged.
- Supabase continues to flag disabled leaked-password protection. This pre-existing authentication hardening setting was not changed.
- Performance advisory notices included an unindexed foreign key on the singleton newsletter runtime table and currently unused indexes. No slowdown was demonstrated from these notices; no speculative index changes were made.
- This was a bounded live stress and correctness check, not a guarantee of unlimited capacity or complete code-path coverage. The largest HTTP burst was 16 concurrent requests. The backend's global write lock serializes conflicting mutations; substantially higher sustained traffic was not measured.
- File conversion, provider retry failures and broader template variants were covered by isolated regression checks; this live run sent seven actual emails and did not upload customer receipt files.

## Dashboard navigation changes

- Overview remains first.
- Daily operations: POS, Orders, Calendar, Production.
- Catalog & stock: Boxes & sets, Flavors, Flavor menus, Daily quantities.
- Reports: Accounting, Analytics.
- Marketing: Promo codes, Affiliates, Newsletter.
- Shop & team: Shop settings, FAQs, Maintenance, Team access.
- Aligned outline icons, consistent spacing and clear group separators.
- A compact mobile menu shows the current page and closes after a successful selection. All destinations remain available; owner/staff visibility rules are preserved.

Browser verification passed for owner and staff at 1440, 1024, 768, 760, 390 and 320 pixels, including menu resizing, selected-page labels and no navigation overflow.
