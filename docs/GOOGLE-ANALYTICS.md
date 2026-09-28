# Google Analytics

Elio uses web stream `G-0DJM12X1FV` on `eliocheesecakes.com` and `www.eliocheesecakes.com`.

- The tag loads only after the visitor allows analytics. A browser's Do Not Track or Global Privacy Control request keeps tracking off. The preference lasts 180 days and can be changed on Privacy → Website analytics.
- Tracked pages: Home, Flavors, Box, Shop, Newsletter signup, Privacy and Terms. Local previews, accounts, admin pages, affiliate dashboards, private order links and newsletter action links are excluded.
- Page views use fixed titles and canonical URLs without queries or fragments. Referrers are reduced to their origin. No names, emails, payment details, order identifiers, account IDs or form values are added to events. Advertising features are disabled.
- Checkout stops analytics before entering the private order view. The tag never emits a purchase event; Elio's backend remains the source for paid, cancelled and refunded sales.

Keep **Enhanced measurement off** in Admin → Data streams → Elio Website. Automatic history or form events could otherwise bypass the explicitly curated page views. Google documentation: https://developers.google.com/analytics/devguides/collection/ga4/views

After publishing, open the live storefront in a fresh browser, choose Allow analytics and check Reports → Realtime in the Elio property. Standard processed reports can take longer. Declining analytics or using a blocker will exclude that visit.

## Dashboard visitor reporting

The `website-analytics` Edge Function supplies the admin visitor cards. It validates the caller with Supabase Auth and the existing service-role-only `authorize_analytics` action, which checks the current Elio staff/owner role. Customers and anonymous callers cannot read reports. No database migration is needed.

- **Visitors today:** GA4 `totalUsers` for `today` in the property's timezone, returned by Google's report metadata.
- **Active visitors · last 30 minutes:** GA4 Realtime `activeUsers`, using Google's default 30-minute window.
- Both requests have no dimensions; visitors are not added across pages or minutes, avoiding duplicate counts. Use the dedicated Elio property containing web stream `G-0DJM12X1FV`.
- The cards refresh every minute while Analytics is visible. Reports are cached for at most 60 seconds per function instance; every caller is authorized before the cache is read. The daily cache is invalidated at the property's midnight.
- Errors, restricted or withheld values display as unavailable. A valid zero remains zero. One unavailable report does not hide the other. Daily results may lag behind Realtime.
- Report responses contain aggregate counts, timezone and update time only. Google credentials and OAuth tokens stay in the Edge Function. Google access uses the read-only Analytics scope.

### One-time Google access

1. In [Google Cloud](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com), select Elio's project and enable **Google Analytics Data API**.
2. In [IAM & Admin → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), create **Elio Analytics**. A Google Cloud project role is not needed for Analytics property access. Open the service account → **Keys → Add key → Create new key → JSON**.
3. In [Google Analytics](https://analytics.google.com/), select Elio → **Admin → Property access management → Add users**. Add the service account's email with **Viewer** access; no invitation email is needed.
4. Copy Elio's numeric **Property ID** from **Admin → Property details**. This is different from the Measurement ID beginning `G-`.
5. Add these [Supabase Edge Function secrets](https://supabase.com/dashboard/project/dzxyhckkkrzqpwpavngn/functions/secrets):

| Name | Value |
| --- | --- |
| `GA_PROPERTY_ID` | Elio's numeric Property ID |
| `GA_SERVICE_ACCOUNT_JSON` | Complete contents of the downloaded JSON key file |

Do not paste the key into chat, put it in `dist`, or commit it. The function uses a fixed Google token URL; it does not follow URLs from the key file. A Measurement Protocol API secret is not a reporting credential.

Deploy `website-analytics` with its local `index.ts`, `handler.ts`, `reporting.ts` and `../_shared/http.ts`. Gateway JWT verification is disabled because the handler performs remote Auth verification followed by a database staff-role check on every request. Existing browser configuration and consent tracking remain unchanged.

### Acceptance check

Open the signed-in Kitchen dashboard → Analytics. Both cards should show numbers, the property's timezone and a received timestamp. Visit a public page in another browser after allowing analytics; compare the active count with Google's Realtime report. Keep the dashboard open for a minute and confirm the timestamp refreshes without changing its order-date filter. Daily figures can be delayed. If access fails, confirm the property, Viewer permission, enabled API and both secrets; the function deliberately does not expose Google's raw error payload.

References: [Google Analytics Data API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart), [Realtime reporting](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport), [Google service account keys](https://docs.cloud.google.com/iam/docs/keys-create-delete).

Verification: `node tests/ui/site-analytics.mjs` checks consent, clean event parameters, private routes, opt-out, blocked storage, production-only activation and the live Google tag's network payload with collection requests intercepted before transmission.

Reporting checks: `node --experimental-transform-types tests/website-analytics.test.mjs` covers signed OAuth requests, exact metrics, zero/partial/error responses, cache expiry, timezone boundaries, credential redaction and authorization. `node tests/ui/website-visitors.mjs` checks the real dashboard/client integration at 1440, 390 and 320 pixels, automatic refresh, filter/focus preservation and stopping polling after leaving Analytics; all reporting values in these tests are fixtures.
