import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {renderNewsletterEmail,newsletterHeaders} from '../../supabase/functions/_shared/newsletter-emails.ts';

export default async function({db,check,state}) {
 const h=state.h,{api,ids,scalar}=h;
 const ip=()=>createHash('sha256').update(randomUUID()).digest('hex');
 const subscribe=(email,extra={})=>h.service('newsletter_subscribe',{email,source:'home_footer',consent:true,consent_version:'elio-newsletter-v1',ip_hash:ip(),...extra});
 const subscriber=email=>db.query('select * from elio.newsletter_subscribers where email=$1',[email]).then(result=>result.rows[0]);
 const message=(email,type='newsletter_confirmation')=>db.query('select * from elio.newsletter_outbox where to_email=$1 and event_type=$2 order by created_at desc,id desc limit 1',[email,type]).then(result=>result.rows[0]);
 const confirm=async email=>h.service('newsletter_confirm',{token:(await message(email)).payload.confirmation_token,ip_hash:ip()});
 const unsubscribe=async email=>h.service('newsletter_unsubscribe',{token:(await message(email,'newsletter_welcome')||await message(email)).payload.unsubscribe_token,ip_hash:ip()});
 const resetRates=()=>db.exec('delete from elio.newsletter_rate_limits');
 const admin=(extra={})=>api('newsletter_admin',extra,ids.owner);
 const campaign={subject:'A little Elio for the weekend',title:'Your next favorite',body:'Freshly baked favorites.\n\nChoose a little something.',cta_label:'Explore the boxes',cta_url:'https://example.test/order.html',image_url:'https://example.test/box.webp'};
 const claim=async row=>{const lease_token=randomUUID();await db.query("update elio.newsletter_outbox set status='sending',attempts=attempts+1,lease_token=$2,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=$1",[row.id,lease_token]);return {id:row.id,lease_token};};
 let first,offer,originalExpiry,box,order;

 await check('Newsletter settings are public but subscriber data, mutations and management stay private',async()=>{
  const settings=await api('newsletter_settings',{email:'customer@example.test'});
  assert.equal(settings.discount_percent,5);assert.equal(settings.min_subtotal_cents,50000);assert.equal(settings.cap_cents,10000);assert.equal(settings.expiry_days,14);assert.equal(settings.popup_delay_ms,5000);
  assert.equal(settings.known_subscriber,false);assert.equal(settings.own_status,null);
  assert.deepEqual(await h.service('newsletter_claim_emails'),[]);
  for(const user of [null,ids.customer,ids.staff]){
   for(const action of ['newsletter_admin','newsletter_admin_unsubscribe','newsletter_save_campaign','newsletter_send_campaign','newsletter_test_campaign','newsletter_subscribe'])await assert.rejects(()=>api(action,{},user),/owner|Authorized/i);
   await assert.rejects(()=>h.as(user,()=>db.query('select * from elio.newsletter_subscribers')),/permission denied/);
   await assert.rejects(()=>h.as(user,()=>db.query("select elio.newsletter_service_dispatch('newsletter_subscribe','{}')")),/permission denied/);
   await assert.rejects(()=>h.as(user,()=>db.query("select public.shop_service('newsletter_subscribe','{}')")),/permission denied/);
  }
  const rls=await scalar("select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='elio' and c.relname in ('newsletter_subscribers','newsletter_campaigns','newsletter_outbox','newsletter_rate_limits')");assert.equal(rls,true);
 })();
 await check('Newsletter consent validates input, normalizes email and queues only confirmation before opt-in',async()=>{
  for(const changes of [{email:'bad'},{consent:false},{consent_version:'bad'},{source:'other'},{ip_hash:'forged'}])await assert.rejects(()=>subscribe('customer@example.test',changes));
  const before=await scalar('select count(*) from elio.orders');
  assert.deepEqual(await subscribe('  Customer@Example.Test  '),{accepted:true,queued:true});
  first=await subscriber('customer@example.test');assert.equal(first.status,'pending');assert.equal(first.promo_id,null);assert.equal(first.consent_version,'elio-newsletter-v1');
  const queued=await message(first.email);assert.match(queued.payload.confirmation_token,/^[a-f0-9]{64}$/);assert.match(queued.payload.unsubscribe_token,/^[a-f0-9]{64}$/);
  const lease=await claim(queued),prepared=await h.service('newsletter_prepare_email',lease);
  const rendered=renderNewsletterEmail(prepared.payload);assert.match(rendered.text,/14 days after confirmation/);assert.match(rendered.text,/₱500/);assert.match(rendered.text,/₱100/);assert.match(rendered.text,/48 hours/);
  assert.match(rendered.html,/newsletter\.html#confirm=/);assert.equal(newsletterHeaders(prepared.payload,'https://example.test')['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  await h.service('newsletter_email_sent',{...lease,provider_id:'local-confirmation'});
  assert.equal(await scalar('select extract(epoch from confirmation_expires_at-consent_at)::integer from elio.newsletter_subscribers where id=$1',[first.id]),48*3600);
  assert.equal(await scalar("select count(*)::integer from elio.newsletter_outbox where event_type='newsletter_welcome'"),0);
  assert.equal(await scalar('select count(*) from elio.orders'),before);
  assert.equal((await subscribe(first.email)).rate_limited,true);
  const own=await api('newsletter_settings',{},ids.customer);assert.equal(own.known_subscriber,true);assert.equal(own.opted_in,true);assert.equal(own.own_status,'pending');
  assert.equal((await api('newsletter_settings',{email:first.email},ids.stranger)).known_subscriber,false);
 })();
 await check('Confirming issues one six-character 5% offer for 14 days and repeated confirmation never reissues it',async()=>{
  assert.deepEqual(await confirm(first.email),{status:'subscribed'});
  first=await subscriber(first.email);offer=await scalar('select data from elio.promos where id=$1',[first.promo_id]);originalExpiry=first.offer_expires_at;
  assert.match(offer.code,/^[2-9A-HJ-NP-Z]{6}$/);assert.equal(offer.value,5);assert.equal(offer.min_subtotal_cents,50000);assert.equal(offer.cap_cents,10000);assert.equal(offer.per_account_limit,1);assert.equal(offer.global_limit,1);
  assert.equal(await scalar('select extract(epoch from offer_expires_at-confirmed_at)::integer from elio.newsletter_subscribers where id=$1',[first.id]),14*86400);
  await confirm(first.email);assert.equal((await subscriber(first.email)).promo_id,first.promo_id);
  assert.equal(await scalar("select count(*)::integer from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[first.id]),1);
  assert.deepEqual((await message(first.email,'newsletter_welcome')).payload.offer,(({id,newsletter_managed,...rest})=>rest)(offer));
  const welcome=await message(first.email,'newsletter_welcome'),lease=await claim(welcome),prepared=await h.service('newsletter_prepare_email',lease),rendered=renderNewsletterEmail(prepared.payload);
  assert(rendered.text.includes(offer.code));assert.match(rendered.text,/5% off/);assert.match(rendered.text,/₱500/);assert.match(rendered.text,/₱100/);assert(rendered.text.includes(first.email));
  await h.service('newsletter_email_sent',{...lease,provider_id:'local-welcome'});
  for(const action of ['save_promo','delete_promo'])await assert.rejects(()=>api(action,action==='save_promo'?{promo:{...offer,value:100}}:{id:offer.id},ids.owner),/cannot be edited or deleted/);
 })();
 await check('Confirmation expiry and resends invalidate old tokens while rate limits persist across accepted requests',async()=>{
  await resetRates();await subscribe('expired@example.test');const old=await message('expired@example.test');
  await db.query("update elio.newsletter_subscribers set confirmation_expires_at=now()-interval '1 second' where email='expired@example.test'");
  await assert.rejects(()=>confirm('expired@example.test'),/invalid or expired/);
  await resetRates();await subscribe('expired@example.test');
  assert.equal(await scalar('select status from elio.newsletter_outbox where id=$1',[old.id]),'skipped');
  await assert.rejects(()=>h.service('newsletter_confirm',{token:old.payload.confirmation_token,ip_hash:ip()}),/invalid or expired/);
  await confirm('expired@example.test');
  await resetRates();const shared=ip();for(let n=0;n<20;n++)assert.equal((await subscribe(`ipquota${n}@example.test`,{ip_hash:shared})).queued,true);
  assert.equal((await subscribe('ipquota-blocked@example.test',{ip_hash:shared})).rate_limited,true);
  await resetRates();await db.query("insert into elio.newsletter_rate_limits(key,bucket,hits) values('subscribe-global-hour',floor(extract(epoch from now())/3600),50)");
  assert.equal((await subscribe('global-blocked@example.test')).rate_limited,true);assert.equal(await subscriber('global-blocked@example.test'),undefined);
  await resetRates();
 })();
 await check('Earned offers require the same verified account, respect minimum and cap, and survive unsubscribe without extension',async()=>{
  const flavor=await h.product({kind:'flavor',price_cents:0});box=await h.product({box_flavors:[flavor.id,flavor.id,flavor.id],price_cents:50000,lead_days:0});
  const checkout=h.checkout(box,await h.day(2),{promo_code:offer.code});
  for(const user of [null,ids.unverified,ids.stranger])await assert.rejects(()=>api('quote',{...checkout,buyer:{...checkout.buyer,email:first.email}},user),/verified email|verified.*received/);
  assert.equal((await api('quote',checkout,ids.customer)).discount_cents,2500);
  assert.equal((await api('quote',{...checkout,items:[h.item(box,5)]},ids.customer)).discount_cents,10000);
  const cheap=await h.product({box_flavors:[flavor.id,flavor.id,flavor.id],price_cents:49999,lead_days:0});await assert.rejects(()=>api('quote',{...checkout,items:[h.item(cheap)]},ids.customer),/subtotal/);
  await unsubscribe(first.email);assert.equal((await subscriber(first.email)).status,'unsubscribed');assert.equal((await api('quote',checkout,ids.customer)).discount_cents,2500);
  await resetRates();await subscribe(first.email);await confirm(first.email);const renewed=await subscriber(first.email);
  assert.equal(renewed.promo_id,first.promo_id);assert.deepEqual(renewed.offer_expires_at,originalExpiry);
  assert.equal(await scalar("select count(*)::integer from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[first.id]),1);
 })();
 await check('Account newsletter consent uses its verified Auth confirmation and cannot replay an old opt-in after unsubscribe',async()=>{
  assert.deepEqual(await h.service('newsletter_activate_account',{user_id:ids.stranger}),{status:'not_subscribed'});
  await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"newsletter_opt_in\":true,\"newsletter_consent_version\":\"elio-newsletter-v1\"}'::jsonb where id in ($1,$2)",[ids.stranger,ids.unverified]);
  assert.deepEqual(await subscribe('stranger@example.test',{source:'account'}),{accepted:true,queued:false});assert.equal(await subscriber('stranger@example.test'),undefined);
  assert.deepEqual(await h.service('newsletter_activate_account',{user_id:ids.unverified}),{status:'not_subscribed'});
  assert.deepEqual(await h.service('newsletter_activate_account',{user_id:ids.stranger}),{status:'subscribed'});
  assert.equal(await message('stranger@example.test'),undefined);const row=await subscriber('stranger@example.test');assert.equal(row.source,'account');
  await unsubscribe('stranger@example.test');await subscribe('stranger@example.test',{source:'account'});
  assert.deepEqual(await h.service('newsletter_activate_account',{user_id:ids.stranger}),{status:'not_subscribed'});assert.equal((await subscriber('stranger@example.test')).status,'unsubscribed');
  const status=await api('newsletter_settings',{},ids.stranger);assert.equal(status.known_subscriber,true);assert.equal(status.opted_in,false);
 })();
 await check('Owner subscriber pagination and campaign previews expose no tokens and never queue preview mail',async()=>{
  const dashboard=await admin({limit:1,search:'customer@'});assert.equal(dashboard.total,1);assert.equal(dashboard.subscribers.length,1);
  assert.equal(Object.keys(dashboard.subscribers[0]).some(key=>/token|digest|encrypted/.test(key)),false);
  const before=await scalar('select count(*) from elio.newsletter_outbox');const preview=await api('newsletter_preview_campaign',{campaign},ids.owner);
  assert.equal(preview.event_type,'newsletter_campaign');assert.equal(preview.recipient_count,dashboard.counts.subscribed);assert.equal(preview.unsubscribe_token,'preview-only');
  assert.equal(await scalar('select count(*) from elio.newsletter_outbox'),before);
  for(const changes of [{subject:'x\r\nBcc:bad'},{cta_url:'javascript:alert(1)'},{cta_url:'https://user:pass@example.test'},{image_url:'http://example.test/image'},{body:''}])await assert.rejects(()=>api('newsletter_save_campaign',{campaign:{...campaign,...changes}},ids.owner));
 })();
 await check('Campaign sends require reviewed revision and audience, queue active subscribers once, and freeze approved content',async()=>{
  let draft=await api('newsletter_save_campaign',{campaign},ids.owner);const firstDraft=draft;
  draft=await api('newsletter_save_campaign',{campaign:{...draft,title:'Reviewed title'}},ids.owner);
  await assert.rejects(()=>api('newsletter_save_campaign',{campaign:firstDraft},ids.owner),/changed/);
  const count=(await admin()).counts.subscribed;
  await assert.rejects(()=>api('newsletter_send_campaign',{campaign_id:draft.id,expected_revision:firstDraft.revision,expected_recipient_count:count},ids.owner),/changed/);
  await assert.rejects(()=>api('newsletter_send_campaign',{campaign_id:draft.id,expected_revision:draft.revision,expected_recipient_count:count+1},ids.owner),/subscriber list changed/);
  const request={campaign_id:draft.id,expected_revision:draft.revision,expected_recipient_count:count};
  assert.equal((await api('newsletter_send_campaign',request,ids.owner)).queued,count);await api('newsletter_send_campaign',request,ids.owner);
  assert.equal(await scalar('select count(*)::integer from elio.newsletter_outbox where campaign_id=$1',[draft.id]),count);
  assert.equal(await scalar("select count(*)::integer from elio.newsletter_outbox e join elio.newsletter_subscribers s on s.id=e.subscriber_id where e.campaign_id=$1 and s.status<>'subscribed'",[draft.id]),0);
  await assert.rejects(()=>api('newsletter_save_campaign',{campaign:{...draft,title:'Changed after sending'}},ids.owner),/Only draft/);
  const queued=(await db.query('select * from elio.newsletter_outbox where campaign_id=$1 order by id',[draft.id])).rows[0];const lease=await claim(queued);
  const prepared=await h.service('newsletter_prepare_email',lease);assert.equal(prepared.payload.campaign.title,'Reviewed title');
  const provider={from:'Elio QA <test@example.test>',to:[queued.to_email],subject:queued.subject,...renderNewsletterEmail(prepared.payload),headers:newsletterHeaders(prepared.payload,'https://example.test')};
  assert.deepEqual((await h.service('newsletter_prepare_email',{...lease,provider_payload:provider})).provider_payload,provider);
  assert.deepEqual((await h.service('newsletter_prepare_email',{...lease,provider_payload:{...provider,html:'Changed'}})).provider_payload,provider);
  await assert.rejects(()=>h.service('newsletter_prepare_email',{...lease,lease_token:randomUUID()}),/stale/);
  await h.service('newsletter_email_failed',{...lease,error:'Mock retry'});await assert.rejects(()=>h.service('newsletter_email_sent',{...lease,provider_id:'fake'}),/stale/);
  const retry=await claim(queued);assert.deepEqual((await h.service('newsletter_prepare_email',retry)).provider_payload,provider);
  await api('newsletter_admin_unsubscribe',{subscriber_id:queued.subscriber_id},ids.owner);
  assert.equal(await scalar('select status from elio.newsletter_outbox where id=$1',[queued.id]),'skipped');await assert.rejects(()=>h.service('newsletter_prepare_email',retry),/stale/);
 })();
 await check('Owner test sends target only the requested address and leased retries stop before provider idempotency expires',async()=>{
  const before=await scalar("select count(*) from elio.newsletter_outbox where event_type='newsletter_test_campaign'");
  await api('newsletter_test_campaign',{campaign,recipient:'qa-test@example.test'},ids.owner);
  assert.equal(await scalar("select count(*) from elio.newsletter_outbox where event_type='newsletter_test_campaign'"),Number(before)+1);
  const row=await message('qa-test@example.test','newsletter_test_campaign');assert.equal(row.subscriber_id,null);assert.equal(row.payload.unsubscribe_token,null);
  const lease=await claim(row);assert.equal((await h.service('newsletter_prepare_email',lease)).to_email,'qa-test@example.test');
  await h.service('newsletter_email_sent',{...lease,provider_id:'local-only'});assert.equal(await scalar('select status from elio.newsletter_outbox where id=$1',[row.id]),'sent');
  await db.query("update elio.newsletter_outbox set status='pending',first_attempt_at=now()-interval '24 hours' where id=$1",[row.id]);
  assert(Array.isArray(await h.service('newsletter_claim_emails',{limit:3})));assert.equal(await scalar('select status from elio.newsletter_outbox where id=$1',[row.id]),'failed');
 })();
 await check('Newsletter confirmation and welcome deliveries take priority over an older campaign backlog',async()=>{
  await db.exec("update elio.newsletter_outbox set status='sent',lease_token=null,leased_until=null where status in ('pending','sending')");
  const active=await subscriber('expired@example.test');
  const template=await message(active.email,'newsletter_welcome');
  await db.query("insert into elio.newsletter_outbox(event_key,event_type,subscriber_id,to_email,subject,payload,created_at) values($1,'newsletter_campaign',$2,$3,'Old campaign',$4::jsonb,now()-interval '1 day')",['priority-campaign',active.id,active.email,JSON.stringify(template.payload)]);
  await resetRates();await subscribe('priority@example.test');
  const claims=await h.service('newsletter_claim_emails',{limit:1});assert.equal(claims.length,1);assert.equal(claims[0].payload.event_type,'newsletter_confirmation');
 })();
 await check('Newsletter code analytics retain uses but exclude delivery, cancelled orders and refunds from product sales',async()=>{
  const checkout=h.checkout(box,await h.day(2),{promo_code:offer.code,method:'delivery',address:{locality:'Newsletter QA City',line1:'Local QA address'}});
  await api('save_zone',{zone:{name:'Newsletter QA',localities:['Newsletter QA City'],active:true,fee_cents:3000}},ids.owner);
  order=await api('create_order',checkout,ids.customer);let report=await admin({offer_search:offer.code});assert.equal(report.offers[0].status,'reserved');assert.equal(report.offers[0].sales_cents,0);
  await assert.rejects(()=>api('create_order',{...checkout,idempotency_key:randomUUID()},ids.customer),/use limit/);
  await h.proof(order,{user_id:ids.customer});order=await h.action('approve_payment',await h.order(order.id));
  report=await admin({offer_search:offer.code});assert.equal(report.offers[0].status,'used');assert.equal(report.offers[0].redeemed_count,1);assert.equal(report.offers[0].paid_order_count,1);assert.equal(report.offers[0].sales_cents,47500);assert.equal(report.offers[0].discount_cents,2500);
  order=await h.action('set_refund_label',order,{enabled:true});report=await admin({offer_search:offer.code});assert.equal(report.offers[0].sales_cents,0);assert.equal(report.offers[0].redeemed_count,1);
  order=await h.action('set_refund_label',order,{enabled:false});order=await h.action('cancel_order',order,{reason:'Local newsletter QA',restore_stock:true});
  report=await admin({offer_search:offer.code,offer_limit:1});assert.equal(report.offers[0].sales_cents,0);assert.equal(report.offers[0].status,'used');assert.equal(report.offer_total,1);assert(report.offer_counts.issued>=3);
  await db.query("update elio.promos set data=jsonb_set(data,'{expires_at}',to_jsonb((now()-interval '1 second')::text)) where id=$1",[offer.id]);
  await assert.rejects(()=>api('quote',checkout,ids.customer),/expired/);
 })();
 await check('Every new newsletter code mixes letters and digits, stays unique, and leaves prior codes unchanged',async()=>{
  const before=(await db.query('select id,code from elio.promos order by id')).rows;
  const codes=[];
  for(let index=0;index<64;index++){
   const user=randomUUID(),email=`mixed-code-${index}@example.test`;
   await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),'{\"newsletter_opt_in\":true,\"newsletter_consent_version\":\"elio-newsletter-v1\"}')",[user,email]);
   assert.deepEqual(await h.service('newsletter_activate_account',{user_id:user}),{status:'subscribed'});
   const code=await scalar('select p.code from elio.newsletter_subscribers n join elio.promos p on p.id=n.promo_id where n.email=$1',[email]);
   assert.match(code,/^[2-9A-HJ-NP-Z]{6}$/);assert.match(code,/[A-HJ-NP-Z]/);assert.match(code,/[2-9]/);codes.push(code);
  }
  assert.equal(new Set(codes).size,codes.length);
  assert.deepEqual((await db.query('select id,code from elio.promos where id=any($1::uuid[]) order by id',[before.map(row=>row.id)])).rows,before);
 })();
 await check('A mixed newsletter code collision retries without replacing the existing code',async()=>{
  const original=await scalar("select pg_get_functiondef('extensions.gen_random_bytes(integer)'::regprocedure)");
  const existing=await scalar("select exists(select 1 from elio.promos where code='A22222')");
  if(!existing)await db.query("insert into elio.promos(code,data) values('A22222',$1::jsonb)",[JSON.stringify({...offer,id:randomUUID(),code:'A22222'})]);
  const protectedId=await scalar("select id from elio.promos where code='A22222'");
  try{
   await db.exec(`create temporary table newsletter_code_random_calls(n integer);insert into newsletter_code_random_calls values(0);
    create or replace function extensions.gen_random_bytes(integer) returns bytea language plpgsql volatile as $$
    declare n integer;begin
     if $1=12 then update pg_temp.newsletter_code_random_calls set n=newsletter_code_random_calls.n+1 returning newsletter_code_random_calls.n into n;
      return decode(repeat(lpad(to_hex(n-1),2,'0'),$1),'hex');end if;
     return decode(repeat('ab',$1),'hex');end $$;`);
   const user=randomUUID();await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'mixed-collision@example.test',now(),'{\"newsletter_opt_in\":true,\"newsletter_consent_version\":\"elio-newsletter-v1\"}')",[user]);
   await h.service('newsletter_activate_account',{user_id:user});
   const code=await scalar("select p.code from elio.newsletter_subscribers n join elio.promos p on p.id=n.promo_id where n.email='mixed-collision@example.test'");
   assert.notEqual(code,'A22222');assert.match(code,/[A-HJ-NP-Z]/);assert.match(code,/[2-9]/);
   assert((await scalar('select n from newsletter_code_random_calls'))>=2);
   assert.equal(await scalar("select id from elio.promos where code='A22222'"),protectedId);
  }finally{await db.exec(original);await db.exec('drop table newsletter_code_random_calls');}
 })();
}
