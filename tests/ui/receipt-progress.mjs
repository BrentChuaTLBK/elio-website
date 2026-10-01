import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {makeHarness} from '../backend/helpers.mjs';
import {accountingFixture} from '../backend/accounting-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT,'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),root=resolve('dist'),origin='https://receipt-progress.test',out=resolve('test-results/receipt-progress');await mkdir(out,{recursive:true});
await db.exec(await readFile('tests/backend/bootstrap.sql','utf8'));
for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(join('supabase/migrations',name),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
const h=await makeHarness(db),results=[],errors=[];let chain=Promise.resolve();const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
await db.query('update elio.settings set data=data||$1::jsonb',[JSON.stringify({site_url:origin,paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],cutoff_time:'',newsletter_enabled:false,payment_options:[{label:'Sample bank',account_name:'Elio Sample',account_number:'0000123'}]})]);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block'});
 let mode='success',readsFail=false,displayExpiry=false,held=null,calls=[],uploaded=[],commits=0;
 const hold=()=>{let start,release;const started=new Promise(r=>start=r),wait=new Promise(r=>release=r);held={start,wait};return {started,release};};
 await ctx.exposeBinding('receiptRpc',async(_,{action,payload,token})=>serial(async()=>{calls.push(action);if(action==='get_order'&&readsFail)return {data:null,error:{message:'Simulated status connection failure'}};try{const data=await h.api(action,payload,null,token);if(action==='get_order'&&displayExpiry)data.payment_deadline=new Date(Date.now()+1200).toISOString();return {data,error:null};}catch(e){return {data:null,error:{message:e.message}};}}));
 await ctx.exposeBinding('receiptUpload',async(_,{fields,file})=>{calls.push('upload');const block=held;held=null;if(block){block.start();await block.wait;}return serial(async()=>{
  uploaded.push(file);if(mode==='network')return {data:null,error:{message:'Connection interrupted'}};
  try{
   if(mode==='expired')await db.query("update elio.orders set payment_deadline=statement_timestamp()-interval '1 minute' where id=$1",[fields.order_id]);
   const order=await h.service('commit_proof',{...fields,path:fields.order_id+'/'+randomUUID()+'.webp'});commits++;
   if(['lost','lost-unreadable','refresh-failure'].includes(mode))readsFail=mode!=='lost';
   if(mode.startsWith('lost'))return {data:null,error:{message:'Connection interrupted after submission'}};
   return {data:{order},error:null};
  }catch(e){return {data:null,error:{message:e.message}};}
 });});
 await ctx.addInitScript(()=>{
  localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));
  const WorkerOriginal=window.Worker;window.Worker=class extends WorkerOriginal{postMessage(...args){if(window.__holdPreparation)window.__continuePreparation=()=>super.postMessage(...args);else super.postMessage(...args);}};
 });
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{}},rpc:async(n,p)=>window.receiptRpc({action:p.p_action,payload:p.p_payload,token:p.p_token}),functions:{invoke:async(n,{body})=>{const f=body.get('file');return window.receiptUpload({fields:Object.fromEntries([...body].filter(([k])=>k!=='file')),file:{name:f.name,type:f.type,bytes:[...new Uint8Array(await f.arrayBuffer())]}})}}}}`});if(u.origin!==origin)return route.abort();const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const start=async(next='success')=>{mode=next;readsFail=false;displayExpiry=false;calls=[];uploaded=[];commits=0;const f=await accountingFixture(h),order=await h.api('create_order',h.checkout(f.product,f.date),null);await page.evaluate(()=>window.__holdPreparation=false);await page.goto(origin+'/order.html#order='+order.id+'&token='+order.access_token);await page.getByRole('heading',{name:order.reference,exact:true}).waitFor();await page.locator('#proof-form').waitFor();return {order,...f};};
 await start();
 const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=360;c.height=160;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,360,160);x.fillStyle='black';x.font='24px Arial';x.fillText('SAMPLE RECEIPT',15,60);return [...new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())];});
 const choose=async(data=bytes,name='receipt.png',mimeType='image/png')=>{await page.locator('[name=proof]').setInputFiles({name,mimeType,buffer:Buffer.from(data)});await page.locator('[name=payment_reference]').fill('SAMPLE-REF');};
 const submit=()=>page.locator('#proof-form [type=submit]').click(),received=()=>page.getByRole('heading',{name:'Your payment is under review',exact:true}).waitFor();
 // Hold real worker preparation and the request separately. The visible timer expires meanwhile.
 // Select first, then refresh: the real input now survives the read. Wait for
 // that read to settle and submit immediately so scrolling cannot consume the
 // deliberately short deadline before this in-flight-expiry scenario starts.
 await choose();await page.evaluate(()=>window.__holdPreparation=true);const request=hold();displayExpiry=true;await page.locator('#refresh-order').click();await page.waitForFunction(()=>document.querySelector('#refresh-order')?.disabled===false);await page.locator('#proof-form').evaluate(form=>form.requestSubmit());await page.getByText('Preparing your receipt…',{exact:true}).waitFor();
 assert.equal(await page.locator('#proof-form input:enabled').count(),0);assert(await page.locator('#refresh-order').isDisabled());await page.locator('#proof-form').evaluate(f=>f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));assert.equal(calls.filter(c=>c==='upload').length,0);
 const reads=calls.filter(c=>c==='get_order').length;await page.waitForTimeout(2500);assert.equal(calls.filter(c=>c==='get_order').length,reads);assert(await page.locator('#proof-form').isVisible());
 await page.evaluate(()=>window.__continuePreparation());await request.started;await page.getByText('Uploading your receipt…',{exact:true}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);if(width===390)await page.locator('#proof-form').screenshot({path:join(out,'uploading-phone.png')});}
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.receipt-spinner').evaluate(el=>getComputedStyle(el).animationName),'none');displayExpiry=false;request.release();await received();assert.equal(commits,1);assert.equal(uploaded[0].type,'image/webp');results.push('Real preparation/upload stages, duplicate-click guard, controls, timer expiry, four widths, reduced motion and server-confirmed review.');
 await start();await choose([1,2,3],'receipt.pdf','application/pdf');await submit();await page.locator('#proof-error').filter({hasText:'Choose a JPEG'}).waitFor();assert.equal(calls.filter(c=>c==='upload').length,0);assert(await page.locator('#proof-form [type=submit]').isEnabled());results.push('Unsupported input rejected before conversion/request.');
 await choose([1,2,3]);await submit();await page.locator('#proof-error').filter({hasText:'couldn’t prepare'}).waitFor();assert.equal(calls.filter(c=>c==='upload').length,0);assert.equal(await page.locator('[name=payment_reference]').inputValue(),'SAMPLE-REF');results.push('Conversion failure restores controls and keeps file/reference.');
 const retry=await start('network');await choose();await submit();await page.locator('#proof-error').filter({hasText:'Connection interrupted'}).waitFor();assert.equal(await page.locator('[name=proof]').evaluate(el=>el.files[0].name),'receipt.png');assert.equal((await h.order(retry.order.id)).payment_status,'awaiting_payment');mode='success';await submit();await received();assert.equal(commits,1);assert.equal(uploaded.length,2);assert.equal(createHash('sha256').update(Buffer.from(uploaded[0].bytes)).digest('hex'),createHash('sha256').update(Buffer.from(uploaded[1].bytes)).digest('hex'));results.push('Network failure preserves values; retry reuses identical converted bytes and commits once.');
 await start('lost');await choose();await submit();await received();assert.equal(commits,1);assert.equal(uploaded.length,1);results.push('Lost successful response reconciles against current order without a second upload.');
 await start('lost-unreadable');await choose();await submit();await page.getByRole('button',{name:'Check upload status',exact:true}).waitFor();await submit();await page.getByRole('button',{name:'Check upload status',exact:true}).waitFor();assert.equal(uploaded.length,1);readsFail=false;await submit();await received();assert.equal(uploaded.length,1);results.push('Uncertain receipt with failed reads must recheck before retry; no second upload.');
 await start('refresh-failure');await choose();await submit();await page.locator('#proof-progress').filter({hasText:'we couldn’t refresh'}).waitFor();assert(await page.getByRole('button',{name:'Receipt received',exact:true}).isDisabled());assert(await page.locator('#refresh-order').isEnabled());assert.equal(commits,1);readsFail=false;await page.locator('#refresh-order').click();await received();results.push('Accepted receipt remains confirmed when refresh fails; refresh recovers without resubmission.');
 await start('expired');await choose();await submit();await page.getByRole('heading',{name:'Order closed',exact:true}).waitFor();assert.equal(commits,0);assert.equal(await page.locator('#proof-form').count(),0);results.push('Server expiry cannot display receipt acceptance or allow another upload.');
 assert.deepEqual(errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log(`PASS ${results.length} receipt-progress scenarios with real conversion and isolated database.`);
}finally{await browser.close();await db.close();}
