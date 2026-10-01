// Shared by the home and shop flavor strips so their motion and navigation stay identical.
export function mountFlavorCarousel({ track, carousel, catalog, renderSlide, carouselStatus, emptyMessage, dialogs = document.querySelectorAll('dialog') }) {
  const canLoop = catalog.length > 1;
  // Copies buffer native scrolling at both ends. Only the originals enter the
  // accessibility tree and tab order; the full catalog still contains each flavor once.
  const pageSize = 3;
  // Buffer a visible group plus a full three-card move, including small catalogs.
  const copyCount = canLoop ? Math.ceil((7 + pageSize) / catalog.length) * catalog.length : 0;
  const copies = Array.from({ length: copyCount }, (_, index) => renderSlide(catalog[index % catalog.length], index % catalog.length, true)).join('');
  track.innerHTML = copies + catalog.map((flavor, index) => renderSlide(flavor, index)).join('') + copies;
  if (!catalog.length) {
    const message = document.createElement('p');
    message.className = 'home-catalog-message';
    message.textContent = emptyMessage;
    track.replaceChildren(message);
  }

  const allSlides = [...track.querySelectorAll('.flavor-slide')];
  const slides = allSlides.filter((slide) => !slide.hasAttribute('data-carousel-copy'));
  const controls = carousel.querySelector('.carousel-controls');
  const [previous, next] = controls.querySelectorAll('button');
  const progress = controls.querySelector('.carousel-progress span');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
  const dialogObserver = new MutationObserver(syncAutoplay);
  for (const dialog of dialogs) dialogObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  new ResizeObserver(measureCarousel).observe(track);
  measureCarousel();
  return { slides, goToFlavor };
}
