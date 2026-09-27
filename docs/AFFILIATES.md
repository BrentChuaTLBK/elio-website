# Elio affiliates

Owners open **Kitchen dashboard → Affiliates** (`manage.html#affiliates`). Customers assigned as affiliates see **Affiliate dashboard** on their account page, linking to `affiliate.html`. Staff cannot manage affiliates or view their private payout proofs.

## Setup and code management

1. The affiliate creates and verifies an Elio account.
2. An owner adds that account by email, gives it a display name, and sets its commission percentage (0–100%, up to two decimal places).
3. The owner adds one or more custom codes. Each code supports a percentage or fixed PHP discount, product minimum, optional discount cap, Manila start/expiry times, per-account and total usage limits, and active/paused status.

Affiliate codes are separate from regular admin and newsletter codes. The regular promo editor cannot change or delete them. Codes and account assignments retain their history. Pause instead of deleting. Account and code assignments cannot be transferred to another affiliate.

The existing promo checkout engine continues to require a verified customer account and reserves uses for unpaid orders. Paid uses remain counted after cancellation/refund. Pausing an affiliate prevents new uses of every assigned code, while retaining their dashboard and prior earnings. Existing orders keep their saved discount terms.

## Commission rules

- Commissionable sales are product subtotal (including flavor surcharges) minus discounts; delivery is excluded.
- The commission percentage is frozen when the order is placed. Later rate changes affect future orders only.
- Paid orders awaiting completion show estimated commission. Only completed, paid, non-refunded orders earn payable commission.
- Purchases using the affiliate's own assigned account receive the code's customer discount but earn no commission.
- Amounts use integer centavos and basis points. Commission rounds once per order to the nearest centavo.
- Paid amendments update the commission base while preserving the original rate. An amendment below the original promo minimum makes the order ineligible.
- Cancellation, expiry, rejected payment or a refund label reverses earnings. Repeated status updates do not duplicate the reversal. A reversal after payout can make the balance negative; future earnings offset that amount.

Available to pay = current earned commission minus non-voided recorded payments. Estimates cannot fund payouts. Reports show all-time figures with 50 orders and 20 payments per page, and refresh every 30 seconds while visible. Owner forms pause background refreshing when dirty. Database permissions restrict affiliates to their own records; reports omit customer identities, addresses and order-access links.

## Manual payments and private proof

Owners make transfers outside Elio, then choose **Record payment**. A positive amount, date, payment method and image receipt are required; reference and notes are optional and visible to the affiliate. Partial payments are supported. The saved payment reduces the available balance and automatically becomes an **Affiliate payouts** expense in Accounting on the payment date. No manual expense entry is needed for that payment. Unpaid earnings are shown in Affiliates, not recorded as a cash expense.

The upload endpoint verifies Auth identity and then independently enforces owner permissions in the database. It validates image bytes (JPG/PNG/WebP, max 5 MB), stores in the private `affiliate-payout-proofs` bucket, and records the payment after rechecking the balance under a lock. Stable request IDs and file/content fingerprints make retries safe. An ambiguous network result is checked before deleting any upload, preserving receipts for accepted payments.

Only an owner or the assigned affiliate can request a receipt link. Signed links expire after five minutes. No public Storage policy or direct client table access is granted. Use **Void record** with a reason to correct a mistaken entry; this restores the balance and removes its Accounting expense while keeping the original receipt and audit history. It does not transfer or retrieve money.

## Verification

- Backend suite: real Postgres-compatible migration execution, permission checks, discount/minimum/cap/usage boundaries, self-purchase exclusion, frozen and fractional rates, commission completion/reversal, partial payouts, retry safety, balance rechecks, private receipts and Accounting reconciliation.
- `tests/affiliate-proof.test.mjs`: mocked Auth/database/Storage boundary checks, validation, authorization, retry recovery and signed-link expiry.
- `tests/ui/affiliates.mjs`: desktop and mobile owner forms, customer dashboards, staff/unassigned/guest guards, private receipt dialog, payout/void workflows, unsaved-change protection and sign-out during a pending request.

No payments are transferred by this feature. Tests create no real affiliates, customer orders or payouts in production.
