const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const imageUrl = box => (box.photos || [box.image]).find(url => typeof url === 'string' && /^(https?:\/\/|assets\/)/.test(url));
const money = cents => new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(Number(cents) / 100);

// The box selection is deliberately manual. Only the separate flavor strip drifts.
export function mountHomeBoxes(content) {
  const region = document.querySelector('#home-boxes');
  const viewport = region.querySelector('[data-box-viewport]');
  const controls = region.querySelector('[data-box-controls]');
  const status = region.querySelector('[data-box-status]');
  const boxes = content.homeBoxes || [];
  const mobile = matchMedia('(max-width:700px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
  let first = 0, target = 0, direction = 1, pageSize = mobile.matches ? 1 : 3;
  let transition = null;
  const wrap = index => (index % boxes.length + boxes.length) % boxes.length;
  const visibleBoxes = () => Array.from({length:Math.min(pageSize, boxes.length)}, (_, offset) => boxes[wrap(first + offset)]);
  const card = box => {
    const href = `order.html?product=${encodeURIComponent(box.id)}`;
    const image = imageUrl(box);
    return `<article class="home-box-card" data-home-box="${escape(box.id)}"><a class="home-box-photo" href="${href}" tabindex="-1" aria-hidden="true">${image ? `<img src="${escape(image)}" alt="" width="1440" height="960" loading="lazy">` : '<span class="home-box-placeholder">ELIO</span>'}</a><h3><a href="${href}">${escape(box.name)}</a></h3><p class="home-box-description">${escape(box.description ?? box.line)}</p>${Number.isFinite(box.price_cents) ? `<p class="home-box-price">${money(box.price_cents)}</p>` : ''}<a class="button" href="${href}" aria-label="View ${escape(box.name)}">View box</a></article>`;
  };
  function makePage() {
    const page = document.createElement('div');
    page.className = 'home-box-page';
    page.innerHTML = visibleBoxes().map(card).join('');
    return page;
  }
  function updateControls(announce = false) {
    controls.hidden = boxes.length <= pageSize;
    for (const button of controls.querySelectorAll('button')) button.setAttribute('aria-label', `${button.dataset.boxMove === '1' ? 'Next' : 'Previous'} ${pageSize === 1 ? 'box' : 'boxes'}`);
    const positions = visibleBoxes().map((_, offset) => wrap(first + offset) + 1);
    const range = positions.length === 1 ? positions[0] : first + positions.length > boxes.length ? positions.join(', ') : `${positions[0]}–${positions.at(-1)}`;
    const message = boxes.length ? `${range} of ${boxes.length} boxes` : '';
    region.querySelector('[data-box-position]').textContent = message;
    if (announce) status.textContent = message + '. ' + visibleBoxes().map(box => box.name).join(', ') + '.';
  }
  function cancelTransition() {
    const previous = transition;
    transition = null;
    previous?.animations.forEach(animation => animation.cancel());
    viewport.removeAttribute('aria-busy');
  }
  function render(announce = false) {
    cancelTransition();
    viewport.replaceChildren(makePage());
    updateControls(announce);
  }
  function slide() {
    if (transition || first === target) return;
    const outgoing = viewport.querySelector('.home-box-page');
    if (outgoing?.contains(document.activeElement)) viewport.focus({preventScroll:true});
    first = target;
    if (reducedMotion.matches || !outgoing?.animate) { render(true); return; }
    const incoming = makePage();
    // Only the settled group is interactive; repeated clicks update the next
    // destination without interrupting the current slide or accumulating copies.
    for (const page of [outgoing, incoming]) { page.inert = true; page.setAttribute('aria-hidden', 'true'); }
    viewport.append(incoming);
    viewport.setAttribute('aria-busy', 'true');
    const timing = {duration:420,easing:'cubic-bezier(.22,.61,.36,1)'};
    const animations = [
      outgoing.animate([{transform:'translateX(0)'},{transform:`translateX(${-direction * 100}%)`}], timing),
      incoming.animate([{transform:`translateX(${direction * 100}%)`},{transform:'translateX(0)'}], timing),
    ];
    const running = {animations};
    transition = running;
    updateControls();
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (transition !== running) return;
      outgoing.remove();
      incoming.inert = false;
      incoming.removeAttribute('aria-hidden');
      transition = null;
      viewport.removeAttribute('aria-busy');
      updateControls(true);
      slide();
    }).catch(() => {}); // Resizing or changing motion preferences cancels safely.
  }
  function move(amount) {
    if (boxes.length <= pageSize) return;
    direction = Math.sign(amount);
    target = wrap(target + amount * pageSize);
    slide();
  }
  region.querySelectorAll('[data-box-move]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.boxMove))));
  region.addEventListener('keydown', event => {
    if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !boxes.length) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') {
      direction = event.key === 'Home' ? -1 : 1;
      target = event.key === 'Home' || boxes.length <= pageSize ? 0 : boxes.length - 1;
      slide();
    }
    else move(event.key === 'ArrowRight' ? 1 : -1);
  });
  let touch;
  viewport.addEventListener('touchstart', event => { touch = event.touches.length === 1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null; }, {passive:true});
  viewport.addEventListener('touchend', event => {
    if (!touch || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  }, {passive:true});
  viewport.addEventListener('touchcancel', () => { touch = null; }, {passive:true});
  mobile.addEventListener('change', () => {
    const hadFocus = viewport.contains(document.activeElement);
    pageSize = mobile.matches ? 1 : 3;
    first = target = boxes.length <= pageSize ? 0 : target;
    if (boxes.length) render();
    else cancelTransition();
    if (hadFocus) viewport.focus({preventScroll:true});
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && transition) { first = target; render(true); }
  });
  if (boxes.length) render();
  else viewport.innerHTML = `<p class="home-catalog-message">${content.homeLoaded ? 'Discover what’s baking in our shop.' : 'Our boxes couldn’t load just now.'} <a href="order.html">Visit the shop →</a></p>`;
  document.querySelectorAll('[data-custom-box-link]').forEach(link => {
    link.hidden = content.homeLoaded && !content.customBoxId && !new URLSearchParams(location.search).has('preview');
    if (content.customBoxId) link.href = `order.html?product=${encodeURIComponent(content.customBoxId)}`;
  });
}
