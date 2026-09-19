(() => {
  'use strict';
  const { flavors, featuredOrder, productImage, isAvailable } = window.ELIO_CONTENT;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const catalog = [...new Set([...featuredOrder, ...flavors.map((flavor) => flavor.id)])].map((id) => flavors.find((flavor) => flavor.id === id)).filter(Boolean);
  const hasPhoto = (flavor) => Boolean(flavor.image || flavor.imagePosition);
  const photo = (flavor) => `<span class="product-photo" style="--image-left:-${parseFloat(flavor.imagePosition || '0') * 2}%"><img src="${escape(flavor.image || productImage)}" width="2172" height="724" alt="${escape(flavor.name)} square Basque cheesecake — concept photograph"${flavor.image ? ' style="left:0;width:100%;height:100%;object-fit:cover"' : ''}></span>`;
  const packaging = (kind = '') => `<span class="box-packaging-photo ${kind}"><img src="assets/gifting-concept.webp" width="1400" height="1000" alt="${kind === 'gallery-bag' ? 'Close view of the Elio paper bag' : kind === 'gallery-carton' ? 'Close view of the three-piece Elio box' : 'Elio paper bag and open three-piece cheesecake box'} — concept photograph"></span>`;
  const gallery = [
    { name: 'The Elio box', markup: packaging() },
    ...catalog.filter(hasPhoto).slice(0, 3).map((flavor) => ({ name: flavor.name, markup: photo(flavor) })),
    { name: 'Paper bag detail', markup: packaging('gallery-bag') },
    { name: 'Box detail', markup: packaging('gallery-carton') }
  ];
  const thumbnails = document.querySelector('#box-thumbnails');
  thumbnails.innerHTML = gallery.map((item, index) => `<button class="box-thumbnail" type="button" data-gallery-index="${index}" aria-label="View ${escape(item.name)} photograph" aria-pressed="${index === 0}"><span aria-hidden="true">${item.markup}</span></button>`).join('');
  function showPhoto(index, announce = true) {
    const item = gallery[index];
    document.querySelector('#box-gallery-stage').innerHTML = item.markup;
    document.querySelector('#box-gallery-caption').textContent = `${item.name} · Concept photograph`;
    [...thumbnails.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    if (announce) document.querySelector('#box-gallery-status').textContent = `Showing ${item.name}.`;
  }
  thumbnails.addEventListener('click', (event) => { const button = event.target.closest('[data-gallery-index]'); if (button) showPhoto(Number(button.dataset.galleryIndex)); });
  thumbnails.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const button = event.target.closest('[data-gallery-index]');
    if (!button) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? gallery.length - 1 : (Number(button.dataset.galleryIndex) + (event.key === 'ArrowRight' ? 1 : -1) + gallery.length) % gallery.length;
    showPhoto(index);
    thumbnails.children[index].focus({ preventScroll: true });
  });
  showPhoto(0, false);

  // These controls preview the design only; no cart or customer data is persisted.
  const available = catalog.filter((flavor) => isAvailable(flavor));
  const defaults = Array.from({ length: 3 }, (_, index) => available[index % available.length]?.id || '');
  const selects = document.querySelector('#box-flavor-selects');
  selects.insertAdjacentHTML('beforeend', defaults.map((id, index) => `<div class="box-flavor-row"><label for="box-flavor-${index}">Cheesecake ${index + 1}</label><select id="box-flavor-${index}"${available.length ? '' : ' disabled'}>${available.length ? '' : '<option value="">Coming soon</option>'}${catalog.map((flavor) => `<option value="${escape(flavor.id)}"${flavor.id === id ? ' selected' : ''}${!isAvailable(flavor) ? ' disabled' : ''}>${escape(flavor.name)}${!isAvailable(flavor) ? ' — currently unavailable' : ''}</option>`).join('')}</select></div>`).join(''));
  function updateFlavors() {
    document.querySelector('#box-flavor-chips').innerHTML = [...selects.querySelectorAll('select')].map((select) => {
      const flavor = available.find((item) => item.id === select.value);
      return flavor ? `<span class="box-flavor-chip">${hasPhoto(flavor) ? photo(flavor) : `<span class="box-flavor-initial" aria-hidden="true">${escape(flavor.name[0])}</span>`}<span>${escape(flavor.name)}</span></span>` : '<span class="box-flavor-chip"><span>Coming soon</span></span>';
    }).join('');
  }
  selects.addEventListener('change', updateFlavors);
  updateFlavors();
  const quantity = document.querySelector('#box-quantity');
  const minus = document.querySelector('#box-minus');
  const plus = document.querySelector('#box-plus');
  function setQuantity(value) {
    const next = Number.isSafeInteger(value) && value > 0 ? value : 1;
    quantity.value = next;
    minus.disabled = next === 1;
    plus.disabled = next === Number.MAX_SAFE_INTEGER;
  }
  minus.addEventListener('click', () => setQuantity(Number(quantity.value) - 1));
  plus.addEventListener('click', () => setQuantity(Number(quantity.value) + 1));
  quantity.addEventListener('change', () => setQuantity(Number(quantity.value)));
  const giftToggle = document.querySelector('#box-gift-toggle');
  const giftField = document.querySelector('#box-gift-field');
  const giftMessage = document.querySelector('#box-gift-message');
  giftToggle.addEventListener('change', () => {
    giftField.hidden = !giftToggle.checked;
    giftToggle.setAttribute('aria-expanded', String(giftToggle.checked));
    if (giftToggle.checked) giftMessage.focus(); else giftMessage.value = '';
  });
  // Clear unsaved preview edits even when a browser restores the page from history.
  window.addEventListener('pageshow', () => {
    giftToggle.checked = false;
    giftToggle.setAttribute('aria-expanded', 'false');
    giftField.hidden = true;
    giftMessage.value = '';
    setQuantity(1);
    [...selects.querySelectorAll('select')].forEach((select, index) => { select.value = defaults[index]; });
    updateFlavors();
  });
})();
