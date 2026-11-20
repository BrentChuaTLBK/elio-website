export function deliveryReceiptSection(order, { esc, money, accept, paymentOptions }) {
  const fee=order.delivery_charge;
  if (order.order_source!=='direct' || order.method!=='delivery' || order.payment_status!=='paid' || order.refund_label
      || ['cancelled','expired'].includes(order.fulfillment_status) || fee?.recipient!=='elio' || fee.state!=='quoted') return '';
  const contents=fee.proof_status==='under_review' ? '<p role="status">Your delivery receipt is under review.</p>' :
    `<p>Pay the delivery fee of <strong>${money(fee.fee_cents)}</strong>.</p>${paymentOptions()}
     ${fee.proof_status==='rejected' ? `<p class="notice danger">${esc(fee.proof_feedback)}</p>` : ''}
     <form data-delivery-receipt><label class="field">Delivery receipt<input type="file" name="photo" accept="${accept}" required></label>
     <label class="field">Delivery payment reference (optional)<input name="reference" maxlength="160"></label>
     <button type="submit" class="button">Submit delivery receipt</button><p role="status" aria-live="polite"></p></form>`;
  return `<section class="panel order-section"><h2>Separate delivery payment</h2>${contents}</section>`;
}

export function bindDeliveryReceipt(form, { upload, refresh }) {
  if (!form) return;
  form.onsubmit=async event=>{
    event.preventDefault();
    const file=form.elements.photo.files[0], button=form.querySelector('button'), status=form.querySelector('[role=status]');
    if (!file || button.disabled) return;
    const reference=form.elements.reference.value;
    button.disabled=form.elements.photo.disabled=form.elements.reference.disabled=true;
    status.textContent='Uploading delivery receipt…';
    try {
      await upload(file,reference);
      status.textContent='Delivery receipt submitted for review.';
      if(form.isConnected)await refresh();
    } catch(error) {
      status.textContent=error.message || 'The receipt could not be submitted. Refresh to check its status.';
    } finally {
      button.disabled=form.elements.photo.disabled=form.elements.reference.disabled=false;
    }
  };
}
