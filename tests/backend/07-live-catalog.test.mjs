import assert from 'node:assert/strict';

export default async function({db,check,state}) {
 const h=state.h,{api,ids}=h;
 const save=product=>api('save_product',{product},ids.owner);
 const v=await h.product({kind:'flavor',name:'QA saved surcharge',price_cents:2500,price_confirmed:false});
 const box=await h.product({kind:'custom_box',name:'QA live box',price_cents:10000,price_confirmed:false});
 const date=await h.day(2);
 await check('Saving prices needs no confirmation; hidden boxes disappear and cannot be ordered',async()=>{
  const payload=h.checkout(box,date,{items:[h.item(box,1,{flavors:{[v.id]:3}})]});
  assert.equal((await api('quote',payload)).subtotal_cents,17500);
  const changed=await save({...box,price_cents:12000,price_confirmed:false});
  assert.equal(changed.price_confirmed,true);
  assert.equal((await api('quote',payload)).subtotal_cents,19500);
  await save({...changed,active:false});
  assert(!(await api('catalog')).products.some(p=>p.id===box.id));
  await assert.rejects(()=>api('quote',payload),/unavailable/i);
  for(const price_cents of [null,-1,1.5,'100'])await assert.rejects(()=>save({...changed,price_cents}),/price|centavos|integer/i);
  assert.equal((await api('admin_bootstrap',{},ids.owner)).products.find(p=>p.id===box.id).active,false);
  await save(changed);assert((await api('catalog')).products.some(p=>p.id===box.id));
 })();
 await check('Collection-only flavors exclude both monthly lineups and use the latest uploaded photo',async()=>{
  const months=(await api('admin_bootstrap',{},ids.owner)).flavor_menus;
  const editor={name:'QA collection-only',description:'Uploaded flavor description',current_month:false,next_month:false,hidden:false,expected_month:months.current_month,photos:['https://example.test/new-flavor.webp']};
  await api('save_flavor_editor',editor,ids.owner);
  const f=(await api('admin_bootstrap',{},ids.owner)).products.find(p=>p.name===editor.name);
  const read=async()=> (await api('flavor_collection')).flavors.find(p=>p.id===f.id);
  assert.equal((await read()).collection_only,true);assert.deepEqual((await read()).photos,editor.photos);
  await api('save_flavor_editor',{...editor,id:f.id,next_month:true},ids.owner);
  assert.equal((await read()).collection_only,false);
  await api('save_flavor_menu_visibility',{month:months.next_month,expected_month:months.current_month,published:false},ids.owner);
  assert.equal(await read(),undefined);
  await api('save_flavor_editor',{...editor,id:f.id,current_month:true,next_month:true,photos:['https://example.test/replaced.webp']},ids.owner);
  assert.equal((await read()).collection_only,false);assert.deepEqual((await read()).photos,['https://example.test/replaced.webp']);
  await api('save_flavor_editor',{...editor,id:f.id},ids.owner);
  assert.equal((await read()).collection_only,true);
  await api('save_flavor_editor',{...editor,id:f.id,hidden:true},ids.owner);
  assert.equal(await read(),undefined);
 })();
}
