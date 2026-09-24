import assert from 'node:assert/strict';

export default async function({db,check,state}) {
  const h=state.h, {api,ids}=h;
  await db.query("insert into elio.staff(user_id,role) values($1,'staff') on conflict(user_id) do update set role='staff'",[ids.staff]);
  const menu=(await api('admin_bootstrap',{},ids.owner)).flavor_menus;
  const current=menu.current_month,next=menu.next_month;
  const date=next.slice(0,7)+'-03',today=await h.day(0);
  const editor={name:'QA monthly pistachio',description:'A new flavor.',tagline:'Nutty and smooth',collection_category:'rich',current_month:true,next_month:true,hidden:false,expected_month:current};
  let flavor,box,order;
  const visibility=(published)=>api('save_flavor_menu_visibility',{month:next,expected_month:current,published},ids.owner);
  const edit=changes=>api('save_flavor_editor',{...editor,id:flavor?.id,...changes},ids.owner);
  await check('Only owners manage flavor lineups; draft months stay private',async()=>{
    for(const user of [null,ids.customer,ids.staff]) {
      await assert.rejects(()=>api('save_flavor_editor',editor,user),/Authorized|owner/);
      await assert.rejects(()=>api('save_flavor_menu_visibility',{month:next,expected_month:current,published:true},user),/Authorized|owner/);
    }
    await edit({});
    flavor=(await api('admin_bootstrap',{},ids.owner)).products.find(p=>p.name===editor.name);
    assert.equal(flavor.active,true);assert.equal(flavor.price_confirmed,true);
    await visibility(false);
    const publicData=await api('flavor_collection');
    assert(publicData.flavors.some(f=>f.id===flavor.id));
    assert(!publicData.menus.some(m=>m.month===next));
    assert(!('price_cents' in publicData.flavors.find(f=>f.id===flavor.id)));
    await assert.rejects(()=>h.as(null,()=>db.query('select * from elio.flavor_menus')),/permission denied/);
    await assert.rejects(()=>edit({expected_month:'2020-01-01'}),/calendar month changed/);
  })();
  await check('Lineups begin at zero; a hidden next month can be stocked without accepting orders',async()=>{
    flavor=await api('save_product',{product:{...flavor,active:true,price_confirmed:true,price_cents:5000}},ids.owner);
    box=await h.product({kind:'set',name:'QA monthly fixed box',box_flavors:[flavor.id,flavor.id,flavor.id],price_cents:99000,lead_days:0});
    await api('save_settings',{settings:{paused:false,fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[]}},ids.owner);
    assert.equal(await h.remaining(flavor,date),0);
    await h.inventory(flavor,date,20);
    await assert.rejects(()=>api('quote',h.checkout(box,date)),/published lineup/);
    assert.equal((await api('catalog',{fulfillment_date:date})).products.find(p=>p.id===box.id).stock_available,false);
    assert(!(await api('catalog')).flavors.find(f=>f.id===flavor.id).available_months.includes(next));
    await visibility(true);
    assert.equal((await api('quote',h.checkout(box,date))).total_cents,99000);
    assert((await api('catalog')).flavors.find(f=>f.id===flavor.id).available_months.includes(next));
    await assert.rejects(()=>api('quote',h.checkout(box,next.slice(0,7)+'-04')),/unavailable|Only 0/);
  })();
  await check('Monthly removal clears unsold stock but protects orders and the other month',async()=>{
    await h.inventory(flavor,today,11);
    order=await api('create_order',h.checkout(box,date));
    const before=await h.allocations(order.id);
    await edit({next_month:false});
    let row=(await api('admin_bootstrap',{},ids.owner)).inventory.find(r=>r.product_id===flavor.id&&r.date===date);
    assert.equal(row.capacity,3);assert.equal(row.reserved,3);assert.equal(row.available,false);
    assert.deepEqual(await h.allocations(order.id),before);
    assert.equal(await h.remaining(flavor,today),11);
    await assert.rejects(()=>h.inventory(flavor,date,20),/month’s lineup/);
    await edit({next_month:true});
    assert.equal(await h.remaining(flavor,date),0);
    await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable|Only 0/);
    await assert.rejects(()=>h.inventory(flavor,date,2),/already reserved|already ordered/);
    await h.inventory(flavor,date,9);
    assert.equal(await h.remaining(flavor,date),6);
    assert.equal((await api('quote',h.checkout(box,date))).total_cents,99000);
  })();
  await check('Hidden flavors leave the public collection and all future lineups without changing existing orders',async()=>{
    await edit({hidden:true});
    assert(!(await api('flavor_collection')).flavors.some(f=>f.id===flavor.id));
    assert((await api('admin_bootstrap',{},ids.owner)).flavor_menus.menus.every(m=>!m.flavor_ids.includes(flavor.id)));
    assert.equal((await h.order(order.id)).items[0].flavor_contents[0].name,editor.name);
    await assert.rejects(()=>api('quote',h.checkout(box,date)),/unavailable/);
    const changed=await h.action('edit_order',order,{reason:'Correct phone',changes:{buyer:{...order.buyer,phone:'09179999999'}}});
    assert.equal(changed.buyer.phone,'09179999999');
    assert.equal((await h.allocations(order.id))[0].quantity,3);
    await edit({hidden:false});
    assert.equal(await h.remaining(flavor,date),0);
  })();
  await check('Daily stock cannot override shop pauses or closed fulfillment dates',async()=>{
    await h.inventory(flavor,date,20);
    await api('save_settings',{settings:{blocked_dates:[date]}},ids.owner);
    await assert.rejects(()=>api('quote',h.checkout(box,date)),/closed|Closed|unavailable/);
    await h.inventory(flavor,date,30);
    await assert.rejects(()=>api('quote',h.checkout(box,date)),/closed|Closed|unavailable/);
    await api('save_settings',{settings:{blocked_dates:[],paused:true}},ids.owner);
    await assert.rejects(()=>api('quote',h.checkout(box,date)),/paused|being prepared/);
    await api('save_settings',{settings:{paused:false}},ids.owner);
    assert.equal((await api('quote',h.checkout(box,date))).total_cents,99000);
  })();
  await check('Bulk fill preserves configured dates, including explicit zero; replace updates totals atomically',async()=>{
    const zero=next.slice(0,7)+'-05',fresh=next.slice(0,7)+'-06';
    await h.inventory(flavor,zero,0);
    const rows=[date,zero,fresh].map(d=>({product_id:flavor.id,date:d,capacity:20,available:true}));
    await api('save_inventory',{rows,mode:'fill_unconfigured'},ids.staff);
    let data=(await api('admin_bootstrap',{},ids.owner)).inventory.filter(r=>r.product_id===flavor.id);
    assert.equal(data.find(r=>r.date===date).capacity,30);
    assert.equal(data.find(r=>r.date===zero).capacity,0);
    assert.equal(data.find(r=>r.date===fresh).capacity,20);
    assert.equal(data.find(r=>r.date===fresh).configured,true);
    await api('save_inventory',{rows,mode:'replace'},ids.staff);
    data=(await api('admin_bootstrap',{},ids.owner)).inventory.filter(r=>r.product_id===flavor.id);
    assert(rows.every(r=>data.find(d=>d.date===r.date).capacity===20));
    await assert.rejects(()=>api('save_inventory',{rows:[{...rows[2],capacity:45},{...rows[0],capacity:1}],mode:'replace'},ids.owner),/already reserved|already ordered/);
    assert.equal((await api('admin_bootstrap',{},ids.owner)).inventory.find(r=>r.product_id===flavor.id&&r.date===fresh).capacity,20);
  })();
}
