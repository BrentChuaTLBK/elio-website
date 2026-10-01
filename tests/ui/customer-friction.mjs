import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {dateInManila,addDays} from '../../dist/assets/shop/shop-rules.js';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),out=join(project,'test-results/customer-friction'),origin='https://customer-friction.test';await mkdir(out,{recursive:true});
const date=addDays(dateInManila(),2),results=[];
const identity=id=>({user:{id,email:id+'@example.test',email_confirmed_at:'2026-09-01',user_metadata:{}},access_token:'test-session'});
function fixture(capacity=30){
 const flavors=['Vanilla','Chocolate'].map((name,i)=>({id:'flavor-'+i,slug:name.toLowerCase(),name,description:'Isolated test flavor',price_cents:0,active:true,in_rotation:true,collection_hidden:false,category_ids:['classic'],photos:[]}));
 const base={active:true,price_cents:10000,lead_days:0,min_quantity:1,photos:[],description:'Isolated test box',sort_order:0};
 const catalog={settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],cutoff_time:''},categories:[],zones:[],flavors,products:[{...base,id:'custom',name:'Build your own box',kind:'custom_box'},{...base,id:'fixed',name:'Vanilla box',kind:'set',flavor_contents:[{product_id:'flavor-0',quantity:3}]}],inventory:flavors.map(f=>({product_id:f.id,date,available:true,capacity,remaining:capacity}))};
 const collection={flavors,categories:[{id:'classic',name:'Classic'}],menus:[{month:date.slice(0,7)+'-01',published:true,flavor_ids:flavors.map(f=>f.id)}],current_month:date.slice(0,7)+'-01',next_month:addDays(date,32).slice(0,7)+'-01'};
 return {catalog,collection,session:null,orderError:null,orderGate:null,collectionGate:null,calls:[]};
}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function make({width=390,capacity=30,session=null,holdCollection=false}={}){
 const data=fixture(capacity);data.session=session;
 if(holdCollection)data.collectionGate=new Promise(r=>data.releaseCollection=r);
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),errors=[];
 await ctx.addInitScript(()=>{localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));});
 await ctx.exposeBinding('testAuth',async(_,{action})=>{if(action==='signin')data.session=identity('customer-1');if(action==='signout')data.session=null;return {data:{session:data.session,user:data.session?.user},error:null};});
 await ctx.exposeBinding('testRpc',async(_,{action,payload})=>{
  data.calls.push({action,payload});
  if(action==='catalog')return {data:structuredClone(data.catalog),error:null};
  if(action==='my_orders'){const id=data.session?.user.id;if(data.orderGate)await data.orderGate;if(data.orderError)return {data:null,error:data.orderError};return {data:[{id:'order-'+id,reference:'ELIO-'+id,fulfillment_date:date,method:'pickup',payment_status:'paid',total_cents:10000}],error:null};}
  if(action==='my_vouchers')return {data:{vouchers:[],total:0,counts:{available:0,used:0,expired:0}},error:null};
  if(action==='newsletter_settings')return {data:{enabled:false,own_status:'unsubscribed'},error:null};
  if(action==='account_access')return {data:{role:'customer'},error:null};
  if(action==='affiliate_status')return {data:{assigned:false},error:null};
  return {data:{},error:null};
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const callbacks=[];window.__authChange=(event,next)=>callbacks.forEach(fn=>fn(event,next));return {auth:{initialize:async()=>({}),getSession:()=>window.testAuth({action:'session'}),onAuthStateChange:fn=>{callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:()=>window.testAuth({action:'signin'}),signInWithOAuth:async({options})=>{window.__oauthReturn=options.redirectTo;return {data:{},error:null};},signOut:()=>window.testAuth({action:'signout'}),updateUser:()=>window.testAuth({action:'session'}),resetPasswordForEmail:async()=>({}),resend:async()=>({})},rpc:async(n,p)=>window.testRpc({action:p.p_action,payload:p.p_payload}),functions:{invoke:async()=>({data:{status:'not_subscribed'},error:null})}}}`});
  if(u.pathname==='/auth/v1/settings')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{"google":true}}'});
  if(u.pathname==='/rest/v1/rpc/shop_api'){const body=route.request().postDataJSON();if(body.p_action==='flavor_collection'){if(data.collectionGate)await data.collectionGate;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data.collection)});}return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});}
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
try{
 for(const width of [390,1440]){
  const t=await make({width}),{page,data}=t;await menu(page);await open(page);await choose(page,[['flavor-0',1],['flavor-1',1]]);await page.locator('#product-quantity').fill('2');await close(page);await open(page,'fixed');await close(page);await open(page);assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'1');assert.equal(await page.locator('#product-quantity').inputValue(),'2');
  await page.reload();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('[data-choice="flavor-1"]').inputValue(),'1');
  data.catalog.flavors[1].active=false;await page.reload();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('[data-choice="flavor-1"]').count(),0);assert.match(await page.locator('#product-error').innerText(),/saved choices.*no longer available/);assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'1');
  data.catalog.flavors[1].active=true;await page.reload();await page.locator('#product-dialog[open]').waitFor();await choose(page,[['flavor-0',1],['flavor-1',2]]);await page.locator('#product-quantity').fill('1');await add(page);await open(page);assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'0');await choose(page,[['flavor-1',2],['flavor-0',1]]);await add(page);
  assert.equal(await page.locator('#cart .cart-line').count(),1);assert.equal(await page.locator('#cart .quantity-control span').innerText(),'2');assert.match(await page.locator('#cart .grand-total').innerText(),/200\.00/);
  const plus=page.locator('#cart [data-delta="1"]');await plus.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');assert.equal(await page.locator('#cart .quantity-control span').innerText(),'4');assert.equal(await page.evaluate(()=>document.activeElement.dataset.delta),'1');
  await page.locator('#cart').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'basket-'+width+'.png')});await finish(t,'draft restore/revalidate/clear, identical basket merge and repeated keyboard use '+width);
 }
 {
  const t=await make({capacity:3}),{page}=t;await menu(page);await open(page,'fixed');await add(page);assert.equal(await page.locator('#cart [data-delta="1"]').isDisabled(),true);assert.match(await page.locator('#basket-quantity-limit-0').innerText(),/Vanilla.*Choose another date/);assert.equal(await page.locator('#checkout-button').isDisabled(),false);await page.locator('#cart').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'stock-limit-explained.png')});await finish(t,'stock limit explained without invalidating checkout');
 }
 {
  const t=await make({capacity:6}),{page}=t;await menu(page);await open(page,'fixed');await add(page);await open(page);await choose(page,[['flavor-0',1],['flavor-1',2]]);await add(page);assert.equal(await page.locator('[data-qty="0"][data-delta="1"]').isDisabled(),true);await page.locator('[data-remove="1"]').click();assert.equal(await page.locator('[data-qty="0"][data-delta="1"]').isDisabled(),false);await page.locator('[data-qty="0"][data-delta="1"]').click();assert.equal(await page.locator('[data-qty="0"][data-delta="1"]').isDisabled(),true);assert.equal(await page.evaluate(()=>document.activeElement.dataset.delta),'-1');await finish(t,'shared-flavor stock releases correctly and disabled controls keep usable focus');
 }
 {
  const t=await make(),{page}=t;await page.goto(origin+'/story.html');await menu(page);await open(page);await choose(page,[['flavor-0',1]]);assert.match(page.url(),/product=custom/);await page.goBack();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open);assert.equal(new URL(page.url()).pathname,'/order.html');await page.goForward();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'1');await page.keyboard.press('Escape');await page.waitForFunction(()=>!new URL(location.href).searchParams.has('product'));await open(page);await close(page);await page.goBack();assert.equal(new URL(page.url()).pathname,'/story.html');
  await page.goto(origin+'/order.html?product=custom');await page.locator('#product-dialog[open]').waitFor();await close(page);assert.equal(new URL(page.url()).pathname,'/order.html');await finish(t,'real browser Back/Forward, Escape, repeated closes and direct product links');
 }
 {
  const t=await make({holdCollection:true}),{page,data}=t;await menu(page);assert.ok(data.calls.some(c=>c.action==='catalog'));assert.equal(await page.locator('.shop-loading').count(),0);data.releaseCollection();await finish(t,'ordering catalog becomes usable while descriptive content is pending');
 }
 {
  const t=await make(),{page}=t;await page.goto(origin+'/flavors.html');await page.locator('#flavor-search:not(:disabled)').waitFor();await page.locator('[data-view="collection"]').click();await page.locator('[data-category="classic"]').click();await page.locator('#flavor-search').fill('Vanilla');await page.reload();await page.locator('#flavor-search:not(:disabled)').waitFor();assert.equal(await page.locator('#flavor-search').inputValue(),'Vanilla');assert.equal(await page.locator('[aria-selected="true"][role="tab"]').getAttribute('data-view'),'collection');assert.equal(await page.locator('[data-category="classic"]').getAttribute('aria-pressed'),'true');await page.goto(origin+'/flavors.html#flavor-chocolate');await page.waitForFunction(()=>document.activeElement?.dataset.flavor==='chocolate');assert.equal(await page.locator('#flavor-search').inputValue(),'');assert.match(await page.locator('#filter-status').innerText(),/flavor/i);await finish(t,'flavor browse state survives reload and explicit flavor links take priority');
 }
 {
  const t=await make(),{page}=t;await page.goto(origin+'/account.html?next=order.html');await page.locator('#account-submit:not(:disabled)').waitFor();await page.locator('[name="email"]').fill('customer@example.test');await page.locator('[name="password"]').fill('local-test-only');await page.locator('#account-submit').click();await page.waitForURL('**/order.html#your-basket');await finish(t,'password sign-in returns to the shop basket');
 }
 {
  const t=await make(),{page,data}=t;await page.goto(origin+'/account.html?next=order.html');await page.locator('#google-signin:not(:disabled)').waitFor();await page.locator('#google-signin').click();await page.waitForFunction(()=>window.__oauthReturn);assert.equal(await page.evaluate(()=>window.__oauthReturn),origin+'/account.html');data.session=identity('oauth-customer');await page.goto(origin+'/account.html#access_token=test');await page.waitForURL('**/order.html#your-basket');await finish(t,'OAuth callback keeps its allowlisted URL and resumes the shop intent');
 }
 {
  const t=await make({session:identity('customer-1')}),{page}=t;await page.goto(origin+'/account.html?next=https://untrusted.example');await page.locator('.account-order').waitFor();assert.equal(new URL(page.url()).pathname,'/account.html');await finish(t,'untrusted return destinations remain on the account page');
 }
 {
  const t=await make({session:identity('customer-1')}),{page,data}=t;await page.goto(origin+'/account.html');await page.locator('.account-order').waitFor();data.orderError={message:'Connection interrupted',code:'PGRST000'};let release;data.orderGate=new Promise(r=>release=r);await page.locator('[data-orders-refresh]').click();assert.equal(await page.locator('.account-order').count(),1);release();data.orderGate=null;await page.locator('#account-orders [role="alert"]').waitFor();assert.equal(await page.locator('.account-order').count(),1);assert.match(await page.locator('#account-orders [role="alert"]').innerText(),/last loaded details/);
  data.orderError={message:'Sign in required',code:'42501'};await page.locator('[data-orders-refresh]').click();await page.waitForFunction(()=>document.querySelector('#account-orders').getAttribute('aria-busy')==='false');assert.equal(await page.locator('.account-order').count(),0);
  data.orderError=null;await page.locator('[data-orders-refresh]').click();await page.locator('.account-order').waitFor();data.orderGate=new Promise(r=>release=r);await page.locator('[data-orders-refresh]').click();data.session=null;await page.evaluate(()=>window.__authChange('SIGNED_OUT',null));release();data.orderGate=null;await page.waitForTimeout(100);assert.equal(await page.locator('.account-order').count(),0);assert.equal(await page.locator('#signed-in').isHidden(),true);await finish(t,'refresh retains same-user cards on network failure and clears them on authorization loss/sign-out');
 }
 {
  const t=await make({session:identity('customer-1')}),{page,data}=t;await page.goto(origin+'/account.html');await page.locator('.account-order').waitFor();data.session=identity('customer-2');await page.evaluate(session=>window.__authChange('SIGNED_IN',session),data.session);await page.getByText('ELIO-customer-2',{exact:true}).waitFor();assert.equal(await page.getByText('ELIO-customer-1',{exact:true}).count(),0);await finish(t,'switching account identity removes the previous customer’s order cards');
 }
 await writeFile(join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log('PASS all customer-friction browser scenarios');
}finally{await browser.close();}
