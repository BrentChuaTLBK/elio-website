# Elio newsletter

The newsletter uses Elio's own subscriber list and delivery queue. TLB Kitchen's popup, personal-code rules, and welcome-offer reporting were the reference; no TLB subscribers are copied.

## Signup and welcome offer

- Account signup has an optional, unchecked newsletter box. Explicit consent is saved with signup; verified account confirmation activates that consent and sends the welcome code without a second confirmation email. Signing in alone never subscribes someone.
- The homepage form and welcome popup send a separate confirmation link, valid for 48 hours. The recipient confirms with a button on the website. Opening the email link alone does not change subscription state.
- A new subscriber receives one unique six-character code containing both letters and numbers (without confusing 0, 1, I, or O): **5% off products, minimum ₱500, maximum ₱100, valid for 14 days after confirmation, one use**. Delivery is excluded and codes cannot stack.
- Promo redemption requires a signed-in, verified Elio account whose current email matches the subscriber. A checkout email field cannot substitute for that identity.
- Existing customers qualify when subscribing for the first time. Repeated signup or resubscription does not issue a second code or extend the original expiry. Unsubscribing stops newsletter mail while preserving an already earned offer.

## Popup

The popup appears after five seconds on public browsing pages. It waits while another dialog is open and is excluded from private order links, account recovery links, and preview mode. Dismissed visitors can see it again after 24 hours. Opted-in visitors are suppressed in the current browser; a signed-in account's subscriber record suppresses it across browsers. Backdrop clicks do not dismiss it; X and Escape do.

## Newsletter dashboard

Owners can search and filter subscribers, unsubscribe an address, compose and save newsletters, preview the branded email, send a test to one explicit address, and review a campaign before sending it to confirmed active subscribers. Draft revision and recipient count are checked again when sending. A campaign can only be queued once. Queued content is immutable, and eligibility is checked again before each delivery.

The Welcome offers report shows all-time code issuance, unused/active, reserved, redeemed, expired and inactive counts, together with paid orders, product sales and discounts. Search by subscriber email or code and filter status. Reserved means awaiting payment or review. A paid cancellation or refund does not restore a redeemed code; those orders are excluded from sales and discount totals. Product sales are subtotal minus discount, excluding delivery.

## Email delivery

Newsletter mail uses a separate private outbox, processed by the existing authenticated minute worker. Order notifications retain their own queue and delivery priority. Each newsletter stores its exact provider payload before sending, so retries keep the same message and idempotency key. Automatic retries stop before the provider's 24-hour idempotency window. Dashboard accepted counts refer to provider acceptance, not a guarantee of inbox placement.

Emails include Elio's branding, saved physical mailing address, and unsubscribe links. The website unsubscribe flow does not require an account. Mail clients can also use the one-click unsubscribe POST header. Existing transactional order/account email behavior is independent of newsletter consent. Resend applies its [account-level hard-bounce and complaint suppression](https://resend.com/changelog/suppression-list-support).

Public signup is validated, consent checked, rate limited and protected by a honeypot. Private tokens, subscriber lists, campaign drafts, and provider payloads are not readable by anonymous or customer API roles. Test and campaign preview actions verify owner access server-side.

## Verification

Run `node --experimental-transform-types tests/newsletter-edge.test.mjs` and `node --experimental-transform-types tests/email-worker.test.mjs`. The backend suite includes newsletter consent, immutable offers, redemption binding, analytics, delivery claims, and campaign approval checks. Browser checks cover popup timing/dismissal, account opt-in, token actions, and the owner dashboard without sending customer emails.

Preview the exact newsletter email renderer with `node --experimental-transform-types scripts/preview-newsletter-emails.mjs`. These files contain a sample code and inactive links.
