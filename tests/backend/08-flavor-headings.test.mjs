import assert from 'node:assert/strict';

export default async function({db,check,state}) {
 const {api,ids}=state.h;
 const defaults={current:'Flavors of the Month',next:'Coming Next Month',collection:'The full collection.'};
 const save=flavor_headings=>api('save_settings',{settings:{flavor_headings}},ids.owner);
 await check('Owner heading edits persist publicly without changing lineups or inventory',async()=>{
  const before=await api('admin_bootstrap',{},ids.owner);
  assert.deepEqual((await api('flavor_collection')).headings,defaults);
  const edited={current:'  This month’s favorites  ',next:'A taste of what’s next',collection:'Past favorites'};
  await save(edited);
  const after=await api('admin_bootstrap',{},ids.owner),publicData=await api('flavor_collection');
  assert.deepEqual(publicData.headings,{...edited,current:edited.current.trim()});
  assert.deepEqual(after.flavor_menus.headings,publicData.headings);
  assert.deepEqual(after.flavor_menus.menus,before.flavor_menus.menus);
  assert.deepEqual(after.inventory,before.inventory);
  const {flavor_headings,...settings}=after.settings;
  assert.deepEqual(settings,before.settings);
  assert.equal(publicData.owner_email,undefined);
  assert.equal(publicData.settings,undefined);
  assert.equal(publicData.current_month,before.flavor_menus.current_month);
  // Settings saved by another dashboard section retain the editorial text.
  await api('save_settings',{settings:{shop_name:before.settings.shop_name}},ids.owner);
  assert.deepEqual((await api('flavor_collection')).headings,flavor_headings);
 })();
 await check('Heading edits require an owner and valid bounded text; failed saves are atomic',async()=>{
  const original=(await api('flavor_collection')).headings;
  for(const user of [null,ids.customer,ids.staff,ids.unverified]) {
   await assert.rejects(()=>api('save_settings',{settings:{flavor_headings:defaults}},user),/authorized|owner|verified|sign in/i);
  }
  for(const value of [null,[],{}, {...defaults,current:''},{...defaults,next:'   '},{...defaults,current:'a'.repeat(81)},{...defaults,collection:2},{...defaults,extra:'private'}]) {
   await assert.rejects(()=>save(value),/heading/i);
   assert.deepEqual((await api('flavor_collection')).headings,original);
  }
  await save(defaults);
 })();
}
