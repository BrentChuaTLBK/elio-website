import assert from 'node:assert/strict';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}) {
 const h=state.h,{product,date}=await accountingFixture(h);
 let order=await h.api('create_order',h.checkout(product,date),h.ids.customer);
 await check('list payloads omit audit snapshots while full order details retain them',async()=>{
  order=await h.action('approve_payment',await h.proof(order));
  order=await h.action('add_staff_note',order,{note:'Full audit stays on the order'});
  const full=await h.scalar('select elio.order_json($1,true,false)',[order.id]),list=(await h.api('admin_bootstrap',{},h.ids.owner)).orders.find(o=>o.id===order.id);
  assert((await h.order(order.id)).history.length>=3);
  assert(full.history.length>=3);assert.deepEqual(list.history,[]);
  const clean=({history,payment_seconds_remaining,...rest})=>rest;
  assert.deepEqual(clean(list),clean(full));
  assert(JSON.stringify(list).length<JSON.stringify(full).length);
  for(const user of [null,h.ids.customer,h.ids.staff])await assert.rejects(h.as(user,()=>db.query('select elio.order_list_json(o) from elio.orders o limit 1')),/permission denied/);
 })();
 await check('read housekeeping detects changed defaults and preserves configured stock',async()=>{
  await h.api('catalog');
  assert.equal(await h.scalar('select elio.default_inventory_needs_refresh()'),false);
  const configured=await h.scalar("select coalesce(jsonb_agg(to_jsonb(i) order by product_id,date),'[]') from elio.inventory i where configured");
  await db.query('update elio.settings set inventory_default=inventory_default+1');
  assert.equal(await h.scalar('select elio.default_inventory_needs_refresh()'),true);
  await h.api('catalog');
  assert.equal(await h.scalar('select elio.default_inventory_needs_refresh()'),false);
  assert.deepEqual(await h.scalar("select coalesce(jsonb_agg(to_jsonb(i) order by product_id,date),'[]') from elio.inventory i where configured"),configured);
 })();
 await check('catalog reads still expire due website reservations before reporting stock',async()=>{
  const pending=await h.api('create_order',h.checkout(product,date),h.ids.customer);
  await db.query("update elio.orders set payment_deadline=now()-interval '30 days',created_at=now()-interval '31 days' where id=$1",[pending.id]);
  await h.api('catalog',{fulfillment_date:date});
  assert.equal(await h.scalar('select fulfillment_status from elio.orders where id=$1',[pending.id]),'expired');
  assert.equal(await h.scalar('select count(*)::int from elio.allocations where order_id=$1',[pending.id]),0);
 })();
}
