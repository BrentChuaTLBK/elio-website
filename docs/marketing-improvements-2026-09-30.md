# Approved marketing improvements — 30 September 2026

Scope: C2, T2, N1, N2 and H1 from the approved clarification preview. No new popup, promotional email, discount, tracker, subscription or commission rule was added.

## C2 and N2: Marketing insights

Owners can open **Marketing → Marketing insights**. Newsletter and automatic-offer groups are selected by Manila calendar month. Affiliate reconciliation has a separate, clearly labelled all-time view.

- Newsletter groups use the first confirmed signup and its original acquisition source: popup, checkout, website newsletter form, account preferences or unknown. Duplicate signups and rejoins keep the same original welcome code and do not create a new signup in this report.
- New acquisition metadata is immutable through normal subscriber updates. For historical records with no rejoin, the existing source is retained as `legacy_recorded`. If a historical record has rejoined, its original source is conservatively marked unknown because the previous implementation could overwrite it. The latest consent source remains available separately.
- Automatic offers use their actual voucher issue date. Existing campaign statistics and voucher eligibility rules are preserved.
- Each recipient gets a fixed 30-day window. Outcomes and redemption denominators include only recipients whose full window has ended. Younger recipients are labelled **Still collecting**. Counts of all signups/issued codes are displayed separately from codes ready for comparison. A recent group with no mature recipients does not show a fabricated 0% redemption rate.
- Eligible orders must be paid website orders with an actual payment approval timestamp within the window. Product totals come from saved server order data. Delivery, cancelled/expired orders, refund-labelled orders, both POS flows, and explicitly marked test orders are excluded from cohorts. Unmarked test data cannot reliably be distinguished from business data.
- Product gross minus discounts reconciles to paid product sales. Source-order drilldowns paginate at 50, preserve the same filters and open the existing order detail.
- A later customer has a separate website order created and paid after the first paid redemption, within that recipient's same 30-day window. Customers are unique by normalized checkout email; this cannot prove that two different emails are the same person. Multiple campaign vouchers do not multiply the repeat-customer denominator.
- Refunds and subsequent order edits can restate historical results. The report uses current saved product totals and payment approval time, not an immutable accounting snapshot. Sales using codes are attributed sales, not proven incremental revenue or profit.
- Affiliate sales, estimates, commission ledger credits/reversals and paid/nonvoided payouts are aggregated separately to avoid join multiplication. Balances remain separate per partner, including negative offsets. All-time ledger reconciliation retains the complete financial history. The new paginated commission ledger opens source orders; the orders/payout button opens that partner in the existing affiliate manager.

Files: `dist/assets/admin/marketing-insights.js`, `marketing-insights.css`, admin navigation/mount integration, affiliate initial selection, and `supabase/migrations/20260929201953_elio_marketing_insights.sql`.

## T2: limited refactoring

The new reporting controller is isolated from the existing order editor. Pagination rendering is shared by the two new drilldowns. The affiliate manager accepts an optional initial partner so the report can reuse its existing order and payout history. No standalone order-edit extraction, historical-migration rewrite or change to pricing/stock/payment behavior was performed.

## N1: verified analytics event map

GA4 measurement: `G-0DJM12X1FV`.

| Stage | Current evidence | Status |
|---|---|---|
| Public page view | Browser tests with the real Google tag emitted one canonical `page_view`, with clean referrer and no private URL/PII; collection intercepted | PASS at browser/network boundary |
| Consent denied | Local privacy tests and live shop test emitted no Google measurement request | PASS |
| Account/admin/private order URL | Automated route, fragment, query and private-checkout-transition tests suppress tracking | PASS |
| Add to cart | No ecommerce event implemented in current source | GAP |
| Begin checkout | No ecommerce event implemented in current source | GAP |
| Order saved | No ecommerce event implemented in current source | GAP |
| Payment approved / paid purchase | No durable server purchase delivery and event deduplication implemented | GAP |
| Event receipt in GA4 DebugView | No authenticated DebugView access available; outbound test collection deliberately intercepted | NOT TESTABLE |

The live shop was tested with consent on and off without creating an order. Its boxes displayed **No available dates yet**, which prevented a live cart-to-checkout traversal. This is a current availability condition, not evidence of a new reporting bug; stock and scheduling settings were not changed. The separate isolated checkout regression completed with real database fixtures.

The current funnel cannot support conversion-dropoff conclusions. A `page_view` in browser code or an HTTP success is not proof that Google processed it. New funnel instrumentation and consent-aware server purchase delivery require a separate reviewed implementation, as specified by the approved N1 preview. Order submission must remain distinct from paid revenue, and paid retries must deduplicate against a stable order event identifier.

