import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.h, {ids,api,product,inventory,item,checkout}=h;
 const a=await product({kind:'flavor',name:'QA recipe A',price_cents:7000,in_rotation:true});
 const b=await product({kind:'flavor',name:'QA recipe B',price_cents:9000,in_rotation:true});
 const set=await product({kind:'set',box_flavors:[a.id,a.id,b.id],price_cents:99000});
 const custom=await product({kind:'custom_box',price_cents:90000});
 const date=await h.day(7);
 const catalog=async()=> (await api('catalog',{fulfillment_date:date})).products.find(p=>p.id===set.id);
 await check('Fixed sets require three valid flavors and reject customer substitutions',async()=>{
  for(const flavors of [[],[a.id],[a.id,a.id],[a.id,a.id,a.id,a.id],[a.id,b.id,randomUUID()],[a.id,b.id,custom.id]]) {
   await assert.rejects(()=>product({box_flavors:flavors}),/three flavors|existing flavor/);
  }
  await assert.rejects(()=>inventory(set,date,2),/All boxes use flavor stock/);
  const q=await api('quote',checkout(set,date));
  assert.equal(q.items[0].unit_price_cents,99000); // No flavor surcharges for fixed sets.
  assert.deepEqual(q.items[0].stock_requirements.sort((x,y)=>y.quantity-x.quantity),[{product_id:a.id,quantity:2},{product_id:b.id,quantity:1}]);
  await assert.rejects(()=>api('quote',checkout(set,date,{items:[item(set,1,{flavors:{[a.id]:3}})]})),/Fixed-set flavors cannot/);
  const tampered=await api('quote',checkout(set,date,{items:[{...item(set),box_flavors:[b.id,b.id,b.id],stock_requirements:[],flavor_contents:[]}]}));
  assert.deepEqual(tampered.items[0].stock_requirements,q.items[0].stock_requirements.sort((x,y)=>x.product_id.localeCompare(y.product_id)));
 })();
 await check('A set sells out with any missing flavor, including repeated pieces and shared custom demand',async()=>{
  await inventory(a,date,5);await inventory(b,date,4);
  assert.equal((await catalog()).remaining_boxes,2);
  const o=await api('create_order',checkout(custom,date,{items:[item(custom,1,{flavors:{[a.id]:3}})]}));
  assert.equal((await catalog()).remaining_boxes,1);
  const fixed=await api('create_order',checkout(set,date));
  assert.equal((await catalog()).stock_available,false);
  assert.equal((await catalog()).remaining_boxes,0);
  await assert.rejects(()=>api('create_order',checkout(set,date)),/Only 0 pieces/);
  await h.action('cancel_order',fixed,{reason:'QA'});await h.action('cancel_order',o,{reason:'QA'});
  for(const change of [{active:false},{in_rotation:false}]) {
   await api('save_product',{product:{...a,...change}},ids.owner);
   assert.equal((await catalog()).stock_available,false);
   await assert.rejects(()=>api('quote',checkout(set,date)),/Flavor unavailable/);
   await api('save_product',{product:a},ids.owner);
  }
  await inventory(b,date,4,false);assert.equal((await catalog()).stock_available,false);
  await inventory(b,date,4,true);assert.equal((await catalog()).stock_available,true);
 })();
 await check('Saved recipes survive later set edits and preserve production counts',async()=>{
  const o=await api('create_order',checkout(set,date));
  await api('save_product',{product:{...set,box_flavors:[b.id,b.id,b.id]}},ids.owner);
  const changed=await h.action('edit_order',o,{reason:'QA quantity',changes:{items:[item(set,2)]}});
  assert.equal(Array.isArray(o.items[0].flavor_contents),true);
  assert.deepEqual(changed.items[0].flavor_contents,o.items[0].flavor_contents);
  assert.deepEqual((await h.allocations(o.id)).map(r=>[r.product_id,r.quantity]).sort(),[[a.id,4],[b.id,2]].sort());
  await h.action('cancel_order',changed,{reason:'QA'});
  const newQuote=await api('quote',checkout(set,date));
  assert.deepEqual(newQuote.items[0].stock_requirements,[{product_id:b.id,quantity:3}]);
 })();
 await check('The server permits this month and next month across year and leap-year boundaries',async()=>{
  const p=await product({box_flavors:[a.id,a.id,b.id],lead_days:0,allow_same_day:true});
  for(const [submitted,last,beyond] of [['2026-12-15T02:00:00Z','2027-01-31','2027-02-01'],['2028-01-15T02:00:00Z','2028-02-29','2028-03-01'],['2026-12-31T16:00:00Z','2027-02-28','2027-03-01']]) {
   const quote=(date,admin=false)=>db.query('select elio.calculate_quote($1::jsonb,null,null,$2,$3::timestamptz) as q',[JSON.stringify(checkout(p,date)),admin,submitted]);
   await quote(last);
   await assert.rejects(()=>quote(beyond),/this month or next month/);
   await quote(beyond,true); // Staff amendments keep their separate date rules.
  }
  const beyond=await h.scalar("select (date_trunc('month',clock_timestamp() at time zone 'Asia/Manila')+interval '2 months')::date::text");
  await assert.rejects(()=>api('create_order',checkout(p,beyond)),/this month or next month/);
 })();
 await check('Public product photo uploads require the database owner and their own unique path',async()=>{
  const put=(user,bucket='product-images',path=`${user}/${randomUUID()}.png`)=>h.as(user,()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,path]));
  await put(ids.owner);
  await db.query("insert into elio.staff(user_id,role) values($1,'staff')",[ids.staff]);
  await db.query("update auth.users set raw_user_meta_data='{"+'"role":"owner"'+"}'::jsonb where id=$1",[ids.customer]);
  for(const user of [ids.staff,ids.customer,ids.stranger,null])await assert.rejects(()=>put(user),/row-level security|permission denied/);
  await assert.rejects(()=>put(ids.owner,'payment-proofs'),/row-level security/);
  await assert.rejects(()=>put(ids.owner,'product-images',`${ids.customer}/${randomUUID()}.png`),/row-level security/);
  await assert.rejects(()=>put(ids.owner,'product-images',`${ids.owner}/unsafe.svg`),/row-level security/);
  await db.query("delete from elio.staff where user_id=$1",[ids.staff]);
 })();
}
