import assert from 'node:assert/strict';

export default async function({db,check,state}) {
 const h=state.h,{api,ids}=h;
 const saveCat=(name,scope)=>api('save_category',{category:{name,scope}},ids.owner);
 const bootstrap=()=>api('admin_bootstrap',{},ids.owner);
 const snapshot=items=>items.map(p=>({id:p.id,sort_order:p.sort_order||0,category_ids:p.category_ids,category_sort_orders:p.category_sort_orders}));
 const request=async(scope='flavors')=>{
  const data=await bootstrap(),items=data.products.filter(p=>(p.kind==='flavor')===(scope==='flavors'));
  const byOrder=(items,category)=>items.sort((a,b)=>(category?a.category_sort_orders[category]-b.category_sort_orders[category]:a.sort_order-b.sort_order)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).map(p=>p.id);
  return {kind:'products',scope,expected:snapshot(items),groups:[{category_id:'*',ids:byOrder([...items])},...data.categories.filter(c=>c.scope===scope&&items.some(p=>p.category_ids.includes(c.id))).map(c=>({category_id:c.id,ids:byOrder(items.filter(p=>p.category_ids.includes(c.id)),c.id)}))]};
 };
 let tea,best,gift,first,second;
 await check('Categories have separate box/flavor scopes and share a single flavor record',async()=>{
  tea=await saveCat('QA Tea','flavors');best=await saveCat('QA Bestsellers','flavors');gift=await saveCat('QA Gifts','boxes');
  first=await h.product({kind:'flavor',name:'QA multi Matcha',category_ids:[tea.id,best.id],in_rotation:true,price_cents:2000});
  second=await h.product({kind:'flavor',name:'QA multi Hojicha',category_ids:[tea.id,best.id],in_rotation:true,price_cents:0});
  assert.deepEqual(first.category_ids,[tea.id,best.id]);
  const before=(await bootstrap()).inventory;
  await api('save_product',{product:{...first,description:'New description',category_sort_orders:{[tea.id]:999},sort_order:999}},ids.owner);
  const after=await bootstrap();assert.deepEqual(after.inventory,before);
  const saved=after.products.find(p=>p.id===first.id);assert.equal(saved.sort_order,first.sort_order);assert.deepEqual(saved.category_sort_orders,first.category_sort_orders);
  await assert.rejects(()=>api('save_product',{product:{...first,category_ids:[gift.id]}},ids.owner),/category for this item type/);
  await assert.rejects(()=>api('save_product',{product:{...first,category_ids:[tea.id,tea.id]}},ids.owner),/each category once/);
  const collection=await api('flavor_collection');assert(collection.categories.some(c=>c.id===tea.id));assert(!collection.categories.some(c=>c.id===gift.id));
  assert.deepEqual(collection.flavors.find(f=>f.id===first.id).category_ids,[tea.id,best.id]);
 })();
 await check('Per-category and All orders save independently without modifying flavor stock',async()=>{
  const req=await request(),inventory=(await bootstrap()).inventory;
  req.groups.find(g=>g.category_id===tea.id).ids.reverse();
  const result=await api('reorder_catalog',req,ids.owner),a=result.items.find(p=>p.id===first.id),b=result.items.find(p=>p.id===second.id);
  assert(a.category_sort_orders[tea.id]>b.category_sort_orders[tea.id]);assert(a.category_sort_orders[best.id]<b.category_sort_orders[best.id]);
  assert(a.sort_order<b.sort_order);assert.deepEqual((await bootstrap()).inventory,inventory);
  const next=await request();next.groups.find(g=>g.category_id==='*').ids.reverse();
  await api('reorder_catalog',next,ids.owner);
  const data=await bootstrap();assert(data.products.find(p=>p.id===first.id).sort_order>data.products.find(p=>p.id===second.id).sort_order);
  await assert.rejects(()=>api('reorder_catalog',req,ids.owner),/another session/);
 })();
 await check('Reordering is owner-only, complete, scoped and atomic',async()=>{
  const req=await request();
  for(const user of [null,ids.customer,ids.staff,ids.unverified])await assert.rejects(()=>api('reorder_catalog',req,user),/owner|Authorized|verified/i);
  await db.query("insert into elio.staff(user_id,role) values($1,'owner')",[ids.unverified]);
  await assert.rejects(()=>api('reorder_catalog',req,ids.unverified),/verified owner/);
  await db.query('delete from elio.staff where user_id=$1',[ids.unverified]);
  const partial=structuredClone(req);partial.groups=partial.groups.filter(g=>g.category_id!==best.id);partial.groups[0].ids.reverse();
  await assert.rejects(()=>api('reorder_catalog',partial,ids.owner),/every category/);assert.deepEqual((await request()).expected,req.expected);
  const duplicate=structuredClone(req);duplicate.groups[0].ids[0]=duplicate.groups[0].ids[1];
  await assert.rejects(()=>api('reorder_catalog',duplicate,ids.owner),/missing|catalog changed/);
  const cross=structuredClone(req);cross.groups.push({category_id:gift.id,ids:[]});await assert.rejects(()=>api('reorder_catalog',cross,ids.owner),/Category not found/);
  const data=await bootstrap(),cats=data.categories.filter(c=>c.scope==='flavors');
  await api('reorder_catalog',{kind:'categories',scope:'flavors',ids:cats.map(c=>c.id).reverse(),expected:cats.map(c=>({id:c.id,sort_order:c.sort_order||0}))},ids.owner);
  assert.deepEqual((await bootstrap()).categories.find(c=>c.id===gift.id),gift);
 })();
 await check('Removing a category preserves other memberships, saved positions and stock',async()=>{
  const data=await bootstrap();await api('delete_category',{id:tea.id},ids.owner);
  const after=await bootstrap(),saved=after.products.find(p=>p.id===first.id);
  assert.deepEqual(saved.category_ids,[best.id]);assert(!Object.hasOwn(saved.category_sort_orders,tea.id));assert.deepEqual(after.inventory,data.inventory);
  await api('delete_category',{id:best.id},ids.owner);
  assert.deepEqual((await bootstrap()).products.find(p=>p.id===first.id).category_ids,[]);
 })();
 await check('Flavor removal preview counts outstanding confirmed recipes only',async()=>{
  const data=await bootstrap(),current=data.flavor_menus.current_month,next=data.flavor_menus.next_month;
  const date=next.slice(0,7)+'-12';
  const box=await h.product({name:'QA removal preview',box_flavors:[first.id,first.id,second.id],price_cents:10000,lead_days:0});
  await api('save_settings',{settings:{paused:false,fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[]}},ids.owner);
  const order=await api('create_order',h.checkout(box,date,{items:[h.item(box,2)]}));
  const payload={id:first.id,current_month:true,next_month:false,hidden:false,expected_month:current};
  assert.equal((await api('flavor_removal_impact',payload,ids.owner)).months[0].pieces,0);
  await h.proof(order);await h.action('approve_payment',await h.order(order.id));
  assert.deepEqual((await api('flavor_removal_impact',payload,ids.owner)).months,[{month:next,orders:1,pieces:4}]);
  await assert.rejects(()=>api('flavor_removal_impact',payload,ids.customer),/owner|Authorized/);
 })();
}
