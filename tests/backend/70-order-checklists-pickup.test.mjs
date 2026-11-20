import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({db,check,state}) {
  const h=state.h, {ids,api,service,scalar}=h;
  const {product,date}=await accountingFixture(h);
  const draft={order_source:'direct',method:'pickup',fulfillment_date:date,items:[h.item(product)],paid:false};
  const order=await api('pos_create_order',{...draft,expected_quote:await api('pos_quote',draft,ids.staff),idempotency_key:randomUUID()},ids.staff);
  const row=async()=> (await api('order_checklist',{},ids.staff)).find(o=>o.id===order.id);
  await check('staff share preparation marks without changing fulfillment and outdated kitchen details must be reviewed again',async()=>{
    for(const user of [null,ids.customer])await assert.rejects(api('order_checklist',{},user),/staff|authorized/i);
    await assert.rejects(h.as(ids.owner,()=>db.query("select public.shop_api('order_checklist')"),'authenticated',{aal:'aal1'}),/authenticator/);
    const item=await row();assert.equal(item.method,'pickup');assert.equal(item.prepared,false);assert.equal(item.buyer.email,undefined);
    const mark={order_id:order.id,content_key:item.content_key,prepared:true};
    await api('set_order_prepared',mark,ids.staff);await api('set_order_prepared',mark,ids.staff);
    assert.equal((await api('order_checklist',{},ids.owner)).find(o=>o.id===order.id).prepared,true);
    assert.equal((await h.order(order.id)).fulfillment_status,'pending_confirmation');
    await db.query("update elio.orders set data=jsonb_set(data,'{instructions}',to_jsonb('Keep chilled'::text)) where id=$1",[order.id]);
    assert.equal((await row()).prepared,false);
    await assert.rejects(api('set_order_prepared',mark,ids.staff),/details changed/);
    const range={from:date,to:date};
    assert((await api('order_checklist_period',range,ids.staff)).orders.some(o=>o.id===order.id));
    await assert.rejects(api('order_checklist_period',{from:date,to:'2200-01-01'},ids.staff),/63/);
    await assert.rejects(api('order_checklist_period',range,ids.customer),/staff|authorized/i);
    await db.query("update elio.orders set refund_label=true where id=$1",[order.id]);
    assert.equal(await row(),undefined);
    assert(!(await api('order_checklist_period',range,ids.staff)).orders.some(o=>o.id===order.id));
    await db.query("update elio.orders set refund_label=false where id=$1",[order.id]);
  })();
  await check('pickup proof is optional, requires staff for writes and an authorized order link or account for reads',async()=>{
    await db.query('update elio.orders set user_id=$1 where id=$2',[ids.customer,order.id]);
    const token=await scalar('select elio.order_token(o) from elio.orders o where id=$1',[order.id]);
    const req={order_id:order.id,user_id:ids.staff}, file=()=>order.id+'/'+randomUUID()+'.jpg';
    const view=(extra={})=>service('read_pickup_proof',{order_id:order.id,...extra});
    assert.equal((await api('get_order',{order_id:order.id},null,token)).has_pickup_proof,false);
    await assert.rejects(view({token}),/unavailable/);
    await assert.rejects(service('authorize_pickup_upload',{...req,user_id:ids.customer}),/staff|authorized/i);
    assert.equal((await service('authorize_pickup_upload',req)).previous,null);
    const path=file(), next=file();
    await service('commit_pickup_proof',{...req,path,previous:null});
    const customer=await api('get_order',{order_id:order.id},null,token);
    assert.equal(customer.has_pickup_proof,true);assert(!JSON.stringify(customer).includes(path));
    assert.equal(customer.payment_status,order.payment_status);assert.equal(customer.fulfillment_status,order.fulfillment_status);
    for(const access of [{token},{user_id:ids.customer},{user_id:ids.staff}])assert.equal((await view(access)).path,path);
    for(const access of [{},{user_id:ids.stranger},{token:'x'.repeat(48)}])await assert.rejects(view(access),/unavailable/);
    await assert.rejects(service('commit_pickup_proof',{...req,path:next,previous:null}),/Another photo/);
    assert.equal((await service('commit_pickup_proof',{...req,path:next,previous:path})).previous,path);
    await db.query("update elio.orders set method='delivery' where id=$1",[order.id]);
    await assert.rejects(view({token}),/unavailable/);await assert.rejects(service('authorize_pickup_upload',req),/pickup order/);
    assert.equal(await scalar("select public from storage.buckets where id='pickup-proofs'"),false);
  })();
}
