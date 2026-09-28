import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({check,state}){
 const h=state.h,{api,ids,scalar}=h,{product,date}=await accountingFixture(h),day=await h.day(0),event_id=randomUUID(),pid=randomUUID();
 const owner=(a,p={})=>api(a,{event_id,...p},ids.owner),data=()=>owner('pos_event_data');
 await owner('pos_save_event',{name:'Individual flavor fixture',starts_on:day,ends_on:day});
 const vanilla={id:randomUUID(),name:'Classic',available:5,expected_available:0,revision:0,surcharge_cents:0,active:true},choco={id:randomUUID(),name:'Chocolate',available:2,expected_available:0,revision:0,surcharge_cents:1000,active:true};
 const setup={id:pid,name:'Chunkies singles',price_cents:14000,revision:0,variants:[vanilla,choco]},save=p=>owner('pos_save_event_variant_item',p);
 let item,order;
 const current=async()=>{const d=await data(),p=d.items.find(i=>i.id===pid);return {...p,variants:d.stock.filter(s=>s.variant_item_id===pid).map(s=>({...s,available:s.remaining,expected_available:s.remaining,active:p.choice_stock_ids.includes(s.id)}))};};
 await check('individual product flavors are owner-only with dedicated stock and optional surcharges',async()=>{
  for(const user of [null,ids.staff,ids.customer])await assert.rejects(api('pos_save_event_variant_item',{event_id,...setup},user),/owner|authorized/i);
  item=await save(setup);assert.equal(item.kind,'variant_item');const d=await data();assert.equal(d.items.find(i=>i.id===pid).remaining,7);assert(d.stock.every(s=>s.variant_item_id===pid&&s.stock_type==='item'));
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'elio.pos_save_event_variant_item(jsonb)','execute')",[role]),false);
 })();
 await check('flavor setup rejects duplicate names, foreign stock, fractional quantities and negative surcharges atomically',async()=>{
  const p=await current();for(const variants of [[],[p.variants[0],{...p.variants[1],name:p.variants[0].name}],[{...p.variants[0],available:1.5}],[{...p.variants[0],surcharge_cents:-1}]])await assert.rejects(save({...p,name:'Must roll back',variants}));
  const other=await owner('pos_save_event_stock',{id:randomUUID(),name:'Other item',stock_type:'item',available:10,expected_available:0,revision:0,reason:'Fixture'});
  await assert.rejects(save({...p,variants:[{...p.variants[0],id:other.id}]}),/belong/i);
  assert.equal((await current()).name,'Chunkies singles');
  await assert.rejects(owner('pos_save_event_item',{id:randomUUID(),name:'Foreign recipe',price_cents:100,recipe:[{stock_id:vanilla.id,quantity:1}]}),/stock item/i);
 })();
 const sale={event_id,order_source:'in_person',fulfillment_date:day,method:'pickup',paid:true,pos_handed_over:false,payment:{method:'cash',cash_received_cents:30000},items:[{source:'event',product_id:pid,quantity:2,selections:{flavors:{[choco.id]:1}}}]};
 await owner('pos_open_cash',{date:day,opening_cents:0});
 await check('each individual product requires exactly one valid enabled flavor and quotes base plus surcharge',async()=>{
  const q=await owner('pos_quote',sale);assert.equal(q.total_cents,30000);assert.equal(q.items[0].unit_price_cents,15000);assert.equal(q.items[0].event_recipe[0].quantity,1);
  for(const selections of [{},{flavors:{}},{flavors:{[choco.id]:2}},{flavors:{[choco.id]:1,[vanilla.id]:1}},{flavors:{[randomUUID()]:1}},{flavors:{[choco.id]:'1'}}])await assert.rejects(owner('pos_quote',{...sale,items:[{...sale.items[0],selections}]}));
  await assert.rejects(owner('pos_quote',{...sale,items:[sale.items[0],sale.items[0]]}),/stock/i);
 })();
 await check('selling flavored singles deducts only their flavor and records surcharge income without website or calendar effects',async()=>{
  const before=await h.remaining({id:product.box_flavors[0]},date),q=await owner('pos_quote',sale);order=await owner('pos_create_order',{...sale,expected_quote:q,idempotency_key:randomUUID()});const d=await data();
  assert.equal(d.stock.find(s=>s.id===choco.id).remaining,0);assert.equal(d.stock.find(s=>s.id===vanilla.id).remaining,5);assert.equal(d.items.find(i=>i.id===pid).remaining,5);
  assert.equal(await scalar('select sum(amount_cents)::integer from elio.accounting_ledger where order_id=$1',[order.id]),30000);assert.equal(await scalar('select count(*) from elio.calendar_events where order_id=$1',[order.id]),0);assert.equal(await h.remaining({id:product.box_flavors[0]},date),before);
  await assert.rejects(owner('pos_quote',sale),/stock/i);
 })();
 await check('concurrent flavor stock changes roll back product edits and preserve earlier prices and allocations',async()=>{
  await assert.rejects(save({...item,name:'Stale change',price_cents:99999,variants:setup.variants}),/stock.*changed/i);assert.equal((await current()).price_cents,14000);
  const p=await current(),old=(await h.order(order.id)).items;
  await save({...p,price_cents:15000,variants:p.variants.map(s=>({...s,available:s.id===choco.id?3:s.available,surcharge_cents:s.id===choco.id?2000:0}))});
  assert.deepEqual((await h.order(order.id)).items,old);assert.equal((await owner('pos_quote',sale)).items[0].unit_price_cents,17000);
  const edited=await h.action('edit_order',await h.order(order.id),{changes:{instructions:'Keep saved variant prices'},reason:'Fixture'});assert.deepEqual(edited.items,old);
 })();
 await check('disabled and removed flavors cannot be sold; original orders retain their flavor names and prices',async()=>{
  let p=await current();await save({...p,variants:p.variants.map(s=>({...s,active:s.id!==choco.id}))});await assert.rejects(owner('pos_quote',sale),/unavailable/i);
  p=await current();await save({...p,variants:p.variants.filter(s=>s.id!==choco.id)});assert(!(await data()).stock.some(s=>s.id===choco.id));
  const old=(await h.order(order.id)).items;assert.equal(old[0].event_recipe[0].name,'Chocolate');assert.equal(old[0].unit_price_cents,15000);
  const edited=await h.action('edit_order',await h.order(order.id),{changes:{instructions:'Removed flavor history'},reason:'Fixture'});assert.deepEqual(edited.items,old);
 })();
 await check('adding flavors to an existing plain product preserves previous unflavored orders and their stock',async()=>{
  const st=await owner('pos_save_event_stock',{id:randomUUID(),name:'Plain pouch',available:100,expected_available:0,revision:0,reason:'Fixture'}),plain=await owner('pos_save_event_item',{id:randomUUID(),name:'Nori',price_cents:10000,recipe:[{stock_id:st.id,quantity:1}]});
  const s={...sale,items:[{source:'event',product_id:plain.id,quantity:1,selections:{}}]},q=await owner('pos_quote',s),o=await owner('pos_create_order',{...s,expected_quote:q,idempotency_key:randomUUID()});
  await save({...plain,variants:[{...vanilla,id:randomUUID(),name:'Spicy',available:10}]});
  const old=(await h.order(o.id)).items,edited=await h.action('edit_order',await h.order(o.id),{changes:{instructions:'Preserve plain stock'},reason:'Fixture'});assert.deepEqual(edited.items,old);assert.equal((await data()).stock.find(x=>x.id===st.id).remaining,99);
  await assert.rejects(owner('pos_quote',s),/flavor/i);
 })();
}
