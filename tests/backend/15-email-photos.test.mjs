import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.h;
 let order,entry,lease;
 await check('Email preparation snapshots only ordered product photos and preserves the saved recipe',async()=>{
  const flavor=await h.product({kind:'flavor',name:'QA email flavor',price_cents:0});
  const box=await h.product({name:'QA email box',box_flavors:[flavor.id,flavor.id,flavor.id],photos:['assets/original.webp'],lead_days:0});
  order=await h.api('create_order',h.checkout(box,await h.day(2)));
  entry=(await db.query("select id from elio.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows[0];
  lease=randomUUID();
  await db.query("update elio.outbox set status='sending',attempts=1,lease_token=$2,leased_until=now()+interval '3 minutes',first_attempt_at=now() where id=$1",[entry.id,lease]);
  const prepared=await h.service('prepare_email',{id:entry.id,lease_token:lease});
  assert.deepEqual(prepared.payload.product_photos,{[box.id]:'assets/original.webp'});
  assert.deepEqual(prepared.payload.order.items,order.items);
  await db.query("update elio.products set data=jsonb_set(data,'{photos}','[\"assets/changed.webp\"]') where id=$1",[box.id]);
  const retry=await h.service('prepare_email',{id:entry.id,lease_token:lease});
  assert.deepEqual(retry.payload,prepared.payload);
 })();
 await check('Email photo preparation still requires a valid service claim',async()=>{
  await assert.rejects(()=>h.service('prepare_email',{id:entry.id,lease_token:randomUUID()}),/stale/);
  await assert.rejects(()=>h.as(h.ids.customer,()=>db.query("select public.shop_service('prepare_email',$1::jsonb)",[JSON.stringify({id:entry.id,lease_token:lease})])),/permission denied/);
  await h.service('email_sent',{id:entry.id,lease_token:lease,provider_id:'local-test'});
 await h.action('cancel_order',await h.order(order.id),{reason:'Local email snapshot test'});
 })();
 await check('Reminders preserve an empty photo snapshot on retry and still skip cancelled orders',async()=>{
  const flavor=await h.product({kind:'flavor',price_cents:0});
  const box=await h.product({box_flavors:[flavor.id,flavor.id,flavor.id],photos:[],lead_days:0});
  const created=await h.api('create_order',h.checkout(box,await h.day(2)));
  await h.proof(created);
  await h.action('approve_payment',await h.order(created.id));
  const today=await h.day(0);
  await db.query('update elio.orders set fulfillment_date=$2 where id=$1',[created.id,today]);
  await db.query("update elio.settings set data=jsonb_set(data,'{reminders_enabled}','true') where id");
  const eventKey='local-photo-reminder/'+created.id;
  await db.query("select elio.queue_email($1,'fulfillment_reminder',$2,$3::date)",[created.id,eventKey,today]);
  const row=(await db.query('select id from elio.outbox where event_key=$1',[eventKey])).rows[0];
  const claim=randomUUID();
  await db.query("update elio.outbox set status='sending',attempts=1,lease_token=$2,leased_until=now()+interval '3 minutes',first_attempt_at=now() where id=$1",[row.id,claim]);
  const first=await h.service('prepare_email',{id:row.id,lease_token:claim});
  assert.deepEqual(first.payload.product_photos,{});
  await db.query("update elio.products set data=jsonb_set(data,'{photos}','[\"assets/later.webp\"]') where id=$1",[box.id]);
  const retry=await h.service('prepare_email',{id:row.id,lease_token:claim});
  assert.deepEqual(retry.payload,first.payload);
  await h.action('cancel_order',await h.order(created.id),{reason:'Local reminder snapshot test',restore_stock:true});
  assert.deepEqual(await h.service('prepare_email',{id:row.id,lease_token:claim}),{skip:true});
 })();
}
