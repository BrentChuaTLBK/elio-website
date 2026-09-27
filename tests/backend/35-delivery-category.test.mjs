import assert from 'node:assert/strict';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}){
 const h=state.h,{api,ids}=h,today=await h.day(0);
 const report=()=>api('accounting_report',{report_version:2,start:today,end:today},ids.owner);
 await check('Delivery is one category with separate fee income and courier expenses, including historical rows',async()=>{
  let r=await report();const delivery=r.categories.find(c=>c.name==='Delivery');assert(delivery);
  assert.equal(r.categories.filter(c=>['delivery_fee','delivery_cost'].includes(c.system_key)).length,1);
  assert(!r.categories.some(c=>c.name==='Delivery fees'||c.name==='Delivery costs'));
  const before=r.summary.find(c=>c.id===delivery.id);
  const f=await accountingFixture(h);let o=await api('create_order',h.checkout(f.product,f.date),ids.customer);o=await h.proof(o);
  await db.query("update elio.orders set method='delivery',data=data||'{\"delivery_cents\":25000,\"total_cents\":35000}'::jsonb where id=$1",[o.id]);
  o=await h.action('approve_payment',await h.order(o.id));
  await api('accounting_save_delivery',{order_id:o.id,order_revision:o.revision,revision:0,cost_date:today,amount_cents:20000,note:'Delivery merge test'},ids.owner);
  r=await report();const rows=r.entries.filter(e=>e.order_id===o.id&&e.category_id===delivery.id);
  assert.equal(rows.length,2);assert.equal(rows.find(e=>e.kind==='sale').amount_cents,25000);assert.equal(rows.find(e=>e.kind==='expense').amount_cents,20000);
  const combined=r.summary.find(c=>c.id===delivery.id);assert.equal(combined.sales_cents-before.sales_cents,25000);assert.equal(combined.expense_cents-before.expense_cents,20000);
  assert.equal(r.deliveries.find(d=>d.order_id===o.id).fee_cents,25000);assert.equal(r.deliveries.find(d=>d.order_id===o.id).cost_cents,20000);
  await h.action('set_refund_label',await h.order(o.id),{enabled:true});r=await report();assert(!r.entries.some(e=>e.order_id===o.id));
  assert.equal(r.summary.find(c=>c.id===delivery.id).sales_cents,before.sales_cents);assert.equal(r.summary.find(c=>c.id===delivery.id).expense_cents,before.expense_cents);
 })();
}
