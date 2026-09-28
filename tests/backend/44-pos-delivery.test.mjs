import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar}=h;
 await db.query("update elio.settings set data=data||$1::jsonb",[JSON.stringify({payment_options:[{label:'GCash',account_name:'QA',account_number:'09170000000'},{label:'BDO',account_name:'QA',account_number:'00001'}]})]);
 const fixture=await accountingFixture(h),today=await h.day(0);
 const create=async(changes={})=>{const p={order_source:'direct',method:'delivery',fulfillment_date:fixture.date,items:[h.item(fixture.product)],delivery_fee_pending:true,delivery_fee_recipient:'elio',paid:true,payment:{method:'cash',cash_received_cents:100000},...changes};return api('pos_create_order',{...p,expected_quote:await api('pos_quote',p,ids.staff),idempotency_key:randomUUID()},ids.staff);};
 const change=(o,fee,recipient='elio')=>h.action('pos_set_delivery_fee',o,{fee_cents:fee,recipient,reason:'Customer changed delivery payment recipient'});
 const received=o=>h.action('pos_record_delivery_payment',o,{method:'BDO',reference:'Delivery-only test payment'});
 const income=id=>scalar("select coalesce(sum(l.amount_cents),0)::integer from elio.accounting_ledger l join elio.accounting_categories c on c.id=l.category_id where l.order_id=$1 and c.system_key='delivery_fee'",[id]);
 let o;
 await check('pending direct delivery fee is not free and has no income; changing recipient preserves stock and product payment',async()=>{
  o=await create();assert.equal(o.total_cents,10000);assert.equal(o.delivery_charge.state,'pending');assert.equal(o.delivery_charge.fee_cents,null);assert.equal(await income(o.id),0);
  const originalStock=await h.allocations(o.id);o=await change(o,null,'courier');assert.equal(o.delivery_charge.recipient,'courier');assert.equal(o.delivery_charge.state,'pending');
  o=await change(o,30000);assert.equal(o.delivery_charge.state,'quoted');assert.equal(o.total_cents,40000);assert.equal(o.paid_amount_cents,10000);assert.equal(await income(o.id),0);
  o=await change(o,30000,'courier');assert.equal(o.delivery_charge.state,'courier');assert.equal(o.total_cents,10000);assert.equal(await income(o.id),0);
  assert.deepEqual(await h.allocations(o.id),originalStock);assert.equal(await scalar('select count(*) from elio.payments where order_id=$1',[o.id]),1);
  const link=await api('pos_payment_link',{order_id:o.id},ids.staff),visible=await api('get_order',{order_id:o.id},null,link.token);assert.equal(visible.delivery_charge.recipient,'courier');assert.equal(visible.delivery_charge.fee_cents,30000);
 })();
 await check('late Elio delivery payment creates income only when manually received, with safe retries and stale edit rejection',async()=>{
  const old=o;o=await change(o,25000,'elio');
  await assert.rejects(change(old,45000),/changed/i);
  const request={order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),method:'BDO',reference:'QA-LATE'};
  await assert.rejects(api('pos_record_delivery_payment',request,ids.customer),/staff|authorized/i);
  o=await api('pos_record_delivery_payment',request,ids.staff);assert.equal(o.delivery_charge.state,'paid');assert.equal(await income(o.id),25000);assert.equal(o.paid_amount_cents,10000);
  assert.equal((await api('pos_record_delivery_payment',request,ids.staff)).id,o.id);assert.equal(await income(o.id),25000);
  await assert.rejects(api('pos_record_delivery_payment',{...request,method:'GCash'},ids.staff),/already used/i);
  await assert.rejects(change(o,25000,'courier'),/already collected/i);
  const rows=await h.api('accounting_report',{report_version:'2',start:today,end:today},ids.owner);const delivery=rows.entries.find(r=>r.order_id===o.id&&r.amount_cents===25000);assert(delivery);assert.equal(delivery.payment_method,'BDO');
 })();
 await check('owner delivery payment correction preserves receipts and reverses income before changing the recipient',async()=>{
  const args={order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),refund_confirmed:true,reason:'Delivery refunded; customer now pays courier'};
  await assert.rejects(api('pos_void_delivery_payment',args,ids.staff),/owner/i);
  await assert.rejects(api('pos_void_delivery_payment',{...args,refund_confirmed:false},ids.owner),/Confirm/i);
  o=await api('pos_void_delivery_payment',args,ids.owner);assert.equal(o.delivery_charge.state,'quoted');assert.equal(await income(o.id),0);
  assert.equal((await api('pos_void_delivery_payment',args,ids.owner)).id,o.id);assert.equal(await scalar('select count(*) from elio.pos_delivery_payments where order_id=$1 and voided_at is not null',[o.id]),1);
  o=await change(o,25000,'courier');assert.equal(o.total_cents,10000);assert.equal(await income(o.id),0);
  o=await change(o,20000);o=await received(o);assert.equal(await income(o.id),20000);assert.equal(await scalar('select count(*) from elio.pos_delivery_payments where order_id=$1',[o.id]),2);
 })();
 await check('unpaid direct orders can switch a known delivery fee between Elio and courier before full initial payment',async()=>{
  let unpaid=await create({paid:false,delivery_fee_pending:false,delivery_cents:20000});assert.equal(unpaid.total_cents,30000);assert.equal(unpaid.delivery_charge.state,'included');
  unpaid=await change(unpaid,20000,'courier');assert.equal(unpaid.total_cents,10000);
  unpaid=await change(unpaid,15000,'elio');assert.equal(unpaid.total_cents,25000);
  unpaid=await h.action('pos_pay_order',unpaid,{payment:{method:'GCash'}});assert.equal(unpaid.paid_amount_cents,25000);assert.equal(await income(unpaid.id),15000);
  await assert.rejects(change(unpaid,15000,'courier'),/already collected/i);
  const zero=await change(await create(),0);assert.equal((await change(zero,10000)).delivery_charge.state,'quoted');
 })();
 await check('direct fee edits are blocked during receipt review and generic item edits preserve collection instructions',async()=>{
  let pending=await create({paid:false});const link=await api('pos_payment_link',{order_id:pending.id},ids.staff);await h.proof({...pending,access_token:link.token});
  await assert.rejects(change(await h.order(pending.id),25000),/Finish reviewing/i);
  let courier=await create({delivery_fee_pending:false,delivery_fee_recipient:'courier',delivery_cents:15000});assert.equal(courier.total_cents,10000);
  courier=await h.action('edit_order',courier,{changes:{instructions:'New instructions'},reason:'Keep delivery payment separate'});assert.equal(courier.delivery_charge.fee_cents,15000);assert.equal(courier.delivery_charge.recipient,'courier');
  await assert.rejects(h.action('edit_order',courier,{changes:{delivery_cents:20000},reason:'Avoid dedicated action'}),/Use Delivery fee/i);
  await assert.rejects(h.action('edit_order',o,{changes:{method:'pickup'},reason:'Cannot lose collected delivery payment'}),/Settle/i);
 })();
 await check('cancelled and refunded direct orders exclude collected delivery fees and reject new delivery payments',async()=>{
  const refunded=await h.action('set_refund_label',o,{enabled:true,reason:'Isolated refund test'});
  const report=await api('accounting_report',{report_version:'2',start:today,end:today},ids.owner);assert(!report.entries.some(r=>r.order_id===refunded.id));
  await assert.rejects(change(refunded,10000),/closed or refunded/i);
  let cancelled=await change(await create(),20000);cancelled=await h.action('cancel_order',cancelled,{reason:'Customer cancelled',restore_stock:false});await assert.rejects(received(cancelled),/closed or refunded/i);
 })();
 await check('customer emails explain pending and courier-paid delivery instead of showing a misleading zero fee',async()=>{
  const direct=await create({paid:false,send_email:true,buyer:{email:'delivery@example.test'}});const payload=await scalar("select payload from elio.outbox where order_id=$1 and event_type='order_submitted'",[direct.id]);
  assert(payload.order.delivery_charge);const email=renderEmail(payload);assert.match(email.text,/To be confirmed.*Pay Elio/i);assert.match(email.html,/To be confirmed/);
  const email2=renderEmail({...payload,order:{...payload.order,delivery_charge:{state:'courier',recipient:'courier',fee_cents:23000}}});assert.match(email2.text,/230.00.*Pay courier directly/i);assert.match(email2.html,/Pay courier directly/);
 })();
}
