import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.h,{api,ids}=h;
 const data=await api('admin_bootstrap',{},ids.owner),current=data.flavor_menus.current_month,next=data.flavor_menus.next_month;
 const date=next.slice(0,7)+'-12';
 const snapshot=async(month=next)=>{
  const menus=(await api('admin_bootstrap',{},ids.owner)).flavor_menus.menus;
  const menu=menus.find(m=>m.month===month)||{flavor_ids:[],published:false};
  return {month,expected_month:current,flavor_ids:menu.flavor_ids,published:menu.published,expected_flavor_ids:menu.flavor_ids,expected_published:menu.published};
 };
 const save=p=>api('save_flavor_lineup',p,ids.owner);
 const flavor=await api('save_product',{product:{kind:'flavor',name:'QA picker Vanilla',price_cents:0,price_confirmed:true,active:false,in_rotation:false,photos:[],option_groups:[],min_quantity:1,lead_days:0}},ids.owner);
 const box=await h.product({name:'QA picker trio',box_flavors:[flavor.id,flavor.id,flavor.id],lead_days:0});
 let paid;
 await check('The lineup picker is owner-only and rejects invalid membership atomically',async()=>{
  const p=await snapshot();
  for(const user of [null,ids.customer,ids.staff])for(const action of ['preview_flavor_lineup','save_flavor_lineup'])await assert.rejects(()=>api(action,p,user),/Authorized|owner/);
  await assert.rejects(()=>h.as(ids.customer,()=>db.query('select elio.flavor_lineup_action($1,$2)', ['save_flavor_lineup',JSON.stringify(p)])),/permission denied/);
  for(const change of [{flavor_ids:[randomUUID()]},{flavor_ids:[box.id]},{flavor_ids:[flavor.id,flavor.id]},{expected_month:'2020-01-01'},{published:'true'}]){
   await assert.rejects(()=>save({...p,...change}),/visible flavors|each flavor once|calendar month changed|whether to publish/);
   assert.deepEqual(await snapshot(),p);
  }
  const hidden=await api('save_product',{product:{...flavor,id:undefined,name:'QA hidden picker',collection_hidden:true}},ids.owner);
  await assert.rejects(()=>save({...p,flavor_ids:[hidden.id]}),/visible flavors/);
 })();
 await check('Picker additions start at zero and lineup availability replaces legacy switches',async()=>{
  assert.equal(flavor.active,true);assert.equal(flavor.in_rotation,true);
  const other=await snapshot(current),p=await snapshot();
  await save({...p,flavor_ids:[...p.flavor_ids,flavor.id],published:true});
  assert.deepEqual(await snapshot(current),other);
  assert.equal(await h.remaining(flavor,date),0);
  await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable|Only 0/);
  await h.inventory(flavor,date,12);
  assert.equal((await api('quote',h.checkout(box,date))).items[0].quantity,1);
  await save(await snapshot());assert.equal(await h.remaining(flavor,date),12);
  await save({...await snapshot(),published:false});
  await assert.rejects(()=>api('quote',h.checkout(box,date)),/published lineup/);
  await save({...await snapshot(),published:true});
  assert.equal(await h.remaining(flavor,date),12);
  const unpriced=await api('save_product',{product:{...flavor,price_confirmed:false}},ids.owner);
  assert.equal(unpriced.active,false);
  await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable/);
  await api('save_product',{product:flavor},ids.owner);
  paid=await api('create_order',h.checkout(box,date));await h.proof(paid);paid=await h.action('approve_payment',await h.order(paid.id));
 })();
 await check('Removing through the picker previews paid orders and preserves their saved recipes',async()=>{
  const before=await h.allocations(paid.id),p=await snapshot();p.flavor_ids=p.flavor_ids.filter(id=>id!==flavor.id);
  const preview=await api('preview_flavor_lineup',p,ids.owner);
  assert.deepEqual(preview.removed,[{id:flavor.id,name:flavor.name,orders:1,pieces:3}]);
  assert.equal(await h.remaining(flavor,date),9); // Preview changes nothing.
  await save(p);
  assert.deepEqual(await h.allocations(paid.id),before);
  assert.equal((await h.order(paid.id)).fulfillment_status,'confirmed');
  await assert.rejects(()=>api('quote',h.checkout(box,date)),/published lineup/);
  const removed=await snapshot();await save({...removed,flavor_ids:[...removed.flavor_ids,flavor.id]});
  assert.equal(await h.remaining(flavor,date),0);
  assert.deepEqual(await h.allocations(paid.id),before);
 })();
 await check('Stale membership and publication cannot overwrite a newer lineup',async()=>{
  const stale=await snapshot();await save({...stale,published:!stale.published});
  await assert.rejects(()=>save(stale),/another session/);
  await save({...await snapshot(),published:stale.published});
  const prior=await snapshot();await save({...prior,flavor_ids:prior.flavor_ids.filter(id=>id!==flavor.id)});
  await assert.rejects(()=>save(prior),/another session/);
  const after=await snapshot();assert(!after.flavor_ids.includes(flavor.id));
  assert.equal(after.published,prior.published);
 })();
}
