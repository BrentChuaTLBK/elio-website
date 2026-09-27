# Elio newsletter

The newsletter uses Elio's own subscriber list and delivery queue. TLB Kitchen's popup, personal-code rules, and welcome-offer reporting were the reference; no TLB subscribers are copied.

## Signup and welcome offer

- Account signup has an optional, unchecked newsletter box. Explicit consent is saved with signup; verified account confirmation activates that consent and sends the welcome code without a second confirmation email. Signing in alone never subscribes someone.
- The homepage form and welcome popup subscribe consenting visitors immediately, without a separate newsletter confirmation email. The popup changes to a welcome message and stays suppressed for subscribers.
- A new subscriber receives one unique six-character code containing both letters and numbers (without confusing 0, 1, I, or O). The default offer is **5% off products, minimum ₱500, maximum ₱100, valid for 14 days after issuance, one use**. Owners can change these defaults in Promo codes for newly issued codes; existing codes retain their original terms. Delivery is excluded and codes cannot stack.
- Promo redemption requires a signed-in, verified Elio account whose current email matches the subscriber. A checkout email field cannot substitute for that identity.
- Existing customers qualify when subscribing for the first time. Repeated signup or resubscription does not issue a second code or extend the original expiry. Unsubscribing stops newsletter mail while preserving an already earned offer.

## Popup

The popup appears after five seconds on public browsing pages. It waits while another dialog is open and is excluded from private order links, account recovery links, and preview mode. Dismissed visitors can see it again after 24 hours. Opted-in visitors are suppressed in the current browser; a signed-in account's subscriber record suppresses it across browsers. Backdrop clicks do not dismiss it; X and Escape do.

## Newsletter dashboard

The owner-only library shows an active subscriber count, six template choices and saved newsletters. A separate editor provides desktop/mobile live previews, catalog photos, direct photo uploads, draft saving, and a test to one explicit address. Owners review a campaign before sending to active subscribers. Draft revision and recipient count are checked again when sending. A campaign can only be queued once. Queued content is immutable, and eligibility is checked again before each delivery.

Available designs are Flavor Spotlight, Subscriber Offer, From the Kitchen, The Elio Edit (photo and story columns), You’re Invited (a framed invitation), and Short & Sweet (numbered updates). Every layout supports optional uploaded/catalog photos and a shopping button. In Short & Sweet, a blank line starts the next update. Changing the layout preserves the draft's content. The preview iframe remains mounted during photo and save operations so concurrent preview requests cannot blank it.

The Welcome offers report under Promo codes shows all-time code issuance, unused/active, reserved, redeemed, expired and inactive counts, together with paid orders, product sales and discounts. Search by subscriber email or code and filter status. Reserved means awaiting payment or review. A paid cancellation or refund does not restore a redeemed code; those orders are excluded from sales and discount totals. Product sales are subtotal minus discount, excluding delivery.

## Email delivery

Newsletter mail uses a separate private outbox, processed by the existing authenticated minute worker. Order notifications retain their own queue and delivery priority. Each newsletter stores its exact provider payload before sending, so retries keep the same message and idempotency key. Automatic retries stop before the provider's 24-hour idempotency window. Dashboard accepted counts refer to provider acceptance, not a guarantee of inbox placement.

All newsletter messages (welcome codes, campaigns and tests) default to `Elio Newsletter <news@eliocheesecakes.com>`. The optional `NEWSLETTER_EMAIL_FROM` Edge Function setting overrides only this identity; newsletters never inherit the order `EMAIL_FROM` setting. Order notifications continue using `orders@eliocheesecakes.com`. Reply-To remains `elio.cheesecakes@gmail.com`. A sender change applies to messages that have not yet frozen their provider payload; retries preserve their original sender to prevent duplicate sends.

Emails include Elio's branding, saved physical mailing address, and unsubscribe links. The website unsubscribe flow does not require an account. Mail clients can also use the one-click unsubscribe POST header. Existing transactional order/account email behavior is independent of newsletter consent. Resend applies its [account-level hard-bounce and complaint suppression](https://resend.com/changelog/suppression-list-support).

Public signup is validated, consent checked, rate limited and protected by a honeypot. Private tokens, subscriber lists, campaign drafts, and provider payloads are not readable by anonymous or customer API roles. Test and campaign preview actions verify owner access server-side.

## Verification

Run `node --experimental-transform-types tests/newsletter-edge.test.mjs` and `node --experimental-transform-types tests/email-worker.test.mjs`. The backend suite includes newsletter consent, immutable offers, redemption binding, analytics, delivery claims, and campaign approval checks. Browser checks cover popup timing/dismissal, account opt-in, token actions, and the owner dashboard without sending customer emails.

Preview the exact newsletter email renderer with `node --experimental-transform-types scripts/preview-newsletter-emails.mjs`. These files contain a sample code and inactive links.

Compare all six campaign layouts with `node --experimental-transform-types scripts/preview-newsletter-designs.mjs <output-directory>`. The interactive gallery has desktop/mobile widths; its links are inactive and it does not send emails. The examples are design copy, not scheduled campaigns or live promotions.
