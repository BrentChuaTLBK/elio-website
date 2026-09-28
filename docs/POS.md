# Elio POS

Open `pos.html` from the Kitchen dashboard’s POS link. Authorized staff and owners can sell. Only owners manage event dates, items, prices and stock. The POS requires an internet connection; it never caches private order data or queues sales offline.

## Selling and setup

The cashier screen keeps event management out of checkout. **Setup** contains event creation, imports, prices, stock adjustments and deletion. On mobile, bottom navigation separates New sale, Orders, Event report and Setup. Start with the product grid, tap **View sale** to open the cart/payment screen, and use **Back to items** to continue adding products. Desktop keeps the product grid and sale panel side by side.

Cart − / + controls and product availability account for the current cart and shared event flavor stock. Cash shortcuts offer the exact total and common tender amounts. The server still rechecks stock and prices before saving.

The product-first mobile navigation and separate management area use the official [Cococart mobile POS guide](https://support.cococart.co/en/articles/15549738-how-do-i-view-orders-using-the-pos-mobile-version) and [product-management guide](https://support.cococart.co/en/articles/15549448-how-do-i-add-products-and-categories-to-the-pos-app) as workflow references. Elio retains its own branding and event inventory rules.

## In-person sales / events

1. Create an event with its name and selling dates.
2. Use **Import flavors** to choose website flavors and enter the quantities prepared for the event. You can also add custom stock units. No website stock is transferred or deducted.
3. Use **Import boxes from website** to copy box names, prices and recipes, then edit event prices independently. Missing fixed-box stock starts at zero. Import flavors before importing Build your own box: staff choose exactly three event flavor pieces at each sale using − / + buttons. Event flavor surcharges and remaining pieces are respected. Use **Add custom event item** for other products with their own prices and stock recipes. Boxes and individual items consume the same event flavor stock. Re-importing skips existing imports and does not reset quantities or edited prices.
4. Open the day’s cash session, including the opening float (zero is allowed).
5. Add items and tap Cash, GCash, BDO or EastWest. For cash, enter the amount received. **Complete sale** checks stock and price, records full payment, and marks the order completed and handed over today. In-person checkout has no fulfillment method/date fields. Customer details and notes are optional and collapsed. A changed server price requires review; a lost save response uses the same request key when retried. The confirmation shows change clearly and **Next sale** opens an empty cart.
6. Review the event report for the chosen day, payment totals and remaining event stock. Enter actual cash in/out with a reason, then count and close the session. Closing prevents further sales until an owner reopens it.

Owners can delete events, stock units and sellable items. These are hidden from new sales while past orders, allocations, cash reports and accounting remain intact. Deleting stock makes dependent fixed recipes unavailable and removes that flavor from custom-box choices. **Show deleted events** gives access to historical orders and reports, including finishing cash reconciliation.

Sale unit prices are prominent, with line totals for quantities above one. Direct fulfillment dates, event setup dates and report dates use Elio’s branded calendar picker.

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

## Delivery fees confirmed later

Direct delivery orders can use **Pay Elio** or **Pay courier directly**. Choose an exact fee or **Confirm after booking** when creating the order. An unconfirmed fee is shown as “To be confirmed,” and is excluded from the current amount owed to Elio.

In POS → Direct orders → Orders, use **Edit delivery fee** to change the amount or recipient. Before the initial payment, an Elio fee joins the full payment due through the existing link. After product payment, a newly confirmed Elio fee remains unpaid until staff uses **Record delivery payment** and confirms the full amount received. There is no second customer receipt upload. The order link always displays the latest payment instructions.

You can switch between Elio and courier while the fee is uncollected, including while its amount is still unknown. Payment-proof review must finish before changing the fee. Once a separate Elio payment is recorded, an owner can use **Correct delivery payment** after returning the money or confirming the receipt was recorded in error; this reverses delivery income and preserves the original receipt and correction history. The recipient can then be changed. This action does not send money or issue a refund. A delivery fee included in an already approved initial payment uses the existing whole-order refund/correction process; it cannot be silently reassigned.

Only delivery fees received by Elio become Delivery income. Fees paid straight to a courier do not. Actual courier costs paid by Elio are entered through Delivery accounting. Product payment, inventory, and event cash counts stay separate from later direct-order delivery payments.

## Accounting and other records

Paid orders use the existing payment records, order history and accounting ledger:

- `Direct order sales`: product income from direct orders, including custom items.
- `In-person POS sales`: product income from events.
- `Delivery`: customer delivery fees as income and actual courier costs as expenses.

Unpaid orders contribute no income. Existing cancellation/refund exclusions apply to sales, discounts and delivery expenses. Cash drawer reconciliation creates no second income entry. Website-linked direct orders participate in production; event items and inventory-free custom items are excluded from the website box production count. Paid, confirmed Direct pickup and delivery orders enter both the admin calendar and Google Calendar sync. Rescheduling updates the same event; cancellation or refund removes it. Event/In-person sales never appear on either calendar, including scheduled event orders. Unpaid direct orders stay off the calendar until payment is approved.

## Safeguards and validation

All POS actions pass through the existing authorized RPC gateway. Private tables have RLS and no direct anonymous/authenticated/service-role grants. Inventory, order creation, cash closure and payment actions use the same transaction advisory lock as website checkout. Sale/payment request keys prevent duplicate processing after retries. Catalog, stock and cash-count edits reject stale revisions or quantities. Server quotes validate prices and stock before recording an order.

Run `node tests/backend/run.mjs`, `node tests/ui/pos.mjs` and `node scripts/check.mjs` with the repository’s PGlite/Playwright environment paths. Tests use isolated data and do not send real emails or create production orders.
