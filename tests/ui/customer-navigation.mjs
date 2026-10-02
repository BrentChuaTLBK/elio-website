import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {dateInManila,addDays} from '../../dist/assets/shop/shop-rules.js';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),out=join(project,'test-results/customer-navigation'),origin='https://customer-navigation.test';await mkdir(out,{recursive:true});
const date=addDays(dateInManila(),2),results=[];
const identity=id=>({user:{id,email:id+'@example.test',email_confirmed_at:'2026-09-01',user_metadata:{}},access_token:'test-session'});
function fixture(capacity=30){
 const flavors=['Vanilla','Chocolate'].map((name,i)=>({id:'flavor-'+i,slug:name.toLowerCase(),name,description:'Isolated test flavor',price_cents:0,active:true,in_rotation:true,collection_hidden:false,category_ids:['classic'],photos:[]}));
 const base={active:true,price_cents:10000,lead_days:0,min_quantity:1,photos:[],description:'Isolated test box',sort_order:0};
 const catalog={settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],cutoff_time:''},categories:[],zones:[],flavors,products:[{...base,id:'custom',name:'Build your own box',kind:'custom_box'},{...base,id:'fixed',name:'Vanilla box',kind:'set',flavor_contents:[{product_id:'flavor-0',quantity:3}]}],inventory:flavors.map(f=>({product_id:f.id,date,available:true,capacity,remaining:capacity}))};
 const collection={flavors,categories:[{id:'classic',name:'Classic'}],menus:[{month:date.slice(0,7)+'-01',published:true,flavor_ids:flavors.map(f=>f.id)}],current_month:date.slice(0,7)+'-01',next_month:addDays(date,32).slice(0,7)+'-01'};
 return {catalog,collection,session:null,orderError:null,orderGate:null,collectionGate:null,calls:[]};
}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
async function make({width=Number(process.env.AUDIT_WIDTH||390),capacity=30,session=null,holdCollection=false,initFailure=false,newsletterHold=false}={}){
 const data=fixture(capacity);data.session=session;data.authFailure=initFailure;data.authInitializations=0;data.signedIn=false;data.newsletterHold=newsletterHold;
 data.catalog.settings.pickup_address='Sample kitchen — fixture only';data.catalog.settings.pickup_hours='10 AM–5 PM';
 data.order={id:'sample-order',reference:'ELIO-AUDIT-SAMPLE',method:'pickup',fulfillment_date:date,created_at:new Date().toISOString(),payment_status:'paid',fulfillment_status:'confirmed',paid_amount_cents:10000,buyer:{name:'Sample customer',email:'sample@example.test',phone:'09170000000'},items:[{product_id:'fixed',name:'Vanilla box',quantity:1,selections:{},unit_price_cents:10000,line_total_cents:10000}],subtotal_cents:10000,discount_cents:0,delivery_cents:0,total_cents:10000,pickup_address:'Sample kitchen — fixture only',pickup_hours:'10 AM–5 PM',history:[]};
 if(newsletterHold)data.newsletterGate=new Promise(resolve=>data.releaseNewsletter=resolve);
 if(holdCollection)data.collectionGate=new Promise(r=>data.releaseCollection=r);
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),errors=[];
 await ctx.addInitScript(()=>{localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));});
 await ctx.exposeBinding('testAuth',async(_,{action})=>{if(action==='initialize'){data.authInitializations++;return data.authFailure?{error:{message:'Temporary startup connection failure'}}:{};}if(action==='signin'){data.session=identity('customer-1');data.signedIn=true;}if(action==='signout')data.session=null;return {data:{session:data.session,user:data.session?.user},error:null};});
 await ctx.exposeBinding('auditEdge',async(_,{body})=>{if(body?.action==='activate_account'){data.newsletterCalled=true;if(data.newsletterGate)await data.newsletterGate;}return {data:{status:'not_subscribed'},error:null};});
 await ctx.exposeBinding('testRpc',async(_,{action,payload})=>{
  data.calls.push({action,payload});
  if(action==='get_order')return data.orderReadError?{data:null,error:data.orderReadError}:{data:structuredClone(data.order),error:null};
  if(action==='quote'){const total=data.priceChanged?11000:10000;return {data:{...structuredClone(data.order),buyer:payload.buyer,items:[{...data.order.items[0],unit_price_cents:total,line_total_cents:total}],subtotal_cents:total,total_cents:total},error:null};}
  if(action==='create_order'){
   data.creates=(data.creates||0)+1;if(data.createGate)await data.createGate;
   if(data.savedOrder)return {data:data.savedOrder,error:null};
   const total=data.priceChanged?11000:10000;
   if(payload.expected_quote.total_cents!==total)return {data:null,error:{message:'Prices or availability changed since review. Review your order again.',code:'P0001'}};
   data.savedOrder={...structuredClone(data.order),total_cents:total,subtotal_cents:total,paid_amount_cents:total,access_token:'fixture-only'};
   if(data.loseCreateResponse)return {data:null,error:{message:'Connection interrupted after saving'}};
   return {data:data.savedOrder,error:null};
  }
  if(action==='catalog')return {data:structuredClone(data.catalog),error:null};
  if(action==='my_orders'){const id=data.session?.user.id;if(data.orderGate)await data.orderGate;if(data.orderError)return {data:null,error:data.orderError};return {data:[{id:'order-'+id,reference:'ELIO-'+id,fulfillment_date:date,method:'pickup',payment_status:'paid',total_cents:10000}],error:null};}
  if(action==='my_vouchers'){const vouchers=structuredClone(data.vouchers||[]),error=data.voucherError;if(data.voucherGate)await data.voucherGate;return {data:{vouchers,total:vouchers.length,counts:{available:vouchers.length,used:0,expired:0}},error};}
  if(action==='newsletter_settings')return {data:{enabled:true,discount_percent:5,own_status:'unsubscribed'},error:null};
  if(action==='account_access')return {data:{role:'customer'},error:null};
  if(action==='affiliate_status')return {data:{assigned:false},error:null};
  return {data:{},error:null};
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const callbacks=[];window.__authChange=(event,next)=>callbacks.forEach(fn=>fn(event,next));return {auth:{initialize:()=>window.testAuth({action:'initialize'}),getSession:()=>window.testAuth({action:'session'}),onAuthStateChange:fn=>{callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:()=>window.testAuth({action:'signin'}),signInWithOAuth:async({options})=>{window.__oauthReturn=options.redirectTo;return {data:{},error:null};},signOut:()=>window.testAuth({action:'signout'}),updateUser:()=>window.testAuth({action:'session'}),resetPasswordForEmail:async()=>({}),resend:async()=>({})},rpc:async(n,p)=>window.testRpc({action:p.p_action,payload:p.p_payload}),functions:{invoke:async(name,{body})=>{window.__newsletterWaiting=body?.action==='activate_account';return window.auditEdge({name,body});}}}}`});
  if(u.pathname==='/auth/v1/settings'){data.providerRequested=true;if(data.providerGate)await data.providerGate;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{"google":true}}'});}
  if(u.pathname==='/rest/v1/rpc/shop_api'){const body=route.request().postDataJSON();if(body.p_action==='flavor_collection'){if(data.collectionGate)await data.collectionGate;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data.collection)});}return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});}
  if(u.pathname==='/wallet.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/admin/ordering.css"><link rel="stylesheet" href="/assets/admin/account.css"><link rel="stylesheet" href="/assets/vouchers.css"><body class="customer-account-page"><main class="customer-account account-dashboard"><div id="wallet"></div></main><script type="module">import {mountVouchers} from "/assets/admin/vouchers.js";window.wallet=mountVouchers(document.querySelector("#wallet"));</script></body></html>'});
  if(u.origin!==origin)return route.abort();const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page,data,errors};
}
const menu=async page=>{await page.goto(origin+'/order.html');await page.locator('#product-grid [data-product]').first().waitFor();};
const open=async(page,id='custom')=>{await page.locator('[data-product="'+id+'"]').click();await page.locator('#product-dialog[open]').waitFor();};
const close=async page=>{await page.locator('[aria-label="Close product"]').click();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));};
const choose=async(page,values)=>{for(const [id,n] of values)await page.locator('[data-choice="'+id+'"]').fill(String(n));};
const add=async page=>{await page.locator('#add-to-cart').click();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));};
const finish=async(test,name)=>{assert.deepEqual(test.errors,[]);assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);results.push(name);console.log('PASS '+name);await test.ctx.close();};
const checkout=async page=>{await page.locator('#checkout-button').click();for(const [name,value]of Object.entries({buyer_name:'Sample customer',buyer_email:'sample@example.test',buyer_phone:'09170000000'}))await page.locator('[name='+name+']').fill(value);await page.locator('[name=social_platform]').selectOption('na');await page.locator('#review-order').click();await page.locator('#place-order').waitFor();};
const vouchers=()=>[0,1].map(i=>({id:'voucher-'+i,title:i?'A little thank-you':'Your welcome treat',code:'DEMO'+i,source:'newsletter',status:'available',kind:'percent',value:5,min_subtotal_cents:50000,cap_cents:10000,expires_at:'2030-10-10T12:00:00+08:00'}));
try{
 for(const width of [390,1440]){
  {
   const t=await make({width}),{page}=t;await page.goto(origin+'/story.html');await menu(page);await open(page,'fixed');await add(page);await checkout(page);
   await page.goBack();await page.locator('#checkout-form').waitFor();assert.equal(new URL(page.url()).pathname,'/order.html');assert.equal(await page.locator('[name=buyer_name]').inputValue(),'Sample customer');assert.equal(await page.locator('#cart .cart-line').count(),1);
   await page.goForward();await page.locator('#place-order').waitFor();await page.goBack();await page.locator('[name=buyer_name]').fill('Edited buyer');await page.goForward();await page.locator('#checkout-form').waitFor();assert.equal(await page.locator('[name=buyer_name]').inputValue(),'Edited buyer');assert.equal(await page.locator('#place-order').count(),0,'Forward must not reuse a quote after edits');await page.locator('#review-order').click();await page.locator('#place-order').waitFor();
   await page.locator('[aria-label="Close review"]').click();await page.waitForFunction(()=>!document.querySelector('#checkout-dialog').open);await page.goBack();assert.equal(new URL(page.url()).pathname,'/story.html','Closing removes every owned checkout entry');await menu(page);await page.locator('#checkout-button').click();await page.locator('#checkout-form').waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#checkout-dialog').open);await page.goBack();assert.equal(new URL(page.url()).pathname,'/story.html');await finish(t,'CF20 native Back/Forward, edited quote invalidation, close and Escape '+width);
  }
  {
   const t=await make({width}),{page,data}=t;await page.goto(origin+'/story.html');await menu(page);await open(page,'fixed');await add(page);await checkout(page);let release;data.createGate=new Promise(r=>release=r);await page.locator('#place-order').click();await page.waitForFunction(()=>document.querySelector('#place-order').disabled);await page.goBack();await page.waitForFunction(()=>history.state?.elioCheckout?.step==='review');assert.equal(await page.locator('#place-order').count(),1);assert.equal(data.creates,1);release();await page.getByRole('heading',{name:'ELIO-AUDIT-SAMPLE',exact:true}).waitFor();assert.equal(await page.locator('#checkout-dialog').evaluate(el=>el.open),false);await page.goBack();await page.locator('#checkout-button').waitFor();assert.equal(await page.locator('#checkout-dialog').evaluate(el=>el.open),false);assert.equal(await page.locator('#cart .cart-line').count(),0);await page.goForward();await page.getByRole('heading',{name:'ELIO-AUDIT-SAMPLE',exact:true}).waitFor();assert.equal(data.creates,1);await finish(t,'CF20 pending save blocks Back and saved order removes checkout history '+width);
  }
  {
   const t=await make({width,session:identity('customer-1')}),{page,data}=t;data.providerGate=new Promise(r=>data.releaseProvider=r);await page.goto(origin+'/account.html');await page.locator('.account-order').waitFor();assert(data.providerRequested);assert.equal(await page.locator('#signed-in').isVisible(),true);assert(data.calls.some(c=>c.action==='my_orders'));data.releaseProvider();await finish(t,'CF21 existing signed-in account loads while optional provider check waits '+width);
  }
  {
   const t=await make({width,session:identity('customer-1'),newsletterHold:true}),{page,data}=t;data.vouchers=vouchers();await page.goto(origin+'/account.html');await page.locator('[data-voucher-details]').first().click();const dialog=page.locator('.voucher-details-dialog');await dialog.locator('[data-voucher-copy]').focus();const count=data.calls.filter(c=>c.action==='my_vouchers').length;data.vouchers[0].value=8;data.releaseNewsletter();await page.waitForFunction(()=>document.querySelector('.voucher-details-dialog')?.textContent.includes('8% off'));assert(data.calls.filter(c=>c.action==='my_vouchers').length>count);assert(await dialog.locator('[data-voucher-copy]').evaluate(el=>el===document.activeElement));await dialog.screenshot({path:join(out,'voucher-refresh-'+width+'.png')});await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await page.locator('[data-voucher-details]').first().evaluate(el=>el===document.activeElement));await finish(t,'CF22 automatic account refresh preserves open voucher, updated value and focus '+width);
  }
  {
   const t=await make({width,session:identity('customer-1')}),{page,data}=t;data.vouchers=vouchers();await page.goto(origin+'/wallet.html');await page.locator('[data-voucher-details]').first().click();data.voucherError={message:'Temporarily unavailable',status:503};await page.evaluate(()=>wallet.refresh());assert.match(await page.locator('.voucher-details-dialog').innerText(),/last loaded details/);data.voucherError=null;data.vouchers.shift();await page.evaluate(()=>wallet.refresh());assert.match(await page.locator('.voucher-details-dialog').innerText(),/no longer in this list/);assert.equal(await page.locator('.voucher-details-dialog .voucher-actions a').count(),0);data.voucherError={message:'Access denied',status:403,code:'42501'};await page.evaluate(()=>wallet.refresh());assert.equal(await page.locator('.voucher-details-dialog').count(),0);data.voucherError=null;data.vouchers=vouchers();await page.evaluate(()=>wallet.refresh());await page.locator('[data-voucher-details]').first().click();let release;data.voucherGate=new Promise(r=>release=r);await page.evaluate(()=>{void wallet.refresh();wallet.destroy();});release();await page.waitForTimeout(50);assert.equal(await page.locator('.voucher-details-dialog').count(),0);assert.equal(await page.locator('#wallet').innerText(),'');await finish(t,'CF22 temporary failure, missing voucher, access denial and pending teardown '+width);
  }
 }
 await writeFile(join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));
}finally{await browser.close();}
