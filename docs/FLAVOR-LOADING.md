# Flavor collection loading

Approved proposal 05: four static cream placeholders use the existing responsive flavor-row layout while the public collection loads. Search, tabs and category controls stay disabled until their handlers and content are ready. The final list, full descriptions, filtering and photos are unchanged.

The placeholders are in HTML and do not wait for the data request or module imports. They are hidden from assistive technology; the list exposes its busy state and a separate status announces loading/completion. There is no animation or artificial delay. Initial CSS/JS references are versioned together.

Successful empty or unpublished menus show their existing messages. Request failure cannot restore old static flavors. Unexpected rendering/module failure removes partial content and exposes a reload/shop message. JavaScript-disabled browsing hides the placeholder/status region and keeps the existing fallback and shop link. Placeholder rows approximate the first screen; arbitrary catalog sizes and description lengths still determine final page height. This change does not promise zero layout shift or faster network transfer.

Validation: `tests/ui/flavor-loading.mjs` passed 14 scenarios using the real public-content loader with isolated intercepted responses: delayed success at 320/390/768/1440px, empty collection, unpublished menus, HTTP/network/malformed response/timeout/module failures, collection/flavor deep links, and JavaScript disabled. Verified control availability, clearing busy states, no stale flavors, row widths/positions, name-only search and no horizontal overflow or page errors.

`tests/ui/flavor-list.mjs` also passed at 320/390/768/1440px: both month menus, filters, keyboard tabs, full descriptions, metadata, deep links, month/year boundaries, 31-flavor collection, escaping and unavailable states. Checked Chrome on Windows; native Safari/Firefox execution was not performed. No order, stock, payment, email, backend or live data was changed.

Files: `dist/flavors.html`, `dist/flavors.css`, `dist/flavors.js`, `tests/ui/flavor-loading.mjs`. Frontend requires deployment-fork sync before live verification.
