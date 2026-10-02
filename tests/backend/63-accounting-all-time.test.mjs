import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({db,check,state}) {
 const h=state.h,report=payload=>h.api('accounting_report',{report_version:2,...payload},h.ids.owner);
 await check('All time resolves complete eligible history and recalculates after new entries, deletion and refunds',async()=>{
  await db.exec('begin');
  try{
   const category=await h.api('accounting_save_category',{id:randomUUID(),revision:0,name:'All time fixture'},h.ids.owner);
   const save=(entry_date,amount_cents)=>h.api('accounting_save_entry',{id:randomUUID(),revision:0,entry_date,category_id:category.id,kind:'sale',amount_cents},h.ids.owner);
   const first=await save('1901-01-01',12345),last=await save('2199-12-31',67890);
   let all=await report({all_time:true,start:'invalid ignored date',end:'invalid ignored date'});
   assert.equal(all.all_time,true);assert.equal(all.start,'1901-01-01');assert.equal(all.end,'2199-12-31');
   assert(all.entries.some(e=>e.id===first.id));assert(all.entries.some(e=>e.id===last.id));
   const bounded=await report({start:all.start,end:all.end});
   assert.equal(bounded.all_time,false);assert.deepEqual(all.entries,bounded.entries);assert.deepEqual(all.summary,bounded.summary);assert.deepEqual(all.deliveries,bounded.deliveries);
   const latest=await save('2200-01-02',1111);
   all=await report({all_time:true});assert.equal(all.end,'2200-01-02');assert(all.entries.some(e=>e.id===latest.id));
   await h.api('accounting_delete_entry',{id:latest.id,revision:latest.revision},h.ids.owner);
   all=await report({all_time:true});assert.equal(all.end,'2199-12-31');assert(!all.entries.some(e=>e.id===latest.id));
   const {product,date}=await accountingFixture(h);
   let order=await h.api('create_order',h.checkout(product,date),h.ids.customer);order=await h.action('approve_payment',await h.proof(order));
   await db.query("update elio.orders set method='delivery' where id=$1",[order.id]);
   await h.api('accounting_save_delivery',{order_id:order.id,order_revision:order.revision,revision:0,cost_date:'1800-01-01',amount_cents:2500},h.ids.owner);
   all=await report({all_time:true});assert.equal(all.start,'1800-01-01');assert(all.entries.some(e=>e.order_id===order.id&&e.source==='Delivery cost'));
   await h.action('set_refund_label',await h.order(order.id),{enabled:true});
   all=await report({all_time:true});assert.equal(all.start,'1901-01-01');assert(!all.entries.some(e=>e.order_id===order.id));assert(!all.deliveries.some(e=>e.order_id===order.id));
  }finally{await db.exec('rollback');}
 })();
 await check('All time supports an empty ledger without fabricated historic dates',async()=>{
  await db.exec('begin');
  try{
   await db.exec("update elio.accounting_entries set deleted_at=now();update elio.orders set payment_status='awaiting_payment';update elio.affiliate_payouts set status='voided'");
   const all=await report({all_time:true});assert.deepEqual(all.entries,[]);assert.deepEqual(all.deliveries,[]);
   assert.equal(all.start,await h.day(0));assert.equal(all.end,all.start);assert.equal(all.all_time,true);
   assert(all.summary.every(c=>Number(c.sales_cents)===0&&Number(c.expense_cents)===0));
  }finally{await db.exec('rollback');}
 })();
 await check('All time remains owner-only and range validation remains required for custom dates',async()=>{
  for(const user of [null,h.ids.staff,h.ids.customer])await assert.rejects(()=>h.api('accounting_report',{report_version:2,all_time:true},user),/owner|authorized/i);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'elio.accounting_report_v2(uuid,jsonb)','execute')",[role]),false);
  await assert.rejects(()=>report({}),/valid start and end/);
  await assert.rejects(()=>report({start:'2026-10-02',end:'2026-10-01'}),/valid start and end/);
 })();
 await check('All time migration is repeatable and retains deferred-delivery reporting',async()=>{
  const definition=await h.scalar("select pg_get_functiondef('elio.accounting_report_v2(uuid,jsonb)'::regprocedure)");
  await db.exec(await readFile(new URL('../../supabase/migrations/20261002080757_elio_accounting_all_time.sql',import.meta.url),'utf8'));
  assert.equal(await h.scalar("select pg_get_functiondef('elio.accounting_report_v2(uuid,jsonb)'::regprocedure)"),definition);
  assert.match(definition,/elio\.pos_delivery_payments/);
 })();
}
