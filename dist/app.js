(async () => {
  'use strict';
  if (location.hash === '#story') { location.replace('story.html'); return; }
  await window.ELIO_CONTENT_READY;
  const { flavorMetaHtml, closeFlavorOnBackdrop } = await import('./assets/shop/flavor-details.js');
  const { mountHomeBoxes } = await import('./assets/shop/home-boxes.js');
  mountHomeBoxes(window.ELIO_CONTENT);
  const { flavors, featuredOrder, productImage, isAvailable } = window.ELIO_CONTENT;
  const byId = (id) => flavors.find((flavor) => flavor.id === id);
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const availability = (flavor) => !isAvailable(flavor) ? '<p class="availability-label">Currently unavailable</p>' : '';
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake with a caramelized top and soft center — concept image" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map(byId).filter(Boolean);
  const track = document.querySelector('#featured-products');
  const renderSlide = (flavor, index, copy = false) => `<article class="flavor-slide" data-flavor-index="${index}"${copy ? ' data-carousel-copy aria-hidden="true"' : ` role="group" aria-roledescription="slide" aria-label="${escape(flavor.name)}, ${index + 1} of ${catalog.length}"`}><a class="product-card" href="#flavor-${escape(flavor.id)}"${copy ? ' tabindex="-1"' : ''} aria-label="Discover ${escape(flavor.name)}: ${escape(flavor.line)}${!isAvailable(flavor) ? ' — currently unavailable' : ''}">${photo(flavor)}<div class="product-label"><h3>${escape(flavor.name)}</h3><span class="product-arrow" aria-hidden="true">→</span></div><p class="product-line">${escape(flavor.line)}</p>${availability(flavor)}</a></article>`;
  const { mountFlavorCarousel } = await import('./assets/shop/flavor-carousel.js?v=1');
  const { slides, goToFlavor } = mountFlavorCarousel({
    track, carousel: document.querySelector('.flavor-carousel'), catalog, renderSlide,
    carouselStatus: document.querySelector('#carousel-status'),
    emptyMessage: window.ELIO_CONTENT.homeLoaded ? 'More little discoveries to come.' : 'Our flavors couldn’t load just now. Please try again shortly.',
  });

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
  matchMedia('(min-width: 1001px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

  const dialog = document.querySelector('#detail-dialog');
  const content = document.querySelector('#dialog-content');
  let trigger = null;
  const heading = (eyebrow, title) => `<p class="eyebrow">${eyebrow}</p><h2 id="dialog-title" tabindex="-1">${title}</h2>`;
  const flavorView = (flavor) => `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}">${heading('The collection', escape(flavor.name))}${availability(flavor)}<p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p>${flavorMetaHtml(flavor, escape)}<a class="text-link" href="flavors.html">All flavors <span aria-hidden="true">→</span></a></div></div>`;
  const boxView = () => `<div class="detail-layout"><img data-website-photo="home_gift_detail" class="box-photo" src="assets/gifting-concept.webp" width="1400" height="1000" alt="Concept image of Elio's paper bag and three-piece cheesecake box"><div class="dialog-body">${heading('The Elio box', 'A beautiful gesture.')}<p class="detail-description">Three individual square cheesecakes, nestled in a single row inside a rich brown carton with a cream interior. A little indulgence, beautifully boxed.</p><ul class="box-details"><li>Three individual cheesecakes per box</li><li>Approximately 6 × 6 × 5 cm per cheesecake</li><li>Brown and gold Elio packaging</li></ul><a class="text-link" href="flavors.html">Explore the flavors <span aria-hidden="true">→</span></a><p class="asset-note" data-photo-disclaimer>Concept packaging image. Final photography and available box combinations are still to be confirmed.</p></div></div>`;
  const accountView = () => `<div class="dialog-body simple-dialog service-placeholder">${heading('My account', 'Your own little<br>corner of Elio.')}<p class="dialog-intro">Create your Elio account or sign in to see your account.</p><a class="button" href="account.html">Open my account</a><div class="placeholder-links"><a class="text-link" href="#orders">My orders <span aria-hidden="true">→</span></a><a class="text-link" href="flavors.html">Explore the flavors <span aria-hidden="true">→</span></a></div></div>`;
  function getView(hash) {
    const id = hash.slice(1);
    if (id === 'box') return boxView();
    if (id === 'account') return accountView();
    if (id === 'orders') { location.assign('account.html'); return null; }
    if (id === 'bag') { location.assign('order.html#your-bag'); return null; }
    if (id.startsWith('flavor-')) { const flavor = byId(id.slice(7)); if (flavor) return flavorView(flavor); }
    return null;
  }
  function syncRoute() {
    if (location.hash === '#story') { location.replace('story.html'); return; }
    if (location.hash === '#flavors') { location.replace('flavors.html'); return; }
    if (location.hash === '#ordering') { location.replace('order.html'); return; }
    const view = getView(location.hash);
    if (view) {
      content.innerHTML = view;
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      document.querySelector('#dialog-title').focus({ preventScroll: true });
    } else if (dialog.open) {
      dialog.close();
      if (trigger?.isConnected) {
        const slide = trigger.closest('.flavor-slide');
        if (slide) goToFlavor(Number(slide.dataset.flavorIndex), false);
        trigger.focus({ preventScroll: true });
      }
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
      if (!dialog.open) {
        const copy = link.closest('[data-carousel-copy]');
        if (copy) {
          const index = Number(copy.dataset.flavorIndex);
          goToFlavor(index, false);
          trigger = slides[index].querySelector('a');
        } else trigger = link.closest('#mobile-nav') ? menuToggle : link;
      }
      const backgroundHash = dialog.open ? history.state?.backgroundHash : location.hash;
      const state = { backgroundHash: backgroundHash || '#home' };
      if (dialog.open) history.replaceState(state, '', hash); else history.pushState(state, '', hash);
      syncRoute();
    }
  });
  document.querySelector('.dialog-close').addEventListener('click', closeDialog);
  closeFlavorOnBackdrop(dialog, closeDialog, () => location.hash.startsWith('#flavor-'));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  window.addEventListener('popstate', syncRoute);
  window.addEventListener('hashchange', syncRoute);
  syncRoute();
})();
