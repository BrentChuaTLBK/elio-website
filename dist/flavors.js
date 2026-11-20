(async () => {
  'use strict';
  const shell = document.querySelector('.flavors-shell');
  const controls = () => shell.querySelectorAll('.flavors-toolbar button, .flavors-toolbar input, .flavor-filters button');
  try {
  await window.ELIO_CONTENT_READY;
  const {responsiveImage}=await import('./assets/responsive-images.js');
  const { flavorMetaHtml, closeFlavorOnBackdrop } = await import('./assets/shop/flavor-details.js');
  const { createFlavorDialog, flavorPortrait } = await import('./assets/shop/flavor-dialog.js');
  const data = window.ELIO_CONTENT;
  const { flavors, featuredOrder, productImage } = data;
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const catalog = [...new Set([...(featuredOrder || []), ...flavors.map(flavor => flavor.id)])].map(id => flavors.find(flavor => flavor.id === id)).filter(Boolean);
  const isFeatured = flavor => data.currentMenuShown !== false && (data.monthlyMenu || []).includes(flavor.id);
  const isNext = flavor => data.nextMenuShown === true && (data.nextMonthlyMenu || []).includes(flavor.id);
  const photo = flavor => flavor.image || flavor.imagePosition !== undefined
    ? `<span class="product-photo${flavor.image ? ' single-photo' : ''}" style="--image-left:-${(parseFloat(flavor.imagePosition) || 0) * 2}%"><img ${flavor.image?responsiveImage(flavor.image,'(max-width:600px) 88px, 116px'):''} src="${escape(flavor.image || productImage)}" width="${flavor.image ? 724 : 2172}" height="724" alt="${escape(flavor.name)} Basque cheesecake" loading="lazy" decoding="async"></span>`
    : `<span class="product-photo product-placeholder" role="img" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const card = (flavor, kind) => {
    const name = escape(flavor.name), id = escape(flavor.id);
    const link = `href="#flavor-${id}" data-flavor="${id}" aria-haspopup="dialog" aria-label="View ${name} flavor details"`;
    if (kind === 'collection') {
      return `<a class="flavor-tile flavor-collection-tile" ${link}>${flavorPortrait(flavor, productImage, '(max-width: 620px) 110px, 144px')}<h3>${name}</h3></a>`;
    }
    return `<a class="flavor-tile" ${link}><div class="flavor-tile-image">${photo(flavor)}</div><div class="flavor-tile-copy"><h3>${name}</h3>${flavor.line ? `<p class="product-line">${escape(flavor.line)}</p>` : ''}${flavor.description ? `<p class="flavor-brief">${escape(flavor.description)}</p>` : ''}${flavorMetaHtml(flavor, escape)}</div></a>`;
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
  const browseKey='elio-flavor-browse-v1';
  if(!location.hash)try{const saved=JSON.parse(sessionStorage.getItem(browseKey)||'null');if(saved&&Number.isFinite(saved.at)&&Date.now()>=saved.at&&Date.now()-saved.at<86400000){currentView=['monthly','collection'].includes(saved.view)?saved.view:'monthly';currentCategory=categories.some(c=>c.id===saved.category)?saved.category:'all';search.value=typeof saved.query==='string'?saved.query.slice(0,250):'';}}catch{}
  function saveBrowse(){try{sessionStorage.setItem(browseKey,JSON.stringify({at:Date.now(),view:currentView,category:currentCategory,query:search.value.slice(0,250)}));}catch{}}
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
    if(announce)saveBrowse();
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
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && typeof Element.prototype.animate === 'function') {
    const observer = new IntersectionObserver(entries => {
      let index = 0;
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        observer.unobserve(target);
        if (reduced.matches || target.matches(':focus') || document.querySelector('dialog[open]')) continue;
        target.animate([{ opacity: .55, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 440, delay: Math.min(index++, 3) * 45, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards'
        });
      }
    }, { threshold: .1 });
    for (const tile of sections[2].tiles.values()) observer.observe(tile);
    reduced.addEventListener?.('change', () => {
      if (reduced.matches) for (const tile of sections[2].tiles.values()) tile.getAnimations().forEach(animation => animation.finish());
    });
  }

  const dialog = document.querySelector('#flavor-dialog');
  const viewer = createFlavorDialog(dialog, document.querySelector('#flavor-dialog-content'), {
    productImage,
    status: flavor => data.isAvailable?.(flavor) === false ? 'Currently unavailable' : isFeatured(flavor) ? 'This month' : isNext(flavor) ? 'Next month' : ''
  });
  let trigger = null;
  let closingHistory = false;
  function syncFlavorLink() {
    closingHistory = false;
    const flavor = catalog.find(item => `#flavor-${item.id}` === location.hash);
    if (!flavor) {
      if (dialog.open) viewer.close(() => {
        trigger?.focus({ preventScroll: true });
        trigger = null;
      });
      return;
    }
    const sectionKind = history.state?.elioFlavorSection;
    const chosen = sectionKind && sections.find(section => section.kind === sectionKind && section.shown);
    if (trigger?.dataset.flavor === flavor.id && trigger.getClientRects().length) {
      viewer.open(flavor, trigger.querySelector('.product-photo'));
      return;
    }
    const section = chosen || sections.find(item => item.shown && item.view === 'monthly' && item.tiles.has(flavor.id)) || sections[2];
    trigger = section.tiles.get(flavor.id) || sections[2].tiles.get(flavor.id);
    if (!chosen || trigger.hidden) { search.value = ''; currentCategory = 'all'; }
    selectView(section.view, false);
    trigger.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    saveBrowse();
    viewer.open(flavor);
  }
  shell.addEventListener('click', event => {
    const tile = event.target.closest('a.flavor-tile');
    if (!tile || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    trigger = tile;
    tile.getAnimations?.().forEach(animation => animation.finish());
    const section = sections.find(item => item.grid.contains(tile));
    history.pushState({ elioFlavorSection: section.kind }, '', tile.hash);
    syncFlavorLink();
  });
  function closeDetails() {
    if (closingHistory || !location.hash.startsWith('#flavor-')) return;
    if (history.state?.elioFlavorSection) {
      closingHistory = true;
      history.back();
    } else {
      history.replaceState(history.state, '', location.pathname + location.search + (currentView === 'collection' ? '#collection-panel' : '#monthly-panel'));
      syncFlavorLink();
    }
  }
  dialog.querySelector('.dialog-close').addEventListener('click', closeDetails);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetails(); });
  closeFlavorOnBackdrop(dialog, closeDetails);
  window.addEventListener('hashchange', syncFlavorLink);
  window.addEventListener('popstate', syncFlavorLink);
  syncFlavorLink();
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
