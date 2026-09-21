(() => {
  'use strict';
  const { flavors, featuredOrder, productImage, boxCollections, isAvailable } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake — concept photograph" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photo coming soon</span></span>`;
  const availability = (flavor) => !isAvailable(flavor) ? '<p class="availability-label">Currently unavailable</p>' : '';
  document.querySelector('#shop-boxes').innerHTML = boxCollections.map((box) => {
    const selected = box.flavors.map((id) => flavors.find((flavor) => flavor.id === id));
    const unavailable = selected.some((flavor) => !flavor || !isAvailable(flavor));
    const names = selected.filter(Boolean).map((flavor) => flavor.name).join(' · ');
    return `<article class="shop-box-card"><a href="box.html?collection=${escape(box.id)}" aria-label="${box.customizable ? 'Customize your box' : `Explore ${escape(box.name)}`}"><span class="shop-box-photo"><img src="${escape(box.image)}" width="1440" height="960" alt="${box.customizable ? 'An open Elio box with three empty compartments' : `${escape(box.name)} with three square cheesecakes: ${escape(names)}`} — concept photograph" loading="lazy"></span><div class="shop-box-copy"><h3>${escape(box.name)}</h3><p class="shop-box-flavors">${names || 'Choose your three favorites'}</p>${unavailable ? '<p class="availability-label">Some flavors are outside this month’s menu</p>' : ''}<div class="shop-box-bottom"><span class="shop-price-note">Pricing coming soon</span><span class="button">${box.customizable ? 'Customize your box' : 'Explore this box'} <span aria-hidden="true">→</span></span></div></div></a></article>`;
  }).join('');
  const products = document.querySelector('#order-products');
  products.innerHTML = catalog.map((flavor) => `<article class="shop-flavor-card" data-flavor="${escape(flavor.id)}"><a href="#flavor-${escape(flavor.id)}" aria-label="View ${escape(flavor.name)} flavor details${!isAvailable(flavor) ? ' — currently unavailable' : ''}">${photo(flavor)}<h3>${escape(flavor.name)}</h3>${availability(flavor)}</a></article>`).join('');
  const dialog = document.querySelector('#order-flavor-dialog');
  const content = document.querySelector('#order-flavor-content');
  let trigger = null;
  function syncDialog() {
    const flavor = catalog.find((item) => `#flavor-${item.id}` === location.hash);
    const isBag = location.hash === '#your-bag';
    if (!flavor && !isBag) {
      if (dialog.open) { dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }
      return;
    }
    content.innerHTML = isBag
      ? '<div class="dialog-body simple-dialog shop-bag-dialog"><p class="eyebrow">A little room for something sweet</p><h2 id="dialog-title" tabindex="-1">Your bag</h2><p>Our online shop is coming soon.</p><p class="shop-bag-note">For now, explore our boxes and try choosing your flavors, date, and pickup or delivery preference. Your selections don’t reserve a box or place an order.</p><button class="button" type="button" disabled>Checkout · Coming soon</button></div>'
      : `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}"><p class="eyebrow">The collection</p><h2 id="dialog-title" tabindex="-1">${escape(flavor.name)}</h2>${availability(flavor)}<p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p><p class="detail-meta">INDIVIDUAL SQUARE BASQUE CHEESECAKE<br>Three pieces per box</p><p class="order-detail-availability">Online ordering is coming soon. Box options and pricing are still to be confirmed.</p>${hasPhoto(flavor) ? '<p class="asset-note">Concept photography. Final product appearance may vary.</p>' : ''}</div></div>`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    document.querySelector('#dialog-title').focus({ preventScroll: true });
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#flavor-"],a[href="#your-bag"]');
    if (!link || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    trigger = link;
    history.pushState(null, '', link.getAttribute('href'));
    syncDialog();
  });
  function closeDialog() { history.replaceState(null, '', `${location.pathname}${location.search}${location.hash === '#your-bag' ? '' : '#catalog'}`); syncDialog(); }
  dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog(); });
  window.addEventListener('hashchange', syncDialog);
  window.addEventListener('popstate', syncDialog);
  syncDialog();
})();
