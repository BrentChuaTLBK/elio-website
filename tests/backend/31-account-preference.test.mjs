import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export default async function({db,check,state}){
 const {api,scalar,service,ids}=state.h;
 await check('account newsletter preferences use verified identity, preserve welcome code on rejoin and sync opt-outs',async()=>{
  const id=randomUUID(),email='account-preference@example.test';
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
  for(const user of [null,ids.unverified])await assert.rejects(api('newsletter_account_preference',{subscribed:true},user),/verified/i);
  await assert.rejects(api('newsletter_account_preference',{subscribed:'false'},id),/Choose whether/);
  await assert.rejects(api('newsletter_account_preference',{},id),/Choose whether/);
  await db.exec('delete from elio.newsletter_rate_limits');
  const settings=await api('newsletter_account_preference',{subscribed:true,email:'someone-else@example.test',user_id:ids.owner},id);
  assert.equal(settings.own_status,'subscribed');
  assert.equal(await scalar("select count(*)::int from elio.newsletter_subscribers where email='someone-else@example.test'"),0);
  const before=(await db.query('select id,promo_id,offer_expires_at from elio.newsletter_subscribers where email=$1',[email])).rows[0];
  assert(before.promo_id);await api('newsletter_account_preference',{subscribed:true},id);
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[before.id]),1);
  assert.equal((await api('newsletter_account_preference',{subscribed:false},id)).own_status,'unsubscribed');
  assert.equal((await service('newsletter_activate_account',{user_id:id})).status,'not_subscribed');
  await db.exec('delete from elio.newsletter_rate_limits');
  assert.equal((await api('newsletter_account_preference',{subscribed:true},id)).own_status,'subscribed');
  const after=(await db.query('select id,promo_id,offer_expires_at from elio.newsletter_subscribers where email=$1',[email])).rows[0];assert.deepEqual(after,before);
  assert.equal(await scalar("select count(*)::int from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome_back'",[before.id]),1);
  await db.query("update elio.newsletter_subscribers set status='suppressed' where id=$1",[before.id]);
  assert.equal((await api('newsletter_account_preference',{subscribed:true},id)).own_status,'suppressed');
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.newsletter_account_preference(jsonb)','execute')",[role]),false);
 })();
}
