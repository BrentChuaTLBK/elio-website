// Run in the head before customer data can render. Private links share public
// HTML, but their order/authentication fragments must never become search pages.
(() => {
  'use strict';
  const publicParameters = new Set(['product', 'collection', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term']);
  let privateVisit = false;
  function protectPrivateVisit(force = false) {
    const url = new URL(location.href);
    privateVisit ||= force || [...url.searchParams.keys()].some(key => !publicParameters.has(key)) || (url.hash !== '' && !/^#[a-z][a-z0-9-]*$/i.test(url.hash));
    if (!privateVisit) return;
    const robots = document.querySelector('meta[name="robots"]') || document.head.appendChild(document.createElement('meta'));
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
  }
  protectPrivateVisit();
  addEventListener('hashchange', () => protectPrivateVisit());
  addEventListener('popstate', () => protectPrivateVisit());
  addEventListener('elio-private-order', () => protectPrivateVisit(true));
})();
