(() => {
  'use strict';
  const { flavors, featuredOrder, productImage } = window.ELIO_CONTENT;
  const byId = (id) => flavors.find((flavor) => flavor.id === id);
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const photo = (flavor) => `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake with a caramelized top and soft center — concept image" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`;
  document.querySelector('#featured-products').innerHTML = featuredOrder.map((id) => {
    const flavor = byId(id);
    return `<a class="product-card" href="#flavor-${flavor.id}" aria-label="Discover ${flavor.name}: ${flavor.line}">${photo(flavor)}<div class="product-label"><h3>${flavor.name}</h3><span class="product-arrow" aria-hidden="true">→</span></div><p class="product-line">${flavor.line}</p></a>`;
  }).join('');

  const menuToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('#mobile-nav');
  function closeMenu() { menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Open navigation'); mobileNav.hidden = true; }
  menuToggle.addEventListener('click', () => {
    const opening = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(opening));
    menuToggle.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
    mobileNav.hidden = !opening;
  });
  mobileNav.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !mobileNav.hidden) { closeMenu(); menuToggle.focus(); } });
  matchMedia('(min-width: 701px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

  const dialog = document.querySelector('#detail-dialog');
  const content = document.querySelector('#dialog-content');
  let trigger = null;
  const heading = (eyebrow, title) => `<p class="eyebrow">${eyebrow}</p><h2 id="dialog-title" tabindex="-1">${title}</h2>`;
  const flavorView = (flavor) => `<div class="${(flavor.image || flavor.imagePosition) ? 'detail-layout' : ''}">${(flavor.image || flavor.imagePosition) ? photo(flavor) : ''}<div class="dialog-body${(flavor.image || flavor.imagePosition) ? '' : ' simple-dialog'}">${heading('The collection', flavor.name)}<p class="detail-line">${flavor.line}</p><p class="detail-description">${flavor.description}</p><p class="detail-meta">INDIVIDUAL SQUARE BASQUE CHEESECAKE<br>Approximately 6 × 6 × 5 cm · Three pieces per box</p><a class="text-link" href="#flavors">All seven flavors <span aria-hidden="true">→</span></a>${(flavor.image || flavor.imagePosition) ? '<p class="asset-note">Concept photography. Final product appearance may vary.</p>' : ''}</div></div>`;
  const collectionView = () => `<div class="dialog-body">${heading('The collection', 'Seven flavors.<br>Your kind of indulgence.')}<p class="dialog-intro">A deeply caramelized top. A soft, creamy center. Discover the individual square cheesecakes in the Elio collection.</p><div class="flavor-list">${flavors.map((flavor) => `<a href="#flavor-${flavor.id}"><h3>${flavor.name} <span aria-hidden="true">↗</span></h3><p class="flavor-line">${flavor.line}</p><p>${flavor.description}</p></a>`).join('')}</div></div>`;
  const boxView = () => `<div class="detail-layout"><img class="box-photo" src="assets/gifting-concept.webp" width="1400" height="1000" alt="Concept image of Elio's paper bag and three-piece cheesecake box"><div class="dialog-body">${heading('The Elio box', 'A beautiful gesture.')}<p class="detail-description">Three individual square cheesecakes, nestled in a single row inside a rich brown carton with a cream interior. A little indulgence, beautifully boxed.</p><ul class="box-details"><li>Three individual cheesecakes per box</li><li>Approximately 6 × 6 × 5 cm per cheesecake</li><li>Brown and gold Elio packaging</li></ul><a class="text-link" href="#flavors">Explore the flavors <span aria-hidden="true">→</span></a><p class="asset-note">Concept packaging image. Final photography and available box combinations are still to be confirmed.</p></div></div>`;
  const storyView = () => `<div class="dialog-body simple-dialog"><div class="wordmark story-wordmark"><span class="wordmark-name">ELIO</span><span class="wordmark-description">Basque Cheesecake</span><span class="wordmark-byline">by TLB Kitchen</span></div>${heading('Our story', 'A little about Elio.')}<p class="dialog-intro">Elio is Basque cheesecake by TLB Kitchen. Individual squares with deeply caramelized tops and soft centers, presented three to a box.</p><p class="dialog-intro">From classic Vanilla to earthy Matcha, the collection brings seven flavors to a little moment of indulgence.</p><a class="button" href="#flavors">Meet the collection</a></div>`;
  const orderView = (isBag) => `<div class="dialog-body simple-dialog"><span class="prototype-label">Website vision · Prototype</span><h2 id="dialog-title" tabindex="-1">${isBag ? 'The bag is still<br>taking shape.' : 'A first taste<br>of what’s to come.'}</h2><p class="dialog-intro">This is Elio’s first website concept. Online ordering isn’t available in this preview, and no items or orders are being saved.</p><p class="dialog-intro">For questions, get in touch with Elio.</p><div class="contact-links"><a href="mailto:elio.cheesecakes@gmail.com">elio.cheesecakes@gmail.com</a><a href="https://www.instagram.com/elio.cheesecakes/" target="_blank" rel="noopener noreferrer">@elio.cheesecakes<span class="sr-only"> (opens in a new tab)</span></a></div><a class="button" href="#flavors">Explore the collection</a></div>`;
  function getView(hash) {
    const id = hash.slice(1);
    if (id === 'flavors') return collectionView();
    if (id === 'box') return boxView();
    if (id === 'story') return storyView();
    if (id === 'ordering' || id === 'bag') return orderView(id === 'bag');
    if (id.startsWith('flavor-')) { const flavor = byId(id.slice(7)); if (flavor) return flavorView(flavor); }
    return null;
  }
  function syncRoute() {
    const view = getView(location.hash);
    if (view) {
      content.innerHTML = view;
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      document.querySelector('#dialog-title').focus({ preventScroll: true });
    } else if (dialog.open) {
      dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  }
  function closeDialog() {
    const background = history.state?.backgroundHash || '#collection';
    history.replaceState(null, '', location.pathname + location.search + background);
    syncRoute();
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const hash = link.getAttribute('href');
    if (getView(hash)) {
      event.preventDefault();
      if (!dialog.open) trigger = link.closest('#mobile-nav') ? menuToggle : link;
      const backgroundHash = dialog.open ? history.state?.backgroundHash : location.hash;
      const state = { backgroundHash: backgroundHash || '#home' };
      if (dialog.open) history.replaceState(state, '', hash); else history.pushState(state, '', hash);
      syncRoute();
    }
  });
  document.querySelector('.dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog(); });
  window.addEventListener('popstate', syncRoute);
  window.addEventListener('hashchange', syncRoute);
  syncRoute();
})();

