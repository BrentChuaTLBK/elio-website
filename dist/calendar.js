/* Elio's customer date picker. UI reference: TLB Kitchen's calendar.
   Bookings are limited to the current and next Manila calendar months. */
(() => {
  'use strict';
  const pad = value => String(value).padStart(2, '0');
  const dateObject = value => new Date(`${value}T12:00:00Z`);
  const iso = value => value.toISOString().slice(0, 10);
  const today = () => {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
  };
  const isDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = dateObject(value);
    return !Number.isNaN(date.getTime()) && iso(date) === value;
  };
  const bookingEnd = () => {
    const date = dateObject(`${today().slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + 2, 0);
    return iso(date);
  };
  const isSelectable = value => isDate(value) && value >= today() && value <= bookingEnd();
  const format = (value, options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(dateObject(value));
  const labelDate = value => format(value, { day: 'numeric', month: 'long', year: 'numeric' });
  const addDays = (value, amount) => { const date = dateObject(value); date.setUTCDate(date.getUTCDate() + amount); return iso(date); };
  const shiftMonth = (month, amount) => { const date = dateObject(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + amount); const result = iso(date); return result.startsWith('+') ? '9999-12' : result.slice(0, 7); };
  const daysInMonth = month => { const date = dateObject(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + 1, 0); return date.getUTCDate(); };

  function mount(trigger, { value = '', method = '', onSelect } = {}) {
    let selected = isSelectable(value) ? value : '';
    let fulfillment = method;
    let month = (selected || today()).slice(0, 7);
    let clockTimer;
    const popup = document.createElement('dialog');
    popup.id = 'elio-calendar';
    popup.className = 'elio-calendar';
    popup.setAttribute('aria-labelledby', 'calendar-title');
    popup.setAttribute('aria-describedby', 'calendar-guidance');
    document.body.append(popup);
    trigger.classList.add('calendar-trigger');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', popup.id);
    trigger.setAttribute('aria-expanded', 'false');

    function updateTrigger() {
      trigger.value = selected;
      trigger.innerHTML = `<span>${selected ? labelDate(selected) : 'Choose a date'}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h1M15 15h1"/></svg>`;
      trigger.setAttribute('aria-label', selected ? `Fulfillment date: ${labelDate(selected)}. Change date.` : 'Choose fulfillment date');
    }
    function render({ focusDate, focusControl, focus = false } = {}) {
      const current = today();
      if (month < current.slice(0, 7)) month = current.slice(0, 7);
      const lastMonth = bookingEnd().slice(0, 7);
      if (month > lastMonth) month = lastMonth;
      const first = `${month}-01`;
      const preferred = [focusDate, selected, current, first].find(date => date && date.startsWith(month) && isSelectable(date));
      const cells = Array(dateObject(first).getUTCDay()).fill('');
      for (let day = 1; day <= daysInMonth(month); day++) {
        const date = `${month}-${pad(day)}`;
        const disabled = !isSelectable(date);
        cells.push(`<button type="button" class="calendar-day" data-date="${date}" aria-label="${labelDate(date)}${disabled ? '. Past date, unavailable.' : ''}" aria-pressed="${date === selected}"${date === current ? ' aria-current="date"' : ''}${disabled ? ' disabled' : ''} tabindex="${date === preferred ? '0' : '-1'}">${day}</button>`);
      }
      while (cells.length % 7) cells.push('');
      const rows = [];
      for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).map(cell => `<td>${cell}</td>`).join('')}</tr>`);
      const methodLabel = fulfillment === 'delivery' ? 'Delivery dates' : fulfillment === 'pickup' ? 'Pickup dates' : 'Your preferred date';
      popup.innerHTML = `<div class="calendar-heading"><h2 id="calendar-title">Choose a date</h2><button type="button" class="calendar-close" data-close aria-label="Close calendar">×</button></div>
        <p id="calendar-guidance" class="calendar-guidance">${methodLabel} · Preview only.</p>
        <div class="calendar-toolbar"><button type="button" class="calendar-nav" data-month="-1" aria-label="Previous month"${month === current.slice(0, 7) ? ' disabled' : ''}>‹</button><strong id="calendar-month" aria-live="polite">${format(first, { month: 'long', year: 'numeric' })}</strong><button type="button" class="calendar-nav" data-month="1" aria-label="Next month"${month === lastMonth ? ' disabled' : ''}>›</button></div>
        <table class="calendar-month" aria-labelledby="calendar-month" aria-describedby="calendar-guidance"><thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
        <div class="calendar-legend"><span><i class="calendar-selected-key" aria-hidden="true"></i>Selected</span><span><i class="calendar-unavailable-key" aria-hidden="true"></i>Unavailable</span></div>
        <p class="calendar-help">Choose a date this month or next month. Dates use Philippine time. Availability will be confirmed before ordering opens.</p>
        <div class="calendar-footer"><button type="button" data-clear${selected ? '' : ' disabled'}>Clear date</button><button type="button" data-current>Current month</button></div>`;
      if (focus && popup.open) {
        const control = focusControl && popup.querySelector(focusControl);
        const day = popup.querySelector(`[data-date="${preferred}"]`);
        (control && !control.disabled ? control : day || popup.querySelector('[data-close]')).focus({ preventScroll: true });
      }
    }
    function close() {
      clearTimeout(clockTimer);
      popup.close();
      trigger.setAttribute('aria-expanded', 'false');
    }
    function refreshClock() {
      clearTimeout(clockTimer);
      if (!popup.open) return;
      const focused = document.activeElement;
      const focusWasInside = popup.contains(focused);
      if (selected && !isSelectable(selected)) { selected = ''; updateTrigger(); onSelect?.(''); }
      render({ focusDate: focused?.dataset.date, focus: focusWasInside });
      const nextMidnight = new Date(`${addDays(today(), 1)}T00:00:00+08:00`).getTime();
      clockTimer = setTimeout(refreshClock, Math.max(1, nextMidnight - Date.now() + 10));
    }
    function choose(date) {
      if (date && !isSelectable(date)) { refreshClock(); return; }
      selected = date;
      updateTrigger();
      close();
      onSelect?.(date);
    }
    trigger.addEventListener('click', () => {
      if (popup.open) return;
      if (selected && !isSelectable(selected)) { selected = ''; updateTrigger(); onSelect?.(''); }
      month = (selected || today()).slice(0, 7);
      render();
      popup.showModal();
      trigger.setAttribute('aria-expanded', 'true');
      refreshClock();
    });
    popup.addEventListener('close', () => { clearTimeout(clockTimer); trigger.setAttribute('aria-expanded', 'false'); trigger.focus({ preventScroll: true }); });
    popup.addEventListener('cancel', event => { event.preventDefault(); close(); });
    popup.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (button && !button.disabled) {
        if (button.hasAttribute('data-close')) close();
        else if (button.hasAttribute('data-clear')) choose('');
        else if (button.hasAttribute('data-current')) { month = today().slice(0, 7); render({ focusDate: today(), focus: true }); }
        else if (button.hasAttribute('data-month')) { month = shiftMonth(month, Number(button.dataset.month)); render({ focusControl: `[data-month="${button.dataset.month}"]`, focus: true }); }
        else if (button.dataset.date) choose(button.dataset.date);
      } else if (event.target === popup) {
        const rect = popup.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }
    });
    popup.addEventListener('keydown', event => {
      const button = event.target.closest('[data-date]');
      if (!button || button.disabled || event.ctrlKey || event.altKey || event.metaKey) return;
      const date = button.dataset.date;
      const day = dateObject(date).getUTCDay();
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -day, End: 6 - day };
      let target;
      if (Object.hasOwn(moves, event.key)) target = addDays(date, moves[event.key]);
      else if (event.key === 'PageUp' || event.key === 'PageDown') {
        let destination = shiftMonth(month, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
        if (destination > '9999-12' || destination.length !== 7) destination = '9999-12';
        target = `${destination}-${pad(Math.min(Number(date.slice(8)), daysInMonth(destination)))}`;
      } else return;
      event.preventDefault();
      if (!isDate(target)) target = '9999-12-31';
      if (target < today()) target = today();
      if (target > bookingEnd()) target = bookingEnd();
      month = target.slice(0, 7);
      render({ focusDate: target, focus: true });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && popup.open) refreshClock(); });
    updateTrigger();
    return { update({ value = selected, method = fulfillment } = {}) {
      selected = isSelectable(value) ? value : '';
      fulfillment = method;
      updateTrigger();
      if (popup.open) render({ focus: true });
    } };
  }
  window.ELIO_CALENDAR = { mount, isSelectable, labelDate, bookingEnd };
})();
