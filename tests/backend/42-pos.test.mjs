import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({db,check,state}) {
 const h=state.h,{api,ids,scalar}=h;
 const posProduct=async(overrides={})=>api('pos_save_product',{id:randomUUID(),revision:0,name:'POS fixture',description:'Isolated test',price_cents:2500,stock_mode:'running',photo:'',active:true,...overrides},ids.owner);
 const stock=async(p,available,date)=>api('pos_set_stock',{id:p.id,date,available,expected_available:await scalar('select elio.pos_remaining($1,$2)',[p.id,date]),reason:'Test setup'},ids.owner);
 const quote=p=>api('pos_quote',p,ids.staff);
 const create=async(p)=>api('pos_create_order',{...p,idempotency_key:p.idempotency_key||randomUUID(),expected_quote:await quote(p)},ids.staff);
 const payment={method:'cash',cash_received_cents:100000};
 let saved,p,base,web,flavor;
 await check('POS role checks protect catalog management and sales',async()=>{
  for(const u of [null,ids.customer])await assert.rejects(api('pos_catalog',{date:await h.day(0)},u),/sign in|verified|authorized|staff/i);
  await assert.rejects(api('pos_save_product',{},ids.staff),/owner/i);
  p=await posProduct();
  assert(!(await api('catalog')).products.some(x=>x.id===p.id));
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.pos_order_action(text,jsonb)','execute')",[role]),false);
 })();
 await check('direct POS reserves both website flavor stock and private running stock',async()=>{
  const f=await accountingFixture(h);web=f.product;flavor=web.box_flavors[0];
  await stock(p,5,f.date);
  base={order_source:'direct',method:'delivery',fulfillment_date:f.date,paid:false,pos_handed_over:false,
   buyer:{name:'Direct buyer',phone:'09171234567',email:''},recipient:{name:'Recipient',phone:'09171234567'},address:{line1:'Test address',locality:'Manila'},delivery_cents:30000,
   items:[{product_id:web.id,source:'website',quantity:2,selections:{}},{product_id:p.id,source:'pos',quantity:1,selections:{}}]};
  saved=await create(base);
  assert.equal(saved.total_cents,52500);assert.equal(saved.payment_deadline,null);assert.equal(saved.payment_status,'awaiting_payment');
  assert.equal(await scalar('select elio.capacity_remaining($1,$2)',[flavor,f.date]),94);
  assert.equal(await scalar('select elio.pos_remaining($1,$2)',[p.id,f.date]),4);
  assert.equal(await scalar('select count(*) from elio.outbox where order_id=$1',[saved.id]),0);
  await db.query("update elio.orders set payment_deadline=now()-interval '40 days' where id=$1",[saved.id]);await db.query('select elio.expire_orders()');
  assert.equal((await h.order(saved.id)).fulfillment_status,'pending_confirmation');
  await assert.rejects(create({...base,items:[{product_id:p.id,quantity:5,source:'pos'}]}),/Not enough stock/i);
 })();
 await check('POS stock counts and sale retries cannot silently change inventory',async()=>{
  await assert.rejects(api('pos_set_stock',{id:p.id,date:base.fulfillment_date,available:10,expected_available:5,reason:'stale'},ids.owner),/Stock changed/i);
  const payload={...base,idempotency_key:randomUUID(),items:[{product_id:p.id,source:'pos',quantity:1,selections:{}}]};
  payload.expected_quote=await quote(payload);
  const one=await api('pos_create_order',payload,ids.staff),two=await api('pos_create_order',payload,ids.staff);assert.equal(one.id,two.id);
  await assert.rejects(api('pos_create_order',{...payload,instructions:'changed'},ids.staff),/key was already used/i);
  assert.equal(await scalar('select elio.pos_remaining($1,$2)',[p.id,base.fulfillment_date]),3);
  await h.action('cancel_order',one,{reason:'Test cancelled'});
  assert.equal(await scalar('select elio.pos_remaining($1,$2)',[p.id,base.fulfillment_date]),4);
 })();
 await check('POS full payments calculate change and flow to correct accounting categories',async()=>{
  const payload={order_id:saved.id,revision:saved.revision,idempotency_key:randomUUID(),payment:{method:'cash',cash_received_cents:50000}};
  await assert.rejects(api('pos_pay_order',payload,ids.staff),/cover the full/i);
  payload.payment=payment;saved=await api('pos_pay_order',payload,ids.staff);
  assert.equal(saved.payment_status,'paid');assert.equal(saved.fulfillment_status,'confirmed');assert.equal(saved.pos_payment.change_cents,47500);
  assert.equal((await api('pos_pay_order',payload,ids.staff)).id,saved.id);
  assert.equal(await scalar('select count(*) from elio.payments where order_id=$1',[saved.id]),1);
  const ledger=(await db.query('select c.system_key,l.amount_cents from elio.accounting_ledger l join elio.accounting_categories c on c.id=l.category_id where order_id=$1',[saved.id])).rows;
  assert.equal(Number(ledger.find(x=>x.system_key==='direct')?.amount_cents),22500);assert.equal(Number(ledger.find(x=>x.system_key==='delivery_fee')?.amount_cents),30000);
  const today=await h.day(0),rows=(await db.query('select * from elio.accounting_rows_v2($1,$1) where order_id=$2',[today,saved.id])).rows;
  assert.equal(rows[0].source,'Direct order');assert.equal(rows[0].payment_method,'Cash');
  assert(await scalar('select elio.calendar_order(o) is not null from elio.orders o where id=$1',[saved.id]));
 })();
 await check('POS cancellation can retain paid stock or restore it and excludes accounting',async()=>{
  await h.action('cancel_order',saved,{reason:'Test cancellation',restore_stock:false});
  assert.equal(await scalar('select state from elio.pos_allocations where order_id=$1',[saved.id]),'retained');
  const today=await h.day(0);assert.equal(await scalar('select count(*) from elio.accounting_rows_v2($1,$1) where order_id=$2',[today,saved.id]),0);
  const o=await create({...base,paid:true,payment,items:[{product_id:p.id,source:'pos',quantity:1}]});
  await h.action('cancel_order',o,{reason:'Test cancellation with stock return',restore_stock:true});
  assert.equal(await scalar('select count(*) from elio.pos_allocations where order_id=$1',[o.id]),0);
 })();
}
