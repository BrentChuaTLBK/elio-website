(async () => {
  'use strict';
  await window.ELIO_CONTENT_READY;
  const { flavorMetaHtml } = await import('./assets/shop/flavor-details.js');
  const { flavors, featuredOrder, productImage, boxCollections, isAvailable } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake — concept photograph" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photo coming soon</span></span>`;
  const availability = (flavor) => !isAvailable(flavor) ? '<p class="availability-label">Currently unavailable</p>' : '';
  const products = document.querySelector('#order-products');
  products.innerHTML = catalog.map((flavor) => `<article class="shop-flavor-card" data-flavor="${escape(flavor.id)}"><a href="#flavor-${escape(flavor.id)}" aria-label="View ${escape(flavor.name)} flavor details${!isAvailable(flavor) ? ' — currently unavailable' : ''}">${photo(flavor)}<h3>${escape(flavor.name)}</h3>${availability(flavor)}</a></article>`).join('');
  const dialog = document.querySelector('#order-flavor-dialog');
  const content = document.querySelector('#order-flavor-content');
  let trigger = null;
  function syncDialog() {
    const flavor = catalog.find((item) => `#flavor-${item.id}` === location.hash);
    if (location.hash === '#your-bag') (document.querySelector('#cart') || document.querySelector('#your-basket'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!flavor) {
      if (dialog.open) { dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }
      return;
    }
    content.innerHTML = `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}"><p class="eyebrow">The collection</p><h2 id="dialog-title" tabindex="-1">${escape(flavor.name)}</h2>${availability(flavor)}<p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p>${flavorMetaHtml(flavor, escape)}<p class="order-detail-availability">Browse the shop for boxes, current prices, and availability for your selected date.</p></div></div>`;
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
  window.addEventListener('hashchange', syncDialog);
  window.addEventListener('popstate', syncDialog);
  syncDialog();
})();
