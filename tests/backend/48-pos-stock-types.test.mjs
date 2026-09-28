import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({check,state}){
 const h=state.h,{api,ids,scalar}=h,{product,date}=await accountingFixture(h),day=await h.day(0),event_id=randomUUID();
 const owner=(a,p={})=>api(a,{event_id,...p},ids.owner),data=()=>owner('pos_event_data');
 await owner('pos_save_event',{name:'Separate stock fixture',starts_on:day,ends_on:day});
 let pouch,flavor,box,item;
 await check('event flavors and standalone stock stay separate; custom boxes reject non-flavor stock',async()=>{
  await owner('pos_import_event_flavors',{flavors:[{product_id:product.box_flavors[0],available:12}]});
  flavor=(await data()).stock[0];assert.equal(flavor.stock_type,'flavor');
  pouch=await owner('pos_save_event_stock',{id:randomUUID(),stock_type:'item',name:'Krisp Nori Pouch',available:100,expected_available:0,revision:0,reason:'Event stock'});assert.equal(pouch.stock_type,'item');
  const custom=await h.product({kind:'custom_box',name:'Typed box',price_cents:80000,lead_days:0});
  await owner('pos_import_event_products',{product_ids:[custom.id]});box=(await data()).items.find(i=>i.source_product_id===custom.id);
  assert.deepEqual(box.choice_stock_ids,[flavor.id]);
  await assert.rejects(owner('pos_save_event_choice_item',{...box,choice_stock_ids:[flavor.id,pouch.id]}),/flavor stock/i);
  const update=s=>({...s,available:s.remaining,expected_available:s.remaining,reason:'Type correction'});
  await assert.rejects(owner('pos_save_event_stock',{...update(flavor),stock_type:'item'}),/Imported website flavors/i);
  await assert.rejects(owner('pos_save_event_stock',{...update(pouch),stock_type:'unknown'}),/Choose flavor stock/i);
  const manual=await owner('pos_save_event_stock',{id:randomUUID(),stock_type:'flavor',name:'Manual Vanilla',available:3,expected_available:0,revision:0,reason:'Event flavor'});
  box=await owner('pos_save_event_choice_item',{...box,choice_stock_ids:[flavor.id,manual.id]});
  await assert.rejects(owner('pos_save_event_stock',{...update(manual),stock_type:'item'}),/Remove this flavor/i);
 })();
 await check('one nori pouch sale takes stock from 100 to 99 with correct accounting and no flavor or website deduction',async()=>{
  item=await owner('pos_save_event_item',{id:randomUUID(),name:'Krisp Nori Pouch',price_cents:10000,recipe:[{stock_id:pouch.id,quantity:1}]});
  await owner('pos_open_cash',{date:day,opening_cents:0});
  const before=await h.remaining({id:product.box_flavors[0]},date),sale={event_id,order_source:'in_person',fulfillment_date:day,method:'pickup',paid:true,pos_handed_over:true,payment:{method:'cash',cash_received_cents:10000},items:[{source:'event',product_id:item.id,quantity:1,selections:{}}]};
  const quote=await owner('pos_quote',sale),order=await owner('pos_create_order',{...sale,expected_quote:quote,idempotency_key:randomUUID()});assert.equal(quote.total_cents,10000);
  const current=await data();assert.equal(current.stock.find(s=>s.id===pouch.id).remaining,99);assert.equal(current.stock.find(s=>s.id===flavor.id).remaining,12);assert.equal(current.items.find(i=>i.id===item.id).remaining,99);
  assert.equal(await h.remaining({id:product.box_flavors[0]},date),before);assert.equal(await scalar('select sum(amount_cents)::integer from elio.accounting_ledger where order_id=$1',[order.id]),10000);
  assert.equal(await scalar('select count(*) from elio.calendar_events where order_id=$1',[order.id]),0);
  await assert.rejects(owner('pos_quote',{...sale,items:[{source:'event',product_id:box.id,quantity:1,selections:{flavors:{[pouch.id]:3}}}]}),/unavailable/i);
  await assert.rejects(owner('pos_quote',{...sale,items:[{...sale.items[0],quantity:100}]}),/stock/i);
  assert.equal((await h.order(order.id)).items[0].name,'Krisp Nori Pouch');
 })();
}
