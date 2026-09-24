(async () => {
  'use strict';
  await window.ELIO_CONTENT_READY;
  const { flavorMetaHtml } = await import('./assets/shop/flavor-details.js');
  const { flavors, featuredOrder, productImage } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake — concept photograph" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" role="img" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const data = window.ELIO_CONTENT;
  const isFeatured = flavor => data.monthlyMenu.includes(flavor.id);
  const isNext = flavor => data.nextMonthlyMenu.includes(flavor.id);
  const card = flavor => `<article class="flavor-tile" data-flavor="${escape(flavor.id)}" data-category="${escape(flavor.category || '')}"><a href="#flavor-${escape(flavor.id)}" aria-label="Discover ${escape(flavor.name)}">${photo(flavor)}<div class="flavor-tile-copy"><h3>${escape(flavor.name)}</h3><p class="product-line">${escape(flavor.line)}</p><span class="flavor-tile-link"><span aria-hidden="true">+</span>Discover the flavor</span></div></a></article>`;
  const sections = [
    { root: '#monthly-menu', grid: document.querySelector('#monthly-flavors'), empty: document.querySelector('#monthly-empty'), items: catalog.filter(isFeatured), shown: data.currentMenuShown, message: 'This month’s selection is coming soon. Discover the collection below.' },
    { root: '#next-month-menu', grid: document.querySelector('#next-month-flavors'), empty: document.querySelector('#next-month-empty'), items: catalog.filter(isNext), shown: data.nextMenuShown, message: 'More flavors to look forward to. Check back soon.' },
    { root: '#other-flavors', grid: document.querySelector('#other-flavors-grid'), empty: document.querySelector('#other-empty'), items: catalog.filter(f => f.collectionOnly ?? (!isFeatured(f) && !isNext(f))), shown: true, message: 'Flavors outside the monthly lineups will appear here.' }
  ];
  sections.forEach(section => { document.querySelector(section.root).hidden = !section.shown; section.grid.innerHTML = section.items.map(card).join(''); });
  const monthName = value => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  const headings = data.flavorHeadings || {};
  document.querySelector('#monthly-title').textContent = (headings.current || 'Flavors of the Month') + (data.currentMonth ? ` — ${monthName(data.currentMonth)}` : '');
  document.querySelector('#next-month-title').textContent = (headings.next || 'Coming Next Month') + (data.nextMonth ? ` — ${monthName(data.nextMonth)}` : '');
  document.querySelector('#other-title').textContent = headings.collection || 'The full collection.';
  if (data.collectionLoaded === false) document.querySelector('.flavors-footnote').textContent = 'Monthly selections are temporarily unavailable. Please check back shortly. Visit the shop for current ordering availability.';
  const filters = document.querySelector('.flavor-filters');
  const categories=data.categories || [{id:'classic',name:'Classic'},{id:'tea',name:'Tea'},{id:'rich',name:'Rich & bold'}];
  const inCategory=(flavor,id)=>(flavor.category_ids || [flavor.category]).includes(id);
  filters.innerHTML=[{id:'all',name:'All flavors'},...categories.filter(c=>catalog.some(f=>inCategory(f,c.id)))].map(c=>`<button type="button" data-category="${escape(c.id)}" aria-pressed="false">${escape(c.name)}</button>`).join('');
  function filterCatalog(category, announce = true) {
    let total = 0;
    sections.forEach((section) => {
      let count = 0;
      const ordered=[...section.items].sort((a,b)=>category==='all' ? (a.sort_order||0)-(b.sort_order||0) : (a.category_sort_orders?.[category]||0)-(b.category_sort_orders?.[category]||0));
      ordered.forEach((flavor) => {
        const tile=[...section.grid.children].find(t=>t.dataset.flavor===flavor.id);
        section.grid.append(tile);
        tile.hidden = category !== 'all' && !inCategory(flavor,category);
        if (!tile.hidden) count++;
      });
      section.empty.hidden = count > 0;
      section.empty.textContent = section.items.length ? 'No flavors in this category here. Try another taste above.' : section.message;
      if (section.shown) total += count;
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
    content.innerHTML = `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}"><p class="eyebrow">The Elio collection</p><h2 id="dialog-title" tabindex="-1">${escape(flavor.name)}</h2><p class="flavor-menu-status">${isFeatured(flavor) ? 'Featured this month' : isNext(flavor) ? 'Coming next month' : 'The full collection'}</p><p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p>${flavorMetaHtml(flavor, escape)}<div class="flavor-dialog-links"><a class="text-link" href="order.html">Discover the Elio box <span aria-hidden="true">→</span></a></div></div></div>`;
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
  window.addEventListener('hashchange', syncFlavor);
  window.addEventListener('popstate', syncFlavor);
  syncFlavor();
})();
