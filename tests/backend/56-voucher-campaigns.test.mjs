import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {renderNewsletterEmail,newsletterHeaders} from '../../supabase/functions/_shared/newsletter-emails.ts';
export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar,as,service}=h;
 const user=randomUUID(),email='vouchers@example.test';
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,email]);
 await api('save_settings',{settings:{...(await api('admin_bootstrap',{},ids.owner)).settings,paused:false,blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],cutoff_time:'',site_url:'https://example.test',payment_instructions:'Local QA only',contact_email:'owner@example.test',pickup_address:'Local QA only',newsletter_mailing_address:'Local QA only'}},ids.owner);
 const flavor=await h.product({kind:'flavor',price_cents:0}),box=await h.product({price_cents:90000,lead_days:0,box_flavors:[flavor.id,flavor.id,flavor.id]}),date=await h.day(2);
 const create=(changes={},who=user)=>api('create_order',h.checkout(box,date,{buyer:{name:'Voucher QA',email,phone:'09171234567',social_platform:'na',social_username:'N/A'},...changes}),who);
 const pay=async o=>{await h.proof(o,{user_id:user});return h.action('approve_payment',await h.order(o.id));};
 const complete=async o=>h.action('set_fulfillment',await h.order(o.id),{status:'completed'});
 const terms={trigger:'first_completed',kind:'fixed',value:5000,min_subtotal_cents:50000,cap_cents:null,customer_limit:1,expiry_mode:'days',expiry_days:30};
 const save=c=>api('voucher_save_campaign',{campaign:c},ids.owner);
 const stats=async id=>(await api('voucher_campaigns',{},ids.owner)).campaigns.find(c=>c.id===id).stats;
 const wallet=(status='available',who=user)=>api('my_vouchers',{status},who);
 let campaign,source,voucher,welcome,repeat;
 await check('Voucher campaigns and private tables enforce owner/account access and draft-first validation',async()=>{
  for(const who of [null,ids.staff,ids.customer])for(const action of ['voucher_campaigns','voucher_campaign_report','voucher_save_campaign'])await assert.rejects(()=>api(action,{},who),/owner/i);
  for(const who of [null,ids.owner,user])for(const table of ['vouchers','voucher_campaigns','voucher_completions','voucher_facts'])await assert.rejects(()=>as(who,()=>db.query('select * from elio.'+table)),/permission denied/);
  for(const who of [null,ids.unverified])await assert.rejects(()=>wallet('available',who),/Verify/);
  await assert.rejects(()=>save({name:'QA',status:'active',terms}),/draft/);
  for(const change of [{kind:'free'},{value:0},{customer_limit:0},{value:1.2},{expiry_days:366},{min_subtotal_cents:-1},{kind:'percent',value:101},{kind:'percent',value:10,cap_cents:0}])await assert.rejects(()=>save({name:'Invalid',terms:{...terms,...change}}));
  campaign=await save({name:'A little thank-you',email_subject:'Your next Elio treat is on us 🍰',email_copy:{eyebrow:'Baked with care',heading:'{{discount}} off your next order.',message:'Thank you! Enjoy {{discount}} next time.'},terms});assert.equal(campaign.status,'draft');
  campaign=await save({...campaign,status:'active'});
  await assert.rejects(()=>save({...campaign,revision:1}),/changed/);
 })();
 await check('Checkout newsletter signup issues the welcome code without an order, account or payment',async()=>{
  const guestEmail='newsletter-checkout-guest@example.test',before=await scalar('select count(*) from elio.orders');
  const request={email:guestEmail,consent:true,consent_version:'elio-newsletter-v2-single-opt-in',source:'checkout',ip_hash:createHash('sha256').update(randomUUID()).digest('hex')};
  await assert.rejects(()=>service('newsletter_subscribe',{...request,consent:false}),/consent/);
  await service('newsletter_subscribe',request);
  const original=(await db.query('select status,promo_id,offer_expires_at from elio.newsletter_subscribers where email=$1',[guestEmail])).rows[0];
  assert.equal(original.status,'subscribed');assert(original.promo_id);assert(original.offer_expires_at);
  assert.equal(await scalar('select count(*) from elio.orders'),before);
  assert.equal(await scalar('select count(*)::int from auth.users where email=$1',[guestEmail]),0);
  await service('newsletter_subscribe',request);
  assert.deepEqual((await db.query('select status,promo_id,offer_expires_at from elio.newsletter_subscribers where email=$1',[guestEmail])).rows[0],original);
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where to_email=$1 and event_type='newsletter_welcome'",[guestEmail]),1);
 })();
 await check('Completed paid website orders issue one immutable personal voucher and opt-in email',async()=>{
  await service('newsletter_subscribe',{email,consent:true,consent_version:'elio-newsletter-v2-single-opt-in',source:'checkout',ip_hash:createHash('sha256').update(randomUUID()).digest('hex')});
  welcome=(await wallet()).vouchers.find(v=>v.source==='newsletter');assert(welcome);
  source=await create();assert.equal((await stats(campaign.id)).issued,undefined);
  source=await pay(source);assert.equal((await wallet()).vouchers.length,1);
  source=await complete(source);voucher=(await wallet()).vouchers.find(v=>v.source==='order');assert(voucher);
  for(const offer of [welcome,voucher]){assert.match(offer.code,/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);assert.match(offer.code,/[A-Z]/);assert.match(offer.code,/[2-9]/);}
  assert.equal(voucher.value,5000);assert.equal(voucher.title,'A little thank-you');
  assert.equal((await stats(campaign.id)).issued,1);
  assert.equal(await scalar('select subject from elio.newsletter_outbox where voucher_id=$1',[voucher.id]),'Your next Elio treat is on us 🍰');
  const message=await scalar('select payload from elio.newsletter_outbox where voucher_id=$1',[voucher.id]);
  assert.equal(message.offer.code,voucher.code);
  assert.equal(message.email_copy.eyebrow,'Baked with care');assert.equal(message.email_copy.message,'Thank you! Enjoy {{discount}} next time.');
  const rendered=renderNewsletterEmail(message);assert.match(rendered.text,/₱50.00 off your next order/);assert.match(rendered.text,/₱500.00/);assert.match(rendered.html,/View my vouchers/);assert.match(rendered.text,/Manila time/);assert.match(rendered.text,/Unsubscribe/);
  assert(newsletterHeaders(message,'https://example.supabase.co')['List-Unsubscribe-Post']);
  const percent=renderNewsletterEmail({...message,title:'<script>bad</script>',offer:{...message.offer,kind:'percent',value:10,cap_cents:10000}});assert.match(percent.text,/10%/);assert.match(percent.text,/₱100.00/);assert(!percent.html.includes('<script>'));
  await db.query("update elio.orders set fulfillment_status='preparing' where id=$1",[source.id]);await complete(source);
  assert.equal(await scalar('select count(*)::integer from elio.newsletter_outbox where voucher_id=$1',[voucher.id]),1);
  assert.equal((await stats(campaign.id)).issued,1);
 })();
 await check('Campaign edits and pauses preserve issued terms; verified customers see only their own vouchers',async()=>{
  campaign=await save({...campaign,status:'paused',email_subject:'Come back for a little treat',email_copy:{eyebrow:'Until next time',heading:'A treat for you',message:'We hope to bake for you again.'},terms:{...terms,value:7500,expiry_days:7}});
  assert.equal(await scalar('select subject from elio.newsletter_outbox where voucher_id=$1',[voucher.id]),'Your next Elio treat is on us 🍰');
  assert.equal(await scalar("select payload#>>'{email_copy,eyebrow}' from elio.newsletter_outbox where voucher_id=$1",[voucher.id]),'Baked with care');
  assert.deepEqual((await wallet()).vouchers.find(v=>v.id===voucher.id),voucher);
  assert.equal((await wallet('available',ids.stranger)).vouchers.some(v=>v.id===voucher.id),false);
  for(const action of ['save_promo','delete_promo'])await assert.rejects(()=>api(action,action==='save_promo'?{promo:{id:voucher.id,code:voucher.code}}:{id:voucher.id},ids.owner),/original terms/);
  assert.equal((await api('admin_bootstrap',{},ids.owner)).promos.some(p=>p.id===voucher.id),false);
  await assert.rejects(()=>api('quote',h.checkout(box,date,{promo_code:voucher.code}),ids.stranger),/account that earned/);
  assert.equal((await api('quote',h.checkout(box,date,{promo_code:voucher.code}),user)).discount_cents,5000);
  await assert.rejects(()=>db.query('select elio.voucher_check($1,$2,true)',[voucher.id,user]),/website checkout/);
  campaign=await save({...campaign,status:'active'});
  await complete(await pay(await create()));assert.equal((await stats(campaign.id)).issued,1);
 })();
 await check('Voucher stats distinguish reservation, payment, refund and restored use without discounting delivery',async()=>{
  let redemption=await create({promo_code:voucher.code});assert.equal((await wallet()).vouchers.find(v=>v.id===voucher.id).status,'reserved');
  let s=await stats(campaign.id);assert.equal(s.reserved,1);assert.equal(s.used,0);assert.equal(s.sales_cents,0);
  await assert.rejects(()=>create({promo_code:voucher.code}),/use limit/);
  redemption=await pay(redemption);s=await stats(campaign.id);assert.equal(s.used,1);assert.equal(s.sales_cents,85000);assert.equal(s.discount_cents,5000);
  assert.equal((await wallet('used')).vouchers[0].id,voucher.id);
  redemption=await h.action('set_refund_label',await h.order(redemption.id),{enabled:true});s=await stats(campaign.id);assert.equal(s.used,0);assert.equal(s.sales_cents,0);assert.equal((await wallet()).vouchers.find(v=>v.id===voucher.id).status,'available');
  const next=await create({promo_code:voucher.code});await assert.rejects(async()=>h.action('set_refund_label',await h.order(redemption.id),{enabled:false}),/already been reused/);
  await h.action('cancel_order',next,{reason:'Local voucher QA'});assert.equal((await wallet()).vouchers.find(v=>v.id===voucher.id).status,'available');
  source=await h.action('set_refund_label',await h.order(source.id),{enabled:true});assert.equal((await wallet('expired')).vouchers.find(v=>v.id===voucher.id).status,'inactive');
  await assert.rejects(()=>create({promo_code:voucher.code}),/qualifying order/);
  source=await h.action('set_refund_label',await h.order(source.id),{enabled:false});
 })();
 await check('Repeated campaigns honor customer limits; POS and opt-outs never send voucher emails',async()=>{
  repeat=await save({name:'Repeat treat',terms:{...terms,trigger:'every_completed',customer_limit:2}});repeat=await save({...repeat,status:'active'});
  await api('newsletter_account_preference',{subscribed:false},user);
  for(let i=0;i<3;i++)await complete(await pay(await create()));
  const s=await stats(repeat.id);assert.equal(s.issued,2);assert.equal(s.emails_skipped,2);
  for(const origin of ['in_person','direct']){
   const o=await create();await db.query("update elio.orders set data=data||jsonb_build_object('order_source',$2::text),payment_status='paid',fulfillment_status='completed' where id=$1",[o.id,origin]);
  }
  assert.equal((await stats(repeat.id)).issued,2);
  const detail=await api('voucher_campaign_report',{id:repeat.id},ids.owner);assert.equal(detail.total,2);assert.equal(detail.vouchers[0].email_status,'skipped');
 })();
 await check('Newsletter wallet links original codes by verified email without resetting expiry or reissuing',async()=>{
  const after=(await wallet()).vouchers.find(v=>v.id===welcome.id);assert.equal(after.code,welcome.code);assert.equal(after.expires_at,welcome.expires_at);
  const before=await scalar('select count(*) from elio.promos');for(let i=0;i<3;i++)await wallet();assert.equal(await scalar('select count(*) from elio.promos'),before);
  await db.query("update elio.promos set data=jsonb_set(data,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",[welcome.id]);
  assert.equal((await wallet('expired')).vouchers.find(v=>v.id===welcome.id).status,'expired');
 })();
 await check('Guest checkout vouchers attach only to the matching verified email and keep first-order/customer limits across signup',async()=>{
  const guestEmail='voucher-guest@example.test',guestAccount=randomUUID();
  const guest=await create({buyer:{name:'Guest QA',email:guestEmail,phone:'09171234567',social_platform:'na',social_username:'N/A'}},null);
  await h.proof(guest);await h.action('approve_payment',await h.order(guest.id));await complete(guest);
  assert.equal(await scalar('select e.subject from elio.newsletter_outbox e join elio.vouchers v on v.promo_id=e.voucher_id where v.owner_email=$1 and v.campaign_id=$2',[guestEmail,campaign.id]),'Come back for a little treat');
  assert.equal(await scalar("select e.payload#>>'{email_copy,eyebrow}' from elio.newsletter_outbox e join elio.vouchers v on v.promo_id=e.voucher_id where v.owner_email=$1 and v.campaign_id=$2",[guestEmail,campaign.id]),'Until next time');
  const count=await scalar('select count(*)::int from elio.vouchers where owner_email=$1',[guestEmail]);assert.equal(count,2);
  await db.query('insert into auth.users(id,email) values($1,$2)',[guestAccount,guestEmail]);
  await assert.rejects(()=>wallet('available',guestAccount),/Verify/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[guestAccount]);
  const claimed=(await wallet('available',guestAccount)).vouchers;assert.equal(claimed.length,2);
  const code=claimed.find(v=>v.title==='A little thank-you').code;
  assert.equal((await api('quote',h.checkout(box,date,{promo_code:code}),guestAccount)).discount_cents,7500);
  await assert.rejects(()=>api('quote',h.checkout(box,date,{promo_code:code,buyer:{email:guestEmail}}),ids.stranger),/verified/);
  const afterSignup=await create({},guestAccount);await h.proof(afterSignup,{user_id:guestAccount});await h.action('approve_payment',await h.order(afterSignup.id));await complete(afterSignup);
  assert.equal(await scalar('select count(*)::int from elio.vouchers where campaign_id=$1 and owner_email=$2',[campaign.id,guestEmail]),1);
  assert.equal(await scalar('select count(*)::int from elio.vouchers where campaign_id=$1 and owner_email=$2',[repeat.id,guestEmail]),2);
  assert.equal((await api('voucher_campaign_report',{id:campaign.id},ids.owner)).vouchers.some(v=>v.email===guestEmail),true);
 })();
 await check('Expired unpaid reservations disappear from wallet state and original voucher expiry is enforced',async()=>{
  const waiting=await create({promo_code:voucher.code});
  await db.query("update elio.orders set payment_deadline=now()-interval '1 minute' where id=$1",[waiting.id]);
  assert.equal((await wallet()).vouchers.find(v=>v.id===voucher.id).status,'available');
  await db.query("update elio.promos set data=jsonb_set(data,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",[voucher.id]);
  assert.equal((await wallet('expired')).vouchers.find(v=>v.id===voucher.id).status,'expired');
  await assert.rejects(()=>create({promo_code:voucher.code}),/expired/);
 })();
 await check('Fixed-expiry campaigns reject past activation; voucher emails recheck opt-out and account email',async()=>{
  const expired=await save({name:'Expired draft',terms:{...terms,expiry_mode:'fixed',expires_at:new Date(Date.now()-86400000).toISOString()}});
  await assert.rejects(()=>save({...expired,status:'active'}),/future expiry/);
  // Recreate an in-flight notification to verify final sending checks, without contacting a provider.
  const row=(await db.query("update elio.newsletter_outbox set status='sending',lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes' where voucher_id=$1 returning id,lease_token",[voucher.id])).rows[0];
  assert.equal((await service('newsletter_prepare_email',row)).skip,true);
  assert.equal(await scalar('select status from elio.newsletter_outbox where id=$1',[row.id]),'skipped');
  campaign=await save({...campaign,status:'paused'});repeat=await save({...repeat,status:'paused'});
 })();
}
