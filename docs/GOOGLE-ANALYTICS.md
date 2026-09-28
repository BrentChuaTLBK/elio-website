# Google Analytics

Elio uses web stream `G-0DJM12X1FV` on `eliocheesecakes.com` and `www.eliocheesecakes.com`.

- The tag loads only after the visitor allows analytics. A browser's Do Not Track or Global Privacy Control request keeps tracking off. The preference lasts 180 days and can be changed on Privacy → Website analytics.
- Tracked pages: Home, Flavors, Box, Shop, Newsletter signup, Privacy and Terms. Local previews, accounts, admin pages, affiliate dashboards, private order links and newsletter action links are excluded.
- Page views use fixed titles and canonical URLs without queries or fragments. Referrers are reduced to their origin. No names, emails, payment details, order identifiers, account IDs or form values are added to events. Advertising features are disabled.
- Checkout stops analytics before entering the private order view. The tag never emits a purchase event; Elio's backend remains the source for paid, cancelled and refunded sales.

Keep **Enhanced measurement off** in Admin → Data streams → Elio Website. Automatic history or form events could otherwise bypass the explicitly curated page views. Google documentation: https://developers.google.com/analytics/devguides/collection/ga4/views

After publishing, open the live storefront in a fresh browser, choose Allow analytics and check Reports → Realtime in the Elio property. Standard processed reports can take longer. Declining analytics or using a blocker will exclude that visit.

The admin dashboard's visitor cards need a separate, authenticated Google Analytics Data API reporting connection. The measurement ID alone does not grant report access. Until that connection is configured, use the Open Google Analytics link; the cards must not display invented zero counts.

Verification: `node tests/ui/site-analytics.mjs` checks consent, clean event parameters, private routes, opt-out, blocked storage, production-only activation and the live Google tag's network payload with collection requests intercepted before transmission.
