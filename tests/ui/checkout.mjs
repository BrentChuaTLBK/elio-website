import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {accountingFixture} from '../backend/accounting-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT,'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),origin='https://checkout.test',out=join(project,'test-results/checkout');await mkdir(out,{recursive:true});
await db.exec(await readFile(join(project,'tests/backend/bootstrap.sql'),'utf8'));
for(const name of (await readdir(join(project,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(join(project,'supabase/migrations',name),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
const h=await makeHarness(db);
await db.query('update elio.settings set data=data||$1::jsonb',[JSON.stringify({site_url:origin,paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],cutoff_time:'',payment_options:[{label:'GCash',account_name:'Test shop',account_number:'09170000000',note:''},{label:'BDO',account_name:'Test shop',account_number:'00123',note:''},{label:'East West',account_name:'Test shop',account_number:'00124',note:''}]})]);
await h.api('save_zone',{zone:{name:'QA Metro',localities:['QA City'],active:true,fee_cents:3000}},h.ids.owner);
await h.api('save_promo',{promo:{code:'CHECKOUT10',kind:'percent',value:10,min_subtotal_cents:0,cap_cents:null,per_account_limit:10,global_limit:100,expires_at:new Date(Date.now()+86400000).toISOString(),active:true}},h.ids.owner);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true}),results=[];let chain=Promise.resolve();const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
try{
 for(const [width,method,guest] of [[1440,'pickup',false],[390,'delivery',false],[320,'pickup',true]]){
  const fixture=await accountingFixture(h),flavor=fixture.product.box_flavors[0];
  await db.query('update elio.inventory set available=false where product_id=$1 and date<>$2',[flavor,fixture.date]);
  const user=guest?null:h.ids.customer,calls=[],errors=[],uploads=[];let created;
  const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await ctx.exposeBinding('checkoutRpc',async(_,{action,payload,token})=>serial(async()=>{try{calls.push(action);const data=await h.api(action,payload,user,token);if(action==='create_order')created=data;return {data,error:null};}catch(e){return {data:null,error:{message:e.message}};}}));
  await ctx.exposeBinding('checkoutProof',async(_,{fields,file})=>serial(async()=>{try{assert.equal(file.type,'image/webp');assert.equal(String.fromCharCode(...file.header.slice(8)),'WEBP');uploads.push(file);const data=await h.service('commit_proof',{...fields,user_id:user,path:fields.order_id+'/'+randomUUID()+'.webp'});return {data,error:null};}catch(e){return {data:null,error:{message:e.message}};}}));
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:${guest?'null':JSON.stringify({user:{id:user,email:'customer@example.test'},access_token:'local-test'})}}}),onAuthStateChange:()=>{}},rpc:async(name,p)=>window.checkoutRpc({action:p.p_action,payload:p.p_payload,token:p.p_token}),functions:{invoke:async(name,{body})=>{const f=body.get('file');return window.checkoutProof({fields:Object.fromEntries([...body].filter(([k])=>k!=='file')),file:{type:f.type,name:f.name,size:f.size,header:[...new Uint8Array(await f.arrayBuffer()).slice(0,12)]}})}}}}`});
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/shop/newsletter.js')return route.fulfill({contentType:'text/javascript',body:''});
   const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/order.html');await page.locator('[data-product="'+fixture.product.id+'"]').click();await page.locator('#add-to-cart').click();
  if(method==='delivery')await page.locator('[data-method=delivery]').click();
  await page.locator('#checkout-button').click();const form=page.locator('#checkout-form');
  await form.locator('[name=buyer_name]').fill('QA customer');await form.locator('[name=buyer_email]').fill('customer@example.test');await form.locator('[name=buyer_phone]').fill('09170000000');await form.locator('[name=social_platform]').selectOption('na');assert.equal(await form.locator('[name=social_username]').inputValue(),'N/A');
  if(method==='delivery'){await form.locator('[name=recipient_name]').fill('QA recipient');await form.locator('[name=recipient_phone]').fill('09170000001');await form.locator('[name=locality]').selectOption('QA City');await form.locator('[name=line1]').fill('Test address only');}
  if(!guest){await form.locator('[name=promo_code]').fill('CHECKOUT10');await page.locator('#apply-promo').click();await page.locator('#promo-status').filter({hasText:'applied'}).waitFor();}
  await page.locator('#review-order').click();await page.locator('#place-order').waitFor();await page.screenshot({path:join(out,`review-${width}-${method}.png`),fullPage:true});
  await page.locator('#place-order').click();await page.locator('#proof-form').waitFor();
  assert.equal(created.total_cents,10000-(guest?0:1000)+(method==='delivery'?3000:0));assert.equal(await h.remaining({id:flavor},fixture.date),97);
  for(const label of ['GCash','BDO','East West'])assert(await page.getByText(label,{exact:true}).count()>0);
  const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=360;c.height=140;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,360,140);x.fillStyle='black';x.font='24px Arial';x.fillText('QA PAYMENT RECEIPT',10,60);return [...new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())];});
  await page.locator('[name=proof]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from(bytes)});await page.getByRole('button',{name:'Submit payment proof',exact:true}).click();await page.getByRole('heading',{name:'Your payment is under review'}).waitFor();
  assert.equal(uploads.length,1);assert.equal((await h.order(created.id)).payment_status,'under_review');
  const paid=await h.action('approve_payment',await h.order(created.id));assert.equal(paid.total_cents,created.total_cents);
  await page.locator('#refresh-order').click();await page.getByRole('heading',{name:'Payment approved',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(out,`paid-${width}-${method}.png`),fullPage:true});
  results.push({width,method,guest,total_cents:created.total_cents,receipt:uploads[0].type,checks:'Checkout, promo, totals, stock, payment methods, PNG-to-WebP proof, approval'});console.log('PASS browser checkout '+width+'px '+method+' '+(guest?'guest':'verified account'));
  await ctx.close();
 }
}finally{await browser.close();await db.close();await writeFile(join(out,'report.json'),JSON.stringify(results,null,2));}
