(() => {
  'use strict';
  const container = document.querySelector('[data-fulfillment]');
  if (!container) return;
  // Native calendar: localized, keyboard accessible, and usable with phone date pickers.
  container.innerHTML = `<div class="fulfillment-row"><div class="fulfillment-date"><label for="treat-date">When is your Elio day?</label><input id="treat-date" type="date" aria-describedby="fulfillment-note date-error"></div><fieldset class="fulfillment-method"><legend>Pickup or delivery</legend><div class="fulfillment-options"><label><input type="radio" name="fulfillment" value="pickup"><span>Pickup</span></label><label><input type="radio" name="fulfillment" value="delivery"><span>Delivery</span></label></div></fieldset></div><p class="fulfillment-note" id="fulfillment-note">Preview your preference. Available dates, fees, and pickup details will be confirmed before ordering opens.</p><p class="fulfillment-error" id="date-error" role="alert" hidden></p><p class="fulfillment-status" id="fulfillment-status" role="status" hidden></p>`;
  const input = container.querySelector('#treat-date');
  const radios = [...container.querySelectorAll('[name="fulfillment"]')];
  const error = container.querySelector('#date-error');
  const status = container.querySelector('#fulfillment-status');
  const localISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const updateMin = () => { input.min = localISO(new Date()); };
  updateMin();
  let date = '';
  let method = '';
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00`);
    return !Number.isNaN(parsed.getTime()) && localISO(parsed) === value && value >= input.min;
  }
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
    updateMin();
    const invalid = input.validity.badInput || (input.value && !validDate(input.value));
    input.setAttribute('aria-invalid', String(Boolean(invalid)));
    error.hidden = !invalid;
    error.textContent = invalid ? 'Choose today or a future date for your preview.' : '';
    date = !invalid ? input.value : '';
    method = radios.find((radio) => radio.checked)?.value || '';
    const label = date ? new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) : '';
    status.hidden = !date && !method;
    status.textContent = [method ? (method === 'pickup' ? 'Pickup' : 'Delivery') : '', label].filter(Boolean).join(' · ') + (date || method ? ' — preview only' : '');
    const url = new URL(location.href);
    applyParams(url);
    // Only non-personal preview preferences in the URL; no cart, storage, or submission.
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    syncLinks();
  }
  function restore() {
    updateMin();
    const params = new URLSearchParams(location.search);
    const requestedDate = params.get('date') || '';
    input.value = validDate(requestedDate) ? requestedDate : '';
    radios.forEach((radio) => { radio.checked = radio.value === params.get('fulfillment'); });
    update();
  }
  input.addEventListener('focus', updateMin);
  input.addEventListener('click', () => { if (input.showPicker) { try { input.showPicker(); } catch { /* Native icon and keyboard remain available. */ } } });
  input.addEventListener('change', update);
  radios.forEach((radio) => radio.addEventListener('change', update));
  window.addEventListener('pageshow', restore);
  window.addEventListener('popstate', restore);
  restore();
})();
