import assert from 'node:assert/strict';

export default async function({db,check,state}) {
 const h=state.h,{api,ids,product,checkout}=h;
 const flavor=await product({kind:'flavor',name:'QA Reference Flavor',price_cents:0,in_rotation:true});
 const box=await product({box_flavors:[flavor.id,flavor.id,flavor.id],price_cents:99000,lead_days:0});
 const date=await h.day(2);
 let order;
 await check('Order references are short, random and stable across submission retries',async()=>{
  const payload=checkout(box,date);order=await api('create_order',payload,ids.customer);
  assert.match(order.reference,/^ELIO-[2-9A-HJ-NP-Z]{6}$/);
  assert.match(order.id,/^[a-f0-9-]{36}$/);assert.match(order.access_token,/^[a-f0-9]{64}$/);
  const repeated=await api('create_order',payload,ids.customer);assert.equal(repeated.id,order.id);assert.equal(repeated.reference,order.reference);
  const generated=(await db.query('select elio.new_order_reference() as reference from generate_series(1,1000)')).rows.map(r=>r.reference);
  assert.equal(new Set(generated).size,1000);assert(generated.every(r=>/^ELIO-[2-9A-HJ-NP-Z]{6}$/.test(r)));
 })();
 await check('Knowing the courier reference cannot open or upload to an order',async()=>{
  await assert.rejects(()=>api('get_order',{order_id:order.id},null,order.reference),/not authorized/);
  await assert.rejects(()=>api('get_order',{order_id:order.id},ids.stranger),/not authorized/);
  await assert.rejects(()=>api('get_order',{order_id:order.reference}),/invalid input syntax/);
  await assert.rejects(()=>h.service('authorize_upload',{kind:'proof',order_id:order.id,token:order.reference}),/not authorized/);
  assert.equal((await api('get_order',{order_id:order.id},ids.customer)).reference,order.reference);
  assert.equal((await api('get_order',{order_id:order.id},null,order.access_token)).reference,order.reference);
  assert.equal((await api('my_orders',{},ids.stranger)).some(o=>o.id===order.id),false);
  await assert.rejects(()=>h.as(ids.customer,()=>db.query('select elio.new_order_reference()')),/permission denied/);
 })();
 await check('A reference collision is retried without changing the existing order',async()=>{
  const original=(await db.query("select pg_get_functiondef('extensions.gen_random_bytes(integer)'::regprocedure) as definition")).rows[0].definition;
  await db.query("update elio.orders set reference='ELIO-222222' where id=$1",[order.id]);
  try {
   await db.exec(`create temporary table reference_random_calls(n integer); insert into reference_random_calls values(0);
    create or replace function extensions.gen_random_bytes(integer) returns bytea language plpgsql volatile as $$
    declare n integer; begin update pg_temp.reference_random_calls set n=reference_random_calls.n+1 returning reference_random_calls.n into n;
    return decode(repeat(case when n=1 then '00' else '01' end,$1),'hex'); end $$;`);
   assert.equal(await h.scalar('select elio.new_order_reference()'),'ELIO-333333');
   assert.equal(await h.scalar('select n from reference_random_calls'),2);
   assert.equal(await h.scalar('select reference from elio.orders where id=$1',[order.id]),'ELIO-222222');
   await db.exec(`create or replace function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$select decode(repeat('00',$1),'hex')$$;`);
   assert.equal(await h.scalar('select elio.new_order_reference()'),'ELIO-2222222'); // Expands only after six-character collisions.
  } finally { await db.exec(original);await db.exec('drop table reference_random_calls'); }
 })();
}
