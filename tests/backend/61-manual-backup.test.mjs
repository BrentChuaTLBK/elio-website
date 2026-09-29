import assert from 'node:assert/strict';
import {accountingFixture} from './accounting-fixture.mjs';
import {validateRecovery} from '../../dist/assets/admin/recovery-data.js';
export default async function({db,check,state}){
 const h=state.h,{product,date}=await accountingFixture(h),read=(scope='paid_review',user=h.ids.owner)=>h.api('manual_order_recovery',{scope},user);
 await check('manual backup scopes are owner-only and cannot change automatic recovery coverage',async()=>{
  for(const user of [null,h.ids.customer,h.ids.staff])await assert.rejects(read('all_unserved',user),/owner|Sign in|authorized/i);
  await assert.rejects(read('everything'),/valid backup scope/);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'elio.manual_order_recovery(text)','execute')",[role]),false);
 })();
 let unpaid=await h.api('create_order',h.checkout(product,date),h.ids.customer),review=await h.api('create_order',h.checkout(product,date),h.ids.customer);review=await h.proof(review);
 await check('all-unserved manual recovery includes unpaid orders, exact reservations and products; default backup excludes them',async()=>{
  const usual=validateRecovery(await read()),all=validateRecovery(await read('all_unserved'));
  assert(!usual.active_order_ids.includes(unpaid.id));assert(usual.active_order_ids.includes(review.id));assert(all.active_order_ids.includes(unpaid.id));assert(all.active_order_ids.includes(review.id));
  assert.deepEqual(all.unpaid_orders.find(o=>o.id===unpaid.id).items,await h.scalar("select data->'items' from elio.orders where id=$1",[unpaid.id]));assert(all.allocations.some(a=>a.order_id===unpaid.id));assert(all.products.some(p=>p.id===product.id));assert(all.inventory.some(i=>i.product_id===product.box_flavors[0]));assert(!JSON.stringify(all).includes('access_token'));
  const automatic=await h.api('paid_order_recovery',{},h.ids.owner);assert(!automatic.active_order_ids.includes(unpaid.id));assert(!automatic.unpaid_orders);
  assert.throws(()=>validateRecovery({...all,download_scope:'paid_review'}),/scope/);
 })();
 await check('closed orders leave both manual active scopes and downloads never mutate reservations or order state',async()=>{
  await h.action('cancel_order',await h.order(unpaid.id),{reason:'Local manual backup regression'});
  review=await h.action('approve_payment',await h.order(review.id));review=await h.action('set_fulfillment',review,{status:'completed'});
  const before=await h.scalar("select jsonb_build_object('orders',(select count(*) from elio.orders),'outbox',(select count(*) from elio.outbox),'revision',(select revision from elio.order_backup_connection where id))");
  const all=validateRecovery(await read('all_unserved'));assert(!all.active_order_ids.includes(unpaid.id));assert(!all.active_order_ids.includes(review.id));assert(all.paid_orders.some(o=>o.id===review.id));
  assert.deepEqual(await h.scalar("select jsonb_build_object('orders',(select count(*) from elio.orders),'outbox',(select count(*) from elio.outbox),'revision',(select revision from elio.order_backup_connection where id))"),before);
 })();
}

