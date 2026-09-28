# Manual pickup reminders

Open a paid pickup order marked **Ready for pickup** in the kitchen dashboard, then click **Send pickup reminder**. The panel shows the buyer email and the last requested time. The Email delivery panel shows queue/sending status.

This sends the existing branded pickup reminder template through the transactional order email worker. It does not change order progress, amounts, stock or payment status. It works for a late pickup even after the original fulfillment date; it is separate from the automatic fulfillment-day reminder setting.

Owners and staff can request reminders. Customers cannot. A locked order revision and action key protect against stale edits and retry duplicates. One reminder may be requested per 15 minutes, and another cannot be queued while one is pending or sending. The worker checks current eligibility before rendering, skips completed/cancelled/refunded orders, and freezes prepared/provider content for safe retries.

Verification: `tests/backend/36-pickup-reminders.test.mjs`, `tests/ui/maintenance-and-print.mjs`, `tests/email-design.test.mjs`.
