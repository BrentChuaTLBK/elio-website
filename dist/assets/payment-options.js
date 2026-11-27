// Existing orders keep the payment details saved when they were placed.
export function paymentDetails(data = {}) {
  if (Array.isArray(data.payment_options)) {
    const options = data.payment_options.filter(method =>
      method && method.enabled !== false && method.active !== false &&
      method.label && method.account_name && method.account_number
    );
    return { options, note: data.payment_note || '' };
  }
  const original = String(data.payment_instructions || '').trim();
  const body = original.replace(/^Accepted Payment Methods:\s*\n+/i, '');
  const blocks = body.split(/\n\s*\n/).map(block => block.split(/\r?\n/).map(line => line.trim()));
  if (blocks.every(lines => lines.length === 3 && lines.every(Boolean) && /^[+\d][\d +()-]{3,99}$/.test(lines[2]))) {
    const options = blocks.map(([label, account_name, account_number]) => ({ label, account_name, account_number, note: '' }));
    return { options, note: data.payment_note || '' };
  }
  return { options: [], note: original || data.payment_note || '' };
}

let lastChoice;

function detailsFor(order, settings) {
  const hasSnapshot = order.payment_options != null || order.payment_instructions != null || order.payment_note != null;
  return paymentDetails(hasSnapshot ? order : settings);
}

function copyField(label, value, esc) {
  return `<div class="payment-copy-row">
    <label>${esc(label)}<input class="payment-copy-value" type="text" readonly spellcheck="false" value="${esc(value)}"></label>
    <button type="button" class="button-secondary payment-copy" data-copy-payment aria-label="Copy ${esc(label.toLowerCase())}">Copy</button>
  </div>`;
}

function methodDetails(method, esc) {
  const numberLabel = /gcash/i.test(method.label) ? 'Mobile number' : 'Account number';
  return `<h3>${esc(method.label)}</h3>
    ${copyField('Account name', method.account_name, esc)}
    ${copyField(numberLabel, method.account_number, esc)}
    ${method.note ? `<p class="payment-option-note">${esc(method.note)}</p>` : ''}`;
}

export function renderPaymentOptions(order, settings, { esc, purpose = 'order', amountCents = order.total_cents }) {
  const { options, note } = detailsFor(order, settings);
  if (!options.length) return `<div class="payment-details">${esc(note || 'Please contact the kitchen for payment details.')}</div>`;

  let selected = 0;
  if (lastChoice && lastChoice.orderId === order.id && lastChoice.purpose === purpose) {
    const index = options.findIndex(method => method.label === lastChoice.label && method.account_number === lastChoice.number);
    if (index >= 0) selected = index;
  }
  const selector = options.length > 1 ? `<fieldset class="payment-methods">
    <legend>Choose how to pay</legend>
    <div class="payment-method-list">${options.map((method, index) => `<label>
      <input type="radio" name="payment-method-${esc(purpose)}" value="${index}" ${index === selected ? 'checked' : ''}>
      <span>${esc(method.label)}</span></label>`).join('')}</div>
  </fieldset>` : '';
  const amount = Number.isSafeInteger(amountCents) && amountCents >= 0
    ? copyField('Amount to pay', (amountCents / 100).toFixed(2), esc) : '';
  return `<div class="payment-options" data-payment-purpose="${esc(purpose)}">
    ${selector}<section class="payment-option" aria-label="Selected payment details">${methodDetails(options[selected], esc)}</section>
    ${amount}${note ? `<p class="payment-option-note">${esc(note)}</p>` : ''}
    <p class="payment-copy-status" role="status"></p>
  </div>`;
}

export function bindPaymentOptions(root, order, settings, { esc }) {
  const { options } = detailsFor(order, settings);
  for (const panel of root.querySelectorAll('[data-payment-purpose]')) {
    const status = panel.querySelector('.payment-copy-status');
    panel.addEventListener('change', event => {
      const radio = event.target;
      if (!radio.matches('.payment-method-list input:checked')) return;
      const method = options[Number(radio.value)];
      if (!method) return;
      lastChoice = { orderId: order.id, purpose: panel.dataset.paymentPurpose, label: method.label, number: method.account_number };
      panel.querySelector('.payment-option').innerHTML = methodDetails(method, esc);
      status.textContent = '';
    });
    panel.addEventListener('click', async event => {
      const button = event.target.closest('[data-copy-payment]');
      if (!button) return;
      const input = button.closest('.payment-copy-row').querySelector('input');
      try {
        await navigator.clipboard.writeText(input.value);
        if (!button.isConnected) return;
        button.textContent = 'Copied';
        status.textContent = 'Copied. You can paste it into your payment app.';
        setTimeout(() => { button.textContent = 'Copy'; }, 2000);
      } catch {
        if (!input.isConnected) return;
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
        status.textContent = 'The value is selected. Use Copy on your device.';
      }
    });
  }
}
