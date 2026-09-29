const arrays=['active_order_ids','paid_orders','payments','allocations','products','inventory','affiliates','affiliate_codes','affiliate_orders','affiliate_order_details','affiliate_ledger','affiliate_payouts'];
export function validateRecovery(data){
 if(data?.source!=='elio-paid-order-recovery'||data.schema_version!==1||!Number.isFinite(Date.parse(data.generated_at))||arrays.some(k=>!Array.isArray(data[k])))throw Error('The backup response is incomplete. Please try again.');
 if(data.active_count!==data.active_order_ids.length||data.paid_history_count!==data.paid_orders.length)throw Error('Backup order counts do not match. Please try again.');
 if(data.review_orders!==undefined&&!Array.isArray(data.review_orders))throw Error('Invalid payment-review orders.');
 const review=data.review_orders||[],paid=new Map([...data.paid_orders,...review].map(o=>[o.id,o]));if(paid.size!==data.paid_orders.length+review.length||new Set(data.active_order_ids).size!==data.active_count)throw Error('Duplicate orders in backup.');
 if(data.paid_orders.some(o=>o.payment_status!=='paid')||review.some(o=>o.payment_status!=='under_review'))throw Error('Invalid payment status in backup.');
 for(const id of data.active_order_ids){const o=paid.get(id);if(!o||o.refund_label||['completed','cancelled','expired','refunded'].includes(o.fulfillment_status))throw Error('Invalid active order in backup.');}
 for(const o of paid.values()){if(!Array.isArray(o.items)||!Number.isSafeInteger(o.total_cents)||Object.hasOwn(o,'access_token'))throw Error('Invalid order in backup.');}
 if(data.active_total_cents!==data.active_order_ids.reduce((sum,id)=>sum+paid.get(id).total_cents,0))throw Error('Backup totals do not match.');
 if(data.allocations.some(a=>!paid.has(a.order_id)))throw Error('Stock allocation has no matching paid order.');return data;
}
export const activeRecoveryOrders=data=>{const ids=new Set(data.active_order_ids);return [...data.paid_orders,...(data.review_orders||[])].filter(o=>ids.has(o.id)).sort((a,b)=>String(a.fulfillment_date||'').localeCompare(String(b.fulfillment_date||''))||a.id.localeCompare(b.id));};
export const recoveryFlavors=item=>(item.selection_labels?.length?item.selection_labels:item.flavor_contents||[]).map(f=>typeof f==='string'?f:`${f.quantity} × ${f.label||f.name}`).join('; ');
const csvCell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
export function fulfillmentCsv(data){
 validateRecovery(data);const active=new Set(data.active_order_ids),affiliates=new Map(data.affiliate_orders.map(a=>[a.order_id,a]));
 const rows=[['Order ID','Order reference','Scheduled date (Manila)','Method','Payment status','Customer','Email','Phone','Social platform','Social username','Recipient','Recipient phone','Address','Products / flavors / quantities','Products PHP','Discount PHP','Delivery PHP','Total PHP','Paid PHP','Payment reference','Fulfillment status','Affiliate code','Commission rate %','Estimated commission PHP','Earned commission PHP','Commission status','Instructions','Backup generated at (UTC)']];
 const php=n=>((Number(n)||0)/100).toFixed(2);
 for(const o of activeRecoveryOrders(data)){const a=affiliates.get(o.id)||{};rows.push([o.id,o.reference,o.fulfillment_date,o.method,o.payment_status,o.buyer?.name,o.buyer?.email,o.buyer?.phone,o.buyer?.social_platform,o.buyer?.social_username,o.recipient?.name,o.recipient?.phone,[o.address?.line1,o.address?.line2,o.address?.locality,o.address?.postal_code].filter(Boolean).join(', '),o.items.map(i=>`${i.quantity} × ${i.name} (${recoveryFlavors(i)}) · unit PHP ${php(i.unit_price_cents)}`).join('\n'),php(o.subtotal_cents),php(o.discount_cents),php(o.delivery_cents),php(o.total_cents),php(o.paid_amount_cents),o.payment_reference,o.fulfillment_status,a.code,a.commission_bps==null?'':(a.commission_bps/100).toFixed(2),php(a.estimated_cents),php(a.earned_cents),a.status,o.instructions,data.generated_at]);}
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export async function recoveryEnvelope(data){validateRecovery(data);const bytes=new TextEncoder().encode(JSON.stringify(data));const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');return {sha256,backup:data};}
