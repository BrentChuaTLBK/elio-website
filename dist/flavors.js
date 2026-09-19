(() => {
  'use strict';
  const { flavors, featuredOrder, productImage, isAvailable } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake — concept photograph" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" role="img" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const availability = (flavor) => isAvailable(flavor) ? '' : '<p class="availability-label">Currently unavailable</p>';
  const card = (flavor) => `<article class="flavor-tile" data-flavor="${escape(flavor.id)}" data-category="${escape(flavor.category || '')}"><a href="#flavor-${escape(flavor.id)}" aria-label="Discover ${escape(flavor.name)}${isAvailable(flavor) ? '' : ' — currently unavailable'}">${photo(flavor)}<div class="flavor-tile-copy"><h3>${escape(flavor.name)}</h3><p class="product-line">${escape(flavor.line)}</p>${availability(flavor)}<span class="flavor-tile-link"><span aria-hidden="true">+</span>Discover the flavor</span></div></a></article>`;
  const sections = [
    { grid: document.querySelector('#monthly-flavors'), empty: document.querySelector('#monthly-empty'), items: catalog.filter(isAvailable), message: 'This month’s menu is coming soon. Discover the collection below.' },
    { grid: document.querySelector('#other-flavors-grid'), empty: document.querySelector('#other-empty'), items: catalog.filter((flavor) => !isAvailable(flavor)), message: 'Every flavor in the collection is on this month’s menu. There’s more to look forward to.' }
  ];
  sections.forEach((section) => { section.grid.innerHTML = section.items.map(card).join(''); });
  document.querySelector('#other-flavors .flavor-section-heading > p').hidden = !sections[1].items.length;
  const filters = document.querySelector('.flavor-filters');
  function filterCatalog(category, announce = true) {
    let total = 0;
    sections.forEach((section) => {
      let count = 0;
      [...section.grid.children].forEach((tile) => {
        tile.hidden = category !== 'all' && tile.dataset.category !== category;
        if (!tile.hidden) count++;
      });
      section.empty.hidden = count > 0;
      section.empty.textContent = section.items.length ? 'No flavors in this category here. Try another taste above.' : section.message;
      total += count;
    });
    [...filters.children].forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    if (announce) document.querySelector('#filter-status').textContent = `${total} ${total === 1 ? 'flavor' : 'flavors'} shown.`;
  }
  filters.addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (button) filterCatalog(button.dataset.category); });
  filterCatalog('all', false);

  const dialog = document.querySelector('#flavor-dialog');
  const content = document.querySelector('#flavor-dialog-content');
  let trigger = null;
  function syncFlavor() {
    const flavor = catalog.find((item) => `#flavor-${item.id}` === location.hash);
    if (!flavor) {
      if (dialog.open) {
        dialog.close();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      }
      return;
    }
    content.innerHTML = `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}"><p class="eyebrow">The Elio collection</p><h2 id="dialog-title" tabindex="-1">${escape(flavor.name)}</h2><p class="flavor-menu-status">${isAvailable(flavor) ? 'On this month’s menu' : 'Currently unavailable · Outside the monthly menu'}</p><p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p><p class="detail-meta">INDIVIDUAL SQUARE BASQUE CHEESECAKE<br>Approximately 6 × 6 × 5 cm · Three pieces per box</p><div class="flavor-dialog-links"><a class="text-link" href="box.html">Discover the Elio box <span aria-hidden="true">→</span></a></div><p class="asset-note">${hasPhoto(flavor) ? 'Concept photography. Final product appearance may vary.' : 'Product photograph coming soon.'}<br>Online ordering is coming soon.</p></div></div>`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    document.querySelector('#dialog-title').focus({ preventScroll: true });
  }
  document.querySelector('.flavors-shell').addEventListener('click', (event) => {
    const link = event.target.closest('.flavor-tile a');
    if (!link || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    trigger = link;
    history.pushState({ backgroundHash: `#${link.closest('.flavor-section').id}` }, '', link.getAttribute('href'));
    syncFlavor();
  });
  function closeFlavor() {
    history.replaceState(null, '', `${location.pathname}${location.search}${history.state?.backgroundHash || '#monthly-menu'}`);
    syncFlavor();
  }
  dialog.querySelector('.dialog-close').addEventListener('click', closeFlavor);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeFlavor(); });
  dialog.addEventListener('click', (event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeFlavor(); });
  window.addEventListener('hashchange', syncFlavor);
  window.addEventListener('popstate', syncFlavor);
  syncFlavor();
})();
