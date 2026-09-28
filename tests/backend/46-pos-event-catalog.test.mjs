import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar}=h,{product,date}=await accountingFixture(h),today=await h.day(0),event_id=randomUUID(),other=randomUUID();
 const flavor=product.box_flavors[0],second=await h.product({kind:'flavor',name:'Import Chocolate',price_cents:2500,lead_days:0}),box=await h.product({kind:'set',name:'Import mixed box',box_flavors:[flavor,flavor,second.id],price_cents:12000,lead_days:0}),custom=await h.product({kind:'custom_box',name:'Import BYO',price_cents:80000,lead_days:0});
 const owner=(a,p={})=>api(a,{event_id,...p},ids.owner),staff=(a,p={})=>api(a,{event_id,...p},ids.staff),data=()=>owner('pos_event_data');let ev,stock,items,order;
 await owner('pos_save_event',{name:'Import and delete fixture',starts_on:today,ends_on:today});
 await api('pos_save_event',{event_id:other,name:'Other event',starts_on:today,ends_on:today},ids.owner);
 await check('event imports/deletes are owner-only and flavor stock starts with independently entered quantities',async()=>{
  for(const user of [null,ids.staff,ids.customer])for(const action of ['pos_import_event_products','pos_import_event_flavors','pos_delete_event','pos_delete_event_stock','pos_delete_event_item','pos_save_event_choice_item'])await assert.rejects(api(action,{event_id},user),/owner|authorized/i);
  await assert.rejects(owner('pos_import_event_products',{product_ids:[custom.id]}),/flavors first/i);
  const before=await h.remaining({id:flavor},date);
  const imported=await owner('pos_import_event_flavors',{flavors:[{product_id:flavor,available:10},{product_id:second.id,available:5}]});assert.equal(imported.imported.length,2);
  stock=(await data()).stock;assert.equal(stock.find(s=>s.source_product_id===flavor).remaining,10);assert.equal(stock.find(s=>s.source_product_id===second.id).surcharge_cents,2500);assert.equal(await h.remaining({id:flavor},date),before);
  await assert.rejects(owner('pos_import_event_flavors',{flavors:[{product_id:product.id,available:5}]}),/flavor.*unavailable/i);
 })();
 await check('imported fixed and custom boxes share event flavors, copy prices, and survive duplicate import retries',async()=>{
  const imported=await owner('pos_import_event_products',{product_ids:[product.id,box.id,custom.id]});assert.equal(imported.imported.length,3);assert.equal(imported.stock_created,0);
  ev=await data();items=ev.items;const fixed=items.find(i=>i.source_product_id===box.id),byo=items.find(i=>i.source_product_id===custom.id);assert.equal(fixed.price_cents,12000);assert.equal(fixed.recipe.length,2);assert.equal(byo.kind,'custom_box');assert.equal(byo.choice_stock_ids.length,2);assert.equal(byo.remaining,5);
  const repeat=await owner('pos_import_event_products',{product_ids:[product.id,box.id,custom.id]});assert.equal(repeat.imported.length,0);assert.equal(repeat.skipped,3);
  await owner('pos_import_event_flavors',{flavors:[{product_id:flavor,available:999}]});assert.equal((await data()).stock.find(s=>s.source_product_id===flavor).remaining,10);
  await assert.rejects(api('pos_save_event_stock',{event_id:other,id:stock[0].id,revision:0,name:'Cross-event overwrite',available:10,expected_available:10,reason:'Test'},ids.owner),/another event/i);
 })();
 await check('event custom boxes validate exact choices, deduct selected event stock, and keep website stock/accounting separate',async()=>{
  await staff('pos_open_cash',{date:today,opening_cents:0});const first=stock.find(s=>s.source_product_id===flavor),last=stock.find(s=>s.source_product_id===second.id),byo=items.find(i=>i.source_product_id===custom.id),fixed=items.find(i=>i.source_product_id===product.id);
  const payload={order_source:'in_person',event_id,fulfillment_date:today,method:'pickup',paid:true,payment:{method:'cash',cash_received_cents:100000},items:[{source:'event',product_id:byo.id,quantity:1,selections:{flavors:{[first.id]:1,[last.id]:2}}},{source:'event',product_id:fixed.id,quantity:1,selections:{}}]};
  const before=await h.remaining({id:flavor},date),quote=await staff('pos_quote',payload);assert.equal(quote.total_cents,95000);assert.equal(quote.items[0].unit_price_cents,85000);
  for(const selections of [{flavors:{[first.id]:4}},{flavors:{[first.id]:2}},{flavors:{[first.id]:-1,[last.id]:4}},{flavors:{[randomUUID()]:3}}])await assert.rejects(staff('pos_quote',{...payload,items:[{...payload.items[0],selections}]}));
  order=await staff('pos_create_order',{...payload,expected_quote:quote,idempotency_key:randomUUID()});assert.equal(order.pos_payment.change_cents,5000);
  const after=await data();assert.equal(after.stock.find(s=>s.id===first.id).remaining,6);assert.equal(after.stock.find(s=>s.id===last.id).remaining,3);assert.equal(await h.remaining({id:flavor},date),before);
  assert.equal(await scalar('select count(*) from elio.allocations where order_id=$1',[order.id]),0);assert.equal(await scalar('select count(*) from elio.calendar_events where order_id=$1',[order.id]),0);
  assert.equal(await scalar('select sum(amount_cents)::integer from elio.accounting_ledger where order_id=$1',[order.id]),95000);
  const changed=await owner('pos_save_event_choice_item',{id:byo.id,revision:byo.revision,name:byo.name,price_cents:100000,choice_stock_ids:byo.choice_stock_ids,active:true});assert.equal(changed.price_cents,100000);assert.equal((await h.order(order.id)).items[0].unit_price_cents,85000);
  await owner('pos_import_event_products',{product_ids:[custom.id]});assert.equal((await data()).items.find(i=>i.id===byo.id).price_cents,100000);
 })();
 await check('deleting stock disables dependent fixed recipes and removes choices while preserving orders and allocations',async()=>{
  ev=await data();const removed=ev.stock.find(s=>s.source_product_id===second.id),original=(await h.order(order.id)).items,allocations=await scalar('select count(*) from elio.pos_event_allocations where order_id=$1',[order.id]);
  await owner('pos_delete_event_stock',{id:removed.id,revision:removed.revision});ev=await data();assert(!ev.stock.some(s=>s.id===removed.id));
  assert.equal(ev.items.find(i=>i.source_product_id===box.id).active,false);assert(!ev.items.find(i=>i.source_product_id===custom.id).choice_stock_ids.includes(removed.id));
  assert.deepEqual((await h.order(order.id)).items,original);assert.equal(await scalar('select count(*) from elio.pos_event_allocations where order_id=$1',[order.id]),allocations);
  await assert.rejects(owner('pos_save_event_stock',{id:removed.id,revision:removed.revision+1,name:removed.name,available:10,expected_available:3,reason:'Cannot resurrect'}),/deleted/i);
  const updated=await h.action('edit_order',await h.order(order.id),{changes:{instructions:'Keep original event recipe'},reason:'Historical edit'});assert.deepEqual(updated.items,original);
  const changes={items:[...updated.items,updated.items[0]]};await assert.rejects(h.action('preview_edit_order',updated,{changes}),/unavailable/i);
 })();
 await check('deleting event items and events hides selling controls but retains accounting and report history',async()=>{
  ev=await data();const removed=ev.items.find(i=>i.source_product_id===custom.id);await owner('pos_delete_event_item',{id:removed.id,revision:removed.revision});assert(!(await data()).items.some(i=>i.id===removed.id));
  const event=await owner('pos_delete_event',{revision:ev.revision});assert(event.deleted_at);assert.equal(event.active,false);
  assert(!(await owner('pos_events')).some(e=>e.id===event_id));assert((await owner('pos_events',{include_deleted:true})).some(e=>e.id===event_id));
  const report=await staff('pos_event_report',{date:today});assert.equal(report.sales[0].total_cents,95000);assert.equal(report.cash.expected_cents,95000);assert(report.stock.some(s=>s.deleted_at));
  const accounting=await api('accounting_report',{report_version:2,start:today,end:today},ids.owner);assert(accounting.entries.some(e=>e.order_id===order.id&&e.amount_cents===95000));
  await assert.rejects(owner('pos_save_event',{revision:event.revision,name:'Restore',starts_on:today,ends_on:today}),/deleted/i);
  await assert.rejects(owner('pos_import_event_products',{product_ids:[product.id]}),/deleted/i);
  await staff('pos_close_cash',{date:today,revision:report.cash.revision,expected_cents:report.cash.expected_cents,counted_cents:95000});
  assert((await staff('pos_event_report',{date:today})).cash.closed_at);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.pos_event_catalog_action(text,jsonb)','execute')",[role]),false);
 })();
}
