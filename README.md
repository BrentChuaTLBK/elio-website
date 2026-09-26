# Elio Website — first vision

A responsive Elio storefront prototype with an independent Supabase ordering backend and team dashboard. The shop connects to live catalog, basket, pickup/delivery checkout, private payment proofs, and order updates. Ordering follows the saved shop pause setting, product visibility, published monthly lineups, and daily flavor quantities.

## Preview

Run `node server.mjs`, then open http://127.0.0.1:4173. No package installation is needed. Use the local server for JavaScript modules and the live flavor collection; the server binds only to this computer.

For a static host, the publish directory is `dist` and no compilation is needed. All asset URLs are relative. The storefront and dashboard connect to Elio's separate Supabase project using a publishable browser key. No server secrets belong in the static files.

## Elio administration

- `/manage.html?preview=1`: read-only dashboard preview; no private data or backend requests.
- `/manage.html`: connected dashboard, requiring a verified and authorized Elio account.
- `/admin-account.html`: Elio team registration, sign-in, and password recovery.
- `/account.html`: customer registration, sign-in, and password recovery. Signed-in customers can view their order history. Registration does not subscribe anyone to marketing email.
- [Backend setup and implementation](docs/BACKEND.md): project separation, inventory rules, tests, and remaining integrations.

Overview, Orders, Daily quantities, Analytics, Promo codes, Shop settings, and Team access are adapted from TLB. Flavors and Boxes & sets have separate catalog areas. All boxes share individual flavor inventory. Owners choose the three flavors inside a fixed set and enter its total price; customers can change flavors only in custom boxes, which add per-flavor surcharges. New installations start paused. Saved numeric prices apply immediately, and “Show this product in shop” controls box visibility.

The live database is installed in `dzxyhckkkrzqpwpavngn`, separate from TLB's project within the same organization. The initial owner is verified. The checkout and private proof functions are connected. The email worker runs every minute; complete a controlled real-delivery check before launching. Verify Resend/SMTP deliverability before relying on account emails. Website visitor analytics is not connected; order analytics is available in the dashboard.

Backend validation: `cd tests/backend`, `npm ci`, then `npm test`. See the backend guide for local PostgreSQL-compatible test details and limitations.

### Flavor menus, quantities, and production

**Flavor menus** uses the same flavor records as **Flavors**. Owners can add a name, photo, description, flavor category, and current/next-month placements. Leaving both months unchecked keeps a flavor in the full collection. Hidden flavors leave the public collection and all future lineups and cannot be ordered. The public flavor list, descriptions, shop flavor strip, and homepage carousel read this managed collection. Categories filter the public collection.

Each lineup belongs to a calendar month in Manila time. A published next-month lineup becomes the current lineup when that month begins. Hidden lineups can be prepared and stocked by staff, but they are excluded from public previews and customer ordering. Publishing a lineup does not override a shop pause, closed date, box visibility, lead time, or daily quantity.

**Daily quantities** shows only the selected month's lineup. Dates start at zero until a quantity is entered. Whole-month and date-range selection stay within that month and include closed dates for stock planning, while customer orders remain blocked on closed dates. Quantities are totals including existing reservations: 20 total with 12 reserved leaves 8. Choose **Replace quantities** or **Fill only unconfigured dates**; an explicitly saved zero counts as configured. Blank / No limit is an explicit owner/staff choice, never the missing-row default. Removing and re-adding a flavor resets its unsold stock to zero; existing orders and their reserved pieces remain intact.

**Production** reports paid, admin-confirmed orders by pickup/delivery date range, with overall and daily flavor-piece totals, fixed sets, custom boxes, and served quantities. Completed orders stay in the range totals; unpaid, cancelled, expired, and refunded orders do not. Calculations use saved order recipes, including repeated flavors. **Top Flavors** in Analytics ranks those saved flavor pieces by the Analytics order-placement date filter, including completed orders and excluding unpaid/cancelled/refunded orders. Box revenue is not arbitrarily allocated to individual flavors.

The Production picker supports **Date range** (start, then end, both included) and **Single date**. It shows consecutive months on desktop and one navigable month on phones, including past dates. Click **View production** to apply the selection. Choosing the same start and end also produces a single-day report.

Lineup removal uses an in-page confirmation with each flavor's upcoming paid, approved order count and required pieces. Cancelling keeps the unsaved draft. Shop and dashboard dialogs ignore outside clicks; close buttons, explicit actions, and keyboard dismissal remain available.

Product detail popups fit their contents and contain readonly flavor tiles for fixed sets, plus expandable packaging and care information. The date and pickup/delivery selector appears once on the shop page. Legacy `box.html` links open the corresponding shop popup.

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

