import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar}=h,{product,date}=await accountingFixture(h),today=await h.day(0),later=await h.day(3);let pickup,delivery;
 const create=async changes=>{const p={order_source:'direct',method:'pickup',fulfillment_date:date,items:[h.item(product)],paid:true,payment:{method:'cash',cash_received_cents:50000},buyer:{name:'Direct calendar customer',phone:'09170000000'},...changes};return api('pos_create_order',{...p,expected_quote:await api('pos_quote',p,ids.staff),idempotency_key:randomUUID()},ids.staff);};
 const queued=id=>scalar('select (select to_jsonb(e) from elio.calendar_events e where order_id=$1)',[id]);
 await check('paid direct pickup and delivery orders appear in the admin calendar and Google sync queue; unpaid stays out',async()=>{
  const unpaid=await create({paid:false});assert.equal(await queued(unpaid.id),null);
  pickup=await create({});delivery=await create({method:'delivery',delivery_fee_pending:true,recipient:{name:'Delivery client',phone:'09171111111'},address:{line1:'QA street',locality:'Quezon City'}});
  const calendar=await api('calendar_list',{from:date,to:date},ids.staff);
  for(const order of [pickup,delivery]){const entry=calendar.orders.find(x=>x.id===order.id);assert(entry);assert.equal(entry.method,order.method);assert.equal(entry.date,date);assert.equal((await queued(order.id)).desired.method,order.method);}
  assert.equal((await queued(delivery.id)).desired.address.locality,'Quezon City');
  assert(!calendar.orders.some(x=>x.id===unpaid.id));
  const completed=await create({fulfillment_date:today,pos_handed_over:true,items:[{source:'custom',product_id:randomUUID(),name:'Direct immediate order',quantity:1,unit_price_cents:10000,selections:{}}]});assert.equal(completed.fulfillment_status,'completed');assert(await queued(completed.id));
 })();
 await check('direct rescheduling updates the existing Google event; cancellation and refund queue its removal',async()=>{
  await h.inventory({id:product.box_flavors[0]},later,100);
  const before=await queued(pickup.id);pickup=await h.action('edit_order',pickup,{changes:{fulfillment_date:later},reason:'Customer changed pickup date'});
  const after=await queued(pickup.id);assert.equal(after.event_id,before.event_id);assert.equal(after.desired.date,later);assert(after.revision>before.revision);
  pickup=await h.action('cancel_order',pickup,{reason:'Calendar cancellation test',restore_stock:false});assert.equal((await queued(pickup.id)).desired,null);
  delivery=await h.action('set_refund_label',delivery,{enabled:true,reason:'Calendar refund test'});assert.equal((await queued(delivery.id)).desired,null);
 })();
 await check('event pickup and delivery sales stay out of both calendars even when scheduled or not handed over',async()=>{
  const event_id=randomUUID();await api('pos_save_event',{event_id,name:'Isolated calendar exclusion event',starts_on:today,ends_on:later},ids.owner);
  const stock=await api('pos_save_event_stock',{event_id,id:randomUUID(),revision:0,name:'Event pieces',available:10,expected_available:0,reason:'Test'},ids.owner);
  const item=await api('pos_save_event_item',{event_id,id:randomUUID(),revision:0,name:'Event item',price_cents:10000,active:true,recipe:[{stock_id:stock.id,quantity:1}]},ids.owner);
  await api('pos_open_cash',{event_id,date:today,opening_cents:0},ids.staff);
  for(const method of ['pickup','delivery']){
   const order=await create({event_id,order_source:'in_person',method,fulfillment_date:date,pos_handed_over:false,items:[{source:'event',product_id:item.id,quantity:1,selections:{}}]});
   assert.equal(order.fulfillment_status,'confirmed');assert.equal(await queued(order.id),null);
   const calendar=await api('calendar_list',{from:date,to:date},ids.staff);assert(!calendar.orders.some(x=>x.id===order.id));
   await db.query("update elio.orders set fulfillment_status='completed' where id=$1",[order.id]);assert.equal(await queued(order.id),null);
  }
 })();
}
