# Website maintenance

Owners manage maintenance from the dashboard's Maintenance section. It starts off; payment-proof pausing is the default option. Staff cannot change these settings.

- **Off:** the storefront is open. Enable the announcement and set start/end times to show a planned-maintenance header without closing ordering.
- **On now:** maintenance starts when saved and ends when the owner switches it off. Planned times describe the announcement only.
- **Scheduled:** the server starts and ends maintenance at the saved times, independently of an open browser or cron. Inputs and customer-facing times use Asia/Manila.

Maintenance replaces the storefront with a branded notice and blocks new checkout/quote requests on the server. Existing order links, account access, unsubscribe pages, affiliate access, and the team dashboard remain accessible. Shop settings' separate Pause new orders switch still applies after maintenance ends.

With **Pause payment-proof uploads and their deadlines** checked, both upload authorization and final proof submission are blocked. Remaining upload time is preserved across manual and scheduled windows, edits, and repeated pauses. For example, eight minutes remaining before maintenance means eight minutes after it ends. Overlapping windows count once; already-expired orders are never revived. Unchecking the option keeps eligible uploads and their ordinary deadlines available during maintenance.

Scheduled closures show a branded countdown using the server’s clock. The digits update locally once per second, without extra API requests. At zero, the page checks the server before reopening; if maintenance is extended or the connection fails, it stays closed and retries. Manual maintenance shows a matching “We’ll be back soon” panel without a countdown or estimated reopening time. It continues checking automatically and restores the storefront when maintenance is switched off. A failed check keeps the closure screen visible with a retry message. Existing order links retain the compact banner.

Public pages refresh status every 30 seconds, on returning to the tab, and near the next scheduled boundary. Database guards apply immediately. Settings use revision checks to reject stale edits. Maintenance history is private and retained to calculate adjusted deadlines.

This feature controls application availability; it cannot guarantee error-free infrastructure or database updates. Use a staging environment for changes to payment/schema behavior. Do not turn maintenance on merely to verify a production release.

## Email notification review

The Overview email-delivery panel shows unreviewed failures and skipped notifications. Staff or owners can select **Acknowledge & dismiss**. This saves a shared acknowledgement in the database, clears the alert across refreshes/devices, and preserves it in collapsed Reviewed notifications. It does not resend, delete, or mark an email as delivered. A changed error, status, or retry attempt clears the acknowledgement so a new problem appears again. A stale acknowledgement request is rejected.

## Verification

Backend tests cover permissions, exact schedule boundaries, idempotent checkout retries, both upload stages, and preserved deadlines. `tests/ui/maintenance-and-print.mjs` covers desktop/mobile controls, the public announcement, access to existing orders, persistent reviewed alerts, and pickup/delivery printing through extensionless hosting redirects.
