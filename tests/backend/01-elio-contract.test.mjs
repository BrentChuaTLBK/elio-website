import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {buildAnalytics} from '../../dist/assets/admin/analytics.js';

export default async function({db,check,state}) {
 const h=await makeHarness(db);state.h=h;
 const {api,ids,as,scalar,product,inventory,item,checkout,action,order,allocations}=h;
 const rejects=async(fn,pattern)=>assert.rejects(fn,pattern);
 let v,m,s,custom,date,o;
 await check('An empty installation is paused and anonymous admin access is denied',async()=>{
  assert.equal((await api('catalog')).settings.paused,true);
  await rejects(()=>api('admin_bootstrap'),/Authorized/);
  await rejects(()=>api('admin_bootstrap',{},ids.customer),/Authorized/);
  await rejects(()=>as(ids.customer,()=>db.query('select * from elio.orders')),/permission denied/);
  await rejects(()=>as(ids.customer,()=>db.query("select elio.calculate_quote('{}',null)")),/permission denied/);
  await rejects(()=>as(null,()=>db.query("select public.shop_service('maintenance')")),/permission denied/);
 })();
 await check('Account navigation exposes only the current database-assigned role',async()=>{
  assert.deepEqual(await api('account_access'),{role:null});
  assert.deepEqual(await api('account_access',{},ids.customer),{role:null});
  assert.deepEqual(await api('account_access',{},ids.owner),{role:'owner'});
  assert.deepEqual(await api('account_access',{},ids.staff),{role:'staff'});
  await db.query("update auth.users set raw_user_meta_data=jsonb_build_object('role','owner') where id=$1",[ids.customer]);
  try {
   assert.deepEqual(await api('account_access',{user_id:ids.owner,role:'owner'},ids.customer),{role:null});
  } finally { await db.query("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1",[ids.customer]); }
 })();
 await check('Only owners can change settings, prices, promotions, and team access',async()=>{
  for(const name of ['save_settings','save_product','save_promo','save_staff'])await rejects(()=>api(name,{},ids.staff),/owner/);
  await api('save_settings',{settings:{paused:false,payment_instructions:'QA only',pickup_address:'QA pickup',contact_email:'owner@example.test',site_url:'https://example.test'}},ids.owner);
  v=await product({kind:'flavor',name:'Vanilla',price_cents:0,in_rotation:true});
  m=await product({kind:'flavor',name:'Matcha',price_cents:5000,in_rotation:true});
  s=await product({kind:'set',name:'Signature Trio',price_cents:99000,box_flavors:[v.id,v.id,m.id]});
  custom=await product({kind:'custom_box',name:'Custom Box',price_cents:90000});
  date=await h.day(5);
  for(const [p,n] of [[v,20],[m,20]])await inventory(p,date,n);
 })();
 await check('Prices require explicit confirmation; stock types are immutable',async()=>{
  await rejects(()=>product({price_confirmed:false}),/Confirm this price/);
  await rejects(()=>api('save_product',{product:{...v,kind:'set',box_flavors:[v.id,v.id,v.id]}},ids.owner),/cannot change/);
  await rejects(()=>inventory(custom,date,10),/All boxes use flavor stock/);
  await rejects(()=>product({price_cents:1.1}),/whole centavos|integer/);
 })();
 const mixed=(quantity=1, counts={[v.id]:1,[m.id]:2})=>item(custom,quantity,{flavors:counts});
 await check('The catalog builds three-choice custom boxes from flavor prices and excludes standalone flavors',async()=>{
  const c=await api('catalog');assert(!c.products.some(p=>p.id===v.id));
  assert.equal(c.products.find(p=>p.id===custom.id).option_groups[0].required_count,3);
  const a=await api('admin_bootstrap',{},ids.owner);assert(a.products.some(p=>p.id===v.id));
  assert.equal(a.products.find(p=>p.id===custom.id).option_groups[0].choices.find(c=>c.id===m.id).surcharge_cents,5000);
 })();
 await check('Custom prices include repeated flavor surcharges for every box; caller prices are ignored',async()=>{
  const q=await api('quote',checkout(custom,date,{items:[{...mixed(2),unit_price_cents:1,stock_requirements:[]}],total_cents:1}));
  assert.equal(q.subtotal_cents,200000);assert.equal(q.items[0].unit_price_cents,100000);
  assert.deepEqual(q.items[0].stock_requirements.sort((a,b)=>a.quantity-b.quantity),[{product_id:v.id,quantity:1},{product_id:m.id,quantity:2}]);
  await rejects(()=>api('quote',checkout(v,date)),/inside a custom box/);
 })();
 await check('Invalid flavor counts, unknown flavors, and unconfirmed surcharges are rejected',async()=>{
  for(const n of [0,2,4])await rejects(()=>api('quote',checkout(custom,date,{items:[mixed(1,{[v.id]:n})]})),/exactly 3/);
  await rejects(()=>api('quote',checkout(custom,date,{items:[mixed(1,{[randomUUID()]:3})]})),/Unknown option/);
  await api('save_product',{product:{...m,price_confirmed:false}},ids.owner);
  await rejects(()=>api('quote',checkout(custom,date,{items:[mixed()]})),/unavailable/);
  await api('save_product',{product:{...m,price_confirmed:true}},ids.owner);
 })();
 await check('Checkout reserves shared flavor pieces for custom boxes and fixed sets atomically',async()=>{
  const p=checkout(custom,date,{items:[mixed(2),item(s)]});o=await api('create_order',p,ids.customer);
  assert.equal(o.total_cents,299000);assert.match(o.reference,/^ELIO-/);
  assert.deepEqual((await allocations(o.id)).map(a=>[a.product_id,a.quantity]).sort(),[[v.id,4],[m.id,5]].sort());
  assert.equal(await h.remaining(m,date),15);assert.equal(await h.remaining(v,date),16);
  const retry=await api('create_order',p,ids.customer);assert.equal(retry.id,o.id);
  await rejects(()=>api('create_order',{...p,instructions:'different'},ids.customer),/different checkout/);
  await rejects(()=>api('get_order',{order_id:o.id},ids.stranger),/not authorized/);
  assert.equal((await api('get_order',{order_id:o.id},null,o.access_token)).id,o.id);
 })();
 await check('Stock checks aggregate repeated cart lines and do not oversell the last piece',async()=>{
  await inventory(m,date,6);
  await rejects(()=>api('quote',checkout(custom,date,{items:[mixed(),mixed()]})),/Only 1 pieces/);
  const before=await scalar('select count(*) from elio.orders');
  await rejects(()=>api('create_order',checkout(custom,date,{items:[mixed()]})),/Only 1 pieces/);
  assert.equal(await scalar('select count(*) from elio.orders'),before);
  // The final Matcha can make one fixed set; both box types then share sold-out stock.
  const setOrder=await api('create_order',checkout(s,date));assert.equal(await h.remaining(m,date),0);
  await rejects(()=>api('create_order',checkout(s,date)),/Only 0 pieces/);
  await action('cancel_order',setOrder,{reason:'QA cancel'});assert.equal(await h.remaining(m,date),1);
  await inventory(m,date,20);
 })();
 await check('Staff can set quantities but cannot reduce a limit below existing reservations',async()=>{
  await api('save_inventory',{rows:[{product_id:m.id,date,capacity:8,available:true}]},ids.staff);
  await rejects(()=>inventory(m,date,3),/below/);
  await inventory(m,date,20);
 })();
 await check('Edits preserve saved custom prices and move the flavor reservations atomically',async()=>{
  await api('save_product',{product:{...m,price_cents:9000}},ids.owner);
  o=await action('edit_order',o,{reason:'QA quantity',changes:{items:[mixed(3),item(s)]}});
  assert.equal(o.items[0].unit_price_cents,100000);assert.equal(await h.remaining(m,date),13);
  const next=await h.day(6);await inventory(m,next,1);await inventory(v,next,20);
  await rejects(()=>action('edit_order',o,{reason:'QA move',changes:{fulfillment_date:next}}),/Only 1 pieces/);
  assert.equal((await order(o.id)).fulfillment_date,date);assert.equal(await h.remaining(m,date),13);
  await inventory(m,next,20);
  o=await action('edit_order',o,{reason:'QA move',changes:{fulfillment_date:next}});
  assert.equal(await h.remaining(m,date),20);assert.equal(await h.remaining(m,next),13);date=next;
  await rejects(()=>action('edit_order',{...o,revision:o.revision-1},{reason:'QA',changes:{instructions:'stale'}}),/order changed/);
 })();
 await check('Unpaid cancellation releases every shared flavor reservation exactly once',async()=>{
  o=await action('cancel_order',o,{reason:'QA cancel'});
  assert.equal(await h.remaining(m,date),20);assert.equal(await h.remaining(v,date),20);
  await rejects(()=>action('cancel_order',o,{reason:'QA repeated'}),/already closed/);
 })();
 await check('Promo limits count reservations and payment approval; paid cancellation keeps a redeemed use',async()=>{
  const promo=await api('save_promo',{promo:{code:'ELIOQA',kind:'percent',value:10,min_subtotal_cents:0,cap_cents:null,per_account_limit:1,global_limit:1,expires_at:new Date(Date.now()+86400000).toISOString(),active:true}},ids.owner);
  const p=checkout(custom,date,{items:[mixed()],promo_code:promo.code});let paid=await api('create_order',p,ids.customer);
  assert.equal(paid.discount_cents,10800);
  await rejects(()=>api('create_order',checkout(s,date,{promo_code:promo.code}),ids.stranger),/total use limit/);
  paid=await h.proof(paid);paid=await order(paid.id);paid=await action('approve_payment',paid);
  assert.equal(paid.payment_status,'paid');assert.equal(paid.paid_amount_cents,97200);
  paid=await action('cancel_order',paid,{reason:'QA produced',restore_stock:false});
  assert((await allocations(paid.id)).every(a=>a.state==='retained'));
  assert.equal(await scalar('select state from elio.promo_usage where order_id=$1',[paid.id]),'redeemed');
  state.paid=paid;
 })();
 await check('Expired orders release reservations and private notes are never returned to a guest',async()=>{
  const pending=await api('create_order',checkout(s,date));
  const noted=await action('add_staff_note',pending,{note:'Private kitchen note'});
  const publicOrder=await api('get_order',{order_id:pending.id},null,pending.access_token);
  assert(!publicOrder.history.some(e=>e.reason==='Private kitchen note'));assert(noted.history.some(e=>e.reason==='Private kitchen note'));
  await db.query("update elio.orders set payment_deadline=now()-interval '1 minute' where id=$1",[pending.id]);
  const expired=await order(pending.id);assert.equal(expired.fulfillment_status,'expired');assert.equal((await allocations(pending.id)).length,0);
 })();
 await check('Team access protects the last owner and removes staff privileges immediately',async()=>{
  await rejects(()=>api('save_staff',{email:'owner@example.test',role:'none'},ids.owner),/owner/i);
  await api('save_staff',{email:'staff@example.test',role:'none'},ids.owner);
  assert.deepEqual(await api('account_access',{},ids.staff),{role:null});
  await rejects(()=>api('admin_bootstrap',{},ids.staff),/Authorized/);
 })();
 await check('Paid-active analytics excludes cancelled orders and refund labels',async()=>{
  const result=await api('admin_bootstrap',{},ids.owner);const report=buildAnalytics(result.orders,result.products);
  assert.equal(report.activePaidOrderCount,0);assert.equal(report.paidOrderCount,1);assert.equal(report.approvedPaymentsCents,97200);
 })();
 await check('All Elio tables have RLS and privileged functions are outside public',async()=>{
  const tables=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='elio' and c.relkind='r' and not c.relrowsecurity");assert.equal(tables.rows.length,0);
  const exposed=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosecdef");assert.equal(exposed.rows.length,0);
 })();
 await check('Only the designated verified email can claim the first owner role',async()=>{
  try{
   await db.exec("delete from elio.staff; insert into elio.pending_owners(email) values ('unverified@example.test')");
   await rejects(()=>api('admin_bootstrap',{},ids.unverified),/Authorized/);
   await db.exec("delete from elio.pending_owners; insert into elio.pending_owners(email) values ('customer@example.test'), ('future-owner@example.test')");
   await db.query("update auth.users set raw_user_meta_data='{}'::jsonb||jsonb_build_object('role','owner') where id=$1",[ids.stranger]);
   await rejects(()=>api('admin_bootstrap',{},ids.stranger),/Authorized/);
   assert.equal((await api('admin_bootstrap',{},ids.customer)).role,'owner');
   assert.equal(await scalar("select count(*) from elio.pending_owners where email='customer@example.test'"),0);
   assert.equal(await scalar("select count(*) from elio.pending_owners where email='future-owner@example.test'"),1);
   assert.equal((await api('admin_bootstrap',{},ids.customer)).role,'owner');
   await db.exec("insert into elio.pending_owners(email) values ('stranger@example.test')");
   await rejects(()=>api('admin_bootstrap',{},ids.stranger),/Authorized/);
  }finally{await db.exec('delete from elio.pending_owners; delete from elio.staff');await db.query("insert into elio.staff(user_id,role) values ($1,'owner')",[ids.owner]);}
 })();
}
