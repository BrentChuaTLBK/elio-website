import assert from 'node:assert/strict';

const savedItems=items=>items.map(({photo_url,...saved})=>saved);

export default async function({db,check,state}) {
 const h=state.h;
 let order,payload,box,missing,deleted,snapshot;
 await check('Customer order photos preserve saved lines and initial submission retries',async()=>{
  const flavor=await h.product({kind:'flavor',name:'QA customer photo flavor',price_cents:2300});
  const recipe={box_flavors:[flavor.id,flavor.id,flavor.id],lead_days:0};
  box=await h.product({...recipe,name:'QA original photo box',photos:['assets/customer-original.webp','assets/customer-second.webp']});
  missing=await h.product({...recipe,name:'QA photo-less box',photos:[]});
  deleted=await h.product({...recipe,name:'QA removed photo box',photos:['assets/customer-removed.webp']});
  payload=h.checkout(box,await h.day(2),{items:[h.item(deleted),h.item(box,2),h.item(missing)]});
  const quote=await h.api('quote',payload);
  order=await h.api('create_order',payload,h.ids.customer);
  snapshot=await h.scalar('select data from elio.orders where id=$1',[order.id]);
  assert.deepEqual(order.items.map(item=>item.product_id),[deleted.id,box.id,missing.id]);
  assert.deepEqual(order.items.map(item=>item.photo_url),['assets/customer-removed.webp','assets/customer-original.webp',null]);
  assert.deepEqual(savedItems(order.items),quote.items);
  assert.deepEqual(snapshot.items,quote.items);
  assert.deepEqual((await h.api('create_order',payload,h.ids.customer)).items,order.items);
  assert.equal(await h.scalar("select count(*)::integer from elio.outbox where order_id=$1 and event_type='order_submitted'",[order.id]),1);
  assert.deepEqual(await h.scalar("select payload#>'{order,items}' from elio.outbox where order_id=$1 and event_type='order_submitted'",[order.id]),snapshot.items);
 })();
 await check('Secure order links retain photos for hidden products without changing order snapshots',async()=>{
  await db.query("update elio.products set data=data||jsonb_build_object('active',false,'name','A later catalog name','photos',jsonb_build_array('assets/customer-current.webp')) where id=$1",[box.id]);
  assert.equal((await h.api('catalog')).products.some(product=>product.id===box.id),false);
  const opened=await h.api('get_order',{order_id:order.id},null,order.access_token);
  assert.equal(opened.items[1].photo_url,'assets/customer-current.webp');
  assert.equal(opened.items[1].name,'QA original photo box');
  assert.deepEqual(savedItems(opened.items),snapshot.items);
  assert.deepEqual((await h.api('get_order',{order_id:order.id},h.ids.customer)).items,opened.items);
  assert.deepEqual(await h.scalar('select data from elio.orders where id=$1',[order.id]),snapshot);
  await assert.rejects(()=>h.api('get_order',{order_id:order.id}),/not authorized/);
  await assert.rejects(()=>h.api('get_order',{order_id:order.id},null,'0'.repeat(64)),/not authorized/);
  await assert.rejects(()=>h.api('get_order',{order_id:order.id},h.ids.stranger),/not authorized/);
  for(const user of [null,h.ids.customer]) {
   await assert.rejects(()=>h.as(user,()=>db.query('select elio.customer_order_photos($1::jsonb)',[JSON.stringify(order)])),/permission denied/);
  }
 })();
 await check('Missing covers and deleted products return null while preserving every ordered item',async()=>{
  await db.query("update elio.products set data=data||jsonb_build_object('photos','[]'::jsonb) where id=$1",[box.id]);
  await db.query('delete from elio.products where id=$1',[deleted.id]);
  const opened=await h.api('get_order',{order_id:order.id},null,order.access_token);
  assert.deepEqual(opened.items.map(item=>item.photo_url),[null,null,null]);
  assert.deepEqual(savedItems(opened.items),snapshot.items);
  assert.deepEqual(await h.scalar('select data from elio.orders where id=$1',[order.id]),snapshot);
  await h.action('cancel_order',await h.order(order.id),{reason:'Local customer image response test'});
 })();
}
