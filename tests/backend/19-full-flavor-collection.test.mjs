import assert from 'node:assert/strict';

export default async function({check,state}) {
  const {api,ids}=state.h;
  const bootstrap=()=>api('admin_bootstrap',{},ids.owner);
  const initial=await bootstrap(),months=initial.flavor_menus;
  const category=await api('save_category',{category:{name:'QA full collection family',scope:'flavors'}},ids.owner);
  const boxCategory=await api('save_category',{category:{name:'QA full collection boxes',scope:'boxes'}},ids.owner);
  const editor={name:'QA full collection',description:'Public description',tagline:'Public tagline',
    photos:['https://example.test/full-collection.webp'],collection_details:{product_type:'Cheesecake',serving:'Keep chilled'},
    category_ids:[category.id],current_month:false,next_month:false,hidden:false,expected_month:months.current_month};
  const create=async(name,changes={})=>{
    await api('save_flavor_editor',{...editor,name,...changes},ids.owner);
    return (await bootstrap()).products.find(flavor=>flavor.name===name);
  };
  const current=await create('QA full current',{current_month:true});
  const next=await create('QA full next',{next_month:true});
  const standalone=await create('QA full standalone');
  const hidden=await create('QA full hidden',{hidden:true});
  const setVisibility=(month,published)=>api('save_flavor_menu_visibility',{month,published,expected_month:months.current_month},ids.owner);
  await setVisibility(months.current_month,true);
  await setVisibility(months.next_month,true);

  await check('Full collection includes all visible flavors across published and draft lineups, excluding hidden rows',async()=>{
    const published=await api('flavor_collection');
    assert(published.menus.some(menu=>menu.month===months.current_month&&menu.flavor_ids.includes(current.id)));
    assert(published.menus.some(menu=>menu.month===months.next_month&&menu.flavor_ids.includes(next.id)));
    await setVisibility(months.next_month,false);
    const owner=await bootstrap();
    const expected=owner.products.filter(flavor=>flavor.kind==='flavor'&&!flavor.collection_hidden).map(flavor=>flavor.id).sort();
    for(const user of [null,ids.customer,ids.owner]) {
      const collection=await api('flavor_collection',{include_hidden:true,include_unpublished:true},user);
      assert.deepEqual(collection.flavors.map(flavor=>flavor.id).sort(),expected);
      assert.deepEqual(collection.flavors,published.flavors);
      assert(collection.flavors.some(flavor=>flavor.id===standalone.id));
      assert(!collection.flavors.some(flavor=>flavor.id===hidden.id));
      assert(collection.menus.every(menu=>menu.published&&menu.month!==months.next_month));
      assert(!collection.menus.some(menu=>menu.flavor_ids.includes(next.id)));
    }
  })();

  await check('Assigning a visible flavor only to an unpublished lineup reveals no membership signal',async()=>{
    const before=await api('flavor_collection');
    await api('save_flavor_editor',{...editor,id:standalone.id,name:standalone.name,next_month:true},ids.owner);
    const after=await api('flavor_collection');
    assert.deepEqual(after.flavors,before.flavors);
    assert.deepEqual(after.categories,before.categories);
    // The editor touches both menu timestamps even when a published lineup's
    // membership is unchanged. Only its already-public membership may remain.
    const membership=collection=>collection.menus.map(({updated_at,...menu})=>menu);
    assert.deepEqual(membership(after),membership(before));
    for(const flavor of after.flavors) {
      for(const field of ['collection_only','current_month','next_month','available_months','price_cents','inventory']) {
        assert(!Object.hasOwn(flavor,field),`Public flavor exposes ${field}`);
      }
    }
    const draft=(await bootstrap()).flavor_menus.menus.find(menu=>menu.month===months.next_month);
    assert.equal(draft.published,false);
    assert(draft.flavor_ids.includes(standalone.id));
  })();

  await check('Full collection preserves category ordering and all saved public flavor details without changing stock or menus',async()=>{
    const before=await bootstrap(),collection=await api('flavor_collection');
    const expectedCategories=before.categories.filter(value=>value.scope==='flavors')
      .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    assert.deepEqual(collection.categories,expectedCategories);
    assert(!collection.categories.some(value=>value.id===boxCategory.id));
    const publicFlavor=collection.flavors.find(flavor=>flavor.id===standalone.id);
    const saved=before.products.find(flavor=>flavor.id===standalone.id);
    for(const field of ['name','description','tagline','photos','collection_details','category_ids','category_sort_orders','sort_order']) {
      assert.deepEqual(publicFlavor[field],saved[field],`Changed public field ${field}`);
    }
    assert.deepEqual(publicFlavor.category_ids,[category.id]);
    const after=await bootstrap();
    assert.deepEqual(after.inventory,before.inventory);
    assert.deepEqual(after.flavor_menus,before.flavor_menus);
  })();
}
