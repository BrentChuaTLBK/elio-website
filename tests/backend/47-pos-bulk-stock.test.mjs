import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export default async function({check,state}){
 const h=state.h,{api,ids,scalar}=h,day=await h.day(0),eid=randomUUID(),other=randomUUID();
 const owner=(a,p={})=>api(a,{event_id:eid,...p},ids.owner),data=()=>owner('pos_event_data');
 await owner('pos_save_event',{name:'Bulk stock fixture',starts_on:day,ends_on:day});await api('pos_save_event',{event_id:other,name:'Other bulk event',starts_on:day,ends_on:day},ids.owner);
 const stocks=[];for(const [name,available,surcharge_cents] of [['Bulk Vanilla',10,1000],['Bulk Chocolate',20,2000]])stocks.push(await owner('pos_save_event_stock',{id:randomUUID(),name,available,expected_available:0,revision:0,surcharge_cents,reason:'Fixture'}));
 const row=(s,available)=>({id:s.id,revision:s.revision,expected_available:s.remaining,available});
 await check('bulk event stock is owner-only, rejects invalid quantities, duplicates and foreign stock, and remains private',async()=>{
  const payload={items:stocks.map(s=>row(s,15)),reason:'Counted event stock'};
  for(const user of [null,ids.staff,ids.customer])await assert.rejects(api('pos_bulk_event_stock',{event_id:eid,...payload},user),/owner|authorized/i);
  for(const available of [-1,1.5,1000001,'2',null])await assert.rejects(owner('pos_bulk_event_stock',{...payload,items:[row(stocks[0],available)]}));
  await assert.rejects(owner('pos_bulk_event_stock',{...payload,items:[row(stocks[0],15),row(stocks[0],15)]}),/once/i);
  await assert.rejects(owner('pos_bulk_event_stock',{...payload,event_id:other}),/belong/i);
  await assert.rejects(owner('pos_bulk_event_stock',{...payload,reason:''}),/reason/i);
  assert.equal((await data()).stock.find(s=>s.id===stocks[0].id).remaining,10);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.pos_bulk_event_stock(jsonb)','execute')",[role]),false);
 })();
 let order;
 await check('bulk stock saves roll back every row when a concurrent sale changes one quantity',async()=>{
  const item=await owner('pos_save_event_item',{id:randomUUID(),name:'Bulk test slice',price_cents:10000,recipe:[{stock_id:stocks[1].id,quantity:2}]});await owner('pos_open_cash',{date:day,opening_cents:0});
  const sale={event_id:eid,order_source:'in_person',fulfillment_date:day,method:'pickup',paid:true,pos_handed_over:true,payment:{method:'cash',cash_received_cents:10000},items:[{source:'event',product_id:item.id,quantity:1,selections:{}}]};
  const quote=await owner('pos_quote',sale);order=await owner('pos_create_order',{...sale,expected_quote:quote,idempotency_key:randomUUID()});
  const beforeAudit=await scalar("select count(*) from elio.pos_audit where action='pos_save_event_stock'");
  await assert.rejects(owner('pos_bulk_event_stock',{items:[row(stocks[0],30),row(stocks[1],30)],reason:'Stale stock count'}),/Stock changed/i);
  const current=(await data()).stock;assert.equal(current.find(s=>s.id===stocks[0].id).remaining,10);assert.equal(current.find(s=>s.id===stocks[1].id).remaining,18);assert.equal(await scalar("select count(*) from elio.pos_audit where action='pos_save_event_stock'"),beforeAudit);
 })();
 await check('bulk counts preserve sales, allocations, prices, website stock and accounting; repeat/stale edits cannot overwrite changes',async()=>{
  const before=await h.order(order.id),alloc=await scalar('select jsonb_agg(to_jsonb(a)) from elio.pos_event_allocations a where order_id=$1',[order.id]),website=await scalar('select count(*) from elio.inventory'),ledger=await scalar('select jsonb_agg(to_jsonb(l)) from elio.accounting_ledger l where order_id=$1',[order.id]);
  const current=(await data()).stock,payload={items:current.map(s=>row(s,s.id===stocks[0].id?0:12)),reason:'Count after sale'},result=await owner('pos_bulk_event_stock',payload);assert.equal(result.updated.length,2);
  const updated=(await data()).stock;assert.equal(updated.find(s=>s.id===stocks[0].id).remaining,0);assert.equal(updated.find(s=>s.id===stocks[1].id).remaining,12);assert.equal(updated.find(s=>s.id===stocks[1].id).capacity,14);
  for(const s of updated){assert.equal(s.name,current.find(x=>x.id===s.id).name);assert.equal(s.surcharge_cents,current.find(x=>x.id===s.id).surcharge_cents);assert.equal(s.revision,current.find(x=>x.id===s.id).revision+1);}
  await assert.rejects(owner('pos_bulk_event_stock',payload),/changed/i);assert.deepEqual(await h.order(order.id),before);assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a)) from elio.pos_event_allocations a where order_id=$1',[order.id]),alloc);assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(l)) from elio.accounting_ledger l where order_id=$1',[order.id]),ledger);assert.equal(await scalar('select count(*) from elio.inventory'),website);
  await owner('pos_delete_event_stock',{id:updated[0].id,revision:updated[0].revision});await assert.rejects(owner('pos_bulk_event_stock',{items:[row(updated[0],4)],reason:'Deleted stock'}),/deleted/i);
  const ev=await data();await owner('pos_delete_event',{revision:ev.revision});await assert.rejects(owner('pos_bulk_event_stock',{items:[row(updated[1],4)],reason:'Deleted event'}),/deleted/i);
 })();
}
