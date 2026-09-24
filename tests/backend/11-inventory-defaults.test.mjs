import assert from 'node:assert/strict';
import {bulkQuantityDrafts,quantitySaveRows} from '../../dist/assets/admin/daily-quantities.js';

export default async function({db,check,state}) {
 const h=state.h,{api,ids,scalar}=h;
 const month=await scalar("select date_trunc('month',now() at time zone 'Asia/Manila')::date::text");
 const next=await scalar("select (date_trunc('month',now() at time zone 'Asia/Manila')+interval '1 month')::date::text");
 const date=next.slice(0,7)+'-04',second=next.slice(0,7)+'-05';
 const rawFlavor=name=>api('save_product',{product:{kind:'flavor',name,description:'Default stock QA',price_cents:0,price_confirmed:true,active:true,in_rotation:true,min_quantity:1,lead_days:0,photos:[],option_groups:[]}},ids.owner);
 const a=await rawFlavor('QA Auto Vanilla'),b=await rawFlavor('QA Auto Matcha');
 const edit=(p,current=true,future=true,hidden=false)=>api('save_flavor_editor',{id:p.id,name:p.name,description:p.description,tagline:'',expected_month:month,current_month:current,next_month:future,hidden},ids.owner);
 const setDefault=quantity=>api('save_inventory_default',{quantity},ids.owner);
 const row=(p,d=date)=>scalar("select jsonb_build_object('capacity',capacity,'available',available,'configured',configured) from elio.inventory where product_id=$1 and date=$2",[p.id,d]);
 await edit(a);await edit(b);
 const box=await h.product({name:'QA Default Trio',box_flavors:[a.id,a.id,a.id],price_cents:10000,lead_days:0});
 await check('Only verified owners can set a bounded whole-number automatic stock default',async()=>{
  for(const user of [null,ids.staff,ids.customer,ids.unverified])await assert.rejects(()=>api('save_inventory_default',{quantity:20},user),/owner|authorized/i);
  for(const quantity of [null,'20',-1,1.5,1000001,{},true])await assert.rejects(()=>setDefault(quantity),/whole default quantity/);
  assert.equal((await api('admin_bootstrap',{},ids.owner)).inventory_default,0);
 })();
 await check('One default supplies all lineup flavors on unconfigured dates in both bookable months',async()=>{
  const result=await setDefault(20);assert.equal(result.inventory_default,20);
  for(const p of[a,b])for(const d of[await h.day(0),date,second])assert.deepEqual(await row(p,d),{capacity:20,available:true,configured:false});
  assert.equal((await api('catalog',{fulfillment_date:date})).inventory.find(r=>r.product_id===a.id&&r.date===date).remaining,20);
 })();
 await check('Changing defaults preserves saved zero, finite, unlimited and disabled daily stock',async()=>{
  const ds=[6,7,8,9].map(n=>next.slice(0,7)+'-'+String(n).padStart(2,'0'));
  for(const [i,capacity]of[0,7,null,9].entries())await h.inventory(a,ds[i],capacity,i!==3);
  const before=await Promise.all(ds.map(d=>row(a,d)));await setDefault(30);
  assert.deepEqual(await Promise.all(ds.map(d=>row(a,d))),before);assert.equal((await row(a)).capacity,30);
  await api('save_settings',{settings:{...(await api('admin_bootstrap',{},ids.owner)).settings,pickup_hours:'QA updated'}},ids.owner);
  assert.equal((await api('admin_bootstrap',{},ids.owner)).inventory_default,30);
 })();
 await check('New and re-added flavors receive defaults while removed flavors and their orders stay protected',async()=>{
  const c=await rawFlavor('QA New Auto Flavor');await edit(c);assert.equal((await row(c)).capacity,30);
  await api('save_flavor_menu_visibility',{expected_month:month,month:next,published:true},ids.owner);
  const o=await api('create_order',h.checkout(box,date),ids.customer);assert.equal(await h.remaining(a,date),27);
  const allocations=await h.allocations(o.id);await edit(a,true,false);
  assert.deepEqual(await row(a),{capacity:3,available:false,configured:false});assert.deepEqual(await h.allocations(o.id),allocations);
  await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable/);
  await edit(a);assert.equal((await row(a)).capacity,30);assert.equal(await h.remaining(a,date),27);
  await setDefault(2);assert.equal((await row(a)).capacity,3);assert.equal(await h.remaining(a,date),0);
  await assert.rejects(()=>api('quote',h.checkout(box,date)),/Only 0/);
  await h.action('cancel_order',o,{reason:'Local default stock test'});await api('catalog');assert.equal((await row(a)).capacity,2);
 })();
 await check('Default stock never overrides closed dates, shop pauses, hidden months or hidden flavors',async()=>{
  await setDefault(20);let settings=(await api('admin_bootstrap',{},ids.owner)).settings;
  await api('save_settings',{settings:{...settings,blocked_dates:[date]}},ids.owner);
  assert.equal((await row(a)).capacity,20);await assert.rejects(()=>api('quote',h.checkout(box,date)),/closed|unavailable/i);
  await api('save_settings',{settings:{...settings,paused:true,pause_message:'QA paused'}},ids.owner);await assert.rejects(()=>api('quote',h.checkout(box,date)),/paused/i);
  await api('save_settings',{settings:{...settings,paused:false}},ids.owner);
  await api('save_flavor_menu_visibility',{expected_month:month,month:next,published:false},ids.owner);
  assert.equal((await row(a)).capacity,20);await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable/);
  await api('save_flavor_menu_visibility',{expected_month:month,month:next,published:true},ids.owner);
  await edit(a,false,false,true);await setDefault(21);assert.equal((await row(a)).available,false);await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable/);
  await edit(a,true,true,false);
 })();
 await check('Bulk editing stages every flavor and saves the same daily total atomically',async()=>{
  const products=[a,b],drafts=bulkQuantityDrafts(products,'20');assert.deepEqual(drafts,{[a.id]:'20',[b.id]:'20'});
  const rows=quantitySaveRows(products,(await api('admin_bootstrap',{},ids.owner)).inventory,[date,second],drafts,await h.day(0));
  assert.equal(rows.length,4);await api('save_inventory',{rows},ids.owner);
  for(const p of products)for(const d of[date,second])assert.deepEqual(await row(p,d),{capacity:20,available:true,configured:true});
  for(const value of['',-1,1.5,1000001,'Infinity'])assert.throws(()=>bulkQuantityDrafts(products,value),/whole quantity/);
 })();
 await check('Bulk fill skips saved dates and conflicting totals save nothing across flavors and dates',async()=>{
  const fresh=next.slice(0,7)+'-12';await setDefault(25);
  const products=[a,b],inventory=(await api('admin_bootstrap',{},ids.owner)).inventory;
  const rows=quantitySaveRows(products,inventory,[date,fresh],bulkQuantityDrafts(products,12),await h.day(0),'fill_unconfigured');
  assert.equal(rows.length,2);assert(rows.every(r=>r.date===fresh));await api('save_inventory',{rows,mode:'fill_unconfigured'},ids.owner);
  const o=await api('create_order',h.checkout(box,date,{items:[h.item(box,4)]}),ids.customer);
  const before=(await api('admin_bootstrap',{},ids.owner)).inventory;
  const today=await h.day(0);
  assert.throws(()=>quantitySaveRows(products,before,[second,date],bulkQuantityDrafts(products,10),today),/already ordered/);
  const unsafe=products.flatMap(p=>[second,date].map(d=>({product_id:p.id,date:d,capacity:10,available:true})));
  await assert.rejects(()=>api('save_inventory',{rows:unsafe},ids.owner),/already reserved|already ordered/);
  assert.deepEqual((await api('admin_bootstrap',{},ids.owner)).inventory,before);
  await h.action('cancel_order',o,{reason:'Local bulk stock QA'});
 })();
 await setDefault(0);
}
