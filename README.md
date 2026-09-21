# Elio Website — first vision

A responsive Elio storefront prototype with an independent Supabase ordering backend and team dashboard. Customer checkout remains a preview while business details and integrations are being prepared.

## Preview

Run `node server.mjs`, then open http://127.0.0.1:4173. No package installation is needed. You can also open `dist/index.html` directly in a browser. The local server binds only to this computer.

For a static host, the publish directory is `dist` and no compilation is needed. All asset URLs are relative. The storefront remains a static preview; the admin dashboard connects to Elio's separate Supabase project using a publishable browser key. No server secrets belong in the static files.

## Elio administration

- `/manage.html?preview=1`: read-only dashboard preview; no private data or backend requests.
- `/manage.html`: connected dashboard, requiring a verified and authorized Elio account.
- `/admin-account.html`: Elio team registration, sign-in, and password recovery.
- [Backend setup and implementation](docs/BACKEND.md): project separation, inventory rules, tests, and remaining integrations.

Overview, Orders, Daily quantities, Analytics, Promo codes, Shop settings, and Team access are adapted from TLB. Flavors & boxes manages the Elio catalog. Custom boxes reserve three individual flavor pieces per box and add per-flavor surcharges; fixed sets reserve only their own set inventory. Seven flavors and four box concepts are seeded as unconfirmed drafts. Ordering starts paused.

The live database is installed in `dzxyhckkkrzqpwpavngn`, separate from TLB's project within the same organization. Resend/SMTP, verification of the initial owner, customer checkout, payment-proof functions, and the email worker/scheduler still need integration setup before customer launch. Website visitor analytics is not connected; order analytics is available in the dashboard.

Backend validation: `cd tests/backend`, `npm ci`, then `npm test`. See the backend guide for local PostgreSQL-compatible test details and limitations.

## Cloudflare deployment

The site uses **Workers Static Assets**, with its deployment settings tracked in `wrangler.jsonc`. Cloudflare serves `dist` directly; `server.mjs` is only for local previews and is not deployed. The custom domain is `eliocheesecakes.com`.

Connect the deployment repository `BrentChuaTLBK/elio-website` through Cloudflare Workers Builds:

| Setting | Value |
| --- | --- |
| Project name | `elio-website` |
| Production branch | `main` |
| Root path | `/` |
| Build command | `npm run check` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Application environment variables | None |

The build command checks JavaScript syntax; no compilation step is needed. Use Cloudflare's generated build API token, never a token committed to GitHub. The domain must be active in the same Cloudflare account. The custom-domain setting lets Cloudflare configure the site's DNS and HTTPS during deployment.

Keep `main` for the deployed version and use other branches for changes you want to preview first. The non-production command uploads a preview version without promoting it to the live site. When changes are made in the source repository `PlayerBC/elio-website`, merge or sync them into the deployment repository to trigger deployment.

