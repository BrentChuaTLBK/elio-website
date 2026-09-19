(() => {
  'use strict';
  const { flavors, featuredOrder, productImage } = window.ELIO_CONTENT;
  const byId = (id) => flavors.find((flavor) => flavor.id === id);
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const availability = (flavor) => flavor.available === false ? '<p class="availability-label">Currently unavailable</p>' : '';
  const photo = (flavor) => hasPhoto(flavor)
    ? `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake with a caramelized top and soft center — concept image" loading="lazy"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`
    : `<span class="product-photo product-placeholder" aria-label="${escape(flavor.name)} — photograph coming soon"><span class="placeholder-brand" aria-hidden="true">ELIO</span><span class="placeholder-name" aria-hidden="true">${escape(flavor.name)}</span><span class="placeholder-note" aria-hidden="true">Photograph coming soon</span></span>`;
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map(byId).filter(Boolean);
  const track = document.querySelector('#featured-products');
  const renderSlide = (flavor, index, copy = false) => `<article class="flavor-slide" data-flavor-index="${index}"${copy ? ' data-carousel-copy aria-hidden="true"' : ` role="group" aria-roledescription="slide" aria-label="${escape(flavor.name)}, ${index + 1} of ${catalog.length}"`}><a class="product-card" href="#flavor-${escape(flavor.id)}"${copy ? ' tabindex="-1"' : ''} aria-label="Discover ${escape(flavor.name)}: ${escape(flavor.line)}${flavor.available === false ? ' — currently unavailable' : ''}">${photo(flavor)}<div class="product-label"><h3>${escape(flavor.name)}</h3><span class="product-arrow" aria-hidden="true">→</span></div><p class="product-line">${escape(flavor.line)}</p>${availability(flavor)}</a></article>`;
  const canLoop = catalog.length > 1;
  // Copies buffer native scrolling at both ends. Only the originals enter the
  // accessibility tree and tab order; the full catalog still contains each flavor once.
  const copyCount = canLoop ? Math.ceil(3 / catalog.length) * catalog.length : 0;
  const copies = Array.from({ length: copyCount }, (_, index) => renderSlide(catalog[index % catalog.length], index % catalog.length, true)).join('');
  track.innerHTML = copies + catalog.map((flavor, index) => renderSlide(flavor, index)).join('') + copies;

  const allSlides = [...track.children];
  const slides = allSlides.filter((slide) => !slide.hasAttribute('data-carousel-copy'));
  const controls = document.querySelector('.carousel-controls');
  const [previous, next] = controls.querySelectorAll('button');
  const progress = controls.querySelector('.carousel-progress span');
  const carouselStatus = document.querySelector('#carousel-status');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let settleTimer;
  let layout;
  let navigationTarget = null;
  let touching = false;
  const wrap = (index) => ((index % catalog.length) + catalog.length) % catalog.length;
  function slidePosition(slide) {
    return slide.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft - parseFloat(getComputedStyle(track).paddingLeft);
  }
  function currentIndex() {
    return layout && canLoop ? wrap(Math.round((track.scrollLeft - layout.start) / layout.step)) : 0;
  }
  function jumpTo(left) {
    track.scrollTo({ left, behavior: 'instant' });
  }
  function normalizePosition() {
    if (!layout || !canLoop) return;
    const relative = track.scrollLeft - layout.start;
    if (relative < -1 || relative >= layout.cycle - 1) {
      const cycles = relative < -1 ? Math.floor(relative / layout.cycle) : Math.floor((relative + 1) / layout.cycle);
      const shift = cycles * layout.cycle;
      jumpTo(track.scrollLeft - shift);
      if (navigationTarget !== null) navigationTarget -= shift;
    }
  }
  function updateCarousel(announce = false) {
    controls.hidden = !canLoop;
    previous.setAttribute('aria-disabled', String(!canLoop));
    next.setAttribute('aria-disabled', String(!canLoop));
    progress.style.width = `${100 / Math.max(1, catalog.length)}%`;
    progress.style.left = `${currentIndex() / Math.max(1, catalog.length) * 100}%`;
    if (announce) {
      const viewport = track.getBoundingClientRect();
      const visible = allSlides.filter((slide) => {
        const rect = slide.getBoundingClientRect();
        return Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left) > rect.width * .6;
      });
      const names = [...new Set(visible.map((slide) => catalog[Number(slide.dataset.flavorIndex)].name))];
      carouselStatus.textContent = names.length ? `Showing ${names.join(' and ')}.` : '';
    }
  }
  function settleCarousel() {
    if (touching) return;
    normalizePosition();
    navigationTarget = null;
    updateCarousel(true);
  }
  function measureCarousel() {
    const index = currentIndex();
    const start = slides.length ? slidePosition(slides[0]) : 0;
    const step = allSlides.length > 1 ? slidePosition(allSlides[1]) - slidePosition(allSlides[0]) : track.clientWidth;
    if (layout && Math.abs(layout.step - step) < .1 && layout.width === track.clientWidth) return;
    layout = { start, step, cycle: catalog.length * step, width: track.clientWidth };
    navigationTarget = null;
    jumpTo(start + index * step);
    updateCarousel();
  }
  function goToFlavor(index, animate = true) {
    if (!layout || !catalog.length) return;
    navigationTarget = layout.start + wrap(index) * layout.step;
    track.scrollTo({ left: navigationTarget, behavior: animate && !reducedMotion.matches ? 'smooth' : 'instant' });
  }
  function moveCarousel(direction) {
    if (!canLoop || !layout) return;
    normalizePosition();
    const position = navigationTarget ?? (layout.start + Math.round((track.scrollLeft - layout.start) / layout.step) * layout.step);
    navigationTarget = position + direction * layout.step;
    // Keep rapid repeated clicks inside the scrolling buffer too.
    if (navigationTarget < layout.step || navigationTarget > track.scrollWidth - track.clientWidth - layout.step) {
      const index = wrap(Math.round((position - layout.start) / layout.step));
      jumpTo(layout.start + index * layout.step);
      navigationTarget = layout.start + (index + direction) * layout.step;
    }
    track.scrollTo({ left: navigationTarget, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
  previous.addEventListener('click', () => { if (previous.getAttribute('aria-disabled') !== 'true') moveCarousel(-1); });
  next.addEventListener('click', () => { if (next.getAttribute('aria-disabled') !== 'true') moveCarousel(1); });
  track.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    // Keep focus on the viewport when moving away from a focused product link.
    track.focus({ preventScroll: true });
    if (event.key === 'Home' || event.key === 'End') {
      goToFlavor(event.key === 'Home' ? 0 : catalog.length - 1);
    } else moveCarousel(event.key === 'ArrowRight' ? 1 : -1);
  });
  track.addEventListener('scroll', () => {
    updateCarousel();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleCarousel, 160);
  }, { passive: true });
  track.addEventListener('touchstart', () => { touching = true; navigationTarget = null; }, { passive: true });
  const endTouch = () => { touching = false; clearTimeout(settleTimer); settleTimer = setTimeout(settleCarousel, 160); };
  track.addEventListener('touchend', endTouch, { passive: true });
  track.addEventListener('touchcancel', endTouch, { passive: true });
  track.addEventListener('wheel', () => { navigationTarget = null; }, { passive: true });
  // A visible copy remains clickable, but focus must return to its original card.
  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.target.closest('[data-carousel-copy] a')) event.preventDefault();
  });
  new ResizeObserver(measureCarousel).observe(track);
  measureCarousel();

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
  const flavorView = (flavor) => `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}">${heading('The collection', flavor.name)}${availability(flavor)}<p class="detail-line">${flavor.line}</p><p class="detail-description">${flavor.description}</p><p class="detail-meta">INDIVIDUAL SQUARE BASQUE CHEESECAKE<br>Approximately 6 × 6 × 5 cm · Three pieces per box</p><a class="text-link" href="#flavors">All flavors <span aria-hidden="true">→</span></a>${hasPhoto(flavor) ? '<p class="asset-note">Concept photography. Final product appearance may vary.</p>' : ''}</div></div>`;
  const collectionView = () => `<div class="dialog-body">${heading('The collection', 'Your kind<br>of indulgence.')}<p class="dialog-intro">A deeply caramelized top. A soft, creamy center. Explore the full Elio flavor catalog and find your favorites.</p><div class="flavor-list">${catalog.map((flavor) => `<a href="#flavor-${flavor.id}"><h3>${flavor.name} <span aria-hidden="true">↗</span></h3><p class="flavor-line">${flavor.line}</p><p>${flavor.description}</p>${availability(flavor)}</a>`).join('')}</div></div>`;
  const boxView = () => `<div class="detail-layout"><img class="box-photo" src="assets/gifting-concept.webp" width="1400" height="1000" alt="Concept image of Elio's paper bag and three-piece cheesecake box"><div class="dialog-body">${heading('The Elio box', 'A beautiful gesture.')}<p class="detail-description">Three individual square cheesecakes, nestled in a single row inside a rich brown carton with a cream interior. A little indulgence, beautifully boxed.</p><ul class="box-details"><li>Three individual cheesecakes per box</li><li>Approximately 6 × 6 × 5 cm per cheesecake</li><li>Brown and gold Elio packaging</li></ul><a class="text-link" href="#flavors">Explore the flavors <span aria-hidden="true">→</span></a><p class="asset-note">Concept packaging image. Final photography and available box combinations are still to be confirmed.</p></div></div>`;
  const storyView = () => `<div class="dialog-body simple-dialog"><div class="wordmark story-wordmark"><span class="wordmark-name">ELIO</span><span class="wordmark-description">Basque Cheesecake</span><span class="wordmark-byline">by TLB Kitchen</span></div>${heading('Our story', 'A little about Elio.')}<p class="dialog-intro">Elio is Basque cheesecake by TLB Kitchen. Individual squares with deeply caramelized tops and soft centers, presented three to a box.</p><p class="dialog-intro">From classic Vanilla to earthy Matcha, the collection brings a little moment of indulgence to every preference.</p><a class="button" href="#flavors">Meet the collection</a></div>`;
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
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog(); });
  window.addEventListener('popstate', syncRoute);
  window.addEventListener('hashchange', syncRoute);
  syncRoute();
})();

