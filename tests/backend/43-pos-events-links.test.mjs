import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}) {
 const h=state.h,{api,ids,scalar}=h,today=await h.day(0),eid=randomUUID();
 await check('direct custom items have editable names/prices and no stock while mixed website items use shared stock',async()=>{
  const f=await accountingFixture(h),custom={source:'custom',product_id:randomUUID(),name:'Custom celebration cake',unit_price_cents:250000,quantity:2,selections:{}};
  const p={order_source:'direct',method:'delivery',fulfillment_date:f.date,delivery_cents:30000,paid:true,payment:{method:'cash',cash_received_cents:600000},items:[h.item(f.product),custom]};
  const o=await api('pos_create_order',{...p,idempotency_key:randomUUID(),expected_quote:await api('pos_quote',p,ids.staff)},ids.staff);
  assert.equal(o.total_cents,540000);assert.equal(o.items[1].name,custom.name);assert.deepEqual(o.items[1].stock_requirements,[]);
  assert.equal(await scalar('select sum(quantity)::integer from elio.allocations where order_id=$1',[o.id]),3);
  assert.equal(await scalar('select count(*) from elio.pos_allocations where order_id=$1',[o.id]),0);
  await assert.rejects(api('pos_quote',{...p,items:[{...custom,product_id:f.product.id}]},ids.staff),/website catalog/i);
  const changes={items:[h.item(f.product),{...custom,name:'Updated custom cake',unit_price_cents:200000}]};
  const preview=await h.action('preview_edit_order',o,{changes});assert.equal(preview.total_cents,440000);
  const updated=await h.action('edit_order',o,{changes,reason:'Custom item correction'});assert.equal(updated.items[1].name,'Updated custom cake');
  const ledgers=await scalar('select sum(l.amount_cents)::integer from elio.accounting_ledger l join elio.accounting_categories c on c.id=l.category_id where l.order_id=$1 and c.kind=\'sale\'',[o.id]);assert.equal(ledgers,440000);
 })();
 const owner=(action,p)=>api(action,{event_id:eid,...p},ids.owner),staff=(action,p)=>api(action,{event_id:eid,...p},ids.staff);
 let stocks=[],item,ev,order,payload;
 await check('event setup is owner-only and recipe stock stays separate from the website',async()=>{
  await assert.rejects(staff('pos_save_event',{name:'Unauthorized',starts_on:today,ends_on:today}),/owner/i);
  ev=await owner('pos_save_event',{revision:0,name:'Isolated pop-up',starts_on:today,ends_on:today});
  for(const name of ['Vanilla','Chocolate','Matcha'])stocks.push(await owner('pos_save_event_stock',{id:randomUUID(),revision:0,name,available:10,expected_available:0,reason:'Test stock'}));
  item=await owner('pos_save_event_item',{id:randomUUID(),revision:0,name:'Event trio',price_cents:75000,active:true,recipe:stocks.map(s=>({stock_id:s.id,quantity:1}))});
  payload={event_id:eid,order_source:'in_person',fulfillment_date:today,method:'pickup',pos_handed_over:true,paid:true,payment:{method:'cash',cash_received_cents:200000},items:[{source:'event',product_id:item.id,quantity:2,selections:{}}]};
  await assert.rejects(staff('pos_quote',payload),/Open.*cash/i);
  await staff('pos_open_cash',{date:today,opening_cents:100000});
  const q=await staff('pos_quote',payload);assert.equal(q.total_cents,150000);assert.deepEqual(q.items[0].stock_requirements,[]);
  const before=await scalar('select coalesce(sum(quantity),0) from elio.allocations');
  const sale={...payload,expected_quote:q,idempotency_key:randomUUID()};order=await staff('pos_create_order',sale);assert.equal((await staff('pos_create_order',sale)).id,order.id);
  assert.equal(order.pos_payment.change_cents,50000);assert.equal(order.fulfillment_status,'completed');
  assert.equal(await scalar('select coalesce(sum(quantity),0) from elio.allocations'),before);
  for(const s of stocks)assert.equal(await scalar('select elio.pos_event_remaining($1)',[s.id]),8);
  assert.equal(await scalar('select elio.calendar_order(o) is null from elio.orders o where id=$1',[order.id]),true);
  assert.equal((await owner('pos_event_data')).items[0].remaining,8);
 })();
 await check('single pieces and boxes share event components; stale prices and overselling are rejected',async()=>{
  const single=await owner('pos_save_event_item',{id:randomUUID(),revision:0,name:'Single vanilla',price_cents:25000,recipe:[{stock_id:stocks[0].id,quantity:1}]});
  let p={...payload,items:[{product_id:single.id,quantity:7}]};p.expected_quote=await staff('pos_quote',p);p.idempotency_key=randomUUID();await staff('pos_create_order',p);
  await assert.rejects(staff('pos_quote',payload),/Not enough event stock/i);
  const stale={...payload,items:[{product_id:item.id,quantity:1}],payment:{method:'BDO'}};stale.expected_quote=await staff('pos_quote',stale);
  item=await owner('pos_save_event_item',{...item,event_id:eid,price_cents:80000});
  await assert.rejects(staff('pos_create_order',{...stale,idempotency_key:randomUUID()}),/Prices or stock changed/i);
  assert.equal((await h.order(order.id)).items[0].unit_price_cents,75000);
  await assert.rejects(staff('pos_create_order',{...payload,paid:false,idempotency_key:randomUUID()}),/full payment/i);
  await assert.rejects(owner('pos_save_event_stock',{...stocks[0],expected_available:10,available:20,reason:'stale'}),/Stock changed/i);
 })();
 await check('cash reconciliation records actual money once and never duplicates accounting',async()=>{
  const before=await scalar('select count(*) from elio.accounting_ledger');
  let report=await staff('pos_event_report',{date:today});assert.equal(report.sales[0].total_cents,325000);assert.equal(report.cash.expected_cents,425000);
  const movement={id:randomUUID(),date:today,amount_cents:-5000,reason:'Test cash out'};await staff('pos_cash_movement',movement);await staff('pos_cash_movement',movement);
  await assert.rejects(staff('pos_close_cash',{date:today,revision:report.cash.revision,expected_cents:425000,counted_cents:420000}),/changed the expected cash/i);
  report=await staff('pos_event_report',{date:today});assert.equal(report.cash.expected_cents,420000);
  await staff('pos_close_cash',{date:today,revision:report.cash.revision,expected_cents:420000,counted_cents:419000});
  report=await staff('pos_event_report',{date:today});assert.equal(report.cash.counted_cents-report.cash.expected_at_close,-1000);
  assert.equal(await scalar('select count(*) from elio.accounting_ledger'),before);
  await assert.rejects(staff('pos_quote',{...payload,items:[{product_id:item.id,quantity:1}]}),/Open.*cash/i);
  const paidCategories=(await db.query('select c.system_key,l.amount_cents from elio.accounting_ledger l join elio.accounting_categories c on c.id=l.category_id where l.order_id=$1',[order.id])).rows;
  assert.equal(paidCategories[0].system_key,'in_person');assert.equal(Number(paidCategories[0].amount_cents),150000);
  await h.action('set_refund_label',await h.order(order.id),{enabled:true,reason:'Test refund'});
  report=await staff('pos_event_report',{date:today});assert.equal(report.sales[0].total_cents,175000);assert.equal(report.cash.expected_cents,420000);
 })();
 await check('event GCash, BDO and EastWest payments record full sales without changing the cash drawer',async()=>{
  const closed=await staff('pos_event_report',{date:today});
  await owner('pos_reopen_cash',{date:today,revision:closed.cash.revision,reason:'Additional isolated payment checks'});
  const current=await owner('pos_event_data');
  for(const s of current.stock)await owner('pos_save_event_stock',{...s,available:5,expected_available:s.remaining,reason:'Test payment methods'});
  for(const method of ['GCash','BDO','EastWest']){
   const p={...payload,items:[{source:'event',product_id:item.id,quantity:1}],payment:{method,reference:'Isolated payment'}};
   const o=await staff('pos_create_order',{...p,idempotency_key:randomUUID(),expected_quote:await staff('pos_quote',p)});
   assert.equal(o.payment_status,'paid');assert.equal(o.pos_payment.label,method);assert.equal(o.pos_payment.change_cents,0);
  }
  const report=await staff('pos_event_report',{date:today});assert.equal(report.cash.expected_cents,420000);
  for(const method of ['GCash','BDO','EastWest'])assert.equal(report.sales.find(s=>s.method===method).total_cents,80000);
 })();
 await check('direct payment links keep optional contact/social details and accept proof without automatic expiry',async()=>{
  const f=await accountingFixture(h),p={order_source:'direct',fulfillment_date:f.date,method:'pickup',paid:false,items:[h.item(f.product)],buyer:{social_platform:'Instagram',social_username:'@test'}};
  const q=await api('pos_quote',p,ids.staff);const o=await api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID()},ids.staff);
  assert.equal(o.payment_deadline,null);assert.equal(o.buyer.social_username,'@test');
  const link=await api('pos_payment_link',{order_id:o.id},ids.staff);
  await assert.rejects(api('pos_payment_link',{order_id:o.id},ids.customer),/authorized|staff/i);
  const visible=await api('get_order',{order_id:o.id},null,link.token);assert.equal(visible.id,o.id);assert.equal(visible.pos_created_by,undefined);
  assert.equal(await scalar("select payment_deadline='infinity'::timestamptz from elio.orders where id=$1",[o.id]),true);
  assert.equal((await h.service('authorize_upload',{kind:'proof',order_id:o.id,token:link.token})).allowed,true);
  let reviewed=await h.proof({...o,access_token:link.token});assert.equal(reviewed.payment_status,'under_review');
  const paid=await h.action('approve_payment',await h.order(o.id));assert.equal(paid.payment_status,'paid');
  assert.equal(await scalar('select count(*) from elio.accounting_ledger l join elio.accounting_categories c on c.id=l.category_id where l.order_id=$1 and c.system_key=\'direct\'',[o.id]),1);
  await assert.rejects(h.service('authorize_upload',{kind:'proof',order_id:o.id,token:link.token}),/no longer accepted/i);
 })();
 await check('direct email is optional, contains the order link and never advertises a short deadline',async()=>{
  const f=await accountingFixture(h),p={order_source:'direct',fulfillment_date:f.date,method:'pickup',paid:false,send_email:true,buyer:{email:'direct@example.test'},items:[h.item(f.product)]};
  const q=await api('pos_quote',p,ids.staff),o=await api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID()},ids.staff);
  const msg=await scalar('select payload from elio.outbox where order_id=$1 and event_type=\'order_submitted\'',[o.id]);assert(msg);
  const email=renderEmail(msg);assert.match(email.text,/no automatic payment deadline/i);assert.doesNotMatch(email.text,/Payment-proof deadline:/i);
  const cancelled=await h.action('cancel_order',o,{reason:'Close unpaid direct order'});assert.equal(cancelled.fulfillment_status,'cancelled');
  const link=await api('pos_payment_link',{order_id:o.id},ids.staff);await assert.rejects(h.service('authorize_upload',{kind:'proof',order_id:o.id,token:link.token}),/no longer accepted/i);
 })();
}