Cloudflare references: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), and [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## What works

- Responsive homepage with the navigation layered over the hero photograph, ivory/brown/gold palette, centered typographic wordmark, and food-first imagery. The same text logo is retained, using its lighter bronze variant over the photo.
- The flavor collection and gifting section now form one compact showcase: three browsable flavor tiles beside a box photograph. The box copy and “Order a box” button are live HTML over the image, with a dark fade for contrast. They stack cleanly on mobile.
- Mobile navigation, a full flavor catalog carousel, individual flavor dialogs, gifting details, and a factual brand introduction.
- “Explore all flavors” opens `flavors.html`: a photo-led catalog with taste filters, clickable descriptions, a monthly menu, and a separate section for flavors outside the rotation. All current flavors are in the initial monthly lineup, as confirmed by Elio. The legacy `#flavors` link redirects to this page.
- The carousel glides automatically at a gentle 14 pixels per second, with the first flavor following the last seamlessly. It keeps moving while the cursor is over it. The previous/next buttons move three flavors at a time on desktop and mobile; keyboard arrows move one flavor, with Home/End jumping to the first/last. Native touch/trackpad scrolling remains available.
- Keyboard-accessible native dialogs, focus restoration, Escape to close, direct detail links, visible focus states, and reduced-motion support.
- Account and bag icons appear beside the centered wordmark. Compact navigation is used at widths up to 1000 px and includes My account, My orders, and Order a box links.
- “Order a box” opens `order.html`, a shop preview based on the supplied layout: a photographic hero, Signature Trio, Tea Collection, Discovery Box, and build-your-own cards, followed by flavor details, gifting, and FAQs. These names and combinations are reference-inspired concepts, not confirmed products. Pricing and checkout remain disabled.
- A custom calendar and pickup/delivery selector sit above the box collection. The calendar follows [TLB Kitchen's customer calendar](https://github.com/BrentChuaTLBK/bakery-website/blob/main/assets/ordering/customer-calendar.js): a centered month popup, previous/next arrows, selected and unavailable styles, Clear date, and Current month. It supports keyboard navigation, Escape, focus restoration, and phone layouts. Calendar days use Philippine time; past dates are disabled and an open popup refreshes at midnight. Preferences carry into box details and back through URL parameters. Dates remain preview preferences, not confirmed bookable slots. Elio's availability, booking window, lead times, fees, delivery area, and pickup details still need confirmation.
- Each card opens `box.html?collection=...`, with its matching concept photograph and initial flavor selection. Build your own starts with three empty selectors. A flavor outside the monthly menu stays disabled and leaves an empty choice instead of silently substituting a different flavor. The gallery, quantity controls, unsaved gift-message preview, and box/care details remain available. Price and Add to bag remain coming-soon placeholders.
- Public storefront account, order-history, and bag controls remain “Coming soon” placeholders. Customer checkout is disabled. The separate team account page and dashboard now use Elio's Supabase backend.
- A compact newsletter placeholder sits above the footer, with small copy beside the email field on desktop and a tight stack on mobile. The email input and arrow are disabled, with an explicit unavailable message. Instagram remains linked in the footer.
- Immediately above the newsletter, an editorial block introduces the three-piece box, a gifting banner, and three everyday Elio moments. “Build your trio” opens the box preview, “Explore gifting” opens the existing packaging details, and the Instagram handle links to Elio. The copy and controls are real HTML; the photographs are replaceable concept assets.

## Structure

| File | Purpose |
| --- | --- |
| `dist/index.html` | Semantic homepage, real copy, navigation, asset references |
| `dist/styles.css` | Responsive components and shared design tokens |
| `dist/content.js` | Structured flavor names, descriptions, and image replacement points |
| `dist/app.js` | Reusable product rendering, navigation, accessible detail views |
| `dist/order.html`, `dist/shop.css`, `dist/order.js` | Box collection shop, flavor details, gifting, FAQs, and bag placeholder |
| `dist/fulfillment.js`, `dist/fulfillment.css` | Shared pickup/delivery controls and date-preference carryover |
| `dist/calendar.js`, `dist/calendar.css` | TLB-inspired custom calendar popup and keyboard/date handling |
| `dist/order.css` | Shared compact header styles retained for box and flavor pages |
| `dist/flavors.html`, `dist/flavors.css`, `dist/flavors.js` | Monthly lineup, full flavor collection, category filters, and clickable descriptions |
| `dist/box.html`, `dist/box.css`, `dist/box.js` | Box-detail gallery and non-purchasing flavor, quantity, and gift-message preview |
| `dist/assets/` | Original logo, optimized logo icons and concept images, licensed heading font |
| `server.mjs` | Dependency-free local preview server |
| `data/verification.json` | Desktop, tablet, and mobile check results |

The original development brief, design and packaging references, and image generation prompts are not required for deployment and are excluded from the published file tree. The local handoff includes them separately. `.gitignore` keeps those local source materials out of future routine commits.

## Temporary assets and open decisions

The hero, featured flavor images, and gifting image are AI-generated **concept photography** for this initial vision. Their appearance and rendered packaging lettering are not production specifications. The original supplied logo and packaging reference files remain the branding authority. Supplier drawings are not displayed as marketing photography.

| Asset | Replacement point |
| --- | --- |
| `dist/assets/hero-concept.webp` | Hero image and preload in `dist/index.html` |
| `dist/assets/flavors-concept.webp` | Shared vanilla/matcha/chocolate triptych in `dist/content.js` |
| `dist/assets/gifting-concept.webp` | Homepage showcase, flavor-catalog hero, box gallery, and gifting dialog |
| `dist/assets/trio-story-concept.webp` | Homepage editorial photograph and Signature Trio card/gallery |
| `dist/assets/shop-hero-concept.webp` | Shop hero image and preload in `dist/order.html` |
| `dist/assets/shop-tea-box-concept.webp` | Tea Collection card/gallery through `boxCollections` in `dist/content.js` |
| `dist/assets/shop-discovery-box-concept.webp` | Discovery Box card/gallery through `boxCollections` |
| `dist/assets/shop-custom-box-concept.webp` | Build-your-own card/gallery through `boxCollections` |
| `dist/assets/thoughtful-gift-concept.webp`, `dist/assets/thoughtful-gift-wide-concept.webp` | Mobile and desktop gifting banners in the homepage and shop |
| `dist/assets/unboxing-moment-concept.webp` | Unboxing lifestyle photograph in `dist/index.html` |
| `dist/assets/coffee-moment-concept.webp` | Cheesecake and coffee lifestyle photograph in `dist/index.html` |

To use separate product photos, add `image: 'assets/your-photo.webp'` to the relevant flavor in `dist/content.js`. Gorgonzola, Ube, Hojicha, and Speculoos currently use clearly labeled typographic photo placeholders throughout the catalog; their product photography remains open. The box gallery uses existing concept photographs, including crops of the bag and carton, rather than new production photos.

The four new shop photographs were generated with `image_gen.imagegen` in reference-guided mode using the existing trio photograph, then resized and compressed to WebP. Their originals and full prompts are retained in the local `work/generated-assets/` handoff. Replace the web assets above with final photography when ready. Add or edit `boxCollections` to maintain the proposed box range independently from the rotating flavor menu.

## Growing the flavor catalog

Add a flavor object to `flavors` in `dist/content.js` with a unique `id`, `name`, `line`, and `description`. It appears automatically in the homepage carousel, full catalog, order page, and its own `#flavor-id` detail view. Add `image` when its photograph is ready. Optional `category` values are `classic`, `tea`, and `rich`; flavors without a category still appear under All flavors. `featuredOrder` only controls which flavors lead; every other flavor follows automatically. Public copy uses “Explore all flavors” without a fixed count.

Update the `monthlyMenu` array in `dist/content.js` with the IDs in the current rotation. All current flavors are included initially. Removing an ID moves that flavor to “More to discover,” keeps its description accessible, and marks it “Currently unavailable” across the homepage, catalog, and shop. It also disables that option in the box preview. Adding an ID brings it back into the monthly lineup. A newly added flavor stays outside the menu until its ID is included; adding catalog entries never silently makes them selectable.

`available: false` is an optional override that keeps a flavor unavailable even when its ID is in `monthlyMenu`. Remove that override and include the ID in `monthlyMenu` to make it selectable again. An empty monthly list displays a coming-soon message and leaves the full collection browsable. The shared `isAvailable` helper keeps all pages consistent. This is an editorial menu, not live inventory or an enabled order service.

Automatic movement starts as soon as the carousel enters view, with no startup delay, and continues on hover and during vertical page scrolling. Only horizontal wheel/trackpad input (including Shift+wheel) starts manual carousel browsing; page scrolling and zoom gestures do not trigger a sideways snap. After an arrow click or mobile swipe, the gentle glide resumes as soon as the movement and native momentum finish. Horizontal wheel/trackpad browsing and focus interaction retain a four-second reading pause. It also pauses while details are open and when the carousel or page is out of view. Reduced-motion preferences disable automatic movement. Screen-reader status announcements are silent while it moves automatically; the full catalog page provides a stationary view of all flavors.

Hidden copies at either end make the scroll loop without a visible rewind. They do not add duplicate entries to screen readers, keyboard navigation, or the full catalog. Selecting a visible copy opens the same flavor details and restores focus to the original card. Resizing preserves the current flavor.

Native swipe gestures recenter the repeated cards at the start and end of each gesture, with an additional guard during momentum near the outer edges. Rapid consecutive swipes therefore keep looping without waiting for the scrolling debounce to finish. The card count stays fixed; no additional copies accumulate.

## Branding

The header, footer, and story use a live-text wordmark reading “ELIO / BASQUE CHEESECAKE / by TLB Kitchen,” as requested in the latest design revision. ELIO and BASQUE CHEESECAKE stay centered and prominent; the TLB Kitchen credit is deliberately tiny. Shared `.wordmark` styles use warm bronze on ivory and lighter bronze on dark backgrounds and the photographic homepage header to echo the planned packaging finish. The browser tab and Apple touch icon use optimized 64 px and 180 px copies of the supplied original circular logo, preserving its artwork, proportions, and transparency. The full-resolution original PNG is retained as their source asset.

The heading font is **Libre Caslon Display**, chosen to approximate the reference; it is not claimed to be Elio's official font. Its SIL Open Font License is included in `dist/assets/FONT-LICENSE.txt`. Body text uses the visitor's Georgia/system serif font.

Still unconfirmed: prices, stock, box combinations/mix-and-match rules, ordering channel, checkout/payment, inventory, delivery/pickup policies, launch timing, and any longer brand history. There are no invented reviews, awards, scarcity claims, or delivery promises. The provided Instagram and email are contact links only.

The newsletter section is visual only. It has no submitting form, email capture, storage, or email-provider integration. Final signup copy and privacy/consent details need to be supplied before enabling it.

The service placeholders can be previewed directly at `#account`, `#orders`, and `#bag`. The legacy `#ordering` link redirects to `order.html`, whose bag preview is `order.html#your-bag`. Account authentication/registration, order history and tracking, a persistent shopping bag, and checkout/payments still need their actual systems and business rules. These placeholders contain no credential fields, fake customer information, sample orders, or active purchase flow. TLB Kitchen is a visual template only: its backend, customer data, prices, and fulfillment settings are not connected or copied.

This prototype includes `noindex, nofollow` metadata. Review that setting when an actual public launch is authorized. A public source repository is not a live business launch.

The calendar and associated date/inventory backend in [TLB Kitchen's main repository](https://github.com/BrentChuaTLBK/bakery-website) were reviewed as a reference only. The backend performs its own date, product, and quantity validation. Elio has not imported TLB's database, APIs, customer data, booking window, cutoffs, or business rules. A similar system for Elio will need its own specification, especially for three-piece boxes and the rotating flavor menu.

## Verification

JavaScript syntax checks passed. Chrome visual and interaction checks passed at 1440, 768, 390, and 320 px widths. No page overflow, missing images, failed asset requests, or browser runtime errors were found. Catalog navigation, product details, gifting, prototype bag, mobile menu, Escape handling, focus restoration, and direct detail links were exercised. Loop checks covered repeated forward/backward navigation, keyboard wrapping, native phone swipes across both boundaries, animated rapid clicks, resize behavior, detail/focus handling for visible copies, and the automatic inclusion of an eighth test flavor. A two-flavor catalog was also checked. Unavailable status was verified using test data only.

The latest visual revision places the header and hero text over one continuous food photograph and combines collection and gifting into a compact row. Three flavors are visible at a time, with looping navigation through the full catalog. On phones the box photo sits below the compact carousel, with its copy and order button still over the image. These checks are not a full cross-browser or production accessibility audit.

The account/order placeholders were checked at 1440, 1001, 1000, 768, 390, and 320 px, including both sides of the compact-header breakpoint. The wordmark remained centered with no overlapping controls or horizontal overflow. Direct links, navigation between placeholders, Escape/focus restoration, disabled controls, and menu reset on resize passed. No customer-data submissions or browser storage writes occurred.

The standalone order page and compact showcase were subsequently checked at 1440, 1001, 768, 390, and 320 px. Checks covered all order-entry links, search and empty results, detail dialogs, keyboard focus, unavailable flavors, a growing catalog, and the legacy order-link redirect. The header/hero and image-overlay layout were visually inspected on desktop and phones.

The repeated-swipe regression was reproduced before the fix, then checked with native touch input in Chrome mobile emulation at 390 and 320 px: 32 rapid swipes forward and 32 backward at each width without reaching a physical end. Canceled-gesture recovery, product taps after swiping, and vertical page scrolling passed. The existing carousel checks for buttons, keyboard navigation, resizing, reduced motion, and catalog growth also passed.

The box-detail and flavor-catalog pages were checked at 1440, 1024, 768, 390, and 320 px. Checks covered gallery navigation, keyboard operation, flavor selection, quantity normalization, gift-message clearing (including browser history), expandable details, catalog filters, all flavor descriptions, focus restoration, and direct links. Rotation was tested with a smaller monthly lineup, an added flavor, and an empty lineup; all pages consistently show unavailable flavors and prevent selecting them in the box preview. The centered wordmark and desktop/mobile layouts were visually inspected. No missing assets, runtime errors, purchase submissions, or stored customer data were found.

The editorial block above the newsletter was visually checked at 1440, 1024, 768, 390, and 320 px. The box preview and gifting dialog links, keyboard focus restoration, Instagram destination, disabled newsletter controls, responsive image variants, and absence of horizontal overflow were verified. Its new photographs are AI-generated concepts, with a wider desktop gifting composition so the full packaging remains visible.

Slow autoplay was checked in Chrome at 1440, 390, and 320 px, including movement within the first 350 milliseconds of entering view, measured speed, seamless wrapping, continued movement on hover, automatic resumption after navigation, reduced-motion preferences, and control spacing. Three-flavor button steps, rapid repeated clicks, keyboard navigation, resizing, and small/growing catalogs were checked at desktop and phone widths. At 390 and 320 px, the glide continued immediately after native swipes settled in both directions, while yielding to a held finger. Offscreen and open-dialog pauses also passed. Repeated-swipe checks covered 32 consecutive native swipes in each direction at both phone widths.

The page-scroll regression was reproduced before the fix and checked at 1440 and 768 px: vertical wheel input scrolls the page without a sideways carousel jump, while horizontal browsing still works and resumes autoplay. At 1440, 390, and 320 px, the gentle glide resumed within 350 milliseconds after the arrow destination aligned, without the previous four-second wait. The three-flavor steps, loop, rapid clicks, resize, keyboard, and native touch boundary checks also passed again.

The redesigned shop and shared fulfillment controls were checked in Chrome at 1440, 1024, 768, 390, and 320 px. The box grid, centered wordmark, mobile image composition, native date input, pickup/delivery selection, preference carryover, past/invalid dates, flavor dialogs, bag placeholder, FAQs, and custom box choices passed. Rotating and empty menus prevent unavailable flavor selections. Box-gallery keyboard navigation, quantity controls, gift-message clearing, and history restoration also passed. No overflow, missing images, runtime errors, submissions, or browser storage writes were found. Phone layout checks use Chrome emulation, not physical iOS/Android devices.

The custom calendar replacement was checked at 1440, 1024, 768, 390, and 320 px, plus a short landscape viewport. Tests covered opening/closing and focus return, previous/next/current month, selection and clearing, pickup/delivery labels, shop-to-box carryover, keyboard arrows/Home/End/PageUp/PageDown, year and leap-day boundaries, invalid URLs, and Philippine-midnight rollover from a browser in another time zone. No backend calls or browser errors occurred. Desktop and phone screenshots were compared with TLB's actual popup.

Run syntax checks directly:

```sh
node --check dist/app.js
node --check dist/order.js
node --check dist/box.js
node --check dist/flavors.js
node --check dist/calendar.js
node --check dist/fulfillment.js
node --check dist/content.js
node --check server.mjs
```

Brand assets and supplied copy remain the property of their respective owner. No open-source license is granted for them by this repository.
