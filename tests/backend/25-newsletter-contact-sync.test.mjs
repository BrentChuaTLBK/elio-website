import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderNewsletterEmail} from '../../supabase/functions/_shared/newsletter-emails.ts';
export default async function({db,check,state}){
 const {service,scalar,ids,as}=state.h;let subscriber,lease,version,originalOffer,originalExpiry;
 const subscribe=()=>service('newsletter_subscribe',{email:'contact-lifecycle@example.test',source:'home_footer',consent:true,consent_version:'elio-newsletter-v2-single-opt-in',ip_hash:'b'.repeat(64)});
 const action=(name,p={})=>service('newsletter_contact_'+name,{lease_token:lease,subscriber_id:subscriber,version,...p});
 const isolate=async()=>{
  await db.exec("update elio.newsletter_broadcasts set status='cancelled'; update elio.newsletter_broadcast_runtime set active_campaign_id=null,lease_token=null,leased_until=null; update elio.newsletter_contact_sync set synced_version=version,checked_at=now(); delete from elio.newsletter_rate_limits");
 };
 await check('Contact sync is private and signup immediately queues work without a campaign',async()=>{
  for(const user of [null,ids.customer,ids.staff])await assert.rejects(()=>as(user,()=>db.query('select * from elio.newsletter_contact_sync')),/permission denied/);
  await isolate();await subscribe();subscriber=await scalar("select id from elio.newsletter_subscribers where email='contact-lifecycle@example.test'");
  const claim=await service('newsletter_contact_claim');lease=claim.lease_token;version=claim.rows.find(r=>r.subscriber_id===subscriber).version;
  assert.equal((await service('newsletter_contact_claim')).busy,true);assert.equal((await service('newsletter_broadcast_claim')).busy,true);
  assert.equal((await action('context')).fresh_consent,true);assert.equal((await action('context')).status,'subscribed');
  await assert.rejects(()=>action('context',{lease_token:randomUUID()}),/stale/);
  await action('done',{contact_id:randomUUID()});await action('release');
  assert.equal(await scalar('select synced_version=version from elio.newsletter_contact_sync where subscriber_id=$1',[subscriber]),true);
  originalOffer=await scalar('select promo_id from elio.newsletter_subscribers where id=$1',[subscriber]);originalExpiry=await scalar('select offer_expires_at from elio.newsletter_subscribers where id=$1',[subscriber]);
 })();
 await check('Unsubscribe queues deletion; stale acknowledgements cannot erase newer consent',async()=>{
  await db.query('select elio.newsletter_unsubscribe($1)',[subscriber]);let claim=await service('newsletter_contact_claim');lease=claim.lease_token;version=claim.rows.find(r=>r.subscriber_id===subscriber).version;
  assert.equal((await action('context')).status,'unsubscribed');await db.exec('delete from elio.newsletter_rate_limits');await subscribe();
  assert.equal((await action('done',{contact_id:null})).stale,true);await action('release');
  assert.equal(await scalar('select synced_version<version from elio.newsletter_contact_sync where subscriber_id=$1',[subscriber]),true);
  claim=await service('newsletter_contact_claim');lease=claim.lease_token;version=claim.rows.find(r=>r.subscriber_id===subscriber).version;
  assert.equal((await action('context')).fresh_consent,true);await action('done',{contact_id:randomUUID()});await action('release');
 })();
 await check('Rejoining sends one welcome-back email with no new discount or extended expiry',async()=>{
  assert.equal(await scalar('select promo_id from elio.newsletter_subscribers where id=$1',[subscriber]),originalOffer);
  assert.equal(String(await scalar('select offer_expires_at from elio.newsletter_subscribers where id=$1',[subscriber])),String(originalExpiry));
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[subscriber]),1);
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome_back'",[subscriber]),1);
  await db.exec('delete from elio.newsletter_rate_limits');await subscribe();
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome_back'",[subscriber]),1);
  const payload=await scalar("select payload from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome_back'",[subscriber]);const email=renderNewsletterEmail(payload);
  assert.match(email.text,/Welcome back/);assert.match(email.text,/new flavors/);assert.match(email.html,/#3d251c/);assert.match(email.text,/Unsubscribe/);assert(!payload.offer);assert(!email.text.includes('5%'));assert(!email.text.includes('Your personal code:'));
 })();
 await check('Provider opt-outs persist before contact removal; campaigns cannot recreate them',async()=>{
  await db.query("update elio.newsletter_contact_sync set checked_at='epoch' where subscriber_id=$1",[subscriber]);const claim=await service('newsletter_contact_claim');lease=claim.lease_token;version=claim.rows.find(r=>r.subscriber_id===subscriber).version;
  version=(await action('opt_out')).version;assert.equal((await action('context')).status,'unsubscribed');await action('done',{contact_id:null});await action('release');
  assert.equal(await scalar('select count(*)::int from elio.newsletter_resend_contacts where subscriber_id=$1',[subscriber]),0);assert.equal((await service('newsletter_contact_claim')).idle,true);
  assert.equal(await scalar('select promo_id from elio.newsletter_subscribers where id=$1',[subscriber]),originalOffer);
 })();
 await check('A later rejoin after provider deletion retains the same offer and creates a distinct welcome-back event',async()=>{
  await db.exec('delete from elio.newsletter_rate_limits');await subscribe();const claim=await service('newsletter_contact_claim');lease=claim.lease_token;version=claim.rows.find(r=>r.subscriber_id===subscriber).version;
  const context=await action('context');assert.equal(context.fresh_consent,true);assert.equal(context.contact_id,null);await action('release');
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome_back'",[subscriber]),2);
  assert.equal(await scalar('select promo_id from elio.newsletter_subscribers where id=$1',[subscriber]),originalOffer);assert.equal(String(await scalar('select offer_expires_at from elio.newsletter_subscribers where id=$1',[subscriber])),String(originalExpiry));
 })();
}
