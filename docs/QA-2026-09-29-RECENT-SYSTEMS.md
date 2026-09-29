# Recent systems audit — September 29, 2026

The current production release (`03264ec`) passed the checks below. No customer-facing defect was reproduced. Six older browser suites needed their fixtures or navigation steps updated; all 19 browser suites passed after those test corrections. This is evidence for the tested scenarios, not a guarantee that every possible failure is excluded.

## Results

| Area | Verification and outcome |
| --- | --- |
| Backend | The 75-file migration set was validated; application migrations ran in an isolated database and 245 contract checks passed. Hosted cron/network/Vault setup is checked separately on production. |
| Unit and service tests | All 15 test files passed (20 Node test-runner entries). Includes email workers, newsletters, payment proofs, affiliates, calendar sync, calculations, production, stock rules, and analytics. |
| Browser workflows | All 19 UI suites passed, covering the new systems plus checkout, POS, accounting, affiliates, calendar, payments, analytics and maintenance. |
| JavaScript | Syntax validation passed for 79 production JavaScript files. |
| Production assets | 12 relevant deployed HTML, JavaScript and CSS files matched the audited local source after line-ending normalization. Source and deployment fork were both on `03264ec` at audit start. |
| Live storefront | Home, Our Story, Shop, Account, Privacy and Terms loaded at 1440, 390 and 320 pixels. No page JavaScript errors, failed resource HTTP responses, broken visible images or horizontal page overflow were observed. |
| Live Flavors | Name-only search, accent/case-insensitive matching, categories, monthly/full-collection tabs, existing flavor links, image loading and responsive layout passed at 1440, 390 and 320 pixels. A term found only in a description correctly returned no results. |

### New features

- **Flavors:** Both published month sections, hidden/unpublished menus, December-to-January rollover, empty/error states, full escaped descriptions, keyboard tabs, filters, legacy links and a 31-flavor catalog passed. Local layout checks also cover 768 pixels.
- **My vouchers:** One voucher retains its full card; 2–8 vouchers use compact rows with four per page. Paging, shrinking result counts, status tabs, copying codes, details, focus/Escape behavior, reserved/expired/used states and checkout actions passed at 600, 390 and 320 pixels.
- **Automatic offers:** Eligibility is limited to qualifying completed website orders. POS direct and event sales are excluded. Duplicate completion processing, customer limits, verified-email ownership, guest-to-account linking, expiry, reservations, payments, cancellations/refunds and campaign statistics passed in the isolated database.
- **Email subject, copy and preview:** Saved and unsaved campaign previews, owner-only access, subject/body validation, escaped content, discount substitution, frozen issued terms/copy and older-client compatibility passed. Previewing does not issue a voucher or send an email. Desktop, mobile and plain-text previews were checked.
- **Newsletter and checkout:** Popup/checkout consent, existing subscriber behavior, duplicate prevention, original welcome-code expiry, retry handling, unsubscribes and suppression passed. Optional checkout signup does not depend on payment. Order notifications and promotional sends remain separate.
- **Account:** Signed-in layouts, order amounts/statuses, voucher access, email preferences, sign-out and conversion-report behavior passed with isolated customer/staff fixtures.
- **Website photos and conversion:** All 14 configurable slots, publishing/rollback, stale-save protection, failed-upload recovery and missing-photo fallbacks passed. Actual JPEG, PNG, WebP, HEIC and HEIF fixtures produced WebP for product, website, payment-proof and affiliate-proof uploads; payout retries retained the same converted bytes.
- **Maintenance:** Scheduled, completed and open-ended states; countdowns; offline recovery; automatic reopening after server confirmation; and access to existing orders passed.
- **POS and operations regression checks:** Product flavor stock/surcharges, box recipes, quantity limits, bulk stock editing, a pouch deduction from 100 to 99, cash/change, calendar completion markers, financial exports, affiliate permissions and chart interactions passed.

## Hosted service checks

- The recent voucher campaign, preview, subject and body-copy migrations are applied in production.
- One automatic-offer campaign is active. No issued thank-you vouchers were present at the time of this audit; the campaign was not edited.
- The order-email queue was empty. All 14 retained newsletter queue entries were marked sent; no pending, sending or failed entries were present.
- Resend reported **121 Elio-domain messages sent and 121 delivered** from September 23 through the September 29 check, with zero failed, bounced, delayed, complained or suppressed messages in that interval. These are historical provider-reported results, not fresh sends made by this audit or proof of inbox placement.
- Email worker v26 and newsletter v12 were active. The email and calendar cron jobs were enabled, ran every minute, and their latest runs succeeded. All 60 retained HTTP responses from the preceding 30 minutes were HTTP 200 with no timeout.
- The checked order, voucher, campaign, subscriber and email-queue tables have row-level security enabled and no direct SELECT grant for anonymous or authenticated customer roles.

## Findings and changes

1. **Mobile navigation test drift:** Five suites attempted to click sidebar links while the redesigned mobile menu was closed. A shared navigation helper now opens the real menu before clicking. Accounting, affiliates, calendar, analytics and visitor-report tests passed after this correction. The payment suite also uses this helper.
2. **Payment fixture test drift:** Its HTML fixture recognized only an unversioned checkout script URL, so it removed the actual versioned script. The fixture now accepts versioned URLs and responds to the newsletter-settings read introduced by the checkout opt-in. Payment methods, copying/fallback, proof submission, closed states, delivery tracking and admin editing passed at all three widths.
3. **Content observation:** October 2026 is published but currently contains no visible flavors. The page shows its coming-soon message. September displays six flavors; the complete catalog contains seven.
4. **Content observation:** Gorgonzola, Ube, Hojicha and Speculoos still use the intentional photo placeholders.

Only test files and this report were changed. No storefront code, database settings, campaigns, customer orders, stock or photos were changed by this audit. No real email was sent by this audit.

## Scope and evidence

Destructive, financial, signed-in and email-delivery workflows were exercised with isolated database/browser fixtures and mocked provider responses. Production checks used anonymous browsing, read-only service health queries and historical Resend metrics. This run did not complete a new production order, transfer money, log in as a real customer, send a new voucher email, run another concurrency stress test or verify rendering inside every email client.

Local evidence is under `test-results/new-systems-audit/`: original suite logs, `recheck/` reruns, deployed-asset comparisons and live browser screenshots. Initial false failures are retained rather than hidden. The final payment rerun is `recheck/ui-payment-options-2.log`. `live/assets-recheck.json` records the corrected asset paths; `live/shop-recheck.json` records Shop checks with the read-only FAQ request allowed. Cloudflare analytics beacons were intentionally blocked during live browsing.

The test changes are in `tests/helpers/dashboard-navigation.mjs` and the six affected `tests/ui/` suites: `order-calendar`, `affiliates`, `accounting`, `analytics-chart`, `website-visitors` and `payment-options`.
