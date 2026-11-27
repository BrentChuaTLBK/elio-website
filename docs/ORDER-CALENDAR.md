# Elio order calendar

Staff open **Calendar** in the kitchen dashboard to see paid orders by fulfillment date. The dashboard marks pickup in green and delivery in blue. The day view and month agenda support search, fulfillment and area filters, and copying customer details.

Google Calendar shows active paid orders in green, unpaid orders in yellow, and completed orders in grey. Pickup or delivery appears in the event title. Expired website reservations are removed.

ELIO syncs all-day order events to the staff calendar using **Default visibility**. Staff with **See event details** can read the customer and fulfillment information. To subscribe, staff open their calendar invitation and add the calendar. Order events have no guests. Reschedule orders in the order editor.

## Connection and operation

The owner can check the connection under **Calendar → Google Calendar connection**. Share the calendar with the displayed service account using **Make changes to events**, enable Google Calendar API in its Cloud project, then enter the Calendar ID or embed link. Credentials stay on the server: `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` overrides the existing `GA_SERVICE_ACCOUNT_JSON` when supplied.

The database queues order changes durably. An authenticated worker runs after changes and every minute, including while the dashboard is closed. Updates are asynchronous; failures retry with backoff up to 15 minutes. The dashboard shows pending updates and connection errors. **Sync now** requests another attempt. Google change cursors detect edits/deletions of managed events and restore the saved Elio schedule. Event IDs and revision acknowledgements prevent duplicate events and lost concurrent edits.

The separate worker credential is generated in Supabase Vault. Anonymous/customer users cannot read the calendar feed, configure the connection, run its service actions, or authorize a background worker. Customer order-access tokens, payment proofs, private staff notes and bank details are excluded from calendar payloads.

## Manual checks

1. Open Calendar and check the Google connection status. Select an order date, filter by delivery area, and copy a name, phone or address.
2. Approve a real order when appropriate. Its calendar entry should appear after automatic sync. Reschedule in Elio and confirm Google follows. Cancel/refund only when appropriate; the Google event should disappear.
3. Open Boxes & sets: each card shows full production days. Delete an unused item through its editor. If deleting a flavor used in a box, the box should show unavailable and reject new checkout attempts.
4. Existing order snapshots, accounting records and stock allocations remain after catalog deletion. Deleted records are retained privately to preserve these references; their photos are retained too. Category removal and ordering continue to work.
5. Open Accounting at desktop/mobile widths. Check aligned summary totals, bordered entries and delivery tables, timeframe controls, and Excel export.

## Validation at release

- 55 database migrations and 183 regression checks passed in isolated PostgreSQL tests.
- Google adapter tests cover calendar sharing permissions, payment and completion colors, OAuth scope, empty calendars, pagination reset, duplicate recovery, ownership checks, deletion, cleanup and retries.
- Browser checks passed at 1440, 390 and 320 pixels for calendar/copy/filter/deletion flows; accounting owner/staff and real Excel-download checks passed.
- Live connection and worker checks created, rescheduled and deleted a temporary private event. The temporary queue record was removed; no test order was created. The normal authenticated Edge Function bundle was restored and verified.
