import assert from 'node:assert/strict';
export default async function({check,state}) {
 const {api,ids}=state.h;
 let flavor;
 const details={product_type:'Small-batch cheesecake',serving:'Six squares per box\nKeep chilled'};
 await check('Both flavor editors share popup details without changing price, stock or placements',async()=>{
  const before=await api('admin_bootstrap',{},ids.owner),month=before.flavor_menus.current_month;
  flavor=before.products.find(p=>p.kind==='flavor'&&!p.collection_hidden);
  const saved=await api('save_product',{product:{...flavor,tagline:'Creamy & mellow',collection_details:details}},ids.owner);
  let publicFlavor=(await api('flavor_collection')).flavors.find(f=>f.id===saved.id);
  assert.deepEqual(publicFlavor.collection_details,details);
  assert.equal(publicFlavor.tagline,'Creamy & mellow');
  const placements=m=>before.flavor_menus.menus.find(v=>v.month===m)?.flavor_ids.includes(saved.id)||false;
  await api('save_flavor_editor',{...saved,expected_month:month,current_month:placements(month),next_month:placements(before.flavor_menus.next_month),hidden:false,collection_details:{...details,serving:''}},ids.owner);
  const after=await api('admin_bootstrap',{},ids.owner),edited=after.products.find(p=>p.id===saved.id);
  assert.equal(edited.collection_details.serving,'');
  assert.equal(edited.price_cents,flavor.price_cents);
  assert.deepEqual(after.inventory,before.inventory);
  assert.deepEqual(after.flavor_menus.menus.map(m=>m.flavor_ids.slice().sort()),before.flavor_menus.menus.map(m=>m.flavor_ids.slice().sort()));
  publicFlavor=(await api('flavor_collection')).flavors.find(f=>f.id===saved.id);
  assert.deepEqual(publicFlavor.collection_details,edited.collection_details);
  flavor=edited;
 })();
 await check('Flavor popup text is bounded and private fields cannot enter its public payload',async()=>{
  for(const collection_details of [null,[],{...details,serving:8},{...details,serving:'x'.repeat(501)},{...details,private:'secret'}]) {
   await assert.rejects(()=>api('save_product',{product:{...flavor,collection_details}},ids.owner),/popup/i);
  }
  await assert.rejects(()=>api('save_product',{product:{...flavor,tagline:'x'.repeat(101)}},ids.owner),/description/i);
  for(const user of [null,ids.staff,ids.customer])await assert.rejects(()=>api('save_product',{product:{...flavor,collection_details:details}},user),/authorized|owner|sign in/i);
  assert.deepEqual((await api('admin_bootstrap',{},ids.owner)).products.find(p=>p.id===flavor.id).collection_details,flavor.collection_details);
 })();
 await check('A new flavor shares its optional cake cutout across both editors and the guest ordering catalog',async()=>{
  const h=state.h, cover='https://photos.example.test/menu/pistachio.webp';
  const first='assets/builder/pistachio-cutout.webp', second='https://photos.example.test/cakes/pistachio.png';
  const p=await h.product({kind:'flavor',name:'QA pistachio builder flavor',lead_days:0,price_cents:5000,photos:[cover]});
  const month=(await api('admin_bootstrap',{},ids.owner)).flavor_menus.current_month;
  const read=async()=> (await api('catalog')).flavors.find(f=>f.id===p.id);
  const menu={id:p.id,name:p.name,expected_month:month,current_month:true,next_month:true,hidden:false};
  assert.equal((await read()).builder_cutout_url,null);
  const withPhoto=await api('save_product',{product:{...p,builder_cutout_url:first}},ids.owner);
  await api('save_flavor_editor',menu,ids.owner);
  assert.equal((await read()).builder_cutout_url,first);
  const {builder_cutout_url,...olderClient}=withPhoto;
  await api('save_product',{product:olderClient},ids.owner);
  assert.equal((await read()).builder_cutout_url,first);
  await api('save_flavor_editor',{...menu,builder_cutout_url:second},ids.owner);
  const current=await read();
  assert.equal(current.builder_cutout_url,second);assert.deepEqual(current.photos,[cover]);assert.equal(current.price_cents,5000);
  assert.ok(current.available_months.includes(month));
  for(const invalid of ['javascript:alert(1)','assets/../private.png',{},['image.webp']]){
   await assert.rejects(()=>api('save_flavor_editor',{...menu,builder_cutout_url:invalid},ids.owner),/valid uploaded cake cutout/);
  }
  await api('save_flavor_editor',{...menu,hidden:true},ids.owner);
  assert.equal((await read()).builder_cutout_url,null);
  await api('save_flavor_editor',{...menu,builder_cutout_url:null},ids.owner);
  const removed=await read();
  assert.equal(removed.builder_cutout_url,null);assert.deepEqual(removed.photos,[cover]);assert.equal(removed.price_cents,5000);
 })();
}
