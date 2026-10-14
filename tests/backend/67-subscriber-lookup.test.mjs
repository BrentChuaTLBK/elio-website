import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export default async function({db,check,state}){
 const {api,service,as,scalar,ids}=state.h;
 const address='owner-lookup-'+randomUUID().slice(0,8)+'@example.test';let id;
 const lookup=email=>api('newsletter_subscriber_lookup',{email},ids.owner);
 await check('Subscriber lookup requires an owner and exposes no direct database function',async()=>{
  for(const user of [null,ids.customer,ids.staff,ids.unverified])await assert.rejects(()=>api('newsletter_subscriber_lookup',{email:address},user));
  await assert.rejects(()=>as(ids.owner,()=>db.query('select elio.newsletter_subscriber_lookup($1::jsonb)',[JSON.stringify({email:address})])),/permission denied/);
  await assert.rejects(()=>as(ids.owner,()=>db.query("select public.shop_api('newsletter_subscriber_lookup',$1::jsonb,null)",[JSON.stringify({email:address})]),'authenticated',{aal:'aal1'}));
 })();
 await check('Exact subscriber lookup normalizes case and spaces without prefix or wildcard enumeration',async()=>{
  await service('newsletter_subscribe',{email:address,source:'home_footer',consent:true,consent_version:'elio-newsletter-v2-single-opt-in',ip_hash:randomUUID().replaceAll('-','').repeat(2)});
  id=await scalar('select id from elio.newsletter_subscribers where email=$1',[address]);
  const result=await lookup('  '+address.toUpperCase()+'  ');assert.equal(result.found,true);assert.equal(result.subscriber.email,address);
  assert.equal(result.subscriber.source,'home_footer');assert.equal(result.subscriber.marketing_eligible,true);assert.equal(result.subscriber.contact_sync.ready,false);
  assert.deepEqual(await lookup('absent-'+address),{found:false});assert.deepEqual(await lookup('%@example.test'),{found:false});
  for(const value of ['',address.split('@')[0],address+', another@example.test'])await assert.rejects(()=>lookup(value),/valid email/);
  const allowed=['email','status','source','consent_version','consent_at','created_at','confirmed_at','subscribed_at','unsubscribed_at','suppressed','marketing_eligible','contact_sync'];
  assert.deepEqual(Object.keys(result.subscriber).sort(),allowed.sort());assert(!/digest|encrypted|unsubscribe_token|promo_id|lease|contact_id/.test(JSON.stringify(result)));
 })();
 await check('Lookup reports recorded eligibility and sync freshness without changing consent or queuing messages',async()=>{
  await db.query('update elio.newsletter_broadcast_runtime set segment_id=$1,topic_id=$2 where id',[randomUUID(),randomUUID()]);
  await db.query('insert into elio.newsletter_resend_contacts(subscriber_id,contact_id) values($1,$2)',[id,randomUUID()]);
  await db.query('update elio.newsletter_contact_sync set synced_version=version,synced_consent_at=(select consent_at from elio.newsletter_subscribers where id=$1),checked_at=now(),last_error=null where subscriber_id=$1',[id]);
  const snapshot=()=>scalar("select jsonb_build_object('subscriber',(select to_jsonb(s) from elio.newsletter_subscribers s where id=$1),'sync',(select to_jsonb(q) from elio.newsletter_contact_sync q where subscriber_id=$1),'outbox',(select count(*) from elio.newsletter_outbox),'contacts',(select to_jsonb(c) from elio.newsletter_resend_contacts c where subscriber_id=$1))",[id]);
  const before=await snapshot(),current=(await lookup(address)).subscriber;assert.equal(current.contact_sync.ready,true);assert.equal(current.contact_sync.state,'current');assert.deepEqual(await snapshot(),before);
  await db.query("update elio.newsletter_contact_sync set last_error='Secret provider diagnostics must not be returned' where subscriber_id=$1",[id]);
  const failed=(await lookup(address)).subscriber;assert.equal(failed.contact_sync.state,'needs_review');assert.equal(failed.contact_sync.ready,false);assert(!JSON.stringify(failed).includes('Secret'));
  for(const status of ['unsubscribed','suppressed','pending']){
   await db.query('update elio.newsletter_subscribers set status=$2 where id=$1',[id,status]);const row=(await lookup(address)).subscriber;
   assert.equal(row.status,status);assert.equal(row.marketing_eligible,false);assert.equal(row.suppressed,status==='suppressed');assert.equal(row.contact_sync.ready,false);
  }
 })();
 await check('Subscriber lookup limits repeated owner queries',async()=>{
  await db.query("delete from elio.newsletter_rate_limits where key=$1",['owner-subscriber-lookup:'+ids.owner]);
  for(let i=0;i<30;i++)await lookup(address);
  await assert.rejects(()=>lookup(address),/wait a minute/);
  await db.query("delete from elio.newsletter_rate_limits where key=$1",['owner-subscriber-lookup:'+ids.owner]);
 })();
}
