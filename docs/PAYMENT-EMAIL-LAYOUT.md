# Order-received payment email

Proposal 03 approved on 30 September 2026. The order-received email now groups saved payment accounts under “How to pay”, with the stored total and Manila proof deadline first. Per-account and general notes remain visible. Direct POS payment-link orders continue to have no automatic deadline. Secure links, subjects, recipients, triggers and other templates are unchanged.

Structured account details come only from the saved order. Legacy instructions remain intact. When structured details disagree with a custom saved instruction block, the complete saved text takes precedence rather than silently dropping notes. Account numbers stay strings to preserve leading zeroes. All values are escaped in HTML; the plain-text version carries the same information.

Provider payloads already frozen for a send/retry retain their original content. New messages use the new renderer. No migration or customer/order change is needed.

Validation:

- 15 content scenarios: account snapshot, per-account/general notes, leading zeroes, direct/no deadline, delivery/discount total, legacy/custom fallback, malformed/empty options, HTML escaping, long content, midnight Manila boundary and zero total.
- 20 Chromium rendering observations across 320/390/768/1440px; no horizontal overflow or page errors in the exercised scenarios. Inline-style fallback and dark browser preference checked.
- 56 existing design checks and 17 mocked worker checks, including freezing and retrying the new payment layout without changing the provider body.
- Isolated database payment-options suite and two actual outbox snapshots; 11 other event types compared byte-for-byte with the previous renderer.

Browser previews do not certify native Gmail/Outlook/Apple Mail rendering. No live test emails were sent in this change. Screenshots and structured results are under test-results/payment-email.
