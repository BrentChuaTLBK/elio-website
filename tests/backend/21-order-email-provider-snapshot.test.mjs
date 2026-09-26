import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';

export default async function({db,check,state}) {
 const h=state.h;let order,row,lease,provider;
 const prepare=extra=>h.service('prepare_email',{id:row.id,lease_token:lease,...extra});
 const claim=async()=>{lease=randomUUID();await db.query("update elio.outbox set status='sending',attempts=attempts+1,lease_token=$2,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=$1",[row.id,lease]);};
 await check('Order email preparation freezes the actual rendered provider body without changing an existing lease',async()=>{
  const flavor=await h.product({kind:'flavor',price_cents:15000});
  const box=await h.product({name:'QA snapshot box',box_flavors:[flavor.id,flavor.id,flavor.id],photos:['assets/qa-snapshot.webp'],lead_days:0});
  order=await h.api('create_order',h.checkout(box,await h.day(2)));
  row=(await db.query("select * from elio.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows[0];await claim();
  const prepared=await prepare();assert.equal(prepared.provider_payload,null);
  provider={from:'Original Elio <original@example.test>',to:[prepared.to_email],reply_to:'elio.cheesecakes@gmail.com',subject:prepared.subject,...renderEmail(prepared.payload)};
  const frozen=await prepare({provider_payload:provider});assert.deepEqual(frozen.provider_payload,provider);
  assert.equal(frozen.lease_token,lease);assert.equal(frozen.attempts,1);assert.equal(frozen.first_attempt_at,prepared.first_attempt_at);
  assert(frozen.provider_payload.html.includes('QA snapshot box'));assert(frozen.provider_payload.html.includes('qa-snapshot.webp'));
 })();
 await check('Order provider snapshots remain immutable across retries and reject stale or browser-authorized mutation',async()=>{
  const original=await prepare();
  assert.deepEqual((await prepare({provider_payload:{...provider,from:'Changed sender',html:'Changed template'}})).provider_payload,provider);
  await assert.rejects(()=>h.service('prepare_email',{id:row.id,lease_token:randomUUID(),provider_payload:provider}),/stale/);
  for(const user of [null,h.ids.customer,h.ids.owner]){
   await assert.rejects(()=>h.as(user,()=>db.query("select public.shop_service('prepare_email',$1::jsonb)",[JSON.stringify({id:row.id,lease_token:lease,provider_payload:provider})])),/permission denied/);
   await assert.rejects(()=>h.as(user,()=>db.query("update elio.outbox set provider_payload='{}' where id=$1",[row.id])),/permission denied/);
  }
  await h.service('email_failed',{id:row.id,lease_token:lease,error:'Simulated accepted email acknowledgement failure'});
  await claim();const retry=await prepare();assert.deepEqual(retry.provider_payload,provider);assert.equal(retry.first_attempt_at,original.first_attempt_at);
  await h.service('email_sent',{id:row.id,lease_token:lease,provider_id:'local-only'});
  assert.equal(await h.scalar('select status from elio.outbox where id=$1',[row.id]),'sent');
  await h.action('cancel_order',await h.order(order.id),{reason:'Local snapshot regression cleanup'});
 })();
 await check('Order payload freeze rejects a different recipient or incomplete body before storage',async()=>{
  const flavor=await h.product({kind:'flavor',price_cents:15000});
  const box=await h.product({box_flavors:[flavor.id,flavor.id,flavor.id],lead_days:0});
  order=await h.api('create_order',h.checkout(box,await h.day(2)));
  row=(await db.query("select * from elio.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows[0];await claim();
  const prepared=await prepare();const payload={...provider,to:[prepared.to_email]};
  for(const invalid of [{...payload,to:['wrong@example.test']},{...payload,text:null},{...payload,from:'Sender\nBcc: injected'},{...payload,bcc:['hidden@example.test']},{}]){
   await assert.rejects(()=>prepare({provider_payload:invalid}),/complete email provider payload/);
   assert.equal(await h.scalar('select provider_payload from elio.outbox where id=$1',[row.id]),null);
  }
  await h.action('cancel_order',await h.order(order.id),{reason:'Local validation regression cleanup'});
 })();
}
