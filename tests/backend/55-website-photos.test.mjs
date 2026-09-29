import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {photoSlots} from '../../dist/assets/website-photo-slots.js';
export default async function({db,check,state}){
 const {api,ids,as,scalar}=state.h;
 let path,photo;
 const payload=()=>({slot:'home_hero',revision:photo.revision,path,alt:'Our latest Elio box',position_x:70,position_y:45});
 await check('Website photos expose only fixed public slots; owner storage uploads and saves are protected',async()=>{
  const initial=await api('website_photos');assert.deepEqual(Object.keys(initial.photos).sort(),photoSlots.map(s=>s.id).sort());photo=initial.photos.home_hero;
  assert.equal(photo.path,null);assert.equal(photo.revision,0);
  for(const user of [null,ids.customer,ids.staff])await assert.rejects(()=>api('save_website_photo',{slot:'home_hero',revision:0,path:null},user),/owner/i);
  for(const user of [null,ids.customer,ids.owner])await assert.rejects(()=>as(user,()=>db.query('select * from elio.website_photos')),/permission denied/);
  path=ids.owner+'/'+randomUUID()+'.webp';
  for(const user of [ids.customer,ids.staff])await assert.rejects(()=>as(user,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('website-images',$1,'{\"mimetype\":\"image/webp\"}')",[user+'/'+randomUUID()+'.webp'])),/row-level security/);
  await assert.rejects(()=>as(ids.owner,()=>db.query("insert into storage.objects(bucket_id,name) values('website-images',$1)",[ids.customer+'/'+randomUUID()+'.webp'])),/row-level security/);
  await assert.rejects(()=>api('save_website_photo',payload(),ids.owner),/Upload the photo/);
  await as(ids.owner,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('website-images',$1,'{\"mimetype\":\"image/webp\"}')",[path]));
 })();
 await check('Website photos validate references, descriptions and crop positions, prevent stale writes and restore defaults',async()=>{
  for(const change of [{slot:'unknown'},{revision:'0'},{path:'https://example.test/photo.webp'},{path:ids.customer+'/'+randomUUID()+'.webp'},{path:''},{alt:''},{alt:'x'.repeat(241)},{position_x:101},{position_y:-1},{position_x:'50'},{position_y:2.5}])await assert.rejects(()=>api('save_website_photo',{...payload(),...change},ids.owner));
  const before=payload();photo=await api('save_website_photo',before,ids.owner);assert.equal(photo.revision,1);assert.equal(photo.path,path);assert.equal(photo.position_x,70);
  const publicData=await api('website_photos');assert.deepEqual(publicData.photos.home_hero,photo);assert.equal(publicData.photos.story_hero.path,null);
  await assert.rejects(()=>api('save_website_photo',before,ids.owner),/changed/);
  photo=await api('save_website_photo',{slot:'home_hero',revision:photo.revision,path:null},ids.owner);assert.equal(photo.path,null);assert.equal(photo.alt,'');assert.equal(photo.revision,2);
  assert.equal(await scalar("select count(*)::integer from storage.objects where bucket_id='website-images' and name=$1",[path]),1);
  await db.query("delete from storage.objects where bucket_id='website-images' and name=$1",[path]);
 })();
}
