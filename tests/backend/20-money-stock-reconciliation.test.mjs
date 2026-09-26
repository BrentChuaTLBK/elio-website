import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildAnalytics} from '../../dist/assets/admin/analytics.js';
import {buildProduction} from '../../dist/assets/admin/production.js';

export default async function({db,check,state}) {
  const h=state.h,{api,ids,item,checkout,action,order,scalar}=h;
  await api('save_settings',{settings:{paused:false,blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],cutoff_time:''}},ids.owner);
  const a=await h.product({kind:'flavor',name:'QA reconciliation premium',price_cents:2500});
  const b=await h.product({kind:'flavor',name:'QA reconciliation classic',price_cents:0});
  const box=await h.product({kind:'custom_box',name:'QA reconciliation box',price_cents:40000,lead_days:0});
  const date=await h.day(2);
  await h.inventory(a,date,100);await h.inventory(b,date,100);
  await api('save_zone',{zone:{name:'QA reconciliation delivery',localities:['QA Reconciliation City'],active:true,fee_cents:12345}},ids.owner);
  const line=quantity=>item(box,quantity,{flavors:{[a.id]:2,[b.id]:1}});
  const promo=async()=>api('save_promo',{promo:{code:'QAR'+randomUUID().replaceAll('-','').slice(0,10),kind:'percent',value:5,min_subtotal_cents:50000,cap_cents:10000,per_account_limit:1,global_limit:1,expires_at:new Date(Date.now()+86400000).toISOString(),active:true}},ids.owner);
  const request=(p,quantity=2)=>checkout(box,date,{items:[line(quantity)],promo_code:p.code,method:'delivery',address:{locality:'QA Reconciliation City',line1:'QA fixture address'}});
  const approve=async value=>{await h.proof(value);return action('approve_payment',await order(value.id));};
  const used=async value=>(await db.query('select state from elio.promo_usage where order_id=$1',[value.id])).rows.map(row=>row.state);
  const reports=value=>({sales:buildAnalytics([value]),production:buildProduction([value],date,date)});
  const assertTotals=(value,subtotal,discount,delivery,total)=>{
    assert.deepEqual([value.subtotal_cents,value.discount_cents,value.delivery_cents,value.total_cents],[subtotal,discount,delivery,total]);
    assert.equal(value.items.reduce((sum,row)=>sum+row.line_total_cents,0),subtotal);
  };
  let paid;

  await check('Paid quantity reductions reconcile saved prices, minimum discounts, stock, production and original payment',async()=>{
    const p=await promo();paid=await approve(await api('create_order',request(p),ids.customer));
    assertTotals(paid,90000,4500,12345,97845);
    assert.equal(paid.paid_amount_cents,97845);
    const recipe=paid.items[0].flavor_contents;
    await api('save_product',{product:{...a,price_cents:9000}},ids.owner);
    await api('save_product',{product:{...box,price_cents:80000}},ids.owner);
    paid=await action('edit_order',paid,{reason:'QA partial quantity cancellation',changes:{items:[line(1)]}});
    assertTotals(paid,45000,0,12345,57345);
    assert.equal(paid.paid_amount_cents,97845);
    assert.equal(paid.items[0].unit_price_cents,45000);
    assert.deepEqual(paid.items[0].flavor_contents,recipe);
    assert.deepEqual(await used(paid),['redeemed']);
    assert.equal(await h.remaining(a,date),98);assert.equal(await h.remaining(b,date),99);
    assert((await h.allocations(paid.id)).every(row=>row.state==='committed'));
    const {sales,production}=reports(paid);
    assert.equal(sales.currentOrderValueCents,57345);assert.equal(sales.refundDifferenceCents,40500);
    assert.equal(sales.approvedPaymentsCents,97845);assert.equal(sales.currentDiscountCents,0);assert.equal(sales.promoUseCount,0);
    assert.equal(sales.totalFlavorPieces,3);assert.equal(production.boxes,1);assert.equal(production.pieces,3);
  })();

  await check('Paid increases, delivery-to-pickup changes and duplicate edit retries preserve one payment and exact stock',async()=>{
    const payload={order_id:paid.id,revision:paid.revision,idempotency_key:randomUUID(),reason:'QA increase and pickup',changes:{items:[line(3)],method:'pickup'}};
    const changed=await api('edit_order',payload,ids.owner),retry=await api('edit_order',payload,ids.owner);
    assert.equal(changed.revision,retry.revision);assert.deepEqual(changed.items,retry.items);
    paid=retry;assertTotals(paid,135000,6750,0,128250);assert.equal(paid.paid_amount_cents,97845);
    assert.equal(await scalar('select count(*)::int from elio.payments where order_id=$1',[paid.id]),1);
    assert.deepEqual(await used(paid),['redeemed']);
    assert.equal(await h.remaining(a,date),94);assert.equal(await h.remaining(b,date),97);
    const {sales,production}=reports(paid);
    assert.equal(sales.additionalPaymentCents,30405);assert.equal(sales.refundDifferenceCents,0);
    assert.equal(sales.currentProductValueCents-sales.currentDiscountCents+sales.currentDeliveryCents,sales.currentOrderValueCents);
    assert.equal(sales.totalUnits,3);assert.equal(sales.totalFlavorPieces,9);assert.equal(production.boxes,3);assert.equal(production.pieces,9);
    await assert.rejects(()=>api('edit_order',{...payload,changes:{items:[line(4)],method:'pickup'}},ids.owner),/action key/);
    assert.equal((await order(paid.id)).revision,paid.revision);
  })();

  await check('Refund labels and paid cancellations reconcile reports while preserving redeemed use and chosen stock treatment',async()=>{
    const before=await h.allocations(paid.id);
    paid=await action('set_refund_label',paid,{enabled:true,reason:'QA refund reporting'});
    assert.deepEqual(await h.allocations(paid.id),before);assert.deepEqual(await used(paid),['redeemed']);
    let report=reports(paid);assert.equal(report.sales.currentOrderValueCents,0);assert.equal(report.sales.approvedPaymentsCents,97845);assert.equal(report.production.pieces,0);
    paid=await action('set_refund_label',paid,{enabled:false,reason:'QA correction'});
    assert.equal(reports(paid).production.pieces,9);
    paid=await action('cancel_order',paid,{restore_stock:false,reason:'QA already produced'});
    assert((await h.allocations(paid.id)).every(row=>row.state==='retained'));
    assert.equal(await h.remaining(a,date),94);assert.equal(await h.remaining(b,date),97);
    assert.deepEqual(await used(paid),['redeemed']);report=reports(paid);
    assert.equal(report.sales.currentOrderValueCents,0);assert.equal(report.sales.approvedPaymentsCents,97845);assert.equal(report.production.boxes,0);
    await assert.rejects(()=>action('edit_order',paid,{reason:'QA closed edit',changes:{items:[line(1)]}}),/Closed or completed/);
    const fresh=await approve(await api('create_order',checkout(box,date,{items:[line(1)]}),ids.customer));
    const restored=await action('cancel_order',fresh,{restore_stock:true,reason:'QA unproduced'});
    assert.equal((await h.allocations(restored.id)).length,0);
    assert.equal(await h.remaining(a,date),94);assert.equal(await h.remaining(b,date),97);
    assert.equal(restored.paid_amount_cents,fresh.paid_amount_cents);
  })();

  await check('Failed promo requalification rolls back order edits and allocations after a different order consumes the released use',async()=>{
    await api('save_product',{product:a},ids.owner);await api('save_product',{product:box},ids.owner);
    const p=await promo();let first=await api('create_order',request(p),ids.customer);
    first=await action('edit_order',first,{reason:'QA reduction below minimum',changes:{items:[line(1)]}});
    assert.deepEqual(await used(first),[]);
    const second=await api('create_order',request(p),ids.stranger);
    first=await order(first.id);
    const allocations=await h.allocations(first.id),remaining=await h.remaining(a,date);
    await assert.rejects(()=>action('edit_order',first,{reason:'QA unavailable promo use',changes:{items:[line(2)]}}),/total use limit/);
    assert.deepEqual(await order(first.id),first);assert.deepEqual(await h.allocations(first.id),allocations);
    assert.equal(await h.remaining(a,date),remaining);assert.deepEqual(await used(first),[]);assert.deepEqual(await used(second),['reserved']);
    await action('cancel_order',second,{reason:'QA cleanup'});await action('cancel_order',first,{reason:'QA cleanup'});
  })();
}
