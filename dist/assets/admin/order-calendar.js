export const todayInManila=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
export function calendarMonth(month){
 const start=new Date(`${month}-01T12:00:00Z`);
 if(!/^\d{4}-\d{2}$/.test(month)||!Number.isFinite(start.getTime())||start.toISOString().slice(0,7)!==month)throw Error('Choose a valid calendar month.');
 const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0,12));
 return {from:month+'-01',to:last.toISOString().slice(0,10),offset:start.getUTCDay(),days:last.getUTCDate(),label:new Intl.DateTimeFormat('en-PH',{month:'long',year:'numeric',timeZone:'UTC'}).format(start)};
}
export function shiftedMonth(month,step){const date=new Date(`${month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+step);return date.toISOString().slice(0,7);}
export const calendarArea=order=>order.address?.locality?.trim()||'Area not recorded';
export const calendarName=order=>(order.method==='delivery'?order.recipient?.name:order.buyer?.name)||'Customer';
export const calendarPhone=order=>(order.method==='delivery'?order.recipient?.phone:order.buyer?.phone)||'';
export const calendarAddress=order=>order.method==='delivery'?[order.address?.line1,order.address?.line2,order.address?.locality,order.address?.postal_code].filter(Boolean).join(', '):order.pickup_address||'';
export function filteredCalendarOrders(orders,filters){
 const query=String(filters.search||'').trim().toLowerCase();
 return orders.filter(o=>(!filters.method||o.method===filters.method)&&(!filters.area||o.method==='delivery'&&calendarArea(o)===filters.area)&&(!query||[o.reference,calendarName(o),calendarPhone(o),calendarAddress(o),o.buyer?.name,o.buyer?.email,o.buyer?.phone].filter(Boolean).join(' ').toLowerCase().includes(query)))
 .sort((a,b)=>a.date.localeCompare(b.date)||a.method.localeCompare(b.method)||calendarArea(a).localeCompare(calendarArea(b),'en-PH')||a.reference.localeCompare(b.reference));
}
export function calendarCopy(order,field='all'){
 const values={name:calendarName(order),phone:calendarPhone(order),address:calendarAddress(order),email:order.buyer?.email||'',buyer_phone:order.buyer?.phone||''};
 if(field!=='all')return values[field]||'';
 const delivery=order.method==='delivery';
 return [order.reference,`${delivery?'Delivery':'Pickup'} · ${order.date}`,order.window?`Window: ${order.window}`:'',
 `${delivery?'Recipient':'Customer'}: ${values.name}`,`Phone: ${values.phone}`,`${delivery?'Address':'Pickup location'}: ${values.address}`,
 order.buyer?.name&&order.buyer.name!==values.name?`Buyer: ${order.buyer.name}`:'',
 values.buyer_phone&&values.buyer_phone!==values.phone?`Buyer phone: ${values.buyer_phone}`:'',values.email?`Email: ${values.email}`:'',
 ...((order.items||[]).map(item=>`${item.quantity} × ${item.name}`)),order.instructions?`Instructions: ${order.instructions}`:''].filter(Boolean).join('\n');
}
