# Elio SEO launch and next steps

The approved release enables indexing for the five primary public pages below. Each has a unique title/description and one clean canonical URL; the sitemap includes those five URLs. Home also retains factual Organization structured data. No ratings, review totals, unverified location or product-availability claims were added.

| Page | Canonical URL |
| --- | --- |
| Home | [https://eliocheesecakes.com/](https://eliocheesecakes.com/) |
| Our Story | [https://eliocheesecakes.com/story](https://eliocheesecakes.com/story) |
| Flavors | [https://eliocheesecakes.com/flavors](https://eliocheesecakes.com/flavors) |
| The Elio box | [https://eliocheesecakes.com/box](https://eliocheesecakes.com/box) |
| Shop | [https://eliocheesecakes.com/order](https://eliocheesecakes.com/order) |

## Do first after publication

1. **Verify the domain in Search Console.** Open [Google Search Console](https://search.google.com/search-console/), add a **Domain** property named `eliocheesecakes.com`, and copy the DNS TXT record Google supplies. Add it at the domain's DNS provider using Google's exact value, then return and verify. Keep that record after verification. Domain verification covers protocol/subdomain variations. [Google's verification instructions](https://support.google.com/webmasters/answer/9008080)
2. **Submit the sitemap.** In that property's Sitemaps screen, submit [https://eliocheesecakes.com/sitemap.xml](https://eliocheesecakes.com/sitemap.xml). Confirm that it is fetched successfully and contains only the five canonical URLs above, with no order IDs, tokens or account pages. [Google's sitemap guide](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
3. **Inspect the five public URLs.** Use URL Inspection and its live test. Check that fetching and indexing are allowed, the declared canonical matches the table, and the rendered page shows useful flavor/box content. Request indexing after the published version passes. Recheck later for Google's selected canonical and any indexing exclusions. Submission makes pages discoverable; it does not guarantee indexing, timing or ranking. [Google's Search Console guide](https://developers.google.com/search/docs/monitor-debug/search-console-start)
4. **Resolve the unused `www` hostname.** The launch precheck found no DNS record for `www.eliocheesecakes.com`. If customers will use it, configure its hosting/certificate and a permanent redirect to `https://eliocheesecakes.com/`, preserving page paths. The apex already redirected HTTP to HTTPS. This hostname work is separate from the five-page indexing change.

Search Console verification, sitemap submission and Google's indexing results have not been performed or verified in this session.

## Improve the content customers find

- Keep each page's title and description specific to that page. Explain actual flavors, box contents, preparation notice, pickup and delivery clearly; use confirmed service locations naturally where relevant. Update real product photos and useful alt text as the catalog changes. Avoid repetitive keyword lists and claims the page does not support. [Google's title guidance](https://developers.google.com/search/docs/appearance/title-link)
- Keep the existing public navigation linking Home, Story, Flavors, Box and Shop. Product dialogs and product/collection query variants currently canonicalize to Shop. Dedicated public product pages and accurate Product/Offer structured data would be a separate future improvement if individual products should appear in search.
- For local discovery, create or claim a Google Business Profile **only if Elio's actual operation meets Google's eligibility rules**. Confirm the applicable pickup, shared-kitchen or virtual-food-brand rules first. Delivery-only food brands have specific website/packaging and service-area conditions and must hide their address; do not assume a private kitchen is a public storefront. Use accurate hours, contact details and service areas. [Google Business Profile guidelines](https://support.google.com/business/answer/3038177)
- After data accumulates, review Search Console's Search results, Page indexing and Core Web Vitals reports. Prioritize real queries, useful page improvements and mobile friction; compare consented conversion data with those results. The existing analytics consent controls remain in place. [Google's Search Console guide](https://developers.google.com/search/docs/monitor-debug/search-console-start)

## Private pages and technical checks

`/account`, `/manage`, `/pos`, `/newsletter` and their `.html` versions remain **noindex/nofollow**. The newsletter route also hosts private preference actions. Admin assets receive a noindex response header. Private order/auth fragments and non-public query parameters on the five public pages receive noindex/nofollow from the inline head guard before customer modules render, including later private-order navigation. Do not put private order links in the sitemap or submit them for indexing. JavaScript noindex is an indexing instruction, not an access-control mechanism; existing API authorization and private tokens remain responsible for privacy. [Google's JavaScript indexing guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)

The sitemap and robots file are generated by `scripts/prepare-launch-seo.mjs`; source and built pages are checked for one canonical, an explicit public allowlist and preserved private-page directives. Browser verification passed private-link transitions, object/base/frame restrictions, current script/styles/WASM and required same-origin/provider frames. Security peer review found no actionable regression. The final release owner still verifies the live response headers and page metadata after deployment.
