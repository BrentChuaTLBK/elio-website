export function acceptsReceipt(order,now=Date.now()) {
 return Boolean(order&&!order.refund_label&&!['cancelled','expired','refunded','completed'].includes(order.fulfillment_status)
  &&!order.uploads_paused&&order.payment_status==='awaiting_payment'
  &&(order.order_source==='direct'&&!order.payment_deadline||Date.parse(order.payment_deadline)>now));
}
