import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
export default async function({db,check,state}){
 const h=state.h,{api,ids,scalar,action,order}=h;let box,ready,request;
 const reminders=id=>db.query("select * from elio.outbox where order_id=$1 and event_type='pickup_reminder' order by created_at,id",[id]).then(r=>r.rows);
 const claim=async row=>{const lease=randomUUID();await db.query("update elio.outbox set status='sending',attempts=attempts+1,lease_token=$2,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=$1",[row.id,lease]);return {id:row.id,lease_token:lease};};
 const create=async()=>{const o=await api('create_order',h.checkout(box,await h.day(2)),ids.customer);await h.proof(o,{user_id:ids.customer});return action('approve_payment',await order(o.id));};
 await check('Manual pickup reminders require staff and a paid, ready pickup without a refund label',async()=>{
  await api('save_settings',{settings:{paused:false,cutoff_time:''}},ids.owner);
  const flavor=await h.product({kind:'flavor',price_cents:15000});box=await h.product({box_flavors:[flavor.id,flavor.id,flavor.id],lead_days:0});
  const confirmed=await create();
  await assert.rejects(()=>action('send_pickup_reminder',confirmed),/Ready for pickup/);
  ready=await action('set_fulfillment',confirmed,{status:'ready_for_pickup'});
  for(const user of [null,ids.customer,ids.stranger])await assert.rejects(()=>api('send_pickup_reminder',{order_id:ready.id,revision:ready.revision,idempotency_key:randomUUID()},user),/Authorized/);
  await assert.rejects(()=>action('send_pickup_reminder',{...ready,revision:ready.revision-1}),/changed/);
  for(const changes of ["method='delivery'","payment_status='awaiting_payment'","refund_label=true","fulfillment_status='completed'"]){
   try{await db.query(`update elio.orders set ${changes} where id=$1`,[ready.id]);await assert.rejects(()=>action('send_pickup_reminder',ready),/Ready for pickup/);}finally{await db.query("update elio.orders set method='pickup',payment_status='paid',refund_label=false,fulfillment_status='ready_for_pickup' where id=$1",[ready.id]);}
  }
  assert.equal((await reminders(ready.id)).length,0);
 })();
 await check('Pickup reminders queue once per action, preserve order amounts and enforce a 15-minute gap',async()=>{
  const before=await order(ready.id),allocations=await h.allocations(ready.id);
  request={order_id:ready.id,revision:ready.revision,idempotency_key:randomUUID()};ready=await api('send_pickup_reminder',request,ids.staff);
  assert.equal(ready.fulfillment_status,'ready_for_pickup');assert.equal(ready.payment_status,'paid');assert.equal(ready.total_cents,before.total_cents);assert.equal(ready.pickup_reminder_count,1);assert(ready.pickup_reminder_requested_at);assert.deepEqual(await h.allocations(ready.id),allocations);
  assert.equal((await reminders(ready.id)).length,1);await api('send_pickup_reminder',request,ids.staff);assert.equal((await reminders(ready.id)).length,1);
  await assert.rejects(()=>action('send_pickup_reminder',ready),/15 minutes/);
  const row=(await reminders(ready.id))[0],lease=await claim(row),prepared=await h.service('prepare_email',lease),rendered=renderEmail(prepared.payload);
  assert.equal(prepared.to_email,'customer@example.test');assert.match(prepared.subject,/reminder about your pickup/);assert.match(rendered.text,/waiting for pickup/);assert.match(rendered.html,/A reminder about your pickup/);assert(!rendered.text.includes('scheduled for today'));
  await h.service('email_sent',{...lease,provider_id:'local-test-only'});
  await db.query("update elio.outbox set created_at=now()-interval '16 minutes' where id=$1",[row.id]);
  ready=await action('send_pickup_reminder',ready);assert.equal((await reminders(ready.id)).length,2);assert.equal(ready.pickup_reminder_count,2);
 })();
 await check('Queued pickup reminders skip collected, cancelled and refunded orders before sending',async()=>{
  const pending=(await reminders(ready.id)).find(r=>r.status==='pending');const lease=await claim(pending);
  ready=await action('set_fulfillment',ready,{status:'completed'});
  assert.deepEqual(await h.service('prepare_email',lease),{skip:true});assert.equal(await scalar('select status from elio.outbox where id=$1',[pending.id]),'skipped');
  for(const mutation of ['cancel_order','set_refund_label']){
   let o=await action('set_fulfillment',await create(),{status:'ready_for_pickup'});o=await action('send_pickup_reminder',o);
   const row=(await reminders(o.id))[0],lease=await claim(row);
   await action(mutation,o,{reason:'Local reminder eligibility test',enabled:true,restore_stock:true});
   assert.deepEqual(await h.service('prepare_email',lease),{skip:true});
  }
 })();
}
