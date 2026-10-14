// ISOLATED LOCAL TEST ONLY. tests/backend/run.mjs constructs an in-memory
// PGlite engine (no connection URL or data directory) and closes it in finally.
// Reject any non-PGlite database before constructing fixtures. No network client
// is imported here. All fixture rows disappear when that memory engine closes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {buildAnalytics} from '../../dist/assets/admin/analytics.js';
import {buildProduction} from '../../dist/assets/admin/production.js';
import {normalizeAnalytics,normalizeProduction} from '../../dist/assets/admin/scoped-reports.js';
import {matchesOrderView} from '../../dist/assets/admin/order-dashboard.js';
import {matchesFulfillmentStatus,needsPaymentReview,isActiveFulfillment} from '../../dist/assets/admin/refund-status.js';
import {attentionItems} from '../../dist/assets/admin/needs-attention.js';
const require=createRequire(process.env.PGLITE_PACKAGE_ROOT?join(resolve(process.env.PGLITE_PACKAGE_ROOT),'package.json'):import.meta.url),{PGlite}=require('@electric-sql/pglite');

export default async function({db,check,state}){
 assert(db instanceof PGlite,'This fixture suite only accepts the local PGlite test engine.');
 const h=state.h,api=(action,p={})=>h.rawApi(action,p,h.ids.owner),today=await h.day(0),next=await h.day(1),later=await h.day(30);
 let complete;const prefix='SCOPED-'+randomUUID().slice(0,5)+'-';
 await check('Scoped Admin reads enforce staff authorization and owner MFA',async()=>{
  for(const action of ['admin_order_page','admin_order_ids','admin_order_export','admin_analytics','admin_production']){
   for(const user of [null,h.ids.customer,h.ids.unverified])await assert.rejects(()=>h.rawApi(action,{from:today,to:today},user));
   await assert.rejects(()=>h.as(h.ids.owner,()=>db.query('select public.shop_api($1,$2::jsonb,null)',[action,JSON.stringify({from:today,to:today})]),'authenticated',{aal:'aal1'}));
  }
  for(const name of ['admin_order_page(text,jsonb)','admin_core_summary()','admin_analytics(jsonb)','admin_production(jsonb)'])assert.equal(await h.scalar('select has_function_privilege($1,$2,$3)',['authenticated','elio.'+name,'execute']),false);
 })();
 await check('Global aggregates preserve Manila boundaries, refunds, saved recipe variants and missing original approvals',async()=>{
  const flavor=await h.product({kind:'flavor',name:'Scoped Vanilla',price_cents:0,lead_days:0}),second=await h.product({kind:'flavor',name:'Scoped Chocolate',price_cents:0,lead_days:0}),box=await h.product({kind:'custom_box',name:'Scoped mixed box',price_cents:10000}),rows=[];
  for(let n=0;n<125;n++){
   const kind=n%10,paid=kind<7,quantity=n%3+1,method=n%2?'pickup':'delivery';
   const payment_status=paid?'paid':kind===7?'under_review':'awaiting_payment',fulfillment_status=kind===0?'completed':kind===5?'cancelled':kind===9?'expired':paid?'confirmed':'pending_confirmation';
   const recipe=n%13===0?[]:n%2?[{product_id:flavor.id,name:'Vanilla snapshot '+n%3,quantity:1},{product_id:second.id,name:'Chocolate',quantity:2}]:[{product_id:second.id,name:'Chocolate',quantity:1},{product_id:flavor.id,name:'Vanilla snapshot '+n%3,quantity:1},{product_id:second.id,name:'Chocolate',quantity:1}];
   const total=10000*quantity-500+(method==='delivery'?2000:0),id=randomUUID();
   rows.push({id,reference:prefix+String(n).padStart(3,'0'),created_at:n%4===0?'2026-08-31T15:59:59Z':n%4===1?'2026-08-31T16:00:00Z':today+'T00:00:00Z',fulfillment_date:n%3===0?today:next,method,payment_status,fulfillment_status,paid_amount_cents:paid?(n%7===0?null:total+(n%3-1)*500):null,refund_label:kind===6,
    data:{order_source:n%20===0?'in_person':n%11===0?'direct':'website',buyer:{name:'Scope buyer '+n,email:'scope-'+n%12+'@example.test',phone:'0900'+String(n).padStart(7,'0')},items:[{product_id:box.id,name:'Old box name '+n%4,product_kind:n%17===0?'pos_item':'custom_box',quantity,unit_price_cents:10000,...(n%9?{line_total_cents:10000*quantity}:{}),flavor_contents:recipe,selections:{flavors:[flavor.id,second.id,second.id]}}],subtotal_cents:10000*quantity,discount_cents:500,delivery_cents:method==='delivery'?2000:0,total_cents:total,promo_snapshot:{code:n%2?' saved5 ':'SAVED5'}}});
  }
  await db.query(`insert into elio.orders(id,reference,created_at,fulfillment_date,method,payment_status,fulfillment_status,paid_amount_cents,refund_label,data,idempotency_key,access_digest,access_encrypted,request_hash,payment_deadline)
   select id,reference,created_at,fulfillment_date,method,payment_status,fulfillment_status,paid_amount_cents,refund_label,data,gen_random_uuid(),extensions.digest(id::text,'sha256'),decode('00','hex'),'isolated-scoped-fixture',now()+interval '1 day' from jsonb_to_recordset($1::jsonb) as x(id uuid,reference text,created_at timestamptz,fulfillment_date date,method text,payment_status text,fulfillment_status text,paid_amount_cents integer,refund_label boolean,data jsonb)`,[JSON.stringify(rows)]);
  complete=await api('admin_bootstrap');
  for(const range of [{},{start:'2026-08-31',end:'2026-08-31'},{start:'2026-09-01',end:'2026-09-30'},{start:today,end:today},{start:'2099-01-01',end:'2099-01-02'}])assert.deepEqual(normalizeAnalytics(await api('admin_analytics',range)),buildAnalytics(complete.orders,{...range,today,products:complete.products}));
  assert.deepEqual(normalizeProduction(await api('admin_production',{from:today,to:later})),buildProduction(complete.orders,today,later));
  await assert.rejects(()=>api('admin_analytics',{start:'2026-02-30',end:today}));await assert.rejects(()=>api('admin_production',{from:next,to:today}),/valid/);
 })();
 await check('Pages, complete CSV data and global selection IDs preserve every order filter',async()=>{
  for(const f of [{},{task:'review'},{task:'today'},{search:prefix+'12'},{search:'scope-1@'},{search:'09000000001'},{search:'%'},{payment:'under_review'},{payment:'paid',fulfillment:'cancelled'},{fulfillment:'refunded'},{date:today,method:'delivery'},{refund:'yes'},{refund:'no',upcoming:true},{task:'today',search:'Scope buyer',method:'pickup'}]){
   const expected=complete.orders.filter(o=>matchesOrderView(o,f.task||'all',today)&&(!f.search||`${o.reference} ${o.buyer?.name||''} ${o.buyer?.email||''} ${o.buyer?.phone||''}`.toLowerCase().includes(f.search.toLowerCase()))&&(!f.payment||(f.payment==='under_review'?needsPaymentReview(o):o.payment_status===f.payment))&&matchesFulfillmentStatus(o,f.fulfillment)&&(!f.date||o.fulfillment_date===f.date)&&(!f.method||o.method===f.method)&&(!f.refund||Boolean(o.refund_label)===(f.refund==='yes'))&&(!f.upcoming||o.fulfillment_date>=today&&isActiveFulfillment(o))).sort((a,b)=>f.upcoming?a.fulfillment_date.localeCompare(b.fulfillment_date)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id):b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
   const ids=[];for(let page=0;page<Math.max(1,Math.ceil(expected.length/17));page++){const result=await api('admin_order_page',{...f,page,limit:17});assert.equal(result.total,expected.length);assert(result.orders.length<=17);ids.push(...result.orders.map(o=>o.id));}
   assert.deepEqual(ids,expected.map(o=>o.id),JSON.stringify(f));assert.deepEqual((await api('admin_order_ids',f)).ids,ids);assert.deepEqual((await api('admin_order_export',f)).orders.map(o=>o.id),ids);
  }
  const max=await api('admin_order_page',{limit:10000});assert.equal(max.limit,100);assert(max.orders.length<=100);const last=await api('admin_order_page',{page:10000,limit:50});assert.equal(last.page,Math.max(0,Math.ceil(complete.orders.length/50)-1));
  await assert.rejects(()=>api('admin_order_page',{task:'other'}),/valid/);await assert.rejects(()=>api('admin_order_page',{search:'x'.repeat(255)}),/254/);
 })();
 await check('Core bootstrap bounds previews while preserving complete operational counts and catalog data',async()=>{
  const core=await api('admin_bootstrap',{scope:'core'});assert.equal(core.orders_mode,'scoped');assert.deepEqual(core.orders,[]);
  assert.equal(core.reporting.order_summary.all,complete.orders.length);assert.equal(core.reporting.order_summary.review,complete.orders.filter(needsPaymentReview).length);assert.equal(core.reporting.order_summary.today,complete.orders.filter(o=>o.fulfillment_date===today&&isActiveFulfillment(o)).length);assert.equal(core.reporting.order_summary.upcoming,complete.orders.filter(o=>o.fulfillment_date>=today&&isActiveFulfillment(o)).length);
  assert(core.reporting.overview_orders.length<=7);assert(core.reporting.attention.items.length<=6);assert.equal(core.reporting.attention.total,attentionItems(complete).length);assert.deepEqual(core.products,complete.products);assert.deepEqual(core.settings,complete.settings);assert(!JSON.stringify(core.reporting).includes('access_token'));
  assert.equal((await h.rawApi('admin_order_page',{search:prefix},h.ids.staff)).total,125);
 })();
}
