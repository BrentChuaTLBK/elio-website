(() => {
  'use strict';
  const { flavors, featuredOrder, productImage } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake — concept photograph" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const availability = (flavor) => flavor.available === false ? '<p class="availability-label">Currently unavailable</p>' : '';
  const products = document.querySelector('#order-products');
  products.innerHTML = catalog.map((flavor) => `<article class="order-card" data-flavor="${escape(flavor.id)}"><a href="#flavor-${escape(flavor.id)}" aria-label="View ${escape(flavor.name)} flavor details${flavor.available === false ? ' — currently unavailable' : ''}">${photo(flavor)}<div class="product-label"><h3>${escape(flavor.name)}</h3><span class="product-arrow" aria-hidden="true">→</span></div><p class="product-line">${escape(flavor.line)}</p>${availability(flavor)}<span class="order-card-link">View flavor</span></a></article>`).join('');
  const search = document.querySelector('#flavor-search');
  function filterCatalog() {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    [...products.children].forEach((card, index) => {
      const flavor = catalog[index];
      card.hidden = !`${flavor.name} ${flavor.line} ${flavor.description}`.toLocaleLowerCase().includes(query);
      if (!card.hidden) count++;
    });
    document.querySelector('#empty-search').hidden = count > 0;
    document.querySelector('#search-status').textContent = `${count} ${count === 1 ? 'flavor' : 'flavors'} shown.`;
  }
  search.addEventListener('input', filterCatalog);
  document.querySelector('#clear-search').addEventListener('click', () => { search.value = ''; filterCatalog(); search.focus(); });
  const dialog = document.querySelector('#order-flavor-dialog');
  const content = document.querySelector('#order-flavor-content');
  let trigger = null;
  function syncFlavor() {
    const flavor = catalog.find((item) => `#flavor-${item.id}` === location.hash);
    if (!flavor) { if (dialog.open) { dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); } return; }
    content.innerHTML = `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}"><p class="eyebrow">The collection</p><h2 id="dialog-title" tabindex="-1">${escape(flavor.name)}</h2>${availability(flavor)}<p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p><p class="detail-meta">INDIVIDUAL SQUARE BASQUE CHEESECAKE<br>Three pieces per box</p><p class="order-detail-availability">Online ordering is coming soon. Box options and pricing are still to be confirmed.</p>${hasPhoto(flavor) ? '<p class="asset-note">Concept photography. Final product appearance may vary.</p>' : ''}</div></div>`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    document.querySelector('#dialog-title').focus({ preventScroll: true });
  }
  products.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    trigger = link;
    history.pushState(null, '', link.getAttribute('href'));
    syncFlavor();
  });
  function closeFlavor() { history.replaceState(null, '', `${location.pathname}${location.search}#catalog`); syncFlavor(); }
  dialog.querySelector('.dialog-close').addEventListener('click', closeFlavor);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeFlavor(); });
  dialog.addEventListener('click', (event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeFlavor(); });
  window.addEventListener('hashchange', syncFlavor);
  window.addEventListener('popstate', syncFlavor);
  syncFlavor();
})();
