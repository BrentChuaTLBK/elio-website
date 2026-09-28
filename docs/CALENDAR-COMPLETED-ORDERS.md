# Completed orders and calendar test orders

Completed paid pickup and delivery orders remain on their original fulfillment date in both the Elio admin calendar and Google Calendar. Cancelling, refunding or deleting an order still removes its calendar event. In-person event sales remain excluded.

The admin calendar shows completed orders as gray cards with a visible **✓ Completed** badge. The month grid separates pending pickup/delivery counts from a gray completed count. Pickup/delivery labels, delivery-area grouping and copy controls remain available for completed orders.

Google Calendar uses a gray event color and prefixes the existing title with **✓ Completed**. Updating completion retains the same event and fulfillment date. Make order changes in Elio; the calendar worker synchronizes them automatically.

Two authorized dummy direct orders were created for September 29, 2026 (Asia/Manila), with customer email brentchua1223@gmail.com:

| Reference | Method | Area | Initial status |
| --- | --- | --- | --- |
| ELIO-UK7SHF | Pickup | — | Paid / Confirmed, awaiting fulfillment |
| ELIO-CP9YTP | Delivery | Quezon City | Paid / Confirmed, awaiting fulfillment |

Both contain a zero-value custom test item, a prominent do-not-fulfill instruction and dummy contact/address values. They do not consume inventory or add sales revenue. Both were acknowledged by the Google Calendar sync worker without errors. They remain available for the owner's manual test.

Validation: calendar sync unit checks confirm completed orders update the existing Google event, preserve its date, carry the completed title and gray color, and are not deleted. Browser checks at 1440px, 390px and 320px verify completed cards remain visible, pending counts exclude completed orders, completed counts and copy controls work, and the page has no horizontal overflow. Browser JavaScript syntax checks passed.

Manual check: open September 29 in Admin → Calendar, inspect both test orders and copy their sample details. Mark either order Completed in Elio. It should remain on September 29, display its completed status, and update in Google Calendar after synchronization.
