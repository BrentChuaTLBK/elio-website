export function reviewWindow(method,settings,escape){
  const delivery=method==='delivery';
  const hours=String(delivery?(settings.delivery_window||'9:00 AM – 6:00 PM'):(settings.pickup_hours||'')).trim();
  if(!hours)return '';
  return `<p class="review-window">${delivery?'Delivery window':'Pickup hours'}: ${escape(hours)} · Manila time.${delivery?' Exact arrival time cannot be selected or guaranteed.':''}</p>`;
}

// Website checkout only. The server starts the 15-minute deadline when it saves the order.
export function reviewPayment(){
  return '<section class="review-payment" aria-labelledby="review-payment-title"><h4 id="review-payment-title">After you place your order</h4><ol><li><div><strong>Pay in full and upload your receipt</strong><p>Use the payment details on the next screen. Upload your receipt within 15 minutes of placing the order.</p></div></li><li><div><strong>We’ll review your payment</strong><p>Your order is confirmed after payment approval.</p></div></li></ol></section>';
}
