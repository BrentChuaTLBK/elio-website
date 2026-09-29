import assert from 'node:assert/strict';
import {accountingFixture} from './accounting-fixture.mjs';
import {validateRecovery,fulfillmentCsv,recoveryEnvelope} from '../../dist/assets/admin/backup.js';
export default async function({db,check,state}){
 const h=state.h,{product,date}=await accountingFixture(h);
 const backup=user=>h.api('paid_order_recovery',{},user);
 await check('paid-order backup is restricted to database-assigned owners',async()=>{
  for(const user of [null,h.ids.customer,h.ids.staff,h.ids.stranger,h.ids.unverified])await assert.rejects(backup(user),/permission|owner|Sign in|authorized/i);
 })();
 let order=await h.api('create_order',h.checkout(product,date),h.ids.customer);
 await check('submitted proofs are backed up as under review, never paid; rejection removes them from active recovery',async()=>{
  let pending=await h.api('create_order',h.checkout(product,date),h.ids.customer);
  const revision=Number(await h.scalar('select revision from elio.order_backup_connection where id'));
  pending=await h.proof(pending);const data=validateRecovery(await backup(h.ids.owner));
  assert(data.active_order_ids.includes(pending.id));assert(!data.paid_orders.some(o=>o.id===pending.id));
  assert.equal(data.review_orders.find(o=>o.id===pending.id).payment_status,'under_review');
  assert(data.review_orders.find(o=>o.id===pending.id).proof_path);assert(data.allocations.some(a=>a.order_id===pending.id));
  assert(fulfillmentCsv(data).includes('under_review'));assert(Number(await h.scalar('select revision from elio.order_backup_connection where id'))>revision);
  pending=await h.action('reject_payment',pending,{reason:'Isolated review-backup test'});
  const rejected=validateRecovery(await backup(h.ids.owner));assert(!rejected.active_order_ids.includes(pending.id));assert(!rejected.review_orders.some(o=>o.id===pending.id));
 })();
 await check('backup excludes unpaid orders and keeps a complete paid order and its allocation',async()=>{
  assert(!(await backup(h.ids.owner)).paid_orders.some(o=>o.id===order.id));
  order=await h.action('approve_payment',await h.proof(order));const data=validateRecovery(await backup(h.ids.owner));
  assert(data.active_order_ids.includes(order.id));assert.deepEqual(data.paid_orders.find(o=>o.id===order.id).items,order.items);
  assert.equal(data.allocations.find(a=>a.order_id===order.id).quantity,3);assert(data.payments.some(p=>p.order_id===order.id));
  assert(!JSON.stringify(data).includes('access_token'));assert(!JSON.stringify(data).includes('access_encrypted'));
  assert(fulfillmentCsv(data).includes(order.reference));assert.equal((await recoveryEnvelope(data)).sha256.length,64);
  assert.equal(data.affiliate_ledger.reduce((n,r)=>n+r.amount_cents,0),Number(await h.scalar('select coalesce(sum(amount_cents),0) from elio.affiliate_ledger')));
 })();
 await check('completed orders leave the active list but their paid and affiliate history remains recoverable',async()=>{
  order=await h.action('set_fulfillment',order,{status:'completed'});
  const data=validateRecovery(await backup(h.ids.owner));assert(!data.active_order_ids.includes(order.id));assert(data.paid_orders.some(o=>o.id===order.id));assert(!fulfillmentCsv(data).includes(order.reference));
  const recovered=JSON.parse(JSON.stringify(await recoveryEnvelope(data)));assert.deepEqual(validateRecovery(recovered.backup),data);
  await db.exec('create temporary table recovered_paid_orders(id uuid primary key, data jsonb not null)');
  for(const o of recovered.backup.paid_orders)await db.query('insert into recovered_paid_orders values($1,$2)',[o.id,JSON.stringify(o)]);
  assert.equal(Number(await h.scalar('select count(*) from recovered_paid_orders')),data.paid_history_count);
  assert.equal(Number(await h.scalar("select coalesce(sum((data->>'total_cents')::bigint),0) from recovered_paid_orders")),data.paid_orders.reduce((n,o)=>n+o.total_cents,0));
  await db.exec('drop table recovered_paid_orders');
 })();
 await check('backup validates counts, totals and CSV cells before downloading',async()=>{
  const data=await backup(h.ids.owner);assert.throws(()=>validateRecovery({...data,active_count:data.active_count+1}),/counts/);
  assert.throws(()=>validateRecovery({...data,active_total_cents:data.active_total_cents+1}),/totals/);
 })();
}
