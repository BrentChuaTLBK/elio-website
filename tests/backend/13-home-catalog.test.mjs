import assert from 'node:assert/strict';

export default async function({db,check,state}) {
  const h=state.h,{api,ids}=h;
  const months=(await api('admin_bootstrap',{},ids.owner)).flavor_menus;
  const edit={name:'QA homepage unannounced',description:'A public flavor story',tagline:'Rich & mellow',photos:['https://example.test/home-photo.webp'],current_month:false,next_month:true,hidden:false,expected_month:months.current_month};
  await api('save_flavor_editor',edit,ids.owner);
  const flavor=(await api('admin_bootstrap',{},ids.owner)).products.find(p=>p.name===edit.name);
  await api('save_flavor_menu_visibility',{month:months.next_month,expected_month:months.current_month,published:false},ids.owner);
  const set=await h.product({name:'QA homepage fixed set',kind:'set',box_flavors:[flavor.id,flavor.id,flavor.id],price_cents:12345});
  const custom=await h.product({name:'QA homepage custom',kind:'custom_box'});

  await check('Homepage shows every non-hidden flavor without publishing draft months or opening stock',async()=>{
    const before=await api('admin_bootstrap',{},ids.owner);
    const home=await api('home_catalog');
    const expected=before.products.filter(p=>p.kind==='flavor'&&!p.collection_hidden).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    assert.deepEqual(home.flavors.map(f=>f.id),expected.map(f=>f.id));
    const result=home.flavors.find(f=>f.id===flavor.id);
    assert.equal(result.tagline,edit.tagline);assert.deepEqual(result.photos,edit.photos);
    assert(!('menus' in home));assert(!('current_month' in home));assert(!('available_months' in result));
    assert(!('price_cents' in result));assert(!('inventory' in home));assert(!('settings' in home));
    assert(!(await api('flavor_collection')).flavors.some(f=>f.id===flavor.id));
    assert(!(await api('catalog')).flavors.find(f=>f.id===flavor.id).available_months.includes(months.next_month));
    const after=await api('admin_bootstrap',{},ids.owner);
    assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.flavor_menus,before.flavor_menus);
  })();

  await check('Homepage boxes follow shop visibility and include saved prices without custom boxes in fixed sets',async()=>{
    let home=await api('home_catalog');
    assert.equal(home.boxes.find(b=>b.id===set.id).price_cents,12345);
    assert(!home.boxes.some(b=>b.id===custom.id));
    const before=(await api('admin_bootstrap',{},ids.owner)).products;
    assert(before.some(p=>p.id===home.custom_box_id&&p.kind==='custom_box'&&p.active));
    await api('save_product',{product:{...set,active:false}},ids.owner);
    assert(!(await api('home_catalog')).boxes.some(b=>b.id===set.id));
    await api('save_product',{product:{...set,price_cents:20000,sort_order:-100}},ids.owner);
    home=await api('home_catalog');assert.equal(home.boxes.find(b=>b.id===set.id).price_cents,20000);
    const expected=(await api('admin_bootstrap',{},ids.owner)).products.filter(p=>p.kind==='set'&&p.active).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    assert.deepEqual(home.boxes.map(b=>b.id),expected.map(b=>b.id));
  })();

  await check('Homepage custom-box display matches its existing selection and exposes only current public fields',async()=>{
    const before=await api('admin_bootstrap',{},ids.owner);
    const firstSort=Math.min(...before.products.filter(p=>p.kind==='custom_box').map(p=>p.sort_order||0))-1;
    await db.query("update elio.products set data=jsonb_set(data,'{sort_order}',to_jsonb($2::integer)) where id=$1",[custom.id,firstSort]);
    let selected=await api('save_product',{product:{...custom,
      description:'Choose your favorite three',photos:['https://example.test/custom-first.webp'],price_cents:54321}},ids.owner);
    const display=p=>({id:p.id,slug:p.slug??null,name:p.name,description:p.description,photos:p.photos,price_cents:p.price_cents});
    let home=await api('home_catalog');
    assert.equal(home.custom_box_id,selected.id);
    assert.deepEqual(home.custom_box,display(selected));
    assert(!home.boxes.some(box=>box.id===selected.id));
    selected=await api('save_product',{product:{...selected,name:'QA updated homepage custom',description:'A fresh custom description',photos:['https://example.test/custom-latest.webp'],price_cents:65432}},ids.owner);
    home=await api('home_catalog');assert.deepEqual(home.custom_box,display(selected));
    await api('save_product',{product:{...selected,active:false}},ids.owner);
    home=await api('home_catalog');assert.notEqual(home.custom_box_id,selected.id);
    assert.equal(home.custom_box?.id??null,home.custom_box_id);
    const active=(await db.query("select id,data from elio.products where data->>'kind'='custom_box' and coalesce((data->>'active')::boolean,false)")).rows;
    try {
      await db.query("update elio.products set data=data||'{\"active\":false}'::jsonb where data->>'kind'='custom_box' and coalesce((data->>'active')::boolean,false)");
      home=await api('home_catalog',{include_hidden:true});
      assert.equal(home.custom_box,null);assert.equal(home.custom_box_id,null);
    } finally {
      for(const product of active)await db.query('update elio.products set data=$2::jsonb where id=$1',[product.id,JSON.stringify(product.data)]);
    }
    const after=await api('admin_bootstrap',{},ids.owner);
    assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.flavor_menus,before.flavor_menus);
  })();

  await check('Individually hidden flavors cannot be exposed through homepage payload options',async()=>{
    await api('save_flavor_editor',{...edit,id:flavor.id,hidden:true},ids.owner);
    for(const user of [null,ids.customer,ids.owner]) {
      const home=await api('home_catalog',{include_hidden:true,hidden:false},user);
      assert(!home.flavors.some(f=>f.id===flavor.id));
    }
    await h.as(null,async()=>assert.rejects(()=>db.query('select * from elio.products'),/permission denied/));
  })();
}
