# Elio Website — first vision

A responsive, static prototype of Elio's approved homepage concept. This is the first design step, not a live ordering service.

## Preview

Run `node server.mjs`, then open http://127.0.0.1:4173. No package installation is needed. You can also open `dist/index.html` directly in a browser. The local server binds only to this computer.

For a static host, the publish directory is `dist` and no build command is needed. All asset URLs are relative so the prototype also works under a repository subpath. There is no backend or required environment variable.

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

- Responsive homepage following the approved composition, ivory/brown/gold palette, centered typographic wordmark, and food-first imagery.
- Mobile navigation, a full flavor catalog carousel, individual flavor dialogs, gifting details, and a factual brand introduction.
- The carousel loops continuously in both directions: the first flavor follows the last. It supports native touch/trackpad scrolling, previous/next buttons, keyboard arrows and Home/End, screen-reader announcements, and reduced motion. It does not autoplay.
- Keyboard-accessible native dialogs, focus restoration, Escape to close, direct detail links, visible focus states, and reduced-motion support.
- Account and bag icons appear beside the centered wordmark. Compact navigation is used at widths up to 1000 px and includes My account, My orders, and Order online links.
- Account, order history, ordering, and bag controls open styled “Coming soon” placeholders. Sign-in, registration, and checkout buttons are disabled. No account, cart, payment, order, or customer data is collected or stored.
- A compact newsletter placeholder sits above the footer, with small copy beside the email field on desktop and a tight stack on mobile. The email input and arrow are disabled, with an explicit unavailable message. Instagram remains linked in the footer.

## Structure

| File | Purpose |
| --- | --- |
| `dist/index.html` | Semantic homepage, real copy, navigation, asset references |
| `dist/styles.css` | Responsive components and shared design tokens |
| `dist/content.js` | Structured flavor names, descriptions, and image replacement points |
| `dist/app.js` | Reusable product rendering, navigation, accessible detail views |
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
| `dist/assets/gifting-concept.webp` | Gifting image in `dist/index.html` and box detail in `dist/app.js` |

To use separate product photos, add `image: 'assets/your-photo.webp'` to the relevant flavor in `dist/content.js`. Gorgonzola, Ube, Hojicha, and Speculoos currently use clearly labeled typographic photo placeholders in the carousel; their product photography remains open.

## Growing the flavor catalog

Add a flavor object to `flavors` in `dist/content.js` with a unique `id`, `name`, `line`, and `description`. It appears automatically in the carousel, full catalog, and its own `#flavor-id` detail view. Add `image` when its photograph is ready. `featuredOrder` only controls which flavors lead; every other flavor follows automatically. Public copy uses “Explore all flavors” without a fixed count.

Set `available: false` on a flavor to show “Currently unavailable” on its card, catalog entry, and detail view. Keep the flavor in the list so visitors can still browse it. Remove the field or set it to `true` to remove that label. No flavors are marked unavailable by default. This is an editorial status for the prototype, not a connection to stock or ordering systems.

The carousel's keyboard controls, explicit navigation buttons, and status announcements draw on [W3C's carousel guidance](https://www.w3.org/WAI/tutorials/carousels/).

Hidden copies at either end make the scroll loop without a visible rewind. They do not add duplicate entries to screen readers, keyboard navigation, or the full catalog. Selecting a visible copy opens the same flavor details and restores focus to the original card. Resizing preserves the current flavor.

## Branding

The header, footer, and story use a live-text wordmark reading “ELIO / BASQUE CHEESECAKE / by TLB Kitchen,” as requested in the latest design revision. ELIO and BASQUE CHEESECAKE stay centered and prominent; the TLB Kitchen credit is deliberately tiny. Shared `.wordmark` styles use warm bronze on ivory and lighter bronze on the dark footer to echo the planned packaging finish. The browser tab and Apple touch icon use optimized 64 px and 180 px copies of the supplied original circular logo, preserving its artwork, proportions, and transparency. The full-resolution original PNG is retained as their source asset.

The heading font is **Libre Caslon Display**, chosen to approximate the reference; it is not claimed to be Elio's official font. Its SIL Open Font License is included in `dist/assets/FONT-LICENSE.txt`. Body text uses the visitor's Georgia/system serif font.

Still unconfirmed: prices, stock, box combinations/mix-and-match rules, ordering channel, checkout/payment, inventory, delivery/pickup policies, launch timing, and any longer brand history. There are no invented reviews, awards, scarcity claims, or delivery promises. The provided Instagram and email are contact links only.

The newsletter section is visual only. It has no submitting form, email capture, storage, or email-provider integration. Final signup copy and privacy/consent details need to be supplied before enabling it.

The service placeholders can be previewed directly at `#account`, `#orders`, `#ordering`, and `#bag`. Account authentication/registration, order history and tracking, a persistent shopping bag, and checkout/payments still need their actual systems and business rules. These placeholders contain no credential fields, fake customer information, sample orders, or active purchase flow.

This prototype includes `noindex, nofollow` metadata. Review that setting when an actual public launch is authorized. A public source repository is not a live business launch.

## Verification

JavaScript syntax checks passed. Chrome visual and interaction checks passed at 1440, 768, 390, and 320 px widths. No page overflow, missing images, failed asset requests, or browser runtime errors were found. Catalog navigation, product details, gifting, prototype bag, mobile menu, Escape handling, focus restoration, and direct detail links were exercised. Loop checks covered repeated forward/backward navigation, keyboard wrapping, native phone swipes across both boundaries, animated rapid clicks, resize behavior, detail/focus handling for visible copies, and the automatic inclusion of an eighth test flavor. A two-flavor catalog was also checked. Unavailable status was verified using test data only.

The desktop retains the reference's section order, with the collection revised into larger cards in a horizontal carousel. Desktop shows two full cards and a preview of the next; phone shows one card and a preview. The phone layout gives the hero copy and photograph separate space, stacks gifting content, and uses a compact menu. These checks are not a full cross-browser or production accessibility audit.

The account/order placeholders were checked at 1440, 1001, 1000, 768, 390, and 320 px, including both sides of the compact-header breakpoint. The wordmark remained centered with no overlapping controls or horizontal overflow. Direct links, navigation between placeholders, Escape/focus restoration, disabled controls, and menu reset on resize passed. No customer-data submissions or browser storage writes occurred.

Run syntax checks directly:

```sh
node --check dist/app.js
node --check dist/content.js
node --check server.mjs
```

Brand assets and supplied copy remain the property of their respective owner. No open-source license is granted for them by this repository.
