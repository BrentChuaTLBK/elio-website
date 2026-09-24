import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.h, {api,ids,product,checkout,item,scalar,action,order}=h;
 await api('save_settings',{settings:{paused:false,blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],cutoff_time:'',payment_instructions:'Local promo QA',pickup_address:'Local QA only',contact_email:'owner@example.test',site_url:'https://example.test'}},ids.owner);
 const vanilla=await product({kind:'flavor',price_cents:0}),matcha=await product({kind:'flavor',price_cents:2500});
 const box=await product({price_cents:10000,box_flavors:[vanilla.id,vanilla.id,matcha.id],lead_days:0});
 const custom=await product({kind:'custom_box',price_cents:10000,lead_days:0});
 const date=await h.day(4);
 await api('save_zone',{zone:{name:'Promo QA',localities:['Promo QA City'],active:true,fee_cents:3000}},ids.owner);
 const draft=(changes={})=>({code:'QA'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),kind:'percent',value:10,min_subtotal_cents:0,cap_cents:null,per_account_limit:2,global_limit:100,expires_at:new Date(Date.now()+86400000).toISOString(),active:true,...changes});
 const save=(p)=>api('save_promo',{promo:p},ids.owner);
 const create=async(changes={})=>save(draft(changes));
 const payload=(p,changes={})=>checkout(box,date,{promo_code:p.code,...changes});
 const quote=(p,changes={},user=ids.customer)=>api('quote',payload(p,changes),user);
 const use=(p,changes={},user=ids.customer)=>api('create_order',payload(p,changes),user);
 const usage=p=>scalar('select count(*)::int from elio.promo_usage where promo_id=$1',[p.id]);
 const approve=async o=>{await h.proof(o,{user_id:ids.customer});return action('approve_payment',await order(o.id));};
 const expected=q=>Object.fromEntries(['items','subtotal_cents','discount_cents','delivery_cents','total_cents'].map(k=>[k,q[k]]));

 await check('Promo codes normalize case and whitespace, and only owners can manage them',async()=>{
  const p=await create({code:'  qa-normalized  '});assert.equal(p.code,'QA-NORMALIZED');
  assert.equal((await quote(p,{promo_code:' qa-Normalized '})).discount_cents,1000);
  for(const user of [null,ids.customer,ids.unverified]) {
   await assert.rejects(()=>api('save_promo',{promo:draft()},user),/authorized|owner/i);
   await assert.rejects(()=>api('delete_promo',{id:p.id},user),/authorized|owner/i);
  }
  assert.equal((await api('catalog')).promos,undefined);
 })();
 await check('Invalid discount amounts, limits, expiry, code syntax and duplicate names are rejected',async()=>{
  for(const changes of [{code:'BAD CODE'},{code:'X'.repeat(51)},{kind:'other'},{value:0},{value:101},{value:1.5},{min_subtotal_cents:-1},{cap_cents:-1},{per_account_limit:0},{global_limit:0},{global_limit:1.2},{expires_at:null},{expires_at:'invalid'}])await assert.rejects(()=>create(changes));
  const p=await create();await assert.rejects(()=>create({code:p.code.toLowerCase()}),/duplicate|already/i);
 })();
 await check('Guests and unverified accounts cannot redeem codes even with a forged buyer email',async()=>{
  const p=await create();for(const user of [null,ids.unverified])await assert.rejects(()=>quote(p,{buyer:{name:'QA',email:'owner@example.test',phone:'09171234567'}},user),/verified email/i);
  await assert.rejects(()=>quote(p,{promo_code:'NO_SUCH_PROMO'}),/not found/);
  assert.equal(await usage(p),0);
 })();
 await check('Inactive and expired codes fail before they can reserve a use',async()=>{
  for(const changes of [{active:false},{expires_at:new Date(Date.now()-1000).toISOString()}]) {
   const p=await create(changes);await assert.rejects(()=>quote(p),/inactive|expired/);await assert.rejects(()=>use(p),/inactive|expired/);assert.equal(await usage(p),0);
  }
 })();
 await check('Percentage promos include repeated custom flavor surcharges but exclude delivery',async()=>{
  const p=await create({value:20});
  const q=await quote(p,{items:[item(custom,2,{flavors:{[vanilla.id]:1,[matcha.id]:2}})],method:'delivery',address:{locality:'Promo QA City',line1:'Local QA address'}});
  assert.equal(q.subtotal_cents,30000);assert.equal(q.discount_cents,6000);assert.equal(q.delivery_cents,3000);assert.equal(q.total_cents,27000);
  assert.equal(await usage(p),0);
 })();
 await check('Minimum spend uses product subtotal, accepts the exact threshold and ignores delivery',async()=>{
  const p=await create({min_subtotal_cents:10001});
  await assert.rejects(()=>quote(p,{method:'delivery',address:{locality:'Promo QA City'}}),/excluding delivery/);
  const exact=await save({...p,min_subtotal_cents:10000});assert.equal((await quote(exact)).discount_cents,1000);
 })();
 await check('Percentage discounts round to centavos and respect the maximum discount',async()=>{
  const odd=await product({price_cents:10005,box_flavors:[vanilla.id,vanilla.id,matcha.id],lead_days:0});
  const p=await create();assert.equal((await quote(p,{items:[item(odd)]})).discount_cents,1001);
  assert.equal((await quote(await save({...p,cap_cents:500}))).discount_cents,500);
  assert.equal((await quote(await save({...p,cap_cents:0}))).discount_cents,0);
 })();
 await check('Fixed and 100 percent discounts cannot make products negative or discount delivery',async()=>{
  for(const changes of [{kind:'fixed',value:2500},{kind:'fixed',value:20000},{value:100}]) {
   const p=await create(changes),q=await quote(p,{method:'delivery',address:{locality:'Promo QA City'}});
   assert.equal(q.discount_cents,changes.value===2500?2500:10000);assert.equal(q.total_cents,13000-q.discount_cents);
  }
 })();
 await check('Client supplied discounts and promo snapshots cannot change the charged total',async()=>{
  const p=await create(),o=await use(p,{discount_cents:999999,total_cents:1,promo_snapshot:{...p,value:100}});
  assert.equal(o.discount_cents,1000);assert.equal(o.total_cents,9000);assert.equal(o.promo_snapshot.value,10);
  await action('cancel_order',o,{reason:'Local promo QA'});
 })();
 await check('Previewing a code reserves nothing; submitting and retrying reserve exactly one use',async()=>{
  const p=await create({global_limit:1,per_account_limit:1}),request=payload(p);
  for(let n=0;n<3;n++)await api('quote',request,ids.customer);assert.equal(await usage(p),0);
  const first=await api('create_order',request,ids.customer),retry=await api('create_order',request,ids.customer);
  assert.equal(first.id,retry.id);assert.equal(await usage(p),1);
  await assert.rejects(()=>api('create_order',{...request,items:[item(box,2)]},ids.customer),/submission key/);
  await assert.rejects(()=>use(p,{},ids.stranger),/total use limit/);
  await action('cancel_order',first,{reason:'Local promo QA'});assert.equal(await usage(p),0);
  const reused=await use(p,{},ids.stranger);assert.equal(reused.discount_cents,1000);
  await action('cancel_order',reused,{reason:'Local promo QA'});
 })();
 await check('Per-account limits use the authenticated identity, not the typed customer email',async()=>{
  const p=await create({per_account_limit:1}),first=await use(p);
  await assert.rejects(()=>use(p,{buyer:{...checkout(box,date).buyer,email:'other@example.test'}}),/account.*use limit/);
  const other=await use(p,{},ids.stranger);assert.equal(await usage(p),2);
  await action('cancel_order',first,{reason:'Local promo QA'});await action('cancel_order',other,{reason:'Local promo QA'});
 })();
 await check('Expired unpaid orders release their promo reservation for the next customer',async()=>{
  const p=await create({global_limit:1}),first=await use(p);
  await db.query("update elio.orders set payment_deadline=clock_timestamp()-interval '1 minute' where id=$1",[first.id]);
  const second=await use(p,{},ids.stranger);assert.equal((await order(first.id)).fulfillment_status,'expired');assert.equal(await usage(p),1);
  await action('cancel_order',second,{reason:'Local promo QA'});
 })();
 await check('Payment review keeps a use reserved; rejecting payment frees that use',async()=>{
  const p=await create({global_limit:1}),first=await use(p);await h.proof(first);
  await assert.rejects(()=>use(p,{},ids.stranger),/total use limit/);
  await action('reject_payment',await order(first.id),{reason:'Local invalid proof fixture'});assert.equal(await usage(p),0);
  assert.equal((await quote(p)).discount_cents,1000);
 })();
 await check('Approval redeems once; paid cancellations and refund labels do not restore a use',async()=>{
  const p=await create({global_limit:1});let paid=await approve(await use(p));
  assert.equal(await scalar('select state from elio.promo_usage where order_id=$1',[paid.id]),'redeemed');
  assert.equal(paid.paid_amount_cents,9000);
  paid=await action('cancel_order',paid,{reason:'Local paid cancellation',restore_stock:true});assert.equal(await usage(p),1);
  await action('set_refund_label',paid,{enabled:true,reason:'Local refund label'});
  await assert.rejects(()=>use(p,{},ids.stranger),/total use limit/);assert.equal(await usage(p),1);
 })();
 await check('Saved orders retain discounts after the promo is edited, disabled or expired',async()=>{
  const p=await create();let first=await use(p);
  await save({...p,value:50,active:false,expires_at:new Date(Date.now()-1000).toISOString()});
  first=await action('edit_order',first,{reason:'Local quantity amendment',changes:{items:[item(box,2)]}});
  assert.equal(first.discount_cents,2000);assert.equal(first.promo_snapshot.value,10);
  const paid=await approve(first);assert.equal(paid.paid_amount_cents,18000);assert.equal(await usage(p),1);
 })();
 await check('Unpaid amendments below the minimum release a use and restore it only when eligible',async()=>{
  const p=await create({min_subtotal_cents:20000});let o=await use(p,{items:[item(box,2)]});assert.equal(await usage(p),1);
  o=await action('edit_order',o,{reason:'Local subtotal reduction',changes:{items:[item(box)]}});assert.equal(o.discount_cents,0);assert.equal(await usage(p),0);
  o=await action('edit_order',o,{reason:'Local subtotal increase',changes:{items:[item(box,2)]}});assert.equal(o.discount_cents,2000);assert.equal(await usage(p),1);
  await action('cancel_order',o,{reason:'Local promo QA'});
 })();
 await check('Deleted promo names cannot be reused or reactivated; existing orders retain their discount',async()=>{
  const p=await create(),o=await use(p);await api('delete_promo',{id:p.id},ids.owner);
  assert(!(await api('admin_bootstrap',{},ids.owner)).promos.some(v=>v.id===p.id));
  await assert.rejects(()=>quote(p),/inactive/);await assert.rejects(()=>save(p),/deleted/);await assert.rejects(()=>create({code:p.code}),/deleted/);
  assert.equal((await approve(o)).discount_cents,1000);assert.equal(await usage(p),1);
 })();
 await check('Checkout revalidates codes changed or exhausted after the customer reviewed totals',async()=>{
  const p=await create(),q=await quote(p);await save({...p,value:20});
  await assert.rejects(()=>use(p,{expected_quote:expected(q)}),/changed since review/);assert.equal(await usage(p),0);
  const limited=await create({global_limit:1}),q2=await quote(limited),o=await use(limited,{},ids.stranger);
  await assert.rejects(()=>use(limited,{expected_quote:expected(q2)}),/total use limit/);
  await action('cancel_order',o,{reason:'Local promo QA'});
 })();
}
