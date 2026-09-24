(async () => {
  'use strict';
  await window.ELIO_CONTENT_READY;
  const { flavorMetaHtml } = await import('./assets/shop/flavor-details.js');
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
  const canLoop = catalog.length > 1;
  // Copies buffer native scrolling at both ends. Only the originals enter the
  // accessibility tree and tab order; the full catalog still contains each flavor once.
  const pageSize = 3;
  // Buffer a visible group plus a full three-card move, including small catalogs.
  const copyCount = canLoop ? Math.ceil(pageSize * 2 / catalog.length) * catalog.length : 0;
  const copies = Array.from({ length: copyCount }, (_, index) => renderSlide(catalog[index % catalog.length], index % catalog.length, true)).join('');
  track.innerHTML = copies + catalog.map((flavor, index) => renderSlide(flavor, index)).join('') + copies;

  const allSlides = [...track.children];
  const slides = allSlides.filter((slide) => !slide.hasAttribute('data-carousel-copy'));
  const controls = document.querySelector('.carousel-controls');
  const [previous, next] = controls.querySelectorAll('button');
  const progress = controls.querySelector('.carousel-progress span');
  const carouselStatus = document.querySelector('#carousel-status');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const carousel = document.querySelector('.flavor-carousel');
  const autoplaySpeed = 14; // Pixels per second, independent of refresh rate.
  const interactionDelay = 4000;
  let autoplayFrame = 0;
  let autoplayTimer;
  let autoplayPosition = 0;
  let lastFrameTime = null;
  let resumeAt = 0;
  let inView = false;
  let pageActive = true;
  let settleTimer;
  let layout;
  let navigationTarget = null;
  let touching = false;
  let touchSettling = false;
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
    if (layout && canLoop && layout.width === track.clientWidth) {
      const position = (track.scrollLeft - layout.start) / layout.step;
      layout.index = wrap(track.classList.contains('is-drifting') ? position : Math.round(position));
    }
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
    if (touching || autoplayFrame) return;
    touchSettling = false;
    normalizePosition();
    navigationTarget = null;
    updateCarousel(true);
    syncAutoplay();
  }
  function measureCarousel() {
    // A browser may adjust scrollLeft during reflow before ResizeObserver runs.
    // Preserve the last measured flavor, rather than interpreting new pixels using old widths.
    const index = layout?.index ?? 0;
    const start = slides.length ? slidePosition(slides[0]) : 0;
    const step = allSlides.length > 1 ? slidePosition(allSlides[1]) - slidePosition(allSlides[0]) : track.clientWidth;
    if (layout && Math.abs(layout.step - step) < .1 && layout.width === track.clientWidth) return;
    stopAutoplay();
    layout = { start, step, cycle: catalog.length * step, width: track.clientWidth, index };
    navigationTarget = null;
    jumpTo(start + index * step);
    updateCarousel();
    syncAutoplay();
  }
  function goToFlavor(index, animate = true) {
    if (!layout || !catalog.length) return;
    prepareManualScroll();
    navigationTarget = layout.start + wrap(index) * layout.step;
    track.scrollTo({ left: navigationTarget, behavior: animate && !reducedMotion.matches ? 'smooth' : 'instant' });
  }
  function moveCarousel(direction) {
    if (!canLoop || !layout) return;
    prepareManualScroll();
    // Resume the gentle glide as soon as arrow navigation finishes.
    resumeAt = 0;
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
  previous.addEventListener('click', () => { if (previous.getAttribute('aria-disabled') !== 'true') moveCarousel(-pageSize); });
  next.addEventListener('click', () => { if (next.getAttribute('aria-disabled') !== 'true') moveCarousel(pageSize); });
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
    if (autoplayFrame) { updateCarousel(); return; }
    // Native touch momentum can consume the buffer before the debounce runs.
    // Recenter at its outer edge, but don't interrupt button-driven animation.
    if (layout && navigationTarget === null) {
      const margin = Math.min(track.clientWidth, layout.cycle / 2);
      if (track.scrollLeft < margin || track.scrollLeft > track.scrollWidth - track.clientWidth - margin) normalizePosition();
    }
    updateCarousel();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleCarousel, 160);
  }, { passive: true });
  track.addEventListener('scrollend', () => {
    // Wait for the finger to lift and ignore the end of an interrupted arrow move.
    if (touching) return;
    if (navigationTarget !== null ? Math.abs(track.scrollLeft - navigationTarget) > 1 : !touchSettling) return;
    clearTimeout(settleTimer);
    settleCarousel();
  }, { passive: true });
  track.addEventListener('touchstart', () => {
    touching = true;
    touchSettling = true;
    prepareManualScroll();
    navigationTarget = null;
    clearTimeout(settleTimer);
    // Start each gesture in the original set, even during rapid repeat swipes.
    normalizePosition();
  }, { passive: true });
  const endTouch = () => {
    touching = false;
    // Let native momentum finish, then continue without a timed reading pause.
    resumeAt = 0;
    clearTimeout(autoplayTimer);
    normalizePosition();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleCarousel, 160);
  };
  track.addEventListener('touchend', endTouch, { passive: true });
  track.addEventListener('touchcancel', endTouch, { passive: true });
  track.addEventListener('wheel', (event) => {
    // Vertical page scrolling must not stop autoplay or snap the flavor strip.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.shiftKey && event.deltaY !== 0);
    if (event.ctrlKey || !horizontal) return;
    prepareManualScroll();
    navigationTarget = null;
    normalizePosition();
  }, { passive: true });
  // A visible copy remains clickable, but focus must return to its original card.
  track.addEventListener('pointerdown', (event) => {
    holdAutoplay();
    if (event.pointerType === 'mouse' && event.target.closest('[data-carousel-copy] a')) event.preventDefault();
  });

  function stopAutoplay() {
    cancelAnimationFrame(autoplayFrame);
    autoplayFrame = 0;
    lastFrameTime = null;
    carouselStatus.setAttribute('aria-live', 'polite');
    // Keep the fractional position while paused; restoring snap here would jump.
  }
  function canAutoplay() {
    return !reducedMotion.matches && canLoop && layout && inView && pageActive && !document.hidden && !touching && !touchSettling && navigationTarget === null && !document.querySelector('dialog[open]');
  }
  function animateCarousel(time) {
    if (!canAutoplay()) { stopAutoplay(); return; }
    const elapsed = lastFrameTime === null ? 0 : Math.min(time - lastFrameTime, 50);
    lastFrameTime = time;
    // Accumulate fractions explicitly: integer scroll rounding must not stall a slow glide.
    autoplayPosition += elapsed / 1000 * autoplaySpeed;
    autoplayPosition = layout.start + ((autoplayPosition - layout.start) % layout.cycle + layout.cycle) % layout.cycle;
    jumpTo(autoplayPosition);
    autoplayFrame = requestAnimationFrame(animateCarousel);
  }
  function syncAutoplay() {
    clearTimeout(autoplayTimer);
    if (!canAutoplay()) { stopAutoplay(); return; }
    const delay = resumeAt - performance.now();
    if (delay > 0) {
      stopAutoplay();
      autoplayTimer = setTimeout(syncAutoplay, delay);
      return;
    }
    if (autoplayFrame) return;
    clearTimeout(settleTimer);
    track.classList.add('is-drifting');
    autoplayPosition = track.scrollLeft;
    carouselStatus.textContent = '';
    carouselStatus.setAttribute('aria-live', 'off');
    autoplayFrame = requestAnimationFrame(animateCarousel);
  }
  function holdAutoplay() {
    resumeAt = performance.now() + interactionDelay;
    stopAutoplay();
    syncAutoplay();
  }
  function prepareManualScroll() {
    holdAutoplay();
    track.classList.remove('is-drifting');
  }
  carousel.addEventListener('focusin', holdAutoplay);
  reducedMotion.addEventListener('change', syncAutoplay);
  document.addEventListener('visibilitychange', syncAutoplay);
  window.addEventListener('pagehide', () => { pageActive = false; clearTimeout(autoplayTimer); stopAutoplay(); });
  window.addEventListener('pageshow', () => { pageActive = true; syncAutoplay(); });
  new IntersectionObserver(([entry]) => {
    const visible = entry.isIntersecting && entry.intersectionRatio >= .35;
    inView = visible;
    syncAutoplay();
  }, { threshold: [0, .35] }).observe(carousel);
  new MutationObserver(syncAutoplay).observe(document.querySelector('#detail-dialog'), { attributes: true, attributeFilter: ['open'] });
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
  matchMedia('(min-width: 1001px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

  const dialog = document.querySelector('#detail-dialog');
  const content = document.querySelector('#dialog-content');
  let trigger = null;
  const heading = (eyebrow, title) => `<p class="eyebrow">${eyebrow}</p><h2 id="dialog-title" tabindex="-1">${title}</h2>`;
  const flavorView = (flavor) => `<div class="${hasPhoto(flavor) ? 'detail-layout' : ''}">${hasPhoto(flavor) ? photo(flavor) : ''}<div class="dialog-body${hasPhoto(flavor) ? '' : ' simple-dialog'}">${heading('The collection', escape(flavor.name))}${availability(flavor)}<p class="detail-line">${escape(flavor.line)}</p><p class="detail-description">${escape(flavor.description)}</p>${flavorMetaHtml(flavor, escape)}<a class="text-link" href="flavors.html">All flavors <span aria-hidden="true">→</span></a></div></div>`;
  const boxView = () => `<div class="detail-layout"><img class="box-photo" src="assets/gifting-concept.webp" width="1400" height="1000" alt="Concept image of Elio's paper bag and three-piece cheesecake box"><div class="dialog-body">${heading('The Elio box', 'A beautiful gesture.')}<p class="detail-description">Three individual square cheesecakes, nestled in a single row inside a rich brown carton with a cream interior. A little indulgence, beautifully boxed.</p><ul class="box-details"><li>Three individual cheesecakes per box</li><li>Approximately 6 × 6 × 5 cm per cheesecake</li><li>Brown and gold Elio packaging</li></ul><a class="text-link" href="flavors.html">Explore the flavors <span aria-hidden="true">→</span></a><p class="asset-note">Concept packaging image. Final photography and available box combinations are still to be confirmed.</p></div></div>`;
  const storyView = () => `<div class="dialog-body simple-dialog"><div class="wordmark story-wordmark"><span class="wordmark-name">ELIO</span><span class="wordmark-description">Basque Cheesecake</span><span class="wordmark-byline">by TLB Kitchen</span></div>${heading('Our story', 'A little about Elio.')}<p class="dialog-intro">Elio is Basque cheesecake by TLB Kitchen. Individual squares with deeply caramelized tops and soft centers, presented three to a box.</p><p class="dialog-intro">From classic Vanilla to earthy Matcha, the collection brings a little moment of indulgence to every preference.</p><a class="button" href="flavors.html">Meet the collection</a></div>`;
  const accountView = () => `<div class="dialog-body simple-dialog service-placeholder">${heading('My account', 'Your own little<br>corner of Elio.')}<p class="dialog-intro">Create your Elio account or sign in to see your account.</p><a class="button" href="account.html">Open my account</a><div class="placeholder-links"><a class="text-link" href="#orders">My orders <span aria-hidden="true">→</span></a><a class="text-link" href="flavors.html">Explore the flavors <span aria-hidden="true">→</span></a></div></div>`;
  function getView(hash) {
    const id = hash.slice(1);
    if (id === 'box') return boxView();
    if (id === 'story') return storyView();
    if (id === 'account') return accountView();
    if (id === 'orders') { location.assign('account.html'); return null; }
    if (id === 'bag') { location.assign('order.html#your-bag'); return null; }
    if (id.startsWith('flavor-')) { const flavor = byId(id.slice(7)); if (flavor) return flavorView(flavor); }
    return null;
  }
  function syncRoute() {
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
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  window.addEventListener('popstate', syncRoute);
  window.addEventListener('hashchange', syncRoute);
  syncRoute();
})();
