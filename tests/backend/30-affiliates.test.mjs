import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar,service}=h,today=await h.day(0);
 const owner=(action,payload={})=>api('affiliate_'+action,payload,ids.owner);
 const mine=(user=ids.stranger,payload={})=>api('affiliate_dashboard',payload,user);
 let affiliate,code,original,second,payout;
 const start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+14*86400000).toISOString();
 const saveCode=(overrides={})=>owner('save_code',{id:code?.id||randomUUID(),affiliate_id:affiliate.id,revision:code?.revision||0,starts_at:start,
  promo:{code:code?.code||'AFF'+randomUUID().replaceAll('-','').slice(0,10),kind:'percent',value:5,min_subtotal_cents:50000,cap_cents:10000,per_account_limit:20,global_limit:100,expires_at:end,active:true,...overrides}});
 const place=async(user=ids.customer)=>{const f=await accountingFixture(h);await api('save_product',{product:{...f.product,price_cents:100000}},ids.owner);return api('create_order',h.checkout(f.product,f.date,{promo_code:code.code}),user);};
 const approve=async o=>{await h.proof(o);return h.action('approve_payment',await h.order(o.id));};
 const complete=async o=>h.action('set_fulfillment',await h.order(o.id),{status:'completed'});
 const pay=(action,p)=>service('affiliate_'+action,{user_id:ids.owner,...p});
 const proofPayload=(amount=5000)=>{const id=randomUUID();return {id,affiliate_id:affiliate.id,amount_cents:amount,paid_on:today,payment_method:'gcash',reference:'QA payout',note:'Local test only',request_hash:randomUUID().replaceAll('-','').repeat(2),path:`${affiliate.id}/${id}/${randomUUID()}.png`};};

 await check('affiliates are assigned by owners to verified accounts; private tables and owner actions reject other roles',async()=>{
  for(const user of [null,ids.customer,ids.staff,ids.unverified])await assert.rejects(api('affiliate_admin',{},user),/Sign in|owner|authorized/i);
  await assert.rejects(owner('save',{id:randomUUID(),revision:0,email:'missing@example.test',name:'Missing',commission_bps:1000}),/create.*account/i);
  affiliate=await owner('save',{id:randomUUID(),revision:0,email:'stranger@example.test',name:'QA Affiliate',commission_bps:1000,active:true});
  const listing=await owner('admin');assert.equal(listing.affiliates.length,1);assert.equal(listing.affiliates[0].id,affiliate.id);assert.equal(listing.affiliates[0].balance_cents,0);assert.equal(listing.affiliates[0].email,'stranger@example.test');
  assert.equal((await api('affiliate_status',{},ids.stranger)).assigned,true);
  assert.equal((await api('affiliate_status',{},ids.customer)).assigned,false);
  for(const table of ['affiliates','affiliate_codes','affiliate_orders','affiliate_ledger','affiliate_payouts','affiliate_audit'])for(const role of ['anon','authenticated','service_role'])
   assert.equal(await scalar('select has_table_privilege($1,$2,\'select,insert,update,delete\')',[role,'elio.'+table]),false);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.affiliate_api(text,jsonb)','execute')",[role]),false);
  assert.equal(await scalar("select public from storage.buckets where id='affiliate-payout-proofs'"),false);
 })();
 await check('custom affiliate codes enforce discount minimums, caps, validity, verified accounts and editable usage limits',async()=>{
  code=await saveCode();const f=await accountingFixture(h);await api('save_product',{product:{...f.product,price_cents:100000}},ids.owner);
  const request=h.checkout(f.product,f.date,{promo_code:code.code});
  const quote=await api('quote',request,ids.customer);assert.equal(quote.discount_cents,5000);assert.equal(quote.total_cents,95000);
  await assert.rejects(api('quote',request,ids.unverified),/verified/i);
  code=await owner('save_code',{id:code.id,affiliate_id:affiliate.id,revision:code.revision,starts_at:new Date(Date.now()+86400000).toISOString(),promo:code});
  await assert.rejects(api('quote',request,ids.customer),/not valid yet/i);code=await saveCode();
  code=await saveCode({expires_at:new Date(Date.now()-1000).toISOString()});await assert.rejects(api('quote',request,ids.customer),/expired/i);code=await saveCode();
  const small=await accountingFixture(h);await assert.rejects(api('quote',h.checkout(small.product,small.date,{promo_code:code.code}),ids.customer),/subtotal/i);
  await assert.rejects(api('save_promo',{promo:{...code,value:50}},ids.owner),/Affiliates section/);
  await assert.rejects(api('delete_promo',{id:code.id},ids.owner),/Affiliates section/);
  await assert.rejects(owner('save_code',{id:code.id,affiliate_id:affiliate.id,revision:1,starts_at:start,promo:{...code,value:8}}),/changed/i);
 })();
 await check('commission rate freezes at checkout, excludes delivery, and becomes payable only after completion',async()=>{
  original=await place();
  affiliate=await owner('save',{...affiliate,commission_bps:2000});
  original=await approve(original);
  await db.query("update elio.orders set data=data||'{\"delivery_cents\":15000,\"total_cents\":110000}'::jsonb where id=$1",[original.id]);
  let r=await mine();assert.equal(r.stats.estimated_cents,9500);assert.equal(r.stats.balance_cents,0);assert.equal(r.orders.find(o=>o.order_id===original.id).commission_bps,1000);
  original=await complete(original);r=await mine();assert.equal(r.stats.earned_cents,9500);assert.equal(r.stats.balance_cents,9500);assert.equal(r.stats.net_sales_cents,95000);
  second=await complete(await approve(await place()));r=await mine();assert.equal(r.stats.earned_cents,28500);
  assert.equal(r.orders.find(o=>o.order_id===second.id).commission_bps,2000);
  await h.action('add_staff_note',await h.order(second.id),{note:'Unrelated note'});
  assert.equal(await scalar('select count(*)::int from elio.affiliate_ledger where order_id=$1',[second.id]),1);
 })();
 await check('self-purchases retain the customer discount but never earn affiliate commission or expose customer details',async()=>{
  const self=await complete(await approve(await place(ids.stranger)));assert.equal(self.discount_cents,5000);
  const r=await mine();assert.equal(r.stats.earned_cents,28500);assert.equal(r.orders.find(o=>o.order_id===self.id).status,'self_purchase');
  const text=JSON.stringify(r);for(const secret of ['buyer','recipient','phone','access_token','proof_path','customer@example.test'])assert(!text.includes(secret),secret);
  await assert.rejects(mine(ids.customer,{id:affiliate.id,affiliate_id:affiliate.id}),/not.*assigned/i);
  await assert.rejects(owner('save',{id:randomUUID(),revision:0,email:'stranger@example.test',name:'Duplicate',commission_bps:500}),/already an affiliate/);
 })();
 await check('recording a partial payout requires owner access, preserves the proof, debits once and posts one accounting expense',async()=>{
  payout=proofPayload();assert.equal((await pay('authorize_payout',payout)).allowed,true);
  await assert.rejects(pay('authorize_payout',{...payout,user_id:ids.staff}),/owner|authorized/i);
  await assert.rejects(pay('commit_payout',{...payout,path:'../someone-else.png'}),/receipt path/i);
  await pay('commit_payout',payout);await pay('commit_payout',payout);
  assert.equal((await mine()).stats.balance_cents,23500);
  assert.equal(await scalar('select count(*)::int from elio.affiliate_payouts where id=$1',[payout.id]),1);
  const entries=(await api('accounting_report',{start:today,end:today,report_version:2},ids.owner)).entries;
  assert.equal(entries.find(e=>e.id===payout.id).amount_cents,5000);assert.equal(entries.find(e=>e.id===payout.id).kind,'expense');
  assert.equal((await pay('proof_read',{id:payout.id,user_id:ids.stranger})).path,payout.path);
  for(const user of [ids.staff,ids.customer])await assert.rejects(pay('proof_read',{id:payout.id,user_id:user}),/not available/i);
  assert(!JSON.stringify(await mine()).includes(payout.path));
  await assert.rejects(pay('commit_payout',{...payout,request_hash:'f'.repeat(64)}),/already been used/i);
 })();
 await check('payout commit rechecks balance; unpaid estimates cannot fund a payout and reversals offset future earnings',async()=>{
  const rest=proofPayload(23500);await pay('authorize_payout',rest);
  await h.action('set_refund_label',await h.order(second.id),{enabled:true});
  await assert.rejects(pay('commit_payout',rest),/cannot exceed/i);
  assert.equal((await mine()).stats.balance_cents,4500);
  await pay('commit_payout',proofPayload(4500));
  await h.action('set_refund_label',await h.order(original.id),{enabled:true});
  assert.equal((await mine()).stats.balance_cents,-9500);
  await assert.rejects(pay('commit_payout',proofPayload(1)),/cannot exceed/i);
  const waiting=await approve(await place());assert.equal((await mine()).stats.estimated_cents,19000);assert.equal((await mine()).stats.balance_cents,-9500);
  await complete(waiting);assert.equal((await mine()).stats.balance_cents,9500);
  await h.action('set_refund_label',await h.order(original.id),{enabled:true});assert.equal((await mine()).stats.balance_cents,9500,'Repeated refund does not reverse twice');
 })();
 await check('voiding a mistaken payout is audited, restores the balance and removes its accounting expense without losing its receipt',async()=>{
  const before=(await mine()).stats.balance_cents;
  await owner('void_payout',{id:payout.id,revision:1,reason:'Duplicate manual record'});
  await owner('void_payout',{id:payout.id,revision:1,reason:'Duplicate manual record'});
  assert.equal((await mine()).stats.balance_cents,before+5000);
  assert.equal((await mine()).payouts.find(p=>p.id===payout.id).status,'voided');
  assert.equal((await pay('proof_read',{id:payout.id,user_id:ids.stranger})).path,payout.path);
  assert.equal((await api('accounting_report',{start:today,end:today,report_version:2},ids.owner)).entries.some(e=>e.id===payout.id),false);
  assert.equal((await owner('history',{id:payout.id})).length,2);
 })();
 await check('pausing an affiliate blocks new code use while preserving dashboard access and existing earnings',async()=>{
  const before=(await mine()).stats;
  affiliate=await owner('save',{...affiliate,active:false});
  await assert.rejects(place(),/inactive/i);
  assert.deepEqual((await mine()).stats,before);
  assert.equal((await mine()).affiliate.active,false);
  affiliate=await owner('save',{...affiliate,active:true});
  const active=await place();await h.action('cancel_order',active,{reason:'Unused checkout'});
  assert.equal((await mine()).orders.find(o=>o.order_id===active.id).status,'cancelled');
 })();
 await check('affiliate discounts respect caps, fixed amounts and usage reservations through the common checkout engine',async()=>{
  const f=await accountingFixture(h);await api('save_product',{product:{...f.product,price_cents:300000}},ids.owner);
  const request=h.checkout(f.product,f.date,{promo_code:code.code});
  assert.equal((await api('quote',request,ids.customer)).discount_cents,10000,'5% is capped at PHP100');
  code=await saveCode({kind:'fixed',value:3575});assert.equal((await api('quote',request,ids.customer)).discount_cents,3575);
  code=await owner('save_code',{id:randomUUID(),affiliate_id:affiliate.id,revision:0,starts_at:start,promo:{...code,code:'LIMIT'+randomUUID().replaceAll('-','').slice(0,8),kind:'percent',value:5,per_account_limit:1,global_limit:2}});
  const first=await place();await assert.rejects(place(),/account|limit|used/i);
  const self=await place(ids.stranger);await assert.rejects(place(ids.owner),/limit|used/i);
  await h.action('cancel_order',first,{reason:'Release reserved use'});const replacement=await place();assert(replacement.id);
  await h.action('cancel_order',replacement,{reason:'Release local test reservation'});await h.action('cancel_order',self,{reason:'Release local test reservation'});
 })();
 await check('fractional commission rates round to centavos and paid amendments use the frozen order rate',async()=>{
  affiliate=await owner('save',{...affiliate,commission_bps:1234});code=await saveCode({kind:'fixed',value:1,min_subtotal_cents:0,cap_cents:null,per_account_limit:20,global_limit:100});
  const f=await accountingFixture(h);await api('save_product',{product:{...f.product,price_cents:10005}},ids.owner);
  let o=await api('create_order',h.checkout(f.product,f.date,{promo_code:code.code}),ids.customer);o=await complete(await approve(o));
  let s=(await mine()).orders.find(r=>r.order_id===o.id);assert.equal(s.net_sales_cents,10004);assert.equal(s.earned_cents,1234);
  affiliate=await owner('save',{...affiliate,commission_bps:5000});
  await db.query("update elio.orders set data=data||'{\"subtotal_cents\":20005,\"discount_cents\":1}'::jsonb where id=$1",[o.id]);
  s=(await mine()).orders.find(r=>r.order_id===o.id);assert.equal(s.commission_bps,1234);assert.equal(s.earned_cents,2468);
  // The current order UI closes completed orders; test the database boundary
  // directly so any later cancellation path still reverses a frozen rate.
  await db.query("update elio.orders set fulfillment_status='cancelled' where id=$1",[o.id]);
  assert.equal((await mine()).orders.find(r=>r.order_id===o.id).earned_cents,0);
  assert.equal(await scalar('select sum(amount_cents)::int from elio.affiliate_ledger where order_id=$1',[o.id]),0);
 })();
 await check('owner list and affiliate report reconcile current code counts, earnings and payment balances',async()=>{
  const list=(await owner('admin')).affiliates.find(a=>a.id===affiliate.id),report=await mine();
  assert.equal(list.balance_cents,report.stats.balance_cents);assert.equal(list.earned_cents,report.stats.earned_cents);assert.equal(list.code_count,report.codes.length);
  assert.equal((await owner('report',{id:affiliate.id})).affiliate.id,affiliate.id);
 })();
 state.affiliate={affiliate,code,payout};
}
