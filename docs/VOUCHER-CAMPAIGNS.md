# Automatic offers and My vouchers

Owners manage campaigns in Marketing → Automatic offers. Save a draft, review the customer preview, then activate. No campaign is created or activated by deployment. Existing completed orders establish first-order history; they do not receive retroactive rewards or emails.

Campaigns choose first or every completed website order, a fixed peso or capped percentage discount, minimum product spend, an issue limit per customer, and expiry in days or at a fixed Manila date/time. POS direct orders and event sales never qualify. Pausing stops issuance; existing vouchers keep their original terms. Each issued code is personal, single-use, and cannot stack with another checkout code.

Completion requires paid, completed, non-refunded status. A durable completion ledger and unique campaign/source-order key prevent repeated status changes from issuing duplicate rewards. Existing checkout transaction locks serialize completion and redemption. Customer issue limits follow the authenticated account and normalized email; guest-to-account signup does not reset first-order eligibility or limits.

Signed-in orders bind vouchers to the account. Guest vouchers bind to checkout email; claiming and redeeming require a verified account with that email. The wallet also reads existing newsletter welcome offers by verified email, without recreating codes, restarting expiry or resending welcome emails. Wallet and report pages use bounded pagination.

Refunding or cancelling a qualifying order disables its unused reward. Refunded/cancelled redemptions release the personal code within its original expiry. Undoing a refund is blocked if the same code has already been reused on another active order. Existing order discount snapshots and accounting entries remain authoritative.

## Reporting

Campaign reports count issued, used, expired, available, reserved and unavailable vouchers. Redemption rate is retained paid uses divided by issued vouchers. Sales are retained paid product subtotals less discounts; delivery, unpaid, cancelled and refunded orders are excluded. A used voucher remains used when its expiry passes. Unpaid expired order reservations do not count as active reservations.

Email states show queued, accepted by provider, failed and skipped. Provider acceptance is not an inbox delivery claim. Reports include recipient, code, issue/expiry, redeemed discount, sales, email state and skip/failure reason. Newsletter welcome-offer analytics remain under Promo codes.

## Email and privacy

The thank-you voucher is a separate `newsletter_voucher` notification after completion, using the existing private marketing outbox. It does not alter existing order email templates. Subscriber consent is checked when queueing and again before rendering/freezing, including source-order eligibility, expiry and recipient-account email changes. Opt-outs, suppression and failed messages never delete the customer's voucher.

The worker preserves its private Vault authentication, immutable provider payload, retry window and idempotency key. The new template includes order-completion thanks, exact issued code and terms, guest account-verification instructions, My vouchers link, mailing address and unsubscribe controls. An optional, initially unchecked checkout checkbox explicitly joins the newsletter immediately through its existing endpoint, independently of order submission or payment. Only an email and consent are needed; eligible new subscribers receive the existing welcome promo once. The checkbox names news, promo codes and offers and shows current welcome terms. Known signed-in subscribers and matching browser signup hints hide the invitation. Browser hints store only recent email hashes. An unrecognized guest may see the box again; server eligibility preserves their existing code and original expiry. Orders without explicit signup never enroll anyone. Privacy, website and newsletter terms describe eligibility, processing and original expiry.

All tables and the invoker view are private with RLS and direct grants revoked. Customer reads require verified ownership; campaign operations require the owner role through `shop_api`.

## Validation

- Full local migration/backend regression suite, including account isolation, first/repeat issuance, stale edits, guest claims, refund reuse, expiry, source cancellation and marketing opt-outs.
- Browser campaign creation/activation/reporting and wallet checks at 1440, 390 and 320 pixels; real local Postgres-compatible API responses.
- Existing checkout, calculation, stock, receipt conversion and payment approval tests, including fragment voucher links.
- Mocked email worker sender separation, rendering, unsubscribe headers and frozen retry payloads. No production customers are contacted by these tests.

## Email preview

Campaign cards and editors provide an owner-only email preview using the actual sending renderer. Saved campaigns load current terms; editor previews use unsaved form values without saving or activating anything. Samples use ELIO-PREVIEW and preview@example.test. Relative expiry assumes issue at preview time; fixed expiry uses the chosen Manila instant. Desktop, mobile and plain-text views show the same subject and offer content. Links are inert, HTML is sandboxed, and preview creates no voucher, outbox row or delivery request.
