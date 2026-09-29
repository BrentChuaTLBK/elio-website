# Receipt-upload feedback

Approved proposal 04. Preparation and upload report their actual boundaries; receipt acceptance is shown only after the server succeeds or the latest order confirms receipt. There is no artificial percentage or change to payment review/deadlines.

The form and refresh control are disabled during a request. Timer refresh cannot replace an active upload. Preparation/request failures retain the selected file and reference; retries reuse the cached converted bytes. A lost response is reconciled against the order before another upload. If submission succeeded but reading the order fails, receipt acceptance remains visible and Refresh status can recover without resubmitting.

Implementation: `dist/assets/admin/client.js`, `dist/assets/shop/{shop.js,receipt-progress.js,commerce.css}`.

Validation: `tests/ui/receipt-progress.mjs` passed eight isolated scenario groups with real PNG-to-WebP conversion and database proof registration: stage boundaries, duplicate clicks, timer expiry during upload, unsupported/corrupt input, network failure/retry, lost successful responses, failed reconciliation, accepted-upload refresh failure and server expiry. Checked 320/390/768/1440px and reduced motion; no page errors. Existing checkout regression passed signed-in pickup/delivery and guest pickup. No live orders, uploads or emails were created by these tests. Native Safari/iPhone execution was not performed.

Frontend publication requires the deployment fork to sync before live behavior can be verified.
