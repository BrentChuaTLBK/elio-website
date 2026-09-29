import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar,service,as}=h,month='2001-01';
 const report=()=>api('marketing_insights',{month},ids.owner);
 const group=async(source='home_popup')=>(await report()).groups.find(g=>g.kind==='newsletter'&&g.group_key===source);
 const subscribe=async(email,source='home_popup')=>{
  await service('newsletter_subscribe',{email,source,consent:true,consent_version:'elio-newsletter-v2-single-opt-in',ip_hash:createHash('sha256').update(randomUUID()).digest('hex')});
  return (await db.query('select * from elio.newsletter_subscribers where email=$1',[email])).rows[0];
 };
 // Exact historic timing fixtures keep the test deterministic across month/year boundaries.
 const order=async({email='cohort-a@example.test',promo=null,paid='2001-01-05T00:00:00Z',created='2001-01-04T00:00:00Z',status='confirmed',payment='paid',refund=false,source='website',test=false}={})=>{
  const id=randomUUID();
  await db.query(`insert into elio.orders(id,reference,access_digest,access_encrypted,created_at,fulfillment_date,method,payment_status,fulfillment_status,refund_label,data,idempotency_key,request_hash)
   values($1::uuid,$2,extensions.digest($1::uuid::text,'sha256'),extensions.digest($1::uuid::text,'sha256'),$3,'2001-01-06','delivery',$4,$5,$6,$7,$8,'cohort-fixture')`,
   [id,'ELIO-'+id.slice(0,8),created,payment,status,refund,JSON.stringify({buyer:{email},order_source:source,is_test:test,subtotal_cents:10000,discount_cents:500,total_cents:11500,delivery_cents:2000}),randomUUID()]);
  if(paid)await db.query("insert into elio.payments(order_id,amount_cents,proof_path,payment_reference,approved_by,approved_at) values($1,11500,'local-fixture','QA',$2,$3)",[id,ids.owner,paid]);
  if(promo)await db.query("insert into elio.promo_usage(order_id,promo_id,user_id,state) values($1,$2,$3,$4)",[id,promo,ids.customer,payment==='paid'?'redeemed':'reserved']);
  return id;
 };
 let sub,first;
 await check('Marketing reports reject anonymous/customer/staff access and direct helper access',async()=>{
  for(const action of ['marketing_insights','marketing_cohort_orders','marketing_affiliates','marketing_affiliate_ledger'])for(const who of [null,ids.customer,ids.staff])await assert.rejects(api(action,{},who),/owner|authorized|sign in/i);
  for(const role of ['anon','authenticated','service_role'])for(const fn of ['elio.marketing_cohort_rows(date)','elio.marketing_insights(text,jsonb)','elio.preserve_newsletter_acquisition()'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
  for(const who of [null,ids.customer,ids.owner])await assert.rejects(as(who,()=>db.query('select acquisition_source from elio.newsletter_subscribers')),/permission denied/);
  for(const invalid of ['2001-13','next','2026-01-01',"2001-01'",'1999-12','9999-12'])await assert.rejects(api('marketing_insights',{month:invalid},ids.owner));
  await assert.rejects(api('marketing_cohort_orders',{month,kind:'newsletter',group_key:'home_popup',offset:1000001},ids.owner),/page/);
 })();
 await check('Original newsletter acquisition survives duplicate signup, unsubscribe and rejoin through checkout',async()=>{
  sub=await subscribe('cohort-a@example.test');const before=await scalar("select count(*) from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[sub.id]);
  await subscribe(sub.email,'checkout');await db.query("update elio.newsletter_subscribers set status='unsubscribed',unsubscribed_at=now() where id=$1",[sub.id]);
  await db.query('delete from elio.newsletter_rate_limits where key=$1',['subscribe-email-minute:'+createHash('sha256').update(sub.email).digest('hex')]);await subscribe(sub.email,'checkout');
  const saved=(await db.query('select * from elio.newsletter_subscribers where id=$1',[sub.id])).rows[0];
  assert.equal(saved.source,'checkout');assert.equal(saved.acquisition_source,'home_popup');assert.equal(saved.acquisition_basis,'captured');assert.equal(saved.promo_id,sub.promo_id);assert.deepEqual(saved.offer_expires_at,sub.offer_expires_at);
  assert.equal(await scalar("select count(*) from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[sub.id]),before);
  await db.query("update elio.newsletter_subscribers set confirmed_at='2001-01-01T00:00:00Z' where id=$1",[sub.id]);
  assert.equal((await group()).people,1);assert.equal((await group()).eligible_issued,1);
 })();
 await check('Cohorts reconcile exact paid product money and exclude refunds, cancelled, unpaid, POS, test and late redemptions',async()=>{
  first=await order({promo:sub.promo_id});
  for(const change of [{refund:true},{status:'cancelled'},{status:'expired'},{payment:'under_review'},{source:'direct'},{source:'in_person'},{test:true},{paid:'2001-01-31T00:00:00Z'},{paid:'2000-12-31T23:59:59Z'},{paid:null}])await order({promo:sub.promo_id,...change});
  const g=await group();assert.equal(g.paid_orders,1);assert.equal(g.redeemed,1);assert.equal(g.gross_cents,10000);assert.equal(g.discount_cents,500);assert.equal(g.sales_cents,9500);
  const detail=await api('marketing_cohort_orders',{month,kind:'newsletter',group_key:'home_popup'},ids.owner);assert.equal(detail.total,1);assert.equal(detail.rows[0].id,first);assert.equal(detail.totals.sales_cents,g.sales_cents);assert.equal(detail.totals.gross_cents-detail.totals.discount_cents,g.sales_cents);
 })();
 await check('Later customer metric requires a separate later-created and later-paid website order inside the same window',async()=>{
  await order({created:'2001-01-03T00:00:00Z',paid:'2001-01-06T00:00:00Z'});assert.equal((await group()).later_customers,0);
  await order({created:'2001-01-07T00:00:00Z',paid:'2001-01-08T00:00:00Z',refund:true});assert.equal((await group()).later_customers,0);
  await order({created:'2001-01-07T00:00:00Z',paid:'2001-01-31T00:00:00Z'});assert.equal((await group()).later_customers,0);
  await order({email:' COHORT-A@example.test ',created:'2001-01-07T00:00:00Z',paid:'2001-01-08T00:00:00Z'});
  await order({created:'2001-01-09T00:00:00Z',paid:'2001-01-10T00:00:00Z'});assert.equal((await group()).later_customers,1);assert.equal((await group()).redeemed_customers,1);
 })();
 await check('Manila issue months, no-code signups and immature groups have honest denominators',async()=>{
  const edge=await subscribe('cohort-edge@example.test','checkout');await db.query("update elio.newsletter_subscribers set confirmed_at='2000-12-31T16:00:00Z' where id=$1",[edge.id]);
  const absent=await subscribe('cohort-no-code@example.test','checkout');await db.query("update elio.newsletter_subscribers set confirmed_at='2000-12-31T15:59:59Z',promo_id=null where id=$1",[absent.id]);
  assert.equal((await group('checkout')).people,1);
  const december=(await api('marketing_insights',{month:'2000-12'},ids.owner)).groups.find(g=>g.group_key==='checkout');assert.equal(december.people,1);assert.equal(december.issued,0);assert.equal(december.eligible_issued,0);
  const recent=await subscribe('cohort-recent@example.test');const current=await api('marketing_insights',{},ids.owner);const fresh=current.groups.find(g=>g.group_key==='home_popup');assert(fresh.collecting>=1);assert(fresh.eligible_issued<fresh.issued);assert(fresh.next_ready_at);
  const immature=(await db.query('select * from elio.marketing_cohort_rows(date_trunc(\'month\',now() at time zone \'Asia/Manila\')::date) where subject_id=$1',['newsletter:'+recent.id])).rows[0];assert.equal(immature.mature,false);
 })();
 await check('Paginated source orders match aggregates and report reads create no email or voucher side effects',async()=>{
  const before=await scalar('select count(*) from elio.newsletter_outbox');
  for(let i=0;i<51;i++){
   const promo=randomUUID(),email=`cohort-page-${i}@example.test`;
   await db.query("insert into elio.promos(id,code,data) select $1::uuid,$2,data||jsonb_build_object('id',$1::uuid::text,'code',$2::text) from elio.promos where id=$3",[promo,'PAGE'+promo.slice(0,8),sub.promo_id]);
   await db.query("insert into elio.newsletter_subscribers(email,status,source,consent_version,consent_at,confirmed_at,unsubscribe_digest,unsubscribe_encrypted,promo_id) select $1,'subscribed','home_popup',consent_version,consent_at,confirmed_at,extensions.digest($1::text,'sha256'),unsubscribe_encrypted,$2 from elio.newsletter_subscribers where id=$3",[email,promo,sub.id]);
   await order({promo,email});
  }
  const args={month,kind:'newsletter',group_key:'home_popup'},a=await api('marketing_cohort_orders',args,ids.owner),b=await api('marketing_cohort_orders',{...args,offset:50},ids.owner);
  assert.equal(a.total,52);assert.equal(a.rows.length,50);assert.equal(b.rows.length,2);assert.equal(new Set([...a.rows,...b.rows].map(o=>o.id)).size,52);assert.equal(a.totals.sales_cents,(await group()).sales_cents);assert.equal(a.rows.concat(b.rows).reduce((n,o)=>n+o.sales_cents,0),a.totals.sales_cents);
  assert.equal(await scalar('select count(*) from elio.newsletter_outbox'),before);
 })();
 await check('Affiliate insights reconcile ledger reversals and voided payouts with existing private balances',async()=>{
  const report=await api('marketing_affiliates',{},ids.owner);assert(report.rows.length);
  for(const a of report.rows){
   assert.equal(a.earned_cents,Number(await scalar('select coalesce(sum(amount_cents),0) from elio.affiliate_ledger where affiliate_id=$1',[a.id])));
   assert.equal(a.balance_cents,Number(await scalar('select elio.affiliate_balance($1)',[a.id])));
   assert.equal(a.paid_cents,Number(await scalar("select coalesce(sum(amount_cents),0) from elio.affiliate_payouts where affiliate_id=$1 and status='paid'",[a.id])));
   const entries=await api('marketing_affiliate_ledger',{id:a.id},ids.owner);assert.equal(entries.earned_cents,a.earned_cents);assert.equal(entries.total,Number(await scalar('select count(*) from elio.affiliate_ledger where affiliate_id=$1',[a.id])));
  }
 })();
 await check('Automatic offer issue groups keep code counts separate from unique repeat customers',async()=>{
  let campaign=await api('voucher_save_campaign',{campaign:{name:'Historic cohort fixture',terms:{trigger:'every_completed',kind:'fixed',value:500,min_subtotal_cents:1000,cap_cents:null,customer_limit:2,expiry_mode:'days',expiry_days:30}}},ids.owner);
  campaign=await api('voucher_save_campaign',{campaign:{...campaign,status:'active'}},ids.owner);
  campaign=await api('voucher_save_campaign',{campaign:{...campaign,status:'paused'}},ids.owner);
  for(let i=0;i<2;i++){
   const promo=randomUUID(),source=await order({email:'campaign-cohort@example.test',status:'completed'});
   await db.query("insert into elio.promos(id,code,data) select $1::uuid,$2,data||jsonb_build_object('id',$1::uuid::text,'code',$2::text) from elio.promos where id=$3",[promo,'CAM'+promo.slice(0,8),sub.promo_id]);
   await db.query("insert into elio.vouchers(promo_id,campaign_id,owner_email,source_order_id,title,issued_at) values($1,$2,'campaign-cohort@example.test',$3,'Historic fixture','2001-01-02T00:00:00Z')",[promo,campaign.id,source]);
   await order({promo,email:'campaign-cohort@example.test',created:i?'2001-01-09T00:00:00Z':'2001-01-04T00:00:00Z',paid:i?'2001-01-10T00:00:00Z':'2001-01-05T00:00:00Z'});
  }
  const g=(await report()).groups.find(g=>g.group_key===campaign.id);assert.equal(g.issued,2);assert.equal(g.redeemed,2);assert.equal(g.redeemed_customers,1);assert.equal(g.later_customers,1);assert.equal(g.sales_cents,19000);
  const d=await api('marketing_cohort_orders',{month,kind:'campaign',group_key:campaign.id},ids.owner);assert.equal(d.total,2);assert.equal(d.totals.sales_cents,g.sales_cents);
 })();
}
