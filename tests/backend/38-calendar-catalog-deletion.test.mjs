import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({db,check,state}) {
 const h=state.h, fixture=await accountingFixture(h),{product,date}=fixture;
 const flavor=(await h.scalar('select data from elio.products where id=$1',[product.box_flavors[0]]));
 const flavorId=product.box_flavors[0];
 let order=await h.api('create_order',h.checkout(product,date),h.ids.customer);
 const row=()=>h.scalar('select (select to_jsonb(e) from elio.calendar_events e where order_id=$1)',[order.id]);
 await check('calendar only includes authorized staff and paid confirmed orders',async()=>{
  for(const user of [null,h.ids.customer])await assert.rejects(h.api('calendar_list',{from:date,to:date},user));
  assert.equal(await row(),null);
  order=await h.action('approve_payment',await h.proof(order));
  const data=await h.api('calendar_list',{from:date,to:date},h.ids.staff),entry=data.orders.find(o=>o.id===order.id);
  assert.equal(entry.reference,order.reference);assert.equal(entry.buyer.phone,'09171234567');
  assert.equal(entry.total_cents,order.total_cents);
  assert.deepEqual(entry.items[0].flavor_contents,order.items[0].flavor_contents||[]);
  assert.deepEqual(entry.items[0].selection_labels,order.items[0].selection_labels||[]);
  assert.equal(entry.access_token,undefined);assert.equal(entry.staff_notes,undefined);assert.equal(entry.payment_proof,undefined);
  await assert.rejects(h.service('calendar_connect',{user_id:h.ids.staff,calendar_id:'fixture@example.test'}));
  await h.service('calendar_connect',{user_id:h.ids.owner,calendar_id:'fixture@example.test'});
  await assert.rejects(h.api('calendar_list',{from:'2026-01-01',to:'2026-12-31'},h.ids.owner));
 })();
 await check('calendar revisions survive changes during sync and retry without duplicate events',async()=>{
  const lease=await h.service('calendar_begin'),payload={lease_token:lease.lease_token};
  assert.equal((await h.service('calendar_begin')).busy,true);
  await assert.rejects(h.service('calendar_jobs',{lease_token:randomUUID()}));
  const before=await row();
  await db.query("update elio.orders set fulfillment_status='preparing' where id=$1",[order.id]);
  await h.service('calendar_ack',{...payload,order_id:order.id,event_id:before.event_id,revision:before.revision,etag:'first'});
  const after=await row();assert.equal(after.event_id,before.event_id);assert.ok(after.revision>after.synced_revision);
  await h.service('calendar_fail',{...payload,order_id:order.id,event_id:after.event_id,revision:after.revision,error:'quota'});
  assert.equal((await row()).last_error,'quota');
  await h.api('calendar_sync_now',{},h.ids.staff);
  await h.service('calendar_ack',{...payload,order_id:order.id,event_id:after.event_id,revision:after.revision,etag:'second'});
  await h.service('calendar_scan',{...payload,changes:[{event_id:after.event_id,etag:'google-edited'}],next_sync:'cursor'});
  assert.ok((await row()).revision>after.revision);
  assert.equal((await h.order(order.id)).fulfillment_date,date,'Google changes never change the order');
  await h.service('calendar_scan',{...payload,changes:[{event_id:after.event_id,deleted:true}],next_page:'page-two'});
  assert.notEqual((await row()).event_id,after.event_id);
  await h.service('calendar_scan_reset',payload);
  assert.equal(await h.scalar('select sync_token from elio.calendar_connection'),null);
  await h.service('calendar_finish',payload);
 })();
 await check('catalog deletion is owner-only and keeps orders, accounting and allocations',async()=>{
  for(const user of [null,h.ids.staff,h.ids.customer])await assert.rejects(h.api('delete_product',{id:flavorId},user));
  const snapshot=(await h.order(order.id)).items,allocation=await h.allocations(order.id);
  const ledger=await h.scalar('select count(*)::int from elio.accounting_ledger where order_id=$1',[order.id]);
  const result=await h.api('delete_product',{id:flavorId},h.ids.owner);assert.ok(result.unavailable_boxes>=1);
  assert.deepEqual((await h.order(order.id)).items,snapshot);assert.deepEqual(await h.allocations(order.id),allocation);
  assert.equal(await h.scalar('select count(*)::int from elio.accounting_ledger where order_id=$1',[order.id]),ledger);
  const catalog=await h.api('catalog',{fulfillment_date:date});assert.equal(catalog.products.find(p=>p.id===product.id).stock_available,false);
  await assert.rejects(h.api('quote',h.checkout(product,date),h.ids.customer),/unavailable|lineup/i);
  await assert.rejects(h.api('save_product',{product:{...flavor,id:flavorId,active:true,collection_hidden:false}},h.ids.owner),/deleted/i);
  await h.api('delete_product',{id:product.id},h.ids.owner);
  assert.equal((await h.api('catalog',{fulfillment_date:date})).products.some(p=>p.id===product.id),false);
  assert.deepEqual((await h.order(order.id)).items,snapshot);
  assert.equal((await h.api('delete_product',{id:product.id},h.ids.owner)).deleted,true);
  await db.query("update elio.products set data=jsonb_set(data,'{category_ids}','[]') where id=$1",[product.id]);
  assert.equal(await h.scalar('select deleted_at is not null and not (data->>\'active\')::boolean from elio.products where id=$1',[product.id]),true);
  const definition=await h.scalar("select pg_get_functiondef('elio.reorder_catalog(jsonb)'::regprocedure)");assert.match(definition,/and deleted_at is null/);
 })();
 await check('refund, cancellation and deletion remove Google events while completed orders remain',async()=>{
  await db.query("update elio.orders set fulfillment_status='completed' where id=$1",[order.id]);assert.ok((await row()).desired);
  await db.query('update elio.orders set refund_label=true where id=$1',[order.id]);assert.equal((await row()).desired,null);
  await db.query("update elio.orders set refund_label=false,fulfillment_status='cancelled' where id=$1",[order.id]);assert.equal((await row()).desired,null);
  // Delete the isolated fixture's dependent history before its order; the sync
  // queue deliberately has no FK and must survive this explicit cleanup.
  const dependencies=(await db.query("select c.conrelid::regclass::text as name,a.attname as column from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='f' and c.confrelid='elio.orders'::regclass")).rows;
  for(const {name,column} of dependencies)await db.query(`delete from ${name} where "${column}"=$1`,[order.id]);
  await db.query('delete from elio.orders where id=$1',[order.id]);assert.equal((await row()).desired,null);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'elio.delete_product(jsonb)','execute')",[role]),false);
 })();
}
