// Shared wording for the POS, kitchen dashboard, and private customer order link.
export function deliveryFeeSummary(order,money){
 const c=order.delivery_charge;
 if(order.method!=='delivery')return money(0);
 if(!c)return money(order.delivery_cents);
 const recipient=c.recipient==='courier'?'Pay courier directly':'Pay Elio';
 if(c.state==='pending')return 'To be confirmed · '+recipient;
 if(c.state==='courier')return money(c.fee_cents)+' · Pay courier directly';
 if(c.state==='quoted')return money(c.fee_cents)+' · Pay Elio · not yet received';
 if(c.state==='paid')return money(c.fee_cents)+' · Paid to Elio separately';
 return money(c.fee_cents)+' · '+recipient;
}
export const separateDeliveryPaid=order=>order.delivery_charge?.state==='paid'?Number(order.delivery_charge.fee_cents||0):0;
