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
  let page = 0, pageSize = mobile.matches ? 1 : 3;
  const pageCount = () => Math.ceil(boxes.length / pageSize);
  const card = box => {
    const href = `order.html?product=${encodeURIComponent(box.id)}`;
    const image = imageUrl(box);
    return `<article class="home-box-card" data-home-box="${escape(box.id)}"><a class="home-box-photo" href="${href}" tabindex="-1" aria-hidden="true">${image ? `<img src="${escape(image)}" alt="" width="1440" height="960" loading="lazy">` : '<span class="home-box-placeholder">ELIO</span>'}</a><h3><a href="${href}">${escape(box.name)}</a></h3><p class="home-box-description">${escape(box.description ?? box.line)}</p>${Number.isFinite(box.price_cents) ? `<p class="home-box-price">${money(box.price_cents)}</p>` : ''}<a class="button" href="${href}" aria-label="View ${escape(box.name)}">View box</a></article>`;
  };
  function render(announce = false) {
    const first = page * pageSize;
    viewport.innerHTML = boxes.slice(first, first + pageSize).map(card).join('');
    controls.hidden = pageCount() <= 1;
    for (const button of controls.querySelectorAll('button')) button.setAttribute('aria-label', `${button.dataset.boxMove === '1' ? 'Next' : 'Previous'} ${pageSize === 1 ? 'box' : 'boxes'}`);
    const message = boxes.length ? `${first + 1}–${Math.min(first + pageSize, boxes.length)} of ${boxes.length} boxes` : '';
    region.querySelector('[data-box-position]').textContent = message;
    if (announce) status.textContent = message + '. ' + boxes.slice(first, first + pageSize).map(box => box.name).join(', ') + '.';
  }
  function move(amount) {
    if (pageCount() < 2) return;
    page = (page + amount + pageCount()) % pageCount();
    render(true);
  }
  region.querySelectorAll('[data-box-move]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.boxMove))));
  region.addEventListener('keydown', event => {
    if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !boxes.length) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') { page = event.key === 'Home' ? 0 : pageCount()-1; render(true); }
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
    const first = page * pageSize;
    const hadFocus = viewport.contains(document.activeElement);
    pageSize = mobile.matches ? 1 : 3;
    page = Math.floor(first / pageSize);
    render();
    if (hadFocus) viewport.focus({preventScroll:true});
  });
  if (boxes.length) render();
  else viewport.innerHTML = `<p class="home-catalog-message">${content.homeLoaded ? 'Discover what’s baking in our shop.' : 'Our boxes couldn’t load just now.'} <a href="order.html">Visit the shop →</a></p>`;
  document.querySelectorAll('[data-custom-box-link]').forEach(link => {
    link.hidden = content.homeLoaded && !content.customBoxId && !new URLSearchParams(location.search).has('preview');
    if (content.customBoxId) link.href = `order.html?product=${encodeURIComponent(content.customBoxId)}`;
  });
}
