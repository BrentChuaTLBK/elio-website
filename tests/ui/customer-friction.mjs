import assert from 'node:assert/strict';
import {choose} from './trio-controls.mjs';
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
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
async function make({width=390,capacity=30,session=null,holdCollection=false,reducedMotion='reduce',motionProbe=false,newsletterPopup=false,touch=false}={}){
 const data=fixture(capacity);data.session=session;
 if(motionProbe)for(let i=0;i<3;i++)data.catalog.products.push({...data.catalog.products[1],id:'row-fixture-'+i,name:'Extra box '+i,sort_order:i+1});
 if(holdCollection)data.collectionGate=new Promise(r=>data.releaseCollection=r);
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion,hasTouch:touch,isMobile:touch,serviceWorkers:'block'}),errors=[];
 await ctx.addInitScript(showPopup=>{
  if(!showPopup)localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));
  localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));
 },newsletterPopup);
 if(motionProbe)await ctx.addInitScript(()=>{
  const animate=Element.prototype.animate;window.__selectedMotion=[];
  Element.prototype.animate=function(frames,options){
   const kind=this.matches('#product-grid [data-product]')?'row':this.matches('#home-box-viewport [data-home-box]')?'home-row':this.matches('[data-store-section]')?'section':this.matches('.quick-cart-shell')?'panel':'';
   if(kind)window.__selectedMotion.push({kind,delay:options?.delay||0,duration:options?.duration,section:this.dataset.storeSection});
   return animate.call(this,frames,options);
  };
 });
 await ctx.exposeBinding('testAuth',async(_,{action})=>{if(action==='signin')data.session=identity('customer-1');if(action==='signout')data.session=null;return {data:{session:data.session,user:data.session?.user},error:null};});
 await ctx.exposeBinding('testRpc',async(_,{action,payload})=>{
  data.calls.push({action,payload});
  if(action==='catalog')return {data:structuredClone(data.catalog),error:null};
  if(action==='my_orders'){const id=data.session?.user.id;if(data.orderGate)await data.orderGate;if(data.orderError)return {data:null,error:data.orderError};return {data:[{id:'order-'+id,reference:'ELIO-'+id,fulfillment_date:date,method:'pickup',payment_status:'paid',total_cents:10000}],error:null};}
  if(action==='my_vouchers')return {data:{vouchers:[],total:0,counts:{available:0,used:0,expired:0}},error:null};
  if(action==='newsletter_settings')return {data:newsletterPopup?{enabled:true,popup_delay_ms:50}:{enabled:false,own_status:'unsubscribed'},error:null};
  if(action==='account_access')return {data:{role:'customer'},error:null};
  if(action==='affiliate_status')return {data:{assigned:false},error:null};
  return {data:{},error:null};
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const callbacks=[];window.__authChange=(event,next)=>callbacks.forEach(fn=>fn(event,next));return {auth:{initialize:async()=>({}),getSession:()=>window.testAuth({action:'session'}),onAuthStateChange:fn=>{callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:()=>window.testAuth({action:'signin'}),signInWithOAuth:async({options})=>{window.__oauthReturn=options.redirectTo;window.__oauthPrompt=options.queryParams?.prompt;return {data:{},error:null};},signOut:()=>window.testAuth({action:'signout'}),updateUser:()=>window.testAuth({action:'session'}),resetPasswordForEmail:async()=>({}),resend:async()=>({})},rpc:async(n,p)=>window.testRpc({action:p.p_action,payload:p.p_payload}),functions:{invoke:async(name,{body})=>({data:name==='newsletter'&&body?.action==='subscribe'?{accepted:true}:{status:'not_subscribed'},error:null})}}}`});
  if(u.pathname==='/auth/v1/settings'){
   if(data.googleGate)await data.googleGate;
   const status=data.failGoogleOnce?503:200;data.failGoogleOnce=false;
   return route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{"google":true}}'});
  }
  if(u.pathname==='/rest/v1/rpc/shop_api'){const body=route.request().postDataJSON();if(body.p_action==='flavor_collection'){if(data.collectionGate)await data.collectionGate;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data.collection)});}return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});}
  if(u.origin!==origin)return route.abort();const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page,data,errors};
}
const menu=async page=>{await page.goto(origin+'/order.html');await page.locator('#product-grid [data-product]').first().waitFor();assert.equal(await page.locator('#fulfillment-date-label').innerText(),'Choose your date');};
const open=async(page,id='custom')=>{await page.locator('[data-product="'+id+'"]').click();await page.locator('#product-dialog[open]').waitFor();};
const close=async page=>{await page.locator('[aria-label="Close product"]').click();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));};
const add=async page=>{await page.locator('#add-to-cart').click();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));};
const finish=async(test,name)=>{assert.deepEqual(test.errors,[]);assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);results.push(name);console.log('PASS '+name);await test.ctx.close();};
try{
 for(const scenario of [
  {path:'index.html',width:1440,close:'Escape'},
  {path:'order.html',width:390,close:'X'},
  {path:'flavors.html',width:390,close:'Continue exploring'},
  {path:'index.html',width:320,close:'X',reduce:true},
 ]){
  const {path,width,close,reduce}=scenario;
  const test=await make({width,newsletterPopup:true,reducedMotion:reduce?'reduce':'no-preference'});
  const {page}=test;await page.goto(origin+'/'+path);
  const popup=page.locator('#elio-newsletter-dialog');
  await popup.waitFor();
  assert(parseFloat(await popup.evaluate(el=>getComputedStyle(el).borderRadius))>=18);
  if(close==='Continue exploring'){
   await popup.getByLabel('Email address').fill('reader@example.test');
   await popup.getByRole('button',{name:'Join',exact:true}).click();
   await popup.getByRole('button',{name:close}).waitFor();
  }
  await popup.evaluate(el=>Promise.allSettled(el.getAnimations({subtree:true}).map(a=>a.finished)));
  // Sample the middle of the actual exit, independently of browser frame rate.
  await popup.evaluate(el=>{
   const sample=()=>queueMicrotask(()=>{
    const transitions=el.getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition);
    for(const a of transitions){a.pause();a.currentTime=a.effect.getTiming().duration/2;}
    window.newsletterExit={open:el.open,opacity:Number(getComputedStyle(el).opacity),
     backdrop:Number(getComputedStyle(el,'::backdrop').opacity),scale:new DOMMatrixReadOnly(getComputedStyle(el).transform).a};
    transitions.forEach(a=>a.play());
   });
   el.addEventListener('click',sample,{once:true});
   el.addEventListener('cancel',sample,{once:true});
  });
  if(close==='Escape')await page.keyboard.press('Escape');
  else await popup.getByRole('button',{name:close==='X'?'Close newsletter signup':close}).click();
  await popup.waitFor({state:'hidden'});
  const frame=await page.evaluate(()=>window.newsletterExit);
  if(reduce)assert.equal(frame.open,false);
  else{
   assert.equal(frame.open,true,'The popup remains modal during the fade');
   assert(frame.opacity>.1&&frame.opacity<.9&&frame.backdrop>.1&&frame.backdrop<.9,'Card and backdrop fade together');
   assert(frame.scale<1&&frame.scale>=.98,'The card recedes slightly');
  }
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('elio-newsletter-popup-v1')).state);
  assert.equal(saved,close==='Continue exploring'?'submitted':'dismissed');
  await page.reload();assert.equal(await page.locator('#elio-newsletter-dialog[open]').count(),0);
  await finish(test,'Newsletter dismissal via '+close+' at '+width+'px');
 }
 for(const [width,id,action,reduce] of [
  [1440,'fixed','click',false],[768,'custom','keyboard',false],
  [390,'custom','tap',false],[320,'fixed','tap',true],
 ]){
  const test=await make({width,touch:action==='tap',reducedMotion:reduce?'reduce':'no-preference'});
  const {page}=test;await menu(page);
  const dialog=page.locator('#product-dialog'),card=page.locator('[data-product="'+id+'"]');
  await dialog.evaluate(panel=>{
   const observer=new MutationObserver(()=>{
    if(!panel.open)return;
    observer.disconnect();
    const transitions=panel.getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition);
    for(const a of transitions){a.pause();a.currentTime=a.effect.getTiming().duration/2;}
    const style=getComputedStyle(panel),matrix=new DOMMatrixReadOnly(style.transform);
    window.boxEntry={modal:panel.matches(':modal'),opacity:Number(style.opacity),
     backdrop:Number(getComputedStyle(panel,'::backdrop').opacity),scale:matrix.a,offset:matrix.f};
    transitions.forEach(a=>a.play());
   });
   observer.observe(panel,{attributes:true,attributeFilter:['open']});
  });
  if(action==='keyboard')await card.press('Enter');
  else if(action==='tap')await card.tap();
  else await card.click();
  await page.waitForFunction(()=>Boolean(window.boxEntry));
  const frame=await page.evaluate(()=>window.boxEntry);
  assert.equal(frame.modal,true);
  if(reduce)assert.deepEqual(frame,{modal:true,opacity:1,backdrop:1,scale:1,offset:0});
  else{
   assert(Math.abs(frame.opacity-.5)<.05&&Math.abs(frame.backdrop-frame.opacity)<.05,'Panel and backdrop fade together');
   assert(Math.abs(frame.scale-.99)<.002&&Math.abs(frame.offset-2.5)<.2,'Box opens with the newsletter’s subtle scale and rise');
  }
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#product-dialog')).transform==='none');
  await page.locator('#product-quantity').fill('2');
  assert.equal(await dialog.evaluate(el=>el.getAnimations().length),0);
  await close(page);
  assert(await card.evaluate(el=>document.activeElement===el));
  await finish(test,'Box entrance with '+action+' at '+width+'px');
 }
 {
  const t=await make({width:768,touch:true}),{ctx,page}=t;
  let releaseCatalog;
  const delayed=new Promise(resolve=>{releaseCatalog=resolve;});
  await ctx.route('**/home-content.js',async route=>{await delayed;await route.fallback();});
  await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});
  try{
   await page.getByRole('button',{name:'Open navigation'}).tap();
   assert(await page.getByRole('link',{name:'Order a Box',exact:true}).isVisible());
  }finally{releaseCatalog();}
  await page.getByRole('link',{name:'Order a Box',exact:true}).tap();
  await page.waitForURL('**/order.html');
  await finish(t,'Home menu opens on the first tap while the catalog is loading');
 }
 for(const width of [320,768,900,1440]){
  const t=await make({width,touch:width<900}),{page}=t;
  await page.goto(origin+'/flavors.html');
  const header=page.getByRole('banner'),link=header.getByRole('link',{name:'Order a Box',exact:true});
  const button=await link.boundingBox(),logo=await header.locator('.wordmark').boundingBox(),icons=await header.locator('nav').boundingBox();
  assert(button&&button.height>=46&&button.x>=0&&button.x+button.width<=width);
  assert(button.y>=logo.y+logo.height||(button.x>=logo.x+logo.width&&button.x+button.width<=icons.x));
  if(width<900)await link.tap();else await link.press('Enter');
  await page.waitForURL('**/order.html');
  await finish(t,'Flavors header order button at '+width+'px');
 }
 for(const width of [320,390,1440]){
  const t=await make({width}),{page,data}=t;
  data.catalog.settings.delivery_blocked_dates=[date];
  await page.goto(origin+'/index.html?preview=1');
  if(width<600)await page.getByRole('button',{name:'Open navigation'}).click();
  const orderLink=page.getByRole('link',{name:'Order a Box',exact:true});
  assert.equal(await orderLink.getAttribute('href'),'order.html');
  assert((await orderLink.boundingBox()).height>=46);
  const appearance=await orderLink.evaluate(el=>{
   const s=getComputedStyle(el);
   return [s.backgroundColor,s.borderTopColor,s.borderRadius,s.fontSize];
  });
  assert.deepEqual(appearance,['rgba(0, 0, 0, 0)','rgb(213, 180, 131)','9px','17px']);
  assert.equal(await orderLink.locator('img[alt=""]').count(),1);
  if(width<600){
   if(width===390)await page.locator('.site-header').screenshot({path:join(out,'mobile-order-menu.png')});
   await page.getByRole('button',{name:'Close navigation'}).click();
   const hero=await page.locator('.home-hero').boundingBox(),photo=await page.locator('.hero-image').boundingBox();
   const heading=await page.locator('.home-hero h1').boundingBox(),cta=await page.locator('.hero-copy .button').boundingBox();
   assert.equal(photo.y,hero.y);
   assert(photo.y+photo.height>=heading.y+heading.height,'The photo shares the headline area');
   assert(hero.y+hero.height-cta.y-cta.height<=32,'The hero ends just below the shop button');
  }
  await page.locator('.hero-copy').getByRole('link',{name:/Explore our boxes/}).click();
  await page.locator('#product-grid [data-product]').first().waitFor();
  assert.equal(new URL(page.url()).pathname,'/order.html');assert.equal(new URL(page.url()).hash,'#cheesecake-boxes');
  await page.waitForFunction(()=>{const h=document.querySelector('#cheesecake-boxes .section-heading h2')?.getBoundingClientRect();return h && h.top>=0 && h.bottom<innerHeight;});
  const chooseDate=async value=>{
   await page.locator('#fulfillment-date').click();
   const day=page.locator(`[data-customer-date="${value}"]`);
   if(!await day.count())await page.locator('[data-customer-month="1"]').click();
   await day.click();
  };
  await chooseDate(date);
  const pickup=page.locator('[data-method=pickup]'),delivery=page.locator('[data-method=delivery]'),notice=page.locator('#fulfillment-notice');
  assert(await notice.isHidden());await delivery.click();
  assert.match(await notice.innerText(),/Delivery is unavailable/);
  assert.equal(await pickup.getAttribute('aria-pressed'),'true');
  await pickup.click();assert(await notice.isHidden());await delivery.click();
  await chooseDate(addDays(date,1));
  assert(await notice.isHidden());await delivery.click();assert.equal(await delivery.getAttribute('aria-pressed'),'true');
  await finish(t,'Homepage order buttons and on-demand delivery notice at '+width+'px');
 }
 for(const width of [390,1440]){
  const t=await make({width}),{page,data}=t;await menu(page);await open(page);await choose(page,[['flavor-0',1],['flavor-1',1]]);await page.locator('#product-quantity').fill('2');await close(page);await open(page,'fixed');await close(page);await open(page);assert.equal(await page.locator('[data-trio-add="flavor-0"]').getAttribute('data-count'),'1');assert.equal(await page.locator('#product-quantity').inputValue(),'2');
  await page.reload();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('[data-trio-add="flavor-1"]').getAttribute('data-count'),'1');
  data.catalog.flavors[1].active=false;await page.reload();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('[data-trio-add="flavor-1"]').count(),0);assert.match(await page.locator('#product-error').innerText(),/no longer available|replace.*lineup/);assert.equal(await page.locator('[data-trio-add="flavor-0"]').getAttribute('data-count'),'1');
  data.catalog.flavors[1].active=true;await page.reload();await page.locator('#product-dialog[open]').waitFor();await choose(page,[['flavor-0',1],['flavor-1',2]]);await page.locator('#product-quantity').fill('1');await add(page);await open(page);assert.equal(await page.locator('[data-trio-add="flavor-0"]').getAttribute('data-count'),'0');await choose(page,[['flavor-1',2],['flavor-0',1]]);await add(page);
  assert.equal(await page.locator('#cart .cart-line').count(),1);assert.equal(await page.locator('#cart .quantity-control span').innerText(),'2');assert.match(await page.locator('#cart .grand-total').innerText(),/200\.00/);
  const plus=page.locator('#cart [data-delta="1"]');await plus.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');assert.equal(await page.locator('#cart .quantity-control span').innerText(),'4');assert.equal(await page.evaluate(()=>document.activeElement.dataset.delta),'1');
  await page.locator('#cart').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'basket-'+width+'.png')});await finish(t,'draft restore/revalidate/clear, identical basket merge and repeated keyboard use '+width);
 }
 {
  const t=await make({capacity:3}),{page}=t;await menu(page);await open(page,'fixed');assert.doesNotMatch(await page.locator('#product-dialog').innerText(),/\\d+ available on this date/i);assert.equal(await page.locator('[data-product="fixed"] .availability').count(),0);await add(page);assert.equal(await page.locator('#cart [data-delta="1"]').isDisabled(),true);assert.match(await page.locator('#basket-quantity-limit-0').innerText(),/Vanilla.*Choose another date/);assert.equal(await page.locator('#checkout-button').isDisabled(),false);await page.locator('#cart').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'stock-limit-explained.png')});await finish(t,'stock limit explained without invalidating checkout');
 }
 {
  const t=await make({capacity:6}),{page}=t;await menu(page);await open(page,'fixed');await add(page);await open(page);await choose(page,[['flavor-0',1],['flavor-1',2]]);await add(page);assert.equal(await page.locator('[data-qty="0"][data-delta="1"]').isDisabled(),true);await page.locator('[data-remove="1"]').click();assert.equal(await page.locator('[data-qty="0"][data-delta="1"]').isDisabled(),false);await page.locator('[data-qty="0"][data-delta="1"]').click();assert.equal(await page.locator('[data-qty="0"][data-delta="1"]').isDisabled(),true);assert.equal(await page.evaluate(()=>document.activeElement.dataset.delta),'-1');await finish(t,'shared-flavor stock releases correctly and disabled controls keep usable focus');
 }
 {
  const t=await make(),{page}=t;await page.goto(origin+'/story.html');await menu(page);await open(page);await choose(page,[['flavor-0',1]]);assert.match(page.url(),/product=custom/);await page.goBack();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open);assert.equal(new URL(page.url()).pathname,'/order.html');await page.goForward();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('[data-trio-add="flavor-0"]').getAttribute('data-count'),'1');await page.keyboard.press('Escape');await page.waitForFunction(()=>!new URL(location.href).searchParams.has('product'));await open(page);await close(page);await page.goBack();assert.equal(new URL(page.url()).pathname,'/story.html');
  await page.goto(origin+'/order.html?product=custom');await page.locator('#product-dialog[open]').waitFor();await close(page);assert.equal(new URL(page.url()).pathname,'/order.html');await finish(t,'real browser Back/Forward, Escape, repeated closes and direct product links');
 }
 {
  const t=await make({holdCollection:true}),{page,data}=t;await menu(page);assert.ok(data.calls.some(c=>c.action==='catalog'));assert.equal(await page.locator('.shop-loading').count(),0);data.releaseCollection();await finish(t,'ordering catalog becomes usable while descriptive content is pending');
 }
 {
  const t=await make(),{page}=t;await page.goto(origin+'/flavors.html');await page.locator('#flavor-search:not(:disabled)').waitFor();await page.locator('[data-view="collection"]').click();await page.locator('[data-category="classic"]').click();await page.locator('#flavor-search').fill('Vanilla');await page.reload();await page.locator('#flavor-search:not(:disabled)').waitFor();assert.equal(await page.locator('#flavor-search').inputValue(),'Vanilla');assert.equal(await page.locator('[aria-selected="true"][role="tab"]').getAttribute('data-view'),'collection');assert.equal(await page.locator('[data-category="classic"]').getAttribute('aria-pressed'),'true');await page.goto(origin+'/flavors.html#flavor-chocolate');await page.getByRole('dialog',{name:'Chocolate',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.id),'dialog-title');assert.equal(await page.locator('#flavor-search').inputValue(),'');assert.match(await page.locator('#filter-status').innerText(),/flavor/i);await finish(t,'flavor browse state survives reload and explicit flavor links take priority');
 }
 {
  const t=await make(),{page}=t;await page.goto(origin+'/account.html?next=order.html');await page.locator('#account-submit:not(:disabled)').waitFor();await page.locator('[name="email"]').fill('customer@example.test');await page.locator('[name="password"]').fill('local-test-only');await page.locator('#account-submit').click();await page.waitForURL('**/order.html#your-basket');await finish(t,'password sign-in returns to the shop basket');
 }
 {
  const t=await make(),{page,data}=t;await page.goto(origin+'/account.html?next=order.html');await page.locator('#google-signin:not(:disabled)').waitFor();await page.locator('#google-signin').click();await page.waitForFunction(()=>window.__oauthReturn);assert.equal(await page.evaluate(()=>window.__oauthReturn),origin+'/account.html');assert.equal(await page.evaluate(()=>window.__oauthPrompt),'select_account');data.session=identity('oauth-customer');await page.goto(origin+'/account.html#access_token=test');await page.waitForURL('**/order.html#your-basket');await finish(t,'OAuth callback keeps its allowlisted URL and resumes the shop intent');
 }
 {
  const t=await make(),{page,data}=t;let release;data.googleGate=new Promise(resolve=>{release=resolve;});data.failGoogleOnce=true;
  await page.goto(origin+'/account.html',{waitUntil:'domcontentloaded'});await page.locator('#account-submit:not(:disabled)').waitFor();
  assert(await page.locator('#google-signin').isHidden());release();data.googleGate=null;
  await page.locator('#google-signin').waitFor({state:'visible',timeout:9000});await finish(t,'Google stays hidden through an unconfirmed response and recovers after a retry');
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

 for(const width of [320,390,1440]){
  const t=await make({width,reducedMotion:'no-preference',motionProbe:true}),{page,data}=t;await menu(page);
  await page.locator('#product-grid [data-product]').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>window.__selectedMotion.some(a=>a.kind==='row')&&window.__selectedMotion.some(a=>a.section==='shop-boxes'));
  const initialRow=await page.evaluate(()=>window.__selectedMotion.filter(a=>a.kind==='row'));
  assert.ok(initialRow.length>=1&&initialRow.length<=3,'Only the first visible row enters');
  assert.ok(initialRow.every(a=>a.delay<=120&&(width>700||a.delay===0)),'Stagger is capped and removed on phones');
  await page.locator('[data-method="delivery"]').click();await page.locator('#product-grid [data-product]').first().scrollIntoViewIfNeeded();await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(()=>window.__selectedMotion.filter(a=>a.kind==='row')),initialRow,'Shop rerender does not replay cards');
  assert.equal(await page.evaluate(()=>window.__selectedMotion.filter(a=>a.section==='shop-boxes').length),1,'Section does not replay after changing fulfillment');
  await open(page,'fixed');await add(page);
  const opener=width<=700?page.locator('#mobile-cart'):page.locator('[data-open-quick-cart]');
  await opener.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>{window.__originalBasket=document.querySelector('#cart');return {url:location.href,history:history.length,scroll:scrollY};});
  await opener.click();const panel=page.locator('#quick-cart-dialog[open]');await panel.waitFor();
  assert.equal(await page.locator('#cart').count(),1);assert.equal(await panel.locator('#cart').evaluate(e=>e===window.__originalBasket),true);
  assert.equal(await panel.getByRole('button',{name:'Close basket'}).evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.evaluate(()=>window.__selectedMotion.filter(a=>a.kind==='panel').at(-1).duration),250);
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await panel.evaluate(e=>e.contains(document.activeElement)),true);}
  await panel.locator('[data-qty="0"][data-delta="1"]').click();assert.equal(await panel.locator('.quantity-control span').textContent(),'2');assert.match(await panel.locator('.grand-total').innerText(),/200\.00/);
  await panel.locator('[data-remove="0"]').click();assert.equal(await panel.locator('.cart-line').count(),0);
  await panel.locator('#undo-remove').click();assert.equal(await panel.locator('.quantity-control span').textContent(),'2');
  const rect=await panel.boundingBox();assert.ok(rect.x>=-1&&rect.x+rect.width<=width+1);
  if(width<=700){assert.ok(Math.abs(rect.width-width)<=1);assert.ok(rect.height<=765);}
  await page.screenshot({path:join(out,'quick-cart-'+width+'.png')});
  await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});
  assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.locator('#app #cart').evaluate(e=>e===window.__originalBasket),true);
  assert.deepEqual(await page.evaluate(()=>({url:location.href,history:history.length,scroll:scrollY})),before,'Opening and closing preserves route, history and page position');
  await opener.click();await panel.locator('#basket-change-date').click();await panel.waitFor({state:'detached'});
  assert.equal(await page.locator('.customer-calendar-trigger').evaluate(e=>e===document.activeElement),true);
  await opener.click();await panel.locator('#checkout-button').click();await page.locator('#checkout-dialog[open]').waitFor();
  assert.equal(await panel.count(),0);assert.equal(await page.locator('#app #cart .quantity-control span').textContent(),'2');
  await page.keyboard.press('Escape');await page.locator('#checkout-dialog[open]').waitFor({state:'detached'});
  assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  assert.equal(data.calls.some(call=>['quote','create_order'].includes(call.action)),false,'Panel and checkout entry send no quote or order request');
  await finish(t,'first product row and section run once; same basket, limits, undo, date, checkout and focus in quick panel '+width);
 }
 {
  const t=await make({motionProbe:true}),{page}=t;await page.goto(origin+'/order.html#your-basket');
  await page.locator('#quick-cart-dialog[open]').waitFor();assert.deepEqual(await page.evaluate(()=>window.__selectedMotion),[]);
  assert.equal(await page.locator('#checkout-button').isDisabled(),true);await page.keyboard.press('Escape');
  await page.goto(origin+'/order.html?product=fixed#your-basket');await page.locator('#product-dialog[open]').waitFor();
  assert.equal(await page.locator('#quick-cart-dialog[open]').count(),0);assert.deepEqual(await page.evaluate(()=>window.__selectedMotion),[]);
  await finish(t,'reduced motion disables the new effects; basket deep link works and product dialog keeps priority');
 }

 {
  const t=await make({width:1440,reducedMotion:'no-preference',motionProbe:true}),{page}=t;
  await page.goto(origin+'/index.html?preview=1');
  await page.locator('#home-box-viewport [data-home-box]').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>window.__selectedMotion.filter(a=>a.kind==='home-row').length===3);
  assert.deepEqual(await page.evaluate(()=>window.__selectedMotion.filter(a=>a.kind==='home-row').map(a=>a.delay)),[0,60,120]);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.locator('#home-box-viewport').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>window.__selectedMotion.filter(a=>a.kind==='home-row').length),3);
  await page.goto(origin+'/index.html?preview=1&anchor-test=1#home-boxes');
  await page.locator('#home-box-viewport [data-home-box]').first().waitFor();await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__selectedMotion.some(a=>a.kind==='home-row')),false);
  assert.equal(await page.locator('[data-open-quick-cart],#brand-intro').count(),0);
  await finish(t,'home boxes enter once with capped stagger, and anchor links show the row immediately');
 }
 await writeFile(join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log('PASS all customer-friction browser scenarios');
}finally{await browser.close();}
