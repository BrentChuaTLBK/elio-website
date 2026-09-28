import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({check,state}){
 const h=state.h,{api,ids,scalar}=h,{product,date}=await accountingFixture(h),day=await h.day(0),event_id=randomUUID();
 const owner=(action,p={})=>api(action,{event_id,...p},ids.owner),data=()=>owner('pos_event_data');
 await owner('pos_save_event',{name:'Simple product fixture',starts_on:day,ends_on:day});
 const setup={id:randomUUID(),stock_id:randomUUID(),name:'Krisp Nori Pouch',price_cents:13000,available:100,expected_available:0,revision:0,stock_revision:0,active:true};
 let item,order;
 await check('simple event products save name price and stock together with owner authorization',async()=>{
  for(const user of [null,ids.staff,ids.customer])await assert.rejects(api('pos_save_event_simple_item',{event_id,...setup},user),/owner|authorized/i);
  item=await owner('pos_save_event_simple_item',setup);assert.equal(item.price_cents,13000);assert.deepEqual(item.recipe,[{stock_id:setup.stock_id,quantity:1}]);
  const d=await data();assert.equal(d.items.length,1);assert.equal(d.items[0].remaining,100);assert.equal(d.stock.length,1);assert.equal(d.stock[0].name,setup.name);assert.equal(d.stock[0].stock_type,'item');
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.pos_save_event_simple_item(jsonb)','execute')",[role]),false);
 })();
 await check('invalid or stale simple product saves leave no orphan stock or partial edits',async()=>{
  for(const change of [{available:1.5},{available:-1},{price_cents:-1},{name:''}]){
   const bad={...setup,id:randomUUID(),stock_id:randomUUID(),...change};await assert.rejects(owner('pos_save_event_simple_item',bad));
   assert.equal(await scalar('select count(*) from elio.pos_event_stock where id=$1',[bad.stock_id]),0);
  }
  await assert.rejects(owner('pos_save_event_simple_item',{...setup,name:'Stale edit'}),/changed/i);
  assert.equal((await data()).items[0].name,setup.name);
 })();
 const sale={event_id,order_source:'in_person',fulfillment_date:day,method:'pickup',paid:true,pos_handed_over:true,payment:{method:'cash',cash_received_cents:20000},items:[{source:'event',product_id:setup.id,quantity:1,selections:{}}]};
 await owner('pos_open_cash',{date:day,opening_cents:0});
 await check('one simple sale deducts 100 to 99 with correct cash change and accounting, leaving website stock and calendar alone',async()=>{
  const before=await h.remaining({id:product.box_flavors[0]},date),q=await owner('pos_quote',sale);order=await owner('pos_create_order',{...sale,expected_quote:q,idempotency_key:randomUUID()});
  assert.equal(order.total_cents,13000);assert.equal(order.pos_payment.change_cents,7000);assert.equal((await data()).items[0].remaining,99);
  assert.equal(await scalar('select sum(amount_cents)::integer from elio.accounting_ledger where order_id=$1',[order.id]),13000);
  assert.equal(await scalar('select count(*) from elio.calendar_events where order_id=$1',[order.id]),0);assert.equal(await h.remaining({id:product.box_flavors[0]},date),before);
 })();
 await check('simple product stock and price edits preserve sales and reject stock from another product',async()=>{
  let d=await data(),p=d.items[0],s=d.stock[0];const old=(await h.order(order.id)).items;
  await assert.rejects(owner('pos_save_event_simple_item',{...setup,revision:p.revision,stock_revision:s.revision,price_cents:15000}),/stock.*changed/i);
  assert.equal((await data()).items[0].price_cents,13000);
  await owner('pos_save_event_simple_item',{...setup,revision:p.revision,stock_revision:s.revision,expected_available:99,available:3,price_cents:15000});
  d=await data();assert.equal(d.items[0].remaining,3);assert.equal(d.stock[0].capacity,4);assert.deepEqual((await h.order(order.id)).items,old);
  const other=await owner('pos_save_event_simple_item',{...setup,id:randomUUID(),stock_id:randomUUID()});
  await assert.rejects(owner('pos_save_event_simple_item',{...setup,revision:d.items[0].revision,stock_id:other.recipe[0].stock_id}),/own stock/i);
  const tooMany={...sale,items:[{...sale.items[0],quantity:4}]};await assert.rejects(owner('pos_quote',tooMany),/stock/i);
 })();
}
