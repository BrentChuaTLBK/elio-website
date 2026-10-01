import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';
import {websitePhotoUrl} from '../../dist/assets/website-photo-slots.js';
export default async function({db,check,state}){
 const h=state.h,{api,ids,as}=h,formats=[['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['heic','image/heic'],['heif','image/heif'],['webp','image/webp']];
 await check('Original upload buckets allow 20 MB and the supported image MIME types while receipts remain private',async()=>{
  const rows=(await db.query("select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('product-images','website-images','payment-proofs','affiliate-payout-proofs')")).rows;assert.equal(rows.length,4);
  for(const row of rows){assert.equal(Number(row.file_size_limit),20*1024*1024);assert.deepEqual([...row.allowed_mime_types].sort(),['image/png','image/jpeg','image/heic','image/heif','image/webp'].sort());assert.equal(row.public,['product-images','website-images'].includes(row.id));}
 })();
 await check('Owners can save original website photos; other users and mismatched MIME/path pairs stay blocked',async()=>{
  let saved=(await api('website_photos')).photos.story_hero;
  for(const [extension,mime] of formats){const path=ids.owner+'/'+randomUUID()+'.'+extension;
   await as(ids.owner,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('website-images',$1,$2)",[path,JSON.stringify({mimetype:mime})]));
   const payload={slot:'story_hero',revision:saved.revision,path,alt:'Original format test',position_x:50,position_y:50};
   for(const user of [ids.staff,ids.customer,null])await assert.rejects(()=>api('save_website_photo',payload,user),/owner/i);
   saved=await api('save_website_photo',payload,ids.owner);assert.equal(saved.path,path);assert.ok(websitePhotoUrl(path,'https://storage.test').endsWith(path));
   for(const bucket of ['product-images','website-images']){for(const user of [ids.staff,ids.customer])await assert.rejects(()=>as(user,()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,user+'/'+randomUUID()+'.'+extension])),/row-level security/);}
  }
  const wrong=ids.owner+'/'+randomUUID()+'.heic';await as(ids.owner,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('website-images',$1,'{\"mimetype\":\"image/png\"}')",[wrong]));await assert.rejects(()=>api('save_website_photo',{slot:'story_hero',revision:saved.revision,path:wrong,alt:'Mismatch',position_x:50,position_y:50},ids.owner),/Upload the photo/);
  for(const extension of ['svg','pdf','gif','html'])for(const bucket of ['product-images','website-images'])await assert.rejects(()=>as(ids.owner,()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,ids.owner+'/'+randomUUID()+'.'+extension])),/row-level security/);
  await api('save_website_photo',{slot:'story_hero',revision:saved.revision,path:null},ids.owner);
 })();
 await check('Order receipts commit original PNG/JPEG/HEIC/HEIF paths without bypassing order authorization',async()=>{
  const fixture=await accountingFixture(h);
  for(const [extension] of formats){const order=await api('create_order',h.checkout(fixture.product,fixture.date)),path=order.id+'/'+randomUUID()+'.'+extension;await assert.rejects(()=>h.proof(order,{path,token:'wrong-token'}));const accepted=await h.proof(order,{path});assert.equal(accepted.payment_status,'under_review');assert.equal((await h.order(order.id)).proof_path,path);await h.action('cancel_order',await h.order(order.id),{reason:'Local fixture complete'});}
 })();
}
