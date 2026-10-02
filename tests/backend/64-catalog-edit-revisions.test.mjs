import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';

export default async function({db,check,state}) {
 const h=state.h||await makeHarness(db),{api,rawApi,ids}=h;
 const save=(action,payload)=>rawApi(action,payload,ids.owner);
 const read=async(table,id)=> (await db.query('select data from elio.'+table+' where id=$1',[id])).rows[0]?.data;
 await check('Stale product editor cannot revert a newer price; fresh save and exact retry work',async()=>{
  const p=await h.product({kind:'flavor',name:'Revision '+randomUUID(),price_cents:10000});
  const payload={product:{...p,price_cents:15000},expected_revision:p.edit_revision};
  const next=await save('save_product',payload);assert.equal(next.price_cents,15000);assert.equal(next.edit_revision,p.edit_revision+1);
  const again=await save('save_product',payload);assert.deepEqual(again,next);
  await assert.rejects(save('save_product',{product:{...p,description:'Stale description'},expected_revision:p.edit_revision}),/changed in another/);
  assert.equal((await read('products',p.id)).price_cents,15000);
  const fresh=await save('save_product',{product:{...next,description:'Fresh description'},expected_revision:next.edit_revision});
  assert.equal(fresh.price_cents,15000);assert.equal(fresh.edit_revision,next.edit_revision+1);
 })();
 await check('Missing, forged and future edit revisions cannot bypass a catalog guard',async()=>{
  const p=await h.product({kind:'flavor',name:'Guard '+randomUUID()});
  for(const expected of [null,-1,1.5,'1',999999])await assert.rejects(save('save_product',{product:{...p,name:'Forged'},expected_revision:expected}),/out of date|changed/);
  await assert.rejects(save('save_product',{product:p}),/out of date/);
  await assert.rejects(save('save_product',{product:{...p,edit_revision:9000,_elio_expected_edit_revision:p.edit_revision}}),/out of date/);
  assert.equal((await read('products',p.id)).name,p.name);
  for(const user of [null,ids.customer,ids.staff])await assert.rejects(rawApi('save_product',{product:{...p,name:'Unauthorized'},expected_revision:p.edit_revision},user),/Authorized|owner|sign in/i);
 })();
 await check('Stale settings and partial-section saves preserve newer settings; identical retries keep revision',async()=>{
  const before=(await db.query('select data from elio.settings where id')).rows[0].data,rev=before.edit_revision??0;
  const payload={settings:{...before,contact_phone:'09171230001'},expected_revision:rev};
  const next=await save('save_settings',payload);assert.equal(next.edit_revision,rev+1);
  assert.equal((await save('save_settings',payload)).edit_revision,next.edit_revision);
  await assert.rejects(save('save_settings',{settings:{...before,contact_email:'stale@example.test'},expected_revision:rev}),/changed in another/);
  await assert.rejects(save('save_settings',{settings:{contact_phone:'09171230002'}}),/out of date/);
  await assert.rejects(save('save_settings',{settings:{flavor_headings:{current:'New current',next:'New next',collection:'New collection'}},expected_revision:rev}),/changed in another/);
  const fresh=await save('save_settings',{settings:{contact_email:'fresh@example.test'},expected_revision:next.edit_revision});
  assert.equal(fresh.contact_phone,'09171230001');
  await api('save_settings',{settings:before},ids.owner);
 })();
 await check('Promo, zone and category editors reject stale snapshots and return their advanced version',async()=>{
  const suffix=randomUUID().slice(0,8);
  const cases=[
   {action:'save_promo',table:'promos',key:'promo',data:{code:'REV'+suffix,kind:'percent',value:10,min_subtotal_cents:0,cap_cents:null,per_account_limit:1,global_limit:100,expires_at:'2030-01-01T00:00:00Z',active:true},first:{value:15},second:{global_limit:50}},
   {action:'save_zone',table:'zones',key:'zone',data:{name:'Revision '+suffix,description:'Original',localities:['Revision '+suffix],fee_cents:10000,active:true},first:{fee_cents:15000},second:{description:'Stale description'}},
   {action:'save_category',table:'categories',key:'category',data:{name:'Revision '+suffix,scope:'flavors'},first:{name:'Renamed '+suffix},second:{name:'Stale '+suffix}}
  ];
  for(const c of cases){const p=await save(c.action,{[c.key]:c.data});assert.equal(p.edit_revision,1);
   const req={[c.key]:{...p,...c.first},expected_revision:1},next=await save(c.action,req);assert.equal(next.edit_revision,2);
   assert.deepEqual(await save(c.action,req),next);
   await assert.rejects(save(c.action,{[c.key]:{...p,...c.second},expected_revision:1}),/changed in another/);
   assert.deepEqual(await read(c.table,p.id),next);
  }
 })();
 await check('Internal changes advance editor versions and removed categories cannot be recreated by stale editors',async()=>{
  const p=await h.product({kind:'flavor',name:'Internal '+randomUUID()});
  await db.query("update elio.products set data=jsonb_set(data,'{description}',to_jsonb('Internal change'::text)) where id=$1",[p.id]);
  const changed=await read('products',p.id);assert.equal(changed.edit_revision,p.edit_revision+1);
  await assert.rejects(save('save_product',{product:{...p,name:'Stale'},expected_revision:p.edit_revision}),/changed in another/);
  const c=await save('save_category',{category:{name:'Remove '+randomUUID(),scope:'flavors'}});
  await api('delete_category',{id:c.id},ids.owner);
  await assert.rejects(save('save_category',{category:c,expected_revision:c.edit_revision}),/no longer exists/);
  assert.equal(await read('categories',c.id),undefined);
 })();
 await check('Flavor editor rejects stale content and stale monthly placement without partial writes',async()=>{
  const p=await h.product({kind:'flavor',name:'Placement '+randomUUID()});
  const month=(await api('admin_bootstrap',{},ids.owner)).flavor_menus.current_month;
  const draft={id:p.id,name:p.name,tagline:'',description:'',hidden:false,current_month:true,next_month:true,expected_month:month,expected_revision:p.edit_revision,expected_current_month:true,expected_next_month:true,photos:[]};
  await db.query('update elio.flavor_menus set flavor_ids=array_remove(flavor_ids,$1::uuid) where month=$2::date',[p.id,month]);
  await assert.rejects(save('save_flavor_editor',{...draft,description:'Unsaved change'}),/lineup changed/);
  assert.equal((await read('products',p.id)).description,p.description);
  const fresh={...draft,expected_current_month:false,current_month:false};
  await save('save_flavor_editor',fresh);
  const current=await read('products',p.id);
  await save('save_product',{product:{...current,tagline:'First tab'},expected_revision:current.edit_revision});
  await assert.rejects(save('save_flavor_editor',{...fresh,description:'Second tab',expected_revision:current.edit_revision}),/changed in another/);
  assert.equal((await read('products',p.id)).tagline,'First tab');
 })();
 await check('Fixture helper never replaces explicit expected revisions or membership snapshots',async()=>{
  const p=await h.product({kind:'flavor',name:'Fixture '+randomUUID()}),rev=p.edit_revision;
  await api('save_product',{product:{...p,description:'New'}},ids.owner);
  await assert.rejects(api('save_product',{product:{...p,description:'Stale'},expected_revision:rev},ids.owner),/changed in another/);
  await assert.rejects(api('save_product',{product:p,expected_revision:null},ids.owner),/out of date/);
 })();
}

