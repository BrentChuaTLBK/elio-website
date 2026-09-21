(() => {
  'use strict';
  const container = document.querySelector('[data-fulfillment]');
  if (!container) return;
  const { mount, isSelectable, labelDate } = window.ELIO_CALENDAR;
  container.innerHTML = `<div class="fulfillment-row"><div class="fulfillment-date"><label for="treat-date">When is your Elio day?</label><button id="treat-date" type="button" aria-describedby="fulfillment-note">Choose a date</button></div><fieldset class="fulfillment-method"><legend>Pickup or delivery</legend><div class="fulfillment-options"><label><input type="radio" name="fulfillment" value="pickup"><span>Pickup</span></label><label><input type="radio" name="fulfillment" value="delivery"><span>Delivery</span></label></div></fieldset></div><p class="fulfillment-note" id="fulfillment-note">Preview your preference. Available dates, fees, and pickup details will be confirmed before ordering opens.</p><p class="fulfillment-status" id="fulfillment-status" role="status" hidden></p>`;
  const trigger = container.querySelector('#treat-date');
  const radios = [...container.querySelectorAll('[name="fulfillment"]')];
  const status = container.querySelector('#fulfillment-status');
  let date = '';
  let method = '';
  const calendar = mount(trigger, { onSelect(value) { date = value; update(); } });
  function applyParams(url) {
    if (date) url.searchParams.set('date', date); else url.searchParams.delete('date');
    if (method) url.searchParams.set('fulfillment', method); else url.searchParams.delete('fulfillment');
  }
  function syncLinks() {
    document.querySelectorAll('a[href]').forEach((link) => {
      if (link.getAttribute('href').startsWith('#')) return;
      const url = new URL(link.getAttribute('href'), location.href);
      if (url.origin !== location.origin || !/(?:^|\/)(box|order)\.html$/.test(url.pathname)) return;
      applyParams(url);
      link.setAttribute('href', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
    });
  }
  function update() {
    if (date && !isSelectable(date)) date = '';
    method = radios.find((radio) => radio.checked)?.value || '';
    calendar.update({ value: date, method });
    status.hidden = !date && !method;
    status.textContent = [method ? (method === 'pickup' ? 'Pickup' : 'Delivery') : '', date ? labelDate(date) : ''].filter(Boolean).join(' · ') + (date || method ? ' — preview only' : '');
    const url = new URL(location.href);
    applyParams(url);
    // Only non-personal preview preferences in the URL; no cart, storage, or submission.
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    syncLinks();
  }
  function restore() {
    const params = new URLSearchParams(location.search);
    const requestedDate = params.get('date') || '';
    date = isSelectable(requestedDate) ? requestedDate : '';
    radios.forEach((radio) => { radio.checked = radio.value === params.get('fulfillment'); });
    update();
  }
  radios.forEach((radio) => radio.addEventListener('change', update));
  window.addEventListener('pageshow', restore);
  window.addEventListener('popstate', restore);
  restore();
})();
