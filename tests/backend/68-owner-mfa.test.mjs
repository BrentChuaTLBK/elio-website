import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
export default async function({db,check,state}){
 const h=state.h||(await makeHarness(db)),{ids,as,rawApi}=h;
 const request=(action,payload={},claims={aal:'aal1'},user=ids.owner)=>as(user,async()=>
  (await db.query('select public.shop_api($1,$2::jsonb,null) as value',[action,JSON.stringify(payload)])).rows[0].value,'authenticated',claims);
 const denied=p=>assert.rejects(p,e=>e.code==='P0MFA');
 await check('Owner role navigation remains available but AAL1 cannot read or mutate owner tools',async()=>{
  assert.deepEqual(await request('account_access'),{role:'owner',mfa_required:true,mfa_enrolled:true});
  for(const action of ['admin_bootstrap','list_staff','save_product','save_settings','order_backup_snapshot','newsletter_subscriber_lookup'])await denied(request(action,{email:'customer@example.test',aal:'aal2'}));
  assert.equal((await rawApi('admin_bootstrap',{},ids.owner)).role,'owner');
  assert.equal((await rawApi('admin_bootstrap',{},ids.staff)).role,'staff');
 })();
 await check('AAL2 requires a live matching session and a still-verified factor',async()=>{
  await denied(request('admin_bootstrap',{}, {aal:'aal2',session_id:randomUUID()}));
  await denied(request('admin_bootstrap',{}, {aal:'aal2',session_id:'not-a-uuid'}));
  const mutate=async(sql,args)=>{await db.query(sql,args);await denied(request('admin_bootstrap',{}, {aal:'aal2'}));};
  try{
   await mutate("update auth.sessions set aal='aal1' where id=$1",[h.ownerSession]);
   await db.query("update auth.sessions set aal='aal2',not_after=now()-interval '1 second' where id=$1",[h.ownerSession]);await denied(request('admin_bootstrap',{}, {aal:'aal2'}));
   await db.query('update auth.sessions set not_after=null where id=$1',[h.ownerSession]);
   await mutate("update auth.mfa_factors set status='unverified' where id=$1",[h.ownerFactor]);
   await db.query("update auth.mfa_factors set status='verified' where id=$1",[h.ownerFactor]);
   await mutate('update auth.sessions set user_id=$2 where id=$1',[h.ownerSession,ids.customer]);
  }finally{await db.query("update auth.sessions set user_id=$2,aal='aal2',not_after=null where id=$1",[h.ownerSession,ids.owner]);await db.query("update auth.mfa_factors set status='verified' where id=$1",[h.ownerFactor]);}
  assert.equal((await rawApi('account_access',{},ids.owner)).mfa_required,false);
 })();
 await check('Owner MFA does not grant a customer owner privileges or trust user-editable metadata',async()=>{
  await db.query("update auth.users set raw_user_meta_data='{"+'"role":"owner","aal":"aal2"'+"}'::jsonb where id=$1",[ids.customer]);
  const access=await request('account_access',{user_id:ids.owner},{aal:'aal2',session_id:h.ownerSession},ids.customer);
  assert.equal(access.role,null);assert.equal(access.mfa_required,false);
  await assert.rejects(request('admin_bootstrap',{}, {aal:'aal2',session_id:h.ownerSession},ids.customer),/Authorized/);
 })();
 await check('AAL1 owner cannot use staff order access, while valid private order links remain customer-safe',async()=>{
  const before=await h.scalar('select data from elio.settings where id');
  try{
   await h.api('save_settings',{settings:{paused:false}},ids.owner);
   const flavor=await h.product({kind:'flavor',price_cents:0}),box=await h.product({kind:'set',box_flavors:[flavor.id,flavor.id,flavor.id]}),date=await h.day(5);
   await h.inventory(flavor,date,20);const created=await h.api('create_order',h.checkout(box,date),ids.customer);
   await assert.rejects(request('get_order',{order_id:created.id}),/access|available|permission|not found/i);
   const linkRead=(user,claims)=>as(user,async()=>(await db.query('select public.shop_api($1,$2::jsonb,$3) value',['get_order',JSON.stringify({order_id:created.id}),created.access_token])).rows[0].value,user?'authenticated':'anon',claims);
   const guest=await linkRead(null,{}),owner=await linkRead(ids.owner,{aal:'aal1'});assert.deepEqual(owner,guest);
   assert.equal((await rawApi('get_order',{order_id:created.id},ids.owner)).id,created.id);
  }finally{await h.api('save_settings',{settings:before},ids.owner);}
 })();
 await check('Owner photo policies require MFA and do not accept a forged client role',async()=>{
  const had=await h.scalar("select has_table_privilege('authenticated','storage.objects','INSERT')");
  await db.exec('grant insert on storage.objects to authenticated');
  const objectIds=[];
  const put=(bucket,claims,user=ids.owner)=>as(user,async()=>{const id=randomUUID();objectIds.push(id);await db.query("insert into storage.objects(id,bucket_id,name) values($1,$2,$3)",[id,bucket,user+'/'+randomUUID()+'.webp']);},'authenticated',claims);
  try{for(const bucket of ['product-images','website-images']){await assert.rejects(put(bucket,{aal:'aal1'}),/row-level security/);await put(bucket,{aal:'aal2'});await assert.rejects(put(bucket,{aal:'aal2',session_id:h.ownerSession},ids.customer),/row-level security/);}}
  finally{await db.query('delete from storage.objects where id=any($1::uuid[])',[objectIds]);if(!had)await db.exec('revoke insert on storage.objects from authenticated');}
 })();
 await check('Trusted recovery services retain access and factor/session revocation is immediate',async()=>{
  assert.equal((await h.service('order_backup_owner_access',{user_id:ids.owner})).allowed,true);
  await db.query('delete from auth.sessions where id=$1',[h.ownerSession]);
  await denied(request('admin_bootstrap',{}, {aal:'aal2'}));
  assert.equal((await request('account_access',{}, {aal:'aal2'})).mfa_required,true);
  await db.query("insert into auth.sessions(id,user_id,factor_id,aal) values($1,$2,$3,'aal2')",[h.ownerSession,ids.owner,h.ownerFactor]);
 })();
}
