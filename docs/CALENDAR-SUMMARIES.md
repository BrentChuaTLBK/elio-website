# Compact calendar summaries

Pickup entries in Google Calendar and the Elio admin calendar show customer name, phone number, social media, order ID, order details (including saved flavor selections) and amount. Pickup entries no longer show the shop's own address or hours, buyer email, duplicate contact details, instructions or synchronization guidance. Existing Google pickup events have their location cleared.

Delivery entries show those essentials plus the delivery address. Recipient name and phone appear only when they differ from the customer. Customer delivery instructions appear only when supplied. Delivery-area grouping and copying details remain available.

Completed orders stay on their original date with a gray treatment and **✓ Completed**. Existing Google event IDs are preserved when details are refreshed. In-person POS sales remain excluded. Private staff notes never enter calendar summaries.

## Current sample orders

The owner requested ten samples with realistic fictional details. The same ten orders were updated in place, keeping their references and dates. Their customer email remains brentchua1223@gmail.com, and their phone numbers, social usernames and addresses are illustrative. Do not contact or fulfill them; that warning is saved in private staff notes. All samples remain zero-value custom orders with no stock allocations or sales revenue.

| Date (Manila) | Pickups | Deliveries | Delivery areas |
| --- | --- | --- | --- |
| September 29, 2026 | 3 | 3 | Quezon City, Makati |
| September 30, 2026 | 2 | 2 | Makati, Pasig |

Names include Mia Santos, Lucas Reyes, Sofia Cruz, Ethan Garcia, Chloe Lim, Noah Mendoza, Isabella Tan, Liam Castillo, Ava Ramos and Gabriel Flores. Visible test prefixes were removed from customer and item names and addresses. Hidden batch metadata identifies these records for later cleanup.

## Verification

68 migrations and 222 backend checks passed in the isolated database. Calendar unit checks verify exact pickup fields, optional delivery recipient details, totals, flavor selections, removal of pickup location, HTML escaping, retained completed events, and matching admin-copy/Google descriptions. Browser checks passed at 1440px, 390px and 320px with working copy controls and no horizontal overflow. All browser JavaScript passed syntax checks.
