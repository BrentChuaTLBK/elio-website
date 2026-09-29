(async () => {
  'use strict';
  const shell = document.querySelector('.flavors-shell');
  const controls = () => shell.querySelectorAll('.flavors-toolbar button, .flavors-toolbar input, .flavor-filters button');
  try {
  await window.ELIO_CONTENT_READY;
  const { flavorMetaHtml } = await import('./assets/shop/flavor-details.js');
  const data = window.ELIO_CONTENT;
  const { flavors, featuredOrder, productImage } = data;
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const catalog = [...new Set([...(featuredOrder || []), ...flavors.map(flavor => flavor.id)])].map(id => flavors.find(flavor => flavor.id === id)).filter(Boolean);
  const isFeatured = flavor => data.currentMenuShown !== false && (data.monthlyMenu || []).includes(flavor.id);
  const isNext = flavor => data.nextMenuShown === true && (data.nextMonthlyMenu || []).includes(flavor.id);
  const photo = flavor => flavor.image || flavor.imagePosition !== undefined
    ? `<span class="product-photo${flavor.image ? ' single-photo' : ''}" style="--image-left:-${(parseFloat(flavor.imagePosition) || 0) * 2}%"><img src="${escape(flavor.image || productImage)}" width="${flavor.image ? 724 : 2172}" height="724" alt="${escape(flavor.name)} Basque cheesecake" loading="lazy" decoding="async"></span>`
    : `<span class="product-photo product-placeholder" role="img" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const card = (flavor, kind) => {
    const badge = kind === 'collection' ? (isFeatured(flavor) ? 'This month' : isNext(flavor) ? 'Next month' : '') : '';
    return `<article class="flavor-tile" data-flavor="${escape(flavor.id)}" tabindex="-1"><div class="flavor-tile-image">${photo(flavor)}</div><div class="flavor-tile-copy">${badge ? `<p class="flavor-month-badge">${badge}</p>` : ''}<h3>${escape(flavor.name)}</h3>${flavor.line ? `<p class="product-line">${escape(flavor.line)}</p>` : ''}${flavor.description ? `<p class="flavor-brief">${escape(flavor.description)}</p>` : ''}${flavorMetaHtml(flavor, escape)}</div></article>`;
  };
  const sections = [
    { view: 'monthly', kind: 'current', root: '#monthly-menu', grid: document.querySelector('#monthly-flavors'), empty: document.querySelector('#monthly-empty'), items: catalog.filter(isFeatured), shown: data.currentMenuShown !== false, message: 'This month’s selection is coming soon. Explore the full collection to find your favorite.' },
    { view: 'monthly', kind: 'next', root: '#next-month-menu', grid: document.querySelector('#next-month-flavors'), empty: document.querySelector('#next-month-empty'), items: catalog.filter(isNext), shown: data.nextMenuShown === true, message: 'More flavors to look forward to. Check back soon.' },
    { view: 'collection', kind: 'collection', root: '#other-flavors', grid: document.querySelector('#other-flavors-grid'), empty: document.querySelector('#other-empty'), items: catalog, shown: true, message: 'Our flavor collection is coming soon. Check back for a little discovery.' }
  ];
  const searchText = new Map(catalog.map(flavor => [flavor.id, normalize(flavor.name)]));
  sections.forEach(section => {
    const root = document.querySelector(section.root);
    root.hidden = !section.shown;
    section.grid.innerHTML = section.items.map(flavor => card(flavor, section.kind)).join('');
    section.tiles = new Map([...section.grid.children].map(tile => [tile.dataset.flavor, tile]));
    section.count = root.querySelector('[data-flavor-count]');
  });
  document.querySelector('#monthly-unavailable').hidden = sections.some(section => section.view === 'monthly' && section.shown);
  const monthName = value => {
    if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value || '')) return '';
    const date = new Date(`${value.length === 7 ? value + '-01' : value}T12:00:00Z`);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  };
  const headings = data.flavorHeadings || {};
  document.querySelector('#monthly-label').textContent = headings.current || 'This month';
  document.querySelector('#next-month-label').textContent = headings.next || 'Coming next month';
  document.querySelector('#monthly-title').textContent = monthName(data.currentMonth) || headings.current || 'Flavors of the Month';
  document.querySelector('#next-month-title').textContent = monthName(data.nextMonth) || headings.next || 'Next month’s selection';
  document.querySelector('#other-title').textContent = headings.collection || 'The full collection.';
  if (data.collectionLoaded === false) {
    const message = 'Our flavor collection is temporarily unavailable. Please check back shortly, or visit the shop for current ordering availability.';
    document.querySelector('#monthly-unavailable').textContent = message;
    sections[2].message = message;
    document.querySelector('.flavors-footnote').textContent = message;
  }
  const filters = document.querySelector('.flavor-filters');
  const categories = data.categories || [{ id: 'classic', name: 'Classic' }, { id: 'tea', name: 'Tea' }, { id: 'rich', name: 'Rich & bold' }];
  const inCategory = (flavor, id) => (flavor.category_ids || [flavor.category]).includes(id);
  filters.innerHTML = [{ id: 'all', name: 'All flavors' }, ...categories.filter(category => catalog.some(flavor => inCategory(flavor, category.id)))].map(category => `<button type="button" data-category="${escape(category.id)}" aria-pressed="false">${escape(category.name)}</button>`).join('');
  const search = document.querySelector('#flavor-search');
  let currentCategory = 'all';
  let currentView = ['#other-flavors', '#collection-panel'].includes(location.hash) ? 'collection' : 'monthly';
  function filterCatalog(category, announce = true) {
    currentCategory = category;
    const query = normalize(search.value.trim());
    const visibleFlavors = new Set();
    sections.forEach(section => {
      let count = 0;
      const ordered = [...section.items].sort((a, b) => category === 'all' ? (a.sort_order || 0) - (b.sort_order || 0) : (a.category_sort_orders?.[category] || 0) - (b.category_sort_orders?.[category] || 0));
      const fragment = document.createDocumentFragment();
      ordered.forEach(flavor => {
        const tile = section.tiles.get(flavor.id);
        tile.hidden = (category !== 'all' && !inCategory(flavor, category)) || !searchText.get(flavor.id).includes(query);
        if (!tile.hidden) { count++; if (section.shown && section.view === currentView) visibleFlavors.add(flavor.id); }
        fragment.append(tile);
      });
      section.grid.append(fragment);
      section.count.textContent = `${count} ${count === 1 ? 'flavor' : 'flavors'}`;
      section.empty.hidden = count > 0;
      section.empty.textContent = section.items.length ? 'No matching flavors here. Try another taste or search.' : section.message;
    });
    [...filters.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    const menus = sections.filter(section => section.view === 'monthly' && section.shown).length;
    const summary = `${visibleFlavors.size} ${visibleFlavors.size === 1 ? 'flavor' : 'flavors'}`;
    document.querySelector('.flavor-result-summary').textContent = currentView === 'monthly' && menus ? `${menus} ${menus === 1 ? 'menu' : 'menus'} · ${summary}` : summary;
    if (announce) document.querySelector('#filter-status').textContent = `${summary} shown in ${currentView === 'monthly' ? 'the monthly selections' : 'the full collection'}.`;
  }
  filters.addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (button) filterCatalog(button.dataset.category); });
  search.addEventListener('input', () => filterCatalog(currentCategory));
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
  // Existing home-page and shared flavor links now lead to the full inline description.
  function followFlavorLink() {
    const flavor = catalog.find(item => `#flavor-${item.id}` === location.hash);
    if (!flavor) return;
    search.value = ''; currentCategory = 'all';
    const section = sections.find(item => item.shown && item.view === 'monthly' && item.tiles.has(flavor.id)) || sections[2];
    selectView(section.view, false);
    const tile = section.tiles.get(flavor.id);
    tile.scrollIntoView({ block: 'start', behavior: 'instant' });
    tile.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', followFlavorLink);
  window.addEventListener('popstate', followFlavorLink);
  followFlavorLink();
  controls().forEach(control => { control.disabled = false; });
  document.querySelector('#filter-status').textContent = data.collectionLoaded === false
    ? 'The flavor collection is temporarily unavailable.'
    : 'Flavor collection loaded. ' + document.querySelector('.flavor-result-summary').textContent + '.';
  } catch {
    // A failed content/module load must not leave a permanent skeleton or partial catalog.
    shell.querySelectorAll('.flavors-grid').forEach(grid => grid.replaceChildren());
    shell.querySelectorAll('.flavor-section').forEach(section => { section.hidden = true; });
    document.querySelector('#monthly-panel').hidden = false;
    document.querySelector('#collection-panel').hidden = true;
    document.querySelector('#monthly-tab').setAttribute('aria-selected', 'true');
    document.querySelector('#collection-tab').setAttribute('aria-selected', 'false');
    controls().forEach(control => { control.disabled = true; });
    const message = document.querySelector('#monthly-unavailable');
    message.hidden = false;
    message.textContent = 'We couldn’t load the flavor collection. Please reload this page, or visit the shop for current ordering availability.';
    document.querySelector('#filter-status').textContent = message.textContent;
  } finally {
    shell.removeAttribute('data-loading');
    shell.querySelectorAll('[aria-busy]').forEach(element => element.removeAttribute('aria-busy'));
    shell.querySelectorAll('.flavor-skeleton').forEach(element => element.remove());
  }
})();
