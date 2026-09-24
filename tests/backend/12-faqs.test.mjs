import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const {api,ids,as}=state.h;
 const read=()=>api('admin_bootstrap',{},ids.owner);
 const save=(content,revision,user=ids.owner)=>api('save_faqs',{content,expected_revision:revision},user);
 let current;
 await check('FAQ setup preserves the four existing questions and exposes only public editorial fields',async()=>{
  current=await read();assert.equal(current.faq_content.items.length,4);
  const publicData=await api('faqs');assert.equal(publicData.items.length,4);
  assert.deepEqual(Object.keys(publicData).sort(),['heading','items']);
  assert(!('visible' in publicData.items[0]));assert(!('faq_content' in (await api('catalog')).settings));
  await assert.rejects(()=>as(ids.customer,()=>db.query('select elio.faq_data(false)')),/permission denied/);
 })();
 await check('Only verified owners can publish FAQs',async()=>{
  for(const user of[null,ids.customer,ids.staff,ids.unverified])await assert.rejects(()=>save(current.faq_content,current.faq_revision,user),/owner|authorized/i);
  assert.equal((await read()).faq_revision,current.faq_revision);
 })();
 await check('Owners can add, edit, reorder and hide FAQs without changing ordering settings or inventory',async()=>{
  const before=await read(),items=structuredClone(current.faq_content.items);
  items[0].question='Which flavors can I choose?';items[1].visible=false;
  const added={id:randomUUID(),question:'Where can I collect my box?',answer:'Use the pickup details in your order.\n\nPlease bring your order reference.',visible:true,link_label:'Browse boxes',link_url:'order.html'};
  const content={heading:'A few helpful answers',items:[added,...items.reverse()]};
  current=await save(content,current.faq_revision);
  const publicData=await api('faqs');assert.equal(publicData.heading,content.heading);assert.equal(publicData.items[0].id,added.id);assert.equal(publicData.items.length,4);assert(!publicData.items.some(i=>i.question==='Can I customize a box?'));
  const after=await read();assert.deepEqual(after.settings,before.settings);assert.deepEqual(after.inventory,before.inventory);assert.equal(after.orders.length,before.orders.length);
 })();
 await check('Stale FAQ edits cannot overwrite a newer saved list',async()=>{
  await assert.rejects(()=>save({heading:'Stale',items:[]},current.faq_revision-1),/another session/);
  assert.deepEqual((await read()).faq_content,current.faq_content);
 })();
 await check('Invalid FAQ content and unsafe links fail atomically',async()=>{
  const valid=current.faq_content,first=valid.items[0];
  for(const changes of[{question:''},{answer:''},{question:'q'.repeat(201)},{answer:'a'.repeat(6001)},{visible:'yes'},{link_url:'javascript:alert(1)'},{link_url:'//untrusted.example'},{link_url:'data:text/html,hello'},{link_label:''}]) {
   await assert.rejects(()=>save({...valid,items:[{...first,...changes}]},current.faq_revision));
  }
  await assert.rejects(()=>save({...valid,items:[first,first]},current.faq_revision),/unique ID/);
  await assert.rejects(()=>save({...valid,items:Array.from({length:51},()=>({...first,id:randomUUID()}))},current.faq_revision),/at most 50/);
  assert.deepEqual((await read()).faq_content,valid);assert.equal((await read()).faq_revision,current.faq_revision);
 })();
 await check('Hidden answers stay out of all public responses, including when every FAQ is hidden',async()=>{
  const content={...current.faq_content,items:current.faq_content.items.map(i=>({...i,visible:false,answer:'Private FAQ draft '+i.id}))};
  current=await save(content,current.faq_revision);assert.deepEqual((await api('faqs')).items,[]);
  assert(!JSON.stringify(await api('catalog')).includes('Private FAQ draft'));
  assert(!JSON.stringify(await api('flavor_collection')).includes('Private FAQ draft'));
  assert.equal((await read()).faq_content.items.length,5);
 })();
 await check('Removing FAQs preserves the chosen heading and an empty public list',async()=>{
  current=await save({heading:'Questions about Elio',items:[]},current.faq_revision);
  assert.deepEqual(await api('faqs'),{heading:'Questions about Elio',items:[]});
 })();
}
