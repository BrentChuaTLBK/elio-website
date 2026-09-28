# Elio POS

Open `pos.html` from the Kitchen dashboard’s POS link. Authorized staff and owners can sell. Only owners manage event dates, items, prices and stock. The POS requires an internet connection; it never caches private order data or queues sales offline.

## In-person sales / events

1. Create an event with its name and selling dates.
2. Add the event’s separately prepared stock, such as individual Vanilla, Chocolate and Matcha pieces. No website stock is transferred or deducted.
3. Create event items with their own prices and recipes. For example, one Trio can use one piece of each flavor; one Vanilla slice uses one Vanilla piece. Both sales consume the same event Vanilla stock.
4. Open the day’s cash session, including the opening float (zero is allowed).
5. Add items, choose pickup or delivery, and record full payment: Cash, GCash, BDO or EastWest. Cash received and change are recorded. Paid pickup orders handed over today are completed immediately; scheduled orders stay confirmed.
6. Review the event report for the chosen day, payment totals and remaining event stock. Enter actual cash in/out with a reason, then count and close the session. Closing prevents further sales until an owner reopens it.

Event price and recipe edits apply to new sales. Existing orders retain their saved prices and recipes. Closed/completed orders retain their history.

Cash reconciliation uses actual original cash payments plus opening float and recorded cash movements. Refund labels/cancellations do not themselves prove money left the drawer: record actual cash refunds as cash out. Cash counts, floats and movements do not duplicate sales in Accounting; record actual business expenses through the normal accounting flow.

## Direct orders / DM sales

- Choose website boxes, including configurable boxes. They share the website’s flavor inventory and current availability; staff-created orders bypass storefront lead times.
- Add custom items by entering a name, unit price and quantity. These items have no inventory. Website and custom items can be combined.
- Customer name, contact, email, social platform/profile and delivery details are optional. Supply the needed fulfillment details before preparing or dispatching an order.
- Save as unpaid or record full payment. Unpaid direct orders reserve stock indefinitely; review them and cancel manually when no longer needed.
- Copy the private payment/order link after saving or from Orders. It has no automatic payment deadline. Customers see the saved payment options and upload proof through the normal staff review process. Cancellation closes payment uploads; submitting proof moves the order under review; approval marks it paid.
- Email details and future updates are optional, initially off. Choosing email requires an email address. Direct-order email templates explain the absence of an automatic deadline.
- Existing order edits use optimistic revisions and preserve website prices for unchanged configurations. Changes and cash movements retain an audit history. Paid-order amount changes still require staff to settle any difference directly.

## Accounting and other records

Paid orders use the existing payment records, order history and accounting ledger:

- `Direct order sales`: product income from direct orders, including custom items.
- `In-person POS sales`: product income from events.
- `Delivery`: customer delivery fees as income and actual courier costs as expenses.

Unpaid orders contribute no income. Existing cancellation/refund exclusions apply to sales, discounts and delivery expenses. Cash drawer reconciliation creates no second income entry. Website-linked direct orders participate in production; event items and inventory-free custom items are excluded from the website box production count. Paid scheduled orders enter the existing calendar sync; immediate handed-over sales do not.

## Safeguards and validation

All POS actions pass through the existing authorized RPC gateway. Private tables have RLS and no direct anonymous/authenticated/service-role grants. Inventory, order creation, cash closure and payment actions use the same transaction advisory lock as website checkout. Sale/payment request keys prevent duplicate processing after retries. Catalog, stock and cash-count edits reject stale revisions or quantities. Server quotes validate prices and stock before recording an order.

Run `node tests/backend/run.mjs`, `node tests/ui/pos.mjs` and `node scripts/check.mjs` with the repository’s PGlite/Playwright environment paths. Tests use isolated data and do not send real emails or create production orders.