- The homepage uses a centered photographic hero, a live premade-box section, the full flavor carousel, a story feature, and a sharing banner. Navigation remains Our Story, Flavors, and Order a Box.
- The public `home_catalog` read returns listed fixed sets, the first listed custom-box link, and every flavor that is not individually Hidden. Names, descriptions, photos, prices, and saved All-list positions come from the dashboard. Stock, lineup membership and publication do not limit the homepage flavor carousel; unpublished month assignments are never returned. This showcase does not change ordering eligibility or the flavor page's monthly sections.
- Premade boxes slide manually in groups of three on larger screens, one per page on phones, looping in either direction. Groups wrap through the beginning to stay full: four boxes show 1–2–3, then 4–1–2, then 3–4–1. Controls disappear when everything fits. Boxes never autoplay. Box links open the selected product in the shop. Swipe and keyboard browsing are supported; reduced motion skips the slide animation.
- The flavor carousel keeps all visible flavors as the collection grows, displaying seven tiles across wide screens, five on tablets and three on phones. The number of visible tiles does not cap the catalog. Uploaded photos are shared with the flavor collection and product details.
- The carousel glides automatically at a gentle 14 pixels per second, with the first flavor following the last seamlessly. It keeps moving while the cursor is over it. The previous/next buttons move three flavors at a time on desktop and mobile; keyboard arrows move one flavor, with Home/End jumping to the first/last. Native touch/trackpad scrolling remains available.
- Keyboard-accessible native dialogs, focus restoration, Escape to close, direct detail links, visible focus states, and reduced-motion support.
- Account and bag icons appear beside the centered wordmark. Compact navigation is used at widths up to 1000 px and includes My account, My orders, and Order a box links.
- “Order a box” opens `order.html`: the existing photographic shop layout now loads active boxes from the dashboard and includes Your basket. Fixed-set recipes cannot be changed; custom boxes require exactly three available flavor pieces. Prices and shared stock are revalidated by the server. Draft concepts remain previews until activated.
- The shop uses TLB’s calendar UI, restricted to the current and following month in Philippine time. On initial load, Pickup and the earliest available date are selected, accounting for production rules, closures, and shared flavor stock. A saved basket is checked as a whole. Customers can then change the date or choose Delivery.
- Box cards open a compact, centered product dialog with photographs, included flavors or custom choices, quantity, price, and Add to basket. Legacy `box.html?collection=...` links open the matching shop dialog. Unlisted concepts use the same compact window with ordering disabled. Date and pickup/delivery selection stay on the shop page, outside product details.
- Public account and team account pages use Elio's Supabase Auth for email/password registration, sign-in, verification, password reset, and sign-out. Google sign-in controls activate automatically when the Elio Google provider is enabled; see [Google sign-in setup](docs/GOOGLE-SIGN-IN.md). Only users with an Elio staff role can open the dashboard. Signed-in customers see their own order history; guests use a private order link. Payment approval remains a staff action.
- A compact newsletter placeholder sits above the footer, with small copy beside the email field on desktop and a tight stack on mobile. The email input and arrow are disabled, with an explicit unavailable message. Instagram remains linked in the footer.
- The story feature and “Made to share” banner sit above the retained newsletter placeholder. Hero and banner calls to action open the shop; “Build your own” opens the listed custom box. Copy and controls are real HTML.

## Structure

| File | Purpose |
| --- | --- |
| `dist/index.html` | Semantic homepage, real copy, navigation, asset references |
| `dist/styles.css`, `dist/home.css` | Shared design tokens and scoped homepage composition |
| `dist/assets/shop/home-content.js`, `dist/assets/shop/home-boxes.js` | Anonymous homepage data and manual looping box pages |
| `dist/content.js` | Structured flavor names, descriptions, and image replacement points |
| `dist/app.js` | Reusable product rendering, navigation, accessible detail views |
| `dist/order.html`, `dist/shop.css`, `dist/order.js` | Connected shop shell, flavor details, gifting, and FAQs |
| `dist/fulfillment.js`, `dist/fulfillment.css` | Shared pickup/delivery controls and date-preference carryover |
| `dist/calendar.js`, `dist/calendar.css` | TLB-inspired custom calendar popup and keyboard/date handling |
| `dist/order.css` | Shared compact header styles retained for box and flavor pages |
| `dist/flavors.html`, `dist/flavors.css`, `dist/flavors.js` | Monthly lineup, full flavor collection, category filters, and clickable descriptions |
| `dist/box.html`, `dist/box.css`, `dist/box.js` | Box-detail gallery and non-purchasing flavor, quantity, and gift-message preview |
| `dist/assets/shop/` | Live catalog, shared-stock rules, calendar, basket, checkout, and private order/proof view |
| `dist/assets/` | Original logo, optimized logo icons and concept images, licensed heading font |
| `server.mjs` | Dependency-free local preview server |
| `data/verification.json` | Desktop, tablet, and mobile check results |

