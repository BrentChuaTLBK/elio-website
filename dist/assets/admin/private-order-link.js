// Only the open order asks for its customer link. The token stays in the URL fragment.
export function privateOrderLinkField() {
  return `<section class="private-order-link" data-private-order-link aria-label="Private order link">
    <label><span>Private order link</span><input data-receipt-link type="text" readonly autocomplete="off" spellcheck="false" placeholder="Loading link…"></label>
    <button type="button" data-copy-link disabled>Copy link</button>
    <small role="status"></small>
  </section>`;
}

export function bindPrivateOrderLink(field, orderId, api) {
  const input = field.querySelector('input');
  const button = field.querySelector('button');
  const feedback = field.querySelector('[role=status]');

  async function loadLink() {
    button.disabled = true;
    feedback.textContent = '';
    try {
      const result = await api('pos_payment_link', {order_id: orderId});
      if (!field.isConnected) return;
      if (result.id !== orderId || typeof result.token !== 'string' || result.token.length < 40) {
        throw new Error('Missing order link');
      }
      const url = new URL('order.html', document.baseURI);
      url.hash = new URLSearchParams({order: orderId, token: result.token}).toString();
      input.value = url.href;
      button.textContent = 'Copy link';
    } catch {
      if (!field.isConnected) return;
      input.placeholder = 'Link unavailable';
      button.textContent = 'Retry link';
      feedback.textContent = 'Couldn’t load this order’s link.';
    } finally {
      button.disabled = false;
    }
  }

  input.onclick = () => input.select();
  button.onclick = async () => {
    if (!input.value) return loadLink();
    try {
      await navigator.clipboard.writeText(input.value);
      feedback.textContent = 'Link copied.';
    } catch {
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);
      feedback.textContent = 'Link selected. Use Copy on your device.';
    }
  };
  void loadLink();
}
