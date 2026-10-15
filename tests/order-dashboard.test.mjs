import assert from 'node:assert/strict';
import {isUpcomingOrder,matchesOrderView,orderNextStep,orderQuickPanel} from '../dist/assets/admin/order-dashboard.js';
import {adminOrderView} from '../dist/assets/admin/progress-state.js';
const today='2026-10-02',base={id:'order',reference:'ELIO-TEST',method:'pickup',fulfillment_date:today,payment_status:'paid',fulfillment_status:'confirmed',items:[],total_cents:10000};
for(const status of ['completed','cancelled','expired','refunded']){const order={...base,fulfillment_status:status};assert.equal(matchesOrderView(order,'today',today),false);assert.equal(orderNextStep(order).action,'details');}
assert.equal(matchesOrderView({...base,refund_label:true},'today',today),false);assert.equal(orderNextStep({...base,refund_label:true}).action,'details');
assert.equal(matchesOrderView({...base,payment_status:'under_review',fulfillment_status:'pending_confirmation'},'review',today),true);
assert.equal(matchesOrderView({...base,payment_status:'under_review'},'review',today),false);
assert.equal(matchesOrderView({...base,fulfillment_date:'2026-10-03'},'today',today),false);
for(const fulfillment_status of ['pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery'])assert.equal(isUpcomingOrder({...base,fulfillment_status,fulfillment_date:'2026-10-01'},today),true,'Overdue paid '+fulfillment_status+' remains upcoming');
for(const payment_status of ['awaiting_payment','under_review','rejected']){
 assert.equal(isUpcomingOrder({...base,payment_status,fulfillment_date:'2026-10-01'},today),false,'Overdue '+payment_status+' does not enter upcoming');
 for(const fulfillment_date of [today,'2026-10-03'])assert.equal(isUpcomingOrder({...base,payment_status,fulfillment_date},today),true,'Current/future active '+payment_status+' remains upcoming');
}
for(const fulfillment_status of ['completed','cancelled','expired','refunded'])for(const fulfillment_date of ['2026-10-01',today,'2026-10-03']){
 assert.equal(isUpcomingOrder({...base,fulfillment_status,fulfillment_date},today),false,'Closed orders never remain upcoming');
 assert.equal(matchesOrderView({...base,payment_status:'awaiting_payment',fulfillment_status,fulfillment_date},'awaiting_payment',today),false,'Closed orders do not await payment');
}
for(const fulfillment_date of ['2026-10-01',today,'2026-10-03']){
 assert.equal(matchesOrderView({...base,payment_status:'awaiting_payment',fulfillment_date},'awaiting_payment',today),true,'Awaiting payment spans all dates');
 assert.equal(isUpcomingOrder({...base,refund_label:true,fulfillment_date},today),false,'Refund labels remove orders from upcoming');
 assert.equal(matchesOrderView({...base,payment_status:'awaiting_payment',refund_label:true,fulfillment_date},'awaiting_payment',today),false,'Refund labels remove orders from awaiting payment');
}
for(const payment_status of ['under_review','paid','rejected','cancelled'])assert.equal(matchesOrderView({...base,payment_status,fulfillment_status:'pending_confirmation'},'awaiting_payment',today),false,'Awaiting payment excludes '+payment_status);
for(const [status,method,expected]of [['confirmed','pickup','preparing'],['preparing','pickup','ready_for_pickup'],['preparing','delivery','out_for_delivery'],['out_for_delivery','delivery','completed'],['ready_for_pickup','pickup','completed']])assert.equal(orderNextStep({...base,fulfillment_status:status,method}).status,expected);
assert.equal(orderNextStep({...base,payment_status:'awaiting_payment'}).action,'details');assert.equal(orderNextStep({...base,order_source:'direct'}).action,'pos');
const escaped=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const markup=orderQuickPanel({...base,buyer:{name:'<img src=x onerror=alert(1)>'},items:[{name:'<script>',quantity:1}]},{escapeHtml:escaped,money:n=>'PHP '+n/100,formatDate:x=>x,locked:true});assert(!markup.includes('<img'));assert(!markup.includes('<script>'));assert.match(markup,/disabled/);
const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},views=adminOrderView(storage);
views.save('owner-a','orders',{method:'delivery'},'review');assert.equal(views.restore('owner-a').taskView,'review');assert.equal(views.restore('owner-a').filters.method,'delivery');assert.equal(views.restore('owner-b'),null);views.save('owner-a','orders',{},'unknown');assert.equal(views.restore('owner-a').taskView,undefined);
views.save('owner-a','orders',{upcoming:true},'awaiting_payment');assert.equal(views.restore('owner-a').taskView,'awaiting_payment');assert.equal(views.restore('owner-a').filters.upcoming,true);assert.equal(views.restore('owner-b'),null);
console.log('PASS order task rules, overdue paid upcoming, active awaiting-payment dates, closed/refund exclusions, escaping and identity-scoped task memory');