The original development brief, design and packaging references, and image generation prompts are not required for deployment and are excluded from the published file tree. The local handoff includes them separately. `.gitignore` keeps those local source materials out of future routine commits.

## Temporary assets and open decisions

The hero, featured flavor images, and gifting image are AI-generated **concept photography** for this initial vision. Their appearance and rendered packaging lettering are not production specifications. The original supplied logo and packaging reference files remain the branding authority. Supplier drawings are not displayed as marketing photography.

| Asset | Replacement point |
| --- | --- |
| `dist/assets/home-hero-centered.webp` | Centered homepage hero and preload in `dist/index.html` |
| `dist/assets/hero-concept.webp` | Homepage story close-up |
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

Manage flavors in **Flavor menus**: upload a photo, edit descriptions, select categories, and assign the current month, next month, both, or neither. Neither means collection-only. Individually hidden flavors are omitted from the public collection and cannot accept new orders. Product surcharges and ordering switches remain in **Flavors**; all screens use the same flavor record.

**Arrange categories** and **Arrange flavors / boxes** support mouse, touch, and keyboard movement. Boxes and flavors have separate category lists. Each item can appear in multiple categories while retaining one inventory record. The All list and every category have independent saved orders. Public filters use these orders. Uncategorized items remain in All. Removing a category preserves other memberships, inventory and orders. Sorting uses a complete saved snapshot to reject stale edits; changing a description preserves existing positions.

Monthly lineups use Manila calendar dates. Prepared next-month menus roll forward automatically with their publication setting and quantities. Flavors not included stay in the full collection unless individually hidden. An unpublished lineup blocks orders for its dates. New or re-added members start with zero unsold stock. Before removal, the editor reports outstanding paid, confirmed order and piece counts. Saved order recipes remain in Production.

Daily quantities shows the selected month’s lineup. Select individual dates, a range within the month, or the whole remaining month. Totals include already ordered pieces. Choose replace or fill only unconfigured dates; a saved zero is configured. If any requested total is below existing reservations, the whole operation is rejected with the conflicting date. Closed dates may be stocked for planning, but shop and fulfillment closures still block ordering.

The live public collection comes from the checked Supabase RPC. The homepage uses its separate `home_catalog` action so an individually visible flavor can appear there even before its next-month placement is announced. Static entries in `dist/content.js` are concept-preview fallbacks, not the live management interface. If public collection loading fails, hidden static flavors are not restored. The carousel follows the saved All flavors order.

Automatic movement starts as soon as the carousel enters view, with no startup delay, and continues on hover and during vertical page scrolling. Only horizontal wheel/trackpad input (including Shift+wheel) starts manual carousel browsing; page scrolling and zoom gestures do not trigger a sideways snap. After an arrow click or mobile swipe, the gentle glide resumes as soon as the movement and native momentum finish. Horizontal wheel/trackpad browsing and focus interaction retain a four-second reading pause. It also pauses while details are open and when the carousel or page is out of view. Reduced-motion preferences disable automatic movement. Screen-reader status announcements are silent while it moves automatically; the full catalog page provides a stationary view of all flavors.

Hidden copies at either end make the scroll loop without a visible rewind. They do not add duplicate entries to screen readers, keyboard navigation, or the full catalog. Selecting a visible copy opens the same flavor details and restores focus to the original card. Resizing preserves the current flavor.

Native swipe gestures recenter the repeated cards at the start and end of each gesture, with an additional guard during momentum near the outer edges. Rapid consecutive swipes therefore keep looping without waiting for the scrolling debounce to finish. The card count stays fixed; no additional copies accumulate.

## Branding

The header, footer, and story use a live-text wordmark reading “ELIO / BASQUE CHEESECAKE / by TLB Kitchen,” as requested in the latest design revision. ELIO and BASQUE CHEESECAKE stay centered and prominent; the TLB Kitchen credit is deliberately tiny. Shared `.wordmark` styles use warm bronze on ivory and lighter bronze on dark backgrounds and the photographic homepage header to echo the planned packaging finish. The browser tab and Apple touch icon use optimized 64 px and 180 px copies of the supplied original circular logo, preserving its artwork, proportions, and transparency. The full-resolution original PNG is retained as their source asset.

