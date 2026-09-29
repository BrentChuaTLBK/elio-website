# Checkout review clarity

Approved proposal 06. The final website checkout review now displays the existing saved pickup hours or delivery window beside the selected date. Blank pickup hours produce no invented schedule. Delivery retains the existing order-page fallback of 9 AM–6 PM if no window is configured, and clearly states that exact arrival cannot be selected or guaranteed. Configured text is escaped and wraps across lines.

The small payment paragraph becomes the approved two-step summary: pay in full and upload a receipt within 15 minutes of submission; then await payment review/approval. The 15-minute server deadline, pricing, promo calculations, stock reservations, order creation and POS behavior are unchanged.

## Mobile review position fixed

Reproduced on actual isolated checkout: the 390px delivery review opened with scrollTop 243 and the 320px guest pickup review with scrollTop 185, hiding the heading/date. Replacing the form HTML retained its scroll position. The final review now focuses its heading and resets its scroll to zero, including after Edit details → Review order. This fixes an observed usability issue; no extra checkout step was added.

## Verification

`tests/ui/checkout.mjs` passed signed-in pickup, signed-in delivery and guest pickup against the isolated database. Checks include configured/blank hours, review text, four viewport widths (320/390/768/1440), first/repeated review focus and scroll, edit preservation, matching stored fulfillment hours, exact 15-minute timestamp difference, prices, promo application, stock allocation, newsletter signup behavior, real PNG-to-WebP receipt upload and payment approval. No page errors. This pass created no live orders or emails.

Files: `dist/assets/shop/checkout-review.js`, `shop.js`, `commerce.css`, and `tests/ui/checkout.mjs`. Frontend publication requires deployment-fork sync before live verification. Native Safari and Firefox were not executed.
