# Shop loading presentation

Approved by Brent on 30 September 2026 after the isolated before/after review.

The shop initially reserves space for its date selector, four product cards and basket. Static cream placeholders use the real responsive grid and product-image aspect ratio. They are decorative, inert and hidden from assistive technology; a loading status and `aria-busy` identify the pending content. Prices and available dates still come from the existing catalog response.

Success, an empty catalog or failure replaces the placeholders. Retry restores them. Order links use “Opening your order…” instead. The no-JavaScript fallback displays instructions rather than placeholders. Saved basket data remains intact.

This reduces initial visible movement; it does not promise faster API responses or zero layout shift. Variable product counts, category filters, unusually long content and server-provided pause messages can still change the final page height.

Validation: `tests/ui/shop-loading.mjs` covers 320/390/768/1440px, catalog loading, saved baskets, failure/retry, empty catalog, session-read failure, order links and JavaScript disabled. The first product position matches within 3px in the standard fixture at all four widths. `tests/ui/checkout.mjs` passed pickup and delivery checkout at desktop and phone widths. `scripts/check.mjs` passed.

Only shop loading was approved. POS progress feedback remains a separate preview awaiting approval.