The heading font is **Libre Caslon Display**, chosen to approximate the reference; it is not claimed to be Elio's official font. Its SIL Open Font License is included in `dist/assets/FONT-LICENSE.txt`. Body text uses the visitor's Georgia/system serif font.

Still awaiting launch configuration: actual prices, active products, flavor quantities, final photography, and opening date. Pickup, delivery, and manual-payment defaults were copied from TLB at the owner’s request and are editable in Elio’s dashboard.

The newsletter supports optional account signup consent, a public signup form, and a welcome popup. Confirmed subscribers receive a personal 5% code with a ₱500 minimum, ₱100 cap, and 14-day validity. Owners manage subscribers, compose and send branded newsletters, and review welcome-code analytics in the dashboard. See [Newsletter behavior and verification](docs/NEWSLETTER.md).

Account and My orders links open `account.html`; bag links open `order.html#your-bag`. The basket and checkout draft are retained in sessionStorage for up to 24 hours in the same tab. Final orders are stored only in Elio. TLB customer data, accounts, and credentials are never copied.

Public pages retain `noindex, nofollow` for the owner’s soft launch. Account, order, and administration pages should remain excluded from search indexes.

The ordering flow is adapted from TLB’s system for Elio’s three-piece boxes and shared flavor inventory. Each order receives a short reference such as `ELIO-K7M4P9`, suitable for courier notes. References have six random symbols, retry collisions, and can expand if needed. They grant no order access: the private token or authorized signed-in account is still required.

## Verification

Current ordering checks cover shared flavor stock, fixed recipes, custom surcharges, server date bounds, product-photo permissions, short references and access denial, pickup/delivery checkout, proof submission, manual approval, and confirmation outbox events. Browser flows use a local database and mocked platform calls; no real payments or emails were sent. The following earlier checks describe the visual prototype revisions.

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

Production groups custom boxes by the saved per-box flavor counts within each box product. Selection order does not affect grouping: Vanilla/Gorgonzola/Vanilla and Vanilla/Vanilla/Gorgonzola both mean 2 Vanilla + 1 Gorgonzola. Overall and daily tables show each combination with total and served box counts. Distinct recipes stay separate.


Monthly lineup panels let owners select flavor chips directly, then save membership and publication together. A removal reminder shows outstanding confirmed requirements. Each month keeps its own unsaved selection, and stale saves cannot overwrite another session. Flavor orderability comes from a published lineup, saved surcharge, daily stock, and shop rules; there is no separate flavor availability toggle. Production uses the same styled calendar as Daily quantities for inclusive start/end dates, including historical and cross-month reports.


The soft launch uses ₱100 placeholder prices for each of the four boxes, including the custom box base price. Flavor surcharges remain editable and apply as saved. The owner will enter daily quantities; no launch stock is assumed. Hidden products never reappear as concept cards, even when all boxes are hidden.

Uploaded flavor cover photos are shared by the shop, public collection, and admin lineup choices. The flavors page has two tabs: **This Month** shows the current and next published lineups, and **Full Collection** shows every flavor that is not individually Hidden, including flavors in either lineup. Unpublished lineup assignments stay private; they do not hide a visible flavor from the full collection. Both tabs retain saved category filters and ordering.

Daily quantities supports bulk editing every flavor in the selected lineup, with either replacement or filling only unconfigured dates. Bulk input is a draft until Save quantities is clicked; reservation conflicts prevent the entire save. Owners can configure one automatic daily total for all lineup flavors. It applies to unconfigured dates in the current and next month, including re-added flavors, and preserves manually saved zero, finite, unlimited, and disabled quantities. Existing ordered pieces count toward the total and are never removed. Hidden lineups and shop closures still block new orders. The default begins at 0 until the owner changes it.

Promo regression coverage includes percentage and fixed discounts, surcharge inclusion, delivery exclusion, minimum spend, caps, centavo rounding, verified-account eligibility, usage reservations, submission retries, expiry, payment approval/rejection, cancellations/refund labels, order amendments, deleted codes, and checkout revalidation. Run `node tests/backend/run.mjs` for the database contracts; tests use an isolated database and do not send real email.

Quantity controls share a compact rounded minus–value–plus style in the shop, basket, custom flavor selections, daily quantities, stock defaults and admin order/product editors. Whole quantities remain directly editable, and disabled states follow existing bounds and permissions. Currency fields keep their normal inputs.

The dashboard FAQs section lets verified owners edit the Shop page's heading, questions, answers and optional links; add, reorder, hide or remove entries; and publish their changes together. The public page retains its accordion layout. Hidden entries are omitted from the public API, text is rendered without executing HTML, and stale editor saves cannot overwrite newer content. Empty or unavailable FAQ responses do not restore old static questions. No FAQs are added to the homepage.