References: [GA4 event implementation](https://developers.google.com/analytics/devguides/collection/ga4/events), [Measurement Protocol validation](https://developers.google.com/analytics/devguides/collection/protocol/ga4/verify-implementation). No additional tracking was enabled.

## H1: existing Cloudflare measurements

Read-only GraphQL query of the existing Elio account data, requested 23–30 September 2026 UTC, hostname `eliocheesecakes.com`, known public home/shop/flavor/box/story paths including both `.html` and extensionless routes, bot flag 0. No customer names, references, addresses, private fragments or raw visit records were requested. The site-configuration endpoint rejected the connected authentication scheme; the existing GraphQL metrics were accessible. No beacon settings changed.

| Device | LCP p75 | LCP samples | INP p75 | INP samples | CLS p75 | CLS samples |
|---|---:|---:|---:|---:|---:|---:|
| Desktop | 832 ms | 182 | 64 ms | 98 | 0.169 | 187 |
| Mobile | 956 ms | 62 | 424 ms | 3 | 0.005 | 1 |

Cloudflare returns LCP/INP quantiles in microseconds; the table converts to milliseconds. Metric sample counts differ because not every visit yields every metric. These are prelaunch observations that can include internal activity and older deployed revisions and are **not a representative customer performance baseline**. Mobile INP (3 samples) and CLS (1 sample) have **not enough data** for conclusions or optimization decisions. The desktop layout-shift sample deserves follow-up after the latest release is synced and there is launch traffic; it does not identify a reproducible new defect by itself. No new performance fix is justified by the tiny mobile samples alone.

After launch, review the same public-page/device aggregates over a longer period and inspect sample sizes before prioritizing work. Existing Cloudflare measurement is sufficient to begin that review; there is no need to add a second collector now. This is a manual review method, not a newly installed monitoring job.

References: [Cloudflare Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/), [data collection](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/).

## Bug checks and regression evidence

The original acquisition-source overwrite was reproduced through unsubscribe/rejoin from a different entry point and fixed by preserving separate acquisition fields. It was retested alongside original promo ID, expiry and welcome-email uniqueness. Existing subscriber consent behavior remains unchanged.

During implementation, an invalid SQL parenthesis was caught by isolated migration execution and corrected before deployment. Fixture defects involving newsletter cooldown, JavaScript Date comparison and SQL parameter types were corrected; these were test-harness issues, not production commerce defects.

The first clean Linux CI run exposed a pre-existing race in the calendar/catalog browser test: it asserted that a deleted flavor had disappeared immediately after the dialog closed, before the subsequent asynchronous catalog refresh rendered. Delaying that mocked refresh by 200 ms reproduced the same failure locally. The test now waits for the deleted row to detach, retains the absence assertion and exercises that delayed response. This fixes the test synchronization without changing or weakening the production deletion behavior.

Local release pass: **40 suites passed, 0 failed; database runner lists 82 migrations and 261 checks**. Hosted-only infrastructure migrations remain explicitly separate from local PGlite execution.

- Backend security: anonymous, customer and staff rejection; direct helper/table access rejection; invalid month/offset validation.
- Money: server-saved gross, discount and net; delivery exclusion; paid approval boundaries; cancelled, expired, refunded, unpaid, POS and marked-test exclusions; report-to-order pagination reconciliation.
- Acquisition and cohorts: duplicate signup, legitimate rejoin after cooldown, immutable original source, preserved welcome offer, no-code signup, Manila month boundary, incomplete windows, unique later customers, multiple campaign vouchers.
- Affiliate reconciliation: signed ledger sum, reversals, paid versus voided payouts, existing balance agreement, paginated ledger.
- UI: actual dashboard navigation at 320/390/768/1440 pixels; staff restriction; loading, retries, stale-response suppression, pagination, affiliate drilldown, order-open failure, empty month, console checks and no page-level horizontal overflow. Screenshots inspected.
- Existing commerce release suites: checkout through proof/approval, vouchers and email previews, newsletter, POS, accounts, calendar, maintenance, accounting, affiliates, backup data/proofs/transport, and existing unit/backend contracts.
- Real Google tag: canonical single page view and sanitized payload with collection intercepted. Live consent check: no order creation or measurement transmission.

Evidence is saved under `test-results/release`, `test-results/marketing`, `test-results/analytics`, and `test-results/marketing-live`. Test screenshots use invented sample numbers and are not production statistics.

### Release limits

Production migration applied and owner RPC readback verified on 30 September 2026 (Manila). The live report found four newsletter recipients still collecting their 30-day results: three retained historical source records and one original source conservatively marked unknown after a historical rejoin. No paid website orders were missing a payment record. The affiliate report returned the existing zero balances without creating any financial records. Private helper execution remains revoked for anonymous, authenticated and service roles. Anonymous HTTP requests to all four report actions were rejected.

The storefront/admin deployment still requires syncing the deployment fork. Local and hosted automated tests do not prove the new live frontend is deployed. No claim of exhaustive coverage or every browser is made; these browser runs use desktop Chromium with responsive viewports, not physical iPhones/Safari. Hosted CI results are linked in the completion message once the clean Linux run finishes.
