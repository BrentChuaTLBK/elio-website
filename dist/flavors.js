(async () => {
  'use strict';
  await window.ELIO_CONTENT_READY;
  const { flavorMetaHtml } = await import('./assets/shop/flavor-details.js');
  const { flavors, featuredOrder, productImage } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" role="img" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const data = window.ELIO_CONTENT;
  const isFeatured = flavor => data.currentMenuShown !== false && (data.monthlyMenu || []).includes(flavor.id);
  const isNext = flavor => data.nextMenuShown === true && (data.nextMonthlyMenu || []).includes(flavor.id);
  const card = (flavor, section) => {
    const badge = section === 'next' ? 'Next month' : isFeatured(flavor) ? 'This month' : isNext(flavor) ? 'Next month' : '';
    return `<article class="flavor-tile" data-flavor="${escape(flavor.id)}"><a href="#flavor-${escape(flavor.id)}" aria-label="Discover ${escape(flavor.name)}"><div class="flavor-tile-image">${photo(flavor)}${badge ? `<span class="flavor-month-badge">${badge}</span>` : ''}</div><div class="flavor-tile-copy"><h3>${escape(flavor.name)}</h3><p class="product-line">${escape(flavor.line || '')}</p><p class="flavor-brief">${escape(flavor.description || '')}</p><span class="flavor-tile-link">Discover flavor <span aria-hidden="true">→</span></span></div></a></article>`;
  };
  const sections = [
    { view: 'monthly', kind: 'current', root: '#monthly-menu', grid: document.querySelector('#monthly-flavors'), empty: document.querySelector('#monthly-empty'), items: catalog.filter(isFeatured), shown: data.currentMenuShown !== false, message: 'This month’s selection is coming soon. Explore the full collection to find your favorite.' },
    { view: 'monthly', kind: 'next', root: '#next-month-menu', grid: document.querySelector('#next-month-flavors'), empty: document.querySelector('#next-month-empty'), items: catalog.filter(isNext), shown: data.nextMenuShown === true, message: 'More flavors to look forward to. Check back soon.' },
    { view: 'collection', kind: 'collection', root: '#other-flavors', grid: document.querySelector('#other-flavors-grid'), empty: document.querySelector('#other-empty'), items: catalog, shown: true, message: 'Our flavor collection is coming soon. Check back for a little discovery.' }
  ];
  sections.forEach(section => { document.querySelector(section.root).hidden = !section.shown; section.grid.innerHTML = section.items.map(flavor => card(flavor, section.kind)).join(''); });
  document.querySelector('#monthly-unavailable').hidden = sections.some(section => section.view === 'monthly' && section.shown);
  const monthName = value => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  const headings = data.flavorHeadings || {};
  document.querySelector('#monthly-title').textContent = (headings.current || 'Flavors of the Month') + (data.currentMonth ? ` — ${monthName(data.currentMonth)}` : '');
  document.querySelector('#next-month-title').textContent = (headings.next || 'Coming Next Month') + (data.nextMonth ? ` — ${monthName(data.nextMonth)}` : '');
  document.querySelector('#other-title').textContent = headings.collection || 'The full collection.';
  if (data.collectionLoaded === false) {
    const message = 'Our flavor collection is temporarily unavailable. Please check back shortly, or visit the shop for current ordering availability.';
    document.querySelector('#monthly-unavailable').textContent = message;
    sections[2].message = message;
    document.querySelector('.flavors-footnote').textContent = message;
  }
  const filters = document.querySelector('.flavor-filters');
  const categories=data.categories || [{id:'classic',name:'Classic'},{id:'tea',name:'Tea'},{id:'rich',name:'Rich & bold'}];
  const inCategory=(flavor,id)=>(flavor.category_ids || [flavor.category]).includes(id);
  filters.innerHTML=[{id:'all',name:'All flavors'},...categories.filter(c=>catalog.some(f=>inCategory(f,c.id)))].map(c=>`<button type="button" data-category="${escape(c.id)}" aria-pressed="false">${escape(c.name)}</button>`).join('');
  let currentCategory = 'all';
  let currentView = location.hash === '#other-flavors' || location.hash === '#collection-panel' ? 'collection' : 'monthly';
  const boxInvitation = document.querySelector('.flavors-box');
  function filterCatalog(category, announce = true) {
    currentCategory = category;
    const visibleFlavors = new Set();
    sections.forEach((section) => {
      let count = 0;
      const ordered=[...section.items].sort((a,b)=>category==='all' ? (a.sort_order||0)-(b.sort_order||0) : (a.category_sort_orders?.[category]||0)-(b.category_sort_orders?.[category]||0));
      ordered.forEach((flavor) => {
        const tile=[...section.grid.children].find(t=>t.dataset.flavor===flavor.id);
        section.grid.append(tile);
        tile.hidden = category !== 'all' && !inCategory(flavor,category);
        if (!tile.hidden) { count++; if (section.shown && section.view === currentView) visibleFlavors.add(flavor.id); }
      });
      section.empty.hidden = count > 0;
      section.empty.textContent = section.items.length ? 'No flavors in this category here. Try another taste above.' : section.message;
    });
    [...filters.children].forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    if (currentView === 'collection' && visibleFlavors.size % 3 === 1) sections[2].grid.append(boxInvitation);
    else document.querySelector('.flavors-shell').insertBefore(boxInvitation, document.querySelector('.flavors-footnote'));
    if (announce) document.querySelector('#filter-status').textContent = `${visibleFlavors.size} ${visibleFlavors.size === 1 ? 'flavor' : 'flavors'} shown in ${currentView === 'monthly' ? 'the monthly selections' : 'the full collection'}.`;
  }
  filters.addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (button) filterCatalog(button.dataset.category); });
  const tabs = [...document.querySelectorAll('.flavor-tabs [role="tab"]')];
  function selectView(view, announce = true) {
    currentView = view;
    tabs.forEach(tab => { const selected = tab.dataset.view === view; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected; });
    filterCatalog(currentCategory, announce);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectView(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
      if (next === null) return;
      event.preventDefault(); selectView(tabs[next].dataset.view); tabs[next].focus();
    });
  });
  selectView(currentView, false);

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
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); });
  window.addEventListener('hashchange', syncFlavor);
  window.addEventListener('popstate', syncFlavor);
  syncFlavor();
})();
