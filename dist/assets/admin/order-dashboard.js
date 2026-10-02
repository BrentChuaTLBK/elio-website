import {isActiveFulfillment,needsPaymentReview} from './refund-status.js';
import {deliveryFeeSummary} from '../delivery-fee.js';
const closed=new Set(['cancelled','expired','completed','refunded']);
const label=value=>String(value||'').replaceAll('_',' ').replace(/^\w/,c=>c.toUpperCase());
export function matchesOrderView(order,view,today){
 if(view==='review')return needsPaymentReview(order);
 if(view==='today')return order.fulfillment_date===today&&isActiveFulfillment(order);
 return true;
}
export function orderNextStep(order){
 if(order.refund_label)return {title:'Refund label applied',action:'details'};
 if(closed.has(order.fulfillment_status))return {title:label(order.fulfillment_status),action:'details'};
 if(needsPaymentReview(order))return {title:'Review payment',label:'Approve payment',action:'approve'};
 if(order.payment_status!=='paid')return {title:order.payment_status==='rejected'?'Payment rejected':'Awaiting payment',action:'details'};
 if(['direct','in_person'].includes(order.order_source))return {title:'Continue fulfillment',label:'Open POS order',action:'pos'};
 if(['confirmed','pending_confirmation'].includes(order.fulfillment_status))return {title:'Start preparing',label:'Start preparing',action:'progress',status:'preparing'};
 if(order.fulfillment_status==='preparing')return order.method==='pickup'?{title:'Mark ready for pickup',label:'Mark ready for pickup',action:'progress',status:'ready_for_pickup'}:{title:'Dispatch delivery',label:'Mark out for delivery',action:'progress',status:'out_for_delivery'};
 if(['ready_for_pickup','out_for_delivery'].includes(order.fulfillment_status))return {title:order.method==='pickup'?'Complete handoff':'Complete delivery',label:order.method==='pickup'?'Complete handoff':'Complete delivery',action:'progress',status:'completed'};
 return {title:'Review fulfillment',action:'details'};
}
export function orderQuickPanel(order,{escapeHtml:esc,money,formatDate,locked=false}){
 const next=orderNextStep(order),disabled=locked?'disabled':'',id=esc(order.id);
 const line=(title,value)=>`<div class="order-quick-line"><span>${title}</span><strong>${value}</strong></div>`;
 return `<span class="eyebrow">Next action</span><h2 id="order-quick-title" tabindex="-1">${esc(next.title)}</h2><p class="muted">${esc(order.reference)} · ${esc(order.buyer?.name||'Customer')}</p>${line('Items',esc((order.items||[]).map(i=>i.quantity+' × '+i.name).join(' · ')||'See full order for item details'))}${line('Due',esc(formatDate(order.fulfillment_date)))}${line('Method',esc(label(order.method)))}${line('Total',money(order.total_cents))}${order.delivery_charge?`<p class="muted">${esc(deliveryFeeSummary(order,money))}</p>`:''}<div class="order-quick-actions">${needsPaymentReview(order)?`<button type="button" class="button button-secondary" data-action="quick-order" data-intent="proof" data-id="${id}" ${disabled}>View payment proof</button>`:''}${next.action!=='details'?`<button type="button" class="button" data-action="quick-order" data-intent="${next.action}" data-id="${id}" ${disabled}>${esc(next.label)}</button>`:''}<button type="button" class="button button-quiet" data-action="open-order" data-id="${id}" ${disabled}>Open full order →</button></div><p class="muted">${needsPaymentReview(order)?'Check the uploaded receipt and the amount received before approving.':'Full order includes customer details, staff notes and order history.'}</p>`;
}
