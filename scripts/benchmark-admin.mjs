import {createRequire} from 'node:module';import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {performance} from 'node:perf_hooks';
import {makeHarness} from '../tests/backend/helpers.mjs';import {accountingFixture} from '../tests/backend/accounting-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),require=createRequire(join(root,'tests/backend/package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),results=[];
try{
 await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));for(const n of (await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort()){const s=await readFile(join(root,'supabase/migrations',n),'utf8');if(!s.startsWith('-- Hosted infrastructure:'))await db.exec(s);}
 await db.query("update elio.settings set data=data||$1::jsonb",[JSON.stringify({paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],cutoff_time:''})]);
 const h=await makeHarness(db),{product,date}=await accountingFixture(h);let order=await h.api('create_order',h.checkout(product,date),h.ids.customer);order=await h.action('approve_payment',await h.proof(order));
 await db.query('update elio.inventory set capacity=100000 where date=$1',[date]);
 for(const count of [1,100,1000]){
  const current=Number(await h.scalar('select count(*) from elio.orders'));
  for(let i=current;i<count;i++)await db.query(`insert into elio.orders(id,reference,user_id,access_digest,access_encrypted,created_at,fulfillment_date,method,payment_status,fulfillment_status,payment_deadline,paid_amount_cents,data,idempotency_key,request_hash)
   select gen_random_uuid(),'ELIO-BENCH'||$2::text,user_id,extensions.digest(gen_random_uuid()::text,'sha256'),access_encrypted,created_at,fulfillment_date,method,payment_status,fulfillment_status,payment_deadline,paid_amount_cents,data,gen_random_uuid(),request_hash from elio.orders where id=$1`,[order.id,i]);
  const ms=[];let result;for(let run=0;run<6;run++){const start=performance.now();result=await h.api('admin_bootstrap',{},h.ids.owner);if(run)ms.push(performance.now()-start);}
  results.push({databaseOrders:count,returnedOrders:result.orders.length,bytes:Buffer.byteLength(JSON.stringify(result)),medianMs:ms.sort((a,b)=>a-b)[2],maxOfFiveMs:Math.max(...ms)});console.log(results.at(-1));
 }
 await mkdir(join(root,'test-results/admin-growth'),{recursive:true});await writeFile(join(root,'test-results/admin-growth/report.json'),JSON.stringify({environment:'Isolated PGlite; no network or hosted performance claim; synthetic orders for payload-growth measurement only',results},null,2));
}finally{await db.close();}
