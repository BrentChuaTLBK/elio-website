import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.h, {api,ids,action,order,scalar}=h;
 await api('save_settings',{settings:{paused:false,blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],cutoff_time:''}},ids.owner);
 await api('save_zone',{zone:{name:'Tracking QA',localities:['Tracking QA City'],active:true,fee_cents:3000}},ids.owner);
 const flavor=await h.product({kind:'flavor',price_cents:0});
 const box=await h.product({box_flavors:[flavor.id,flavor.id,flavor.id],lead_days:0});
 const date=await h.day(2);
 const create=async(method='delivery')=>api('create_order',h.checkout(box,date,{method,address:{locality:'Tracking QA City',line1:'Local QA address'}}),ids.customer);
 const approve=async created=>{await h.proof(created,{user_id:ids.customer});return action('approve_payment',await order(created.id));};
 const save=(o,url,extra={})=>action('save_delivery_tracking',o,{tracking_url:url,...extra});
 const notices=id=>db.query("select * from elio.outbox where order_id=$1 and event_type='delivery_tracking_updated' order by created_at,id",[id]).then(r=>r.rows);
 const claim=async id=>{const lease=randomUUID();await db.query("update elio.outbox set status='sending',attempts=attempts+1,lease_token=$2,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=$1",[id,lease]);return {id,lease_token:lease};};
 const business=async id=>({
  order:await scalar("select to_jsonb(o)-'revision'-'data'||jsonb_build_object('data',data-'delivery_tracking_url'-'delivery_tracking_updated_at') from elio.orders o where id=$1",[id]),
  allocations:await h.allocations(id),
  payments:(await db.query('select * from elio.payments where order_id=$1',[id])).rows,
 });
 let o=await approve(await create()),firstPayload,dispatchRetry;
 const firstUrl='https://share.lalamove.com/tracking/qa-first?language=en';
 const secondUrl='https://express.grab.com/track/qa-second';

 await check('Tracking changes require staff access and a paid active delivery without refund label',async()=>{
  for(const user of [null,ids.customer,ids.stranger])await assert.rejects(()=>api('save_delivery_tracking',{order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),tracking_url:firstUrl},user),/Authorized/i);
  await assert.rejects(()=>h.as(ids.staff,()=>db.query("select elio.normalize_delivery_tracking_url('\"https://example.test\"'::jsonb)")),/permission denied/);
  const pending=await create();await assert.rejects(()=>save(pending,firstUrl),/paid active/);
  await h.proof(pending,{user_id:ids.customer});await assert.rejects(async()=>save(await order(pending.id),firstUrl),/paid active/);
  await action('cancel_order',await order(pending.id),{reason:'Tracking test cleanup'});
  const pickup=await approve(await create('pickup'));await assert.rejects(()=>save(pickup,firstUrl),/delivery orders only/);
  await action('cancel_order',pickup,{reason:'Tracking test cleanup',restore_stock:true});
  o=await action('set_refund_label',o,{enabled:true});await assert.rejects(()=>save(o,firstUrl),/refund label/);
  o=await action('set_refund_label',o,{enabled:false});
 })();
 await check('Unsafe and malformed tracking URLs are rejected without side effects',async()=>{
  const before=await order(o.id),count=await scalar('select count(*) from elio.history where order_id=$1',[o.id]);
  for(const url of [true,7,{},[], 'javascript:alert(1)','data:text/html,x','//example.test/tracking','https://','https:///bad','https://user:secret@example.test/','https://example.test\\evil','https://exa mple.test','https://example.test/\nscript','https://example.test/%0d%0aheader','https://example.test:0','https://example.test:65536','https://bad..test','https://-bad.test','https://999.999.999.999','https://[invalid]/','https://example.test/'+ 'x'.repeat(2048)])await assert.rejects(()=>save(o,url),/tracking|HTTP|username|port/i);
  await assert.rejects(()=>action('save_delivery_tracking',o),/Provide a tracking link/);
  assert.deepEqual(await order(o.id),before);
  assert.equal(await scalar('select count(*) from elio.history where order_id=$1',[o.id]),count);
  assert.equal((await notices(o.id)).length,0);
 })();
 await check('Staff can save a trimmed courier link without changing payment, fulfillment or stock',async()=>{
  const before=await business(o.id),revision=o.revision;
  firstPayload={order_id:o.id,revision,idempotency_key:randomUUID(),tracking_url:`  ${firstUrl}  `};
  o=await api('save_delivery_tracking',firstPayload,ids.staff);
  assert.equal(o.delivery_tracking_url,firstUrl);assert.equal(o.revision,revision+1);assert(o.delivery_tracking_updated_at);
  assert.deepEqual(await business(o.id),before);
  const history=o.history.at(-1);assert.equal(history.action,'save_delivery_tracking');assert.equal(history.reason,'Delivery tracking link added.');
  assert.deepEqual(history.before,{});assert(!JSON.stringify(history).includes('access_token'));
  for(const [user,token] of [[ids.customer,null],[null,(await scalar('select elio.order_token(o) from elio.orders o where id=$1',[o.id]))]])assert.equal((await api('get_order',{order_id:o.id},user,token)).delivery_tracking_url,firstUrl);
  assert.equal((await notices(o.id)).length,0);
 })();
 await check('Retry keys and revisions protect tracking edits and unchanged links do not notify again',async()=>{
  const before=o,noticesBefore=(await notices(o.id)).length;
  assert.deepEqual(await api('save_delivery_tracking',firstPayload,ids.staff),before);
  await assert.rejects(()=>api('save_delivery_tracking',{...firstPayload,tracking_url:secondUrl},ids.staff),/different request/);
  await assert.rejects(()=>save({...o,revision:o.revision-1},secondUrl),/order changed/);
  o=await save(o,` ${firstUrl} `);assert.deepEqual(o,before);assert.equal((await notices(o.id)).length,noticesBefore);
 })();
 await check('First tracking links wait for dispatch unless the delivery is already out',async()=>{
  o=await action('set_fulfillment',o,{status:'out_for_delivery'});
  const dispatch=(await db.query("select id from elio.outbox where order_id=$1 and event_type='out_for_delivery'",[o.id])).rows[0];
  const prepared=await h.service('prepare_email',await claim(dispatch.id));
  assert.equal(prepared.payload.order.delivery_tracking_url,firstUrl);assert.equal((await notices(o.id)).length,0);
  dispatchRetry={id:dispatch.id,lease_token:prepared.lease_token};
  await h.service('email_failed',{...dispatchRetry,error:'Local transient delivery failure'});
  const out=await action('set_fulfillment',await approve(await create()),{status:'out_for_delivery'});
  const linked=await save(out,firstUrl),entry=(await notices(out.id))[0];assert.equal(entry.payload.tracking_change,'added');
  await action('cancel_order',linked,{reason:'Tracking test cleanup',restore_stock:true});
 })();
 await check('Replacing a courier link before dispatch produces exactly one follow-up',async()=>{
  o=await action('set_fulfillment',o,{status:'preparing'});
  o=await save(o,secondUrl);
  const messages=await notices(o.id),latest=messages.find(e=>e.payload.tracking_url===secondUrl);
  assert.equal(messages.length,1);assert.equal(latest.payload.tracking_change,'replaced');assert.equal(latest.payload.previous_tracking_url,firstUrl);
  assert.deepEqual(await h.service('prepare_email',await claim(dispatchRetry.id)),{skip:true});
  const prepared=await h.service('prepare_email',await claim(latest.id));
  assert.equal(prepared.payload.order.delivery_tracking_url,secondUrl);assert.equal(prepared.payload.order.fulfillment_status,'preparing');
  assert.equal(prepared.payload.tracking_url,secondUrl);
  const retry=await h.service('prepare_email',{id:latest.id,lease_token:prepared.lease_token});assert.deepEqual(retry,prepared);
 })();
 await check('A pending customer email gets the current courier link once and retains its retry body',async()=>{
  const entry=(await db.query("select id from elio.outbox where order_id=$1 and event_type='payment_approved'",[o.id])).rows[0];
  const args=await claim(entry.id),prepared=await h.service('prepare_email',args);
  assert.equal(prepared.payload.order.delivery_tracking_url,secondUrl);
  o=await save(o,'http://tracking.example.test/newer?code=qa%20order');
  assert.deepEqual(await h.service('prepare_email',args),prepared);
  await h.service('email_sent',{...args,provider_id:'local-test'});
 })();
 await check('Clearing a courier link updates customer data, audits once and suppresses outdated prepared notices',async()=>{
  const old=(await notices(o.id)).find(e=>e.payload.tracking_url===secondUrl),before=await business(o.id);
  const queued=(await notices(o.id)).find(e=>e.payload.tracking_url==='http://tracking.example.test/newer?code=qa%20order');
  const oldClaim={id:old.id,lease_token:old.lease_token};
  o=await save(o,'   ');assert.equal(o.delivery_tracking_url,null);assert.deepEqual(await business(o.id),before);
  const latest=(await notices(o.id)).find(e=>e.payload.tracking_change==='removed');assert(latest);assert.equal(latest.payload.tracking_url,null);
  assert.deepEqual(await h.service('prepare_email',oldClaim),{skip:true});
  assert.deepEqual(await h.service('prepare_email',await claim(queued.id)),{skip:true});
  const prepared=await h.service('prepare_email',await claim(latest.id));assert.equal(prepared.payload.order.delivery_tracking_url,null);
  const count=(await notices(o.id)).length,revision=o.revision;
  o=await save(o,null);assert.equal(o.revision,revision);assert.equal((await notices(o.id)).length,count);
 })();
 await check('A link restored after removal notifies immediately even before dispatch',async()=>{
  assert.equal(o.fulfillment_status,'preparing');
  const count=(await notices(o.id)).length;
  o=await save(o,'https://tracking.example.test/restored');
  assert.equal((await notices(o.id)).length,count+1);
  assert.equal((await notices(o.id)).find(e=>e.payload.tracking_updated_at===o.delivery_tracking_updated_at).payload.tracking_change,'added');
 })();
 await check('Closed and refunded orders cannot send or accept new tracking updates',async()=>{
  o=await action('set_fulfillment',o,{status:'out_for_delivery'});
  o=await save(o,firstUrl);
  const latest=(await notices(o.id)).find(e=>e.payload.tracking_updated_at===o.delivery_tracking_updated_at),args=await claim(latest.id);
  o=await action('set_refund_label',o,{enabled:true});assert.deepEqual(await h.service('prepare_email',args),{skip:true});
  o=await action('set_refund_label',o,{enabled:false});o=await action('set_fulfillment',o,{status:'completed'});
  await assert.rejects(()=>save(o,secondUrl),/paid active/);
  const cancelled=await action('set_fulfillment',await approve(await create()),{status:'out_for_delivery'});const tracked=await save(cancelled,firstUrl);
  const event=(await notices(tracked.id))[0],eventClaim=await claim(event.id);
  const closed=await action('cancel_order',tracked,{reason:'Tracking test cleanup',restore_stock:true});
  assert.deepEqual(await h.service('prepare_email',eventClaim),{skip:true});await assert.rejects(()=>save(closed,secondUrl),/paid active/);
 })();
}
