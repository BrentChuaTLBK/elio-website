import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {dateInManila,addDays} from '../../dist/assets/shop/shop-rules.js';

const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),out=join(project,'test-results/product-photo-viewer'),origin='https://product-photo-viewer.test';
await mkdir(out,{recursive:true});
const results=[],date=addDays(dateInManila(),2);
const selectors={viewer:'#product-photo-viewer',trigger:'[data-open-photo]',image:'[data-viewer-image]',close:'[data-photo-close]',previous:'[data-photo-prev]',next:'[data-photo-next]',counter:'[data-photo-counter]'};
const photo=(name)=>origin+'/fixtures/'+name+'.svg';
const pictures={landscape:[1600,900],portrait:[800,1400],square:[1000,1000]};
function fixture(){
 const flavors=['Vanilla','Matcha'].map((name,i)=>({id:'flavor-'+i,slug:name.toLowerCase(),name,description:'Isolated test flavor',price_cents:0,active:true,in_rotation:true,collection_hidden:false,category_ids:['classic'],photos:[]}));
 const base={active:true,price_cents:90000,lead_days:0,min_quantity:1,description:'Isolated photo viewer fixture',sort_order:0};
 const catalog={settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],cutoff_time:''},categories:[],zones:[],flavors,products:[
  {...base,id:'gallery',name:'Choose your box',kind:'custom_box',photos:Object.keys(pictures).map(photo)},
  {...base,id:'single',name:'One photo box',kind:'set',flavor_contents:[{product_id:'flavor-0',quantity:3}],photos:[photo('portrait')]},
  {...base,id:'missing',name:'Missing photo box',kind:'set',flavor_contents:[{product_id:'flavor-0',quantity:3}],photos:[photo('missing'),photo('square')]},
  {...base,id:'none',name:'Photo coming soon box',kind:'set',flavor_contents:[{product_id:'flavor-0',quantity:3}],photos:[]}
 ],inventory:flavors.map(f=>({product_id:f.id,date,available:true,capacity:99,remaining:99}))};
 return {catalog,collection:{flavors,categories:[],menus:[],current_month:date.slice(0,7)+'-01',next_month:addDays(date,32).slice(0,7)+'-01'},calls:[],blockedWrites:[],errors:[]};
}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
async function make(width){
 const data=fixture(),ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block',hasTouch:width<600});
 await ctx.addInitScript(()=>{
  localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));
  localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));
 });
 await ctx.exposeBinding('photoTestRpc',async(_,{action})=>{
  data.calls.push(action);
  if(action==='catalog')return {data:structuredClone(data.catalog),error:null};
  if(action==='newsletter_settings')return {data:{enabled:false,own_status:'unsubscribed'},error:null};
  if(action==='account_access')return {data:{role:'customer'},error:null};
  if(action==='affiliate_status')return {data:{assigned:false},error:null};
  if(action==='site_status')return {data:{},error:null};
  if(action==='faqs')return {data:[],error:null};
  data.blockedWrites.push(action);return {data:null,error:{message:'Unexpected RPC in read-only photo viewer test: '+action}};
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async(n,p)=>window.photoTestRpc({action:p.p_action,payload:p.p_payload}),functions:{invoke:async()=>({data:{status:'not_subscribed'},error:null})}}}`});
  if(u.pathname==='/auth/v1/settings')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{}}'});
  if(u.pathname==='/rest/v1/rpc/shop_api'){
   const {p_action:action}=route.request().postDataJSON();
   if(!['flavor_collection','website_photos','site_status','faqs'].includes(action))data.blockedWrites.push(action);
   return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(action==='flavor_collection'?data.collection:{})});
  }
  if(u.origin!==origin)return route.abort();
  if(u.pathname.startsWith('/fixtures/')){
   const name=u.pathname.split('/').pop().replace('.svg',''),size=pictures[name]||(name==='missing'&&data.recoverMissing?pictures.landscape:null);
   if(!size)return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="0 0 ${size[0]} ${size[1]}"><rect width="100%" height="100%" fill="#eadbc7"/><rect x="12" y="12" width="${size[0]-24}" height="${size[1]-24}" fill="none" stroke="#7a4d31" stroke-width="20"/><text x="50%" y="50%" text-anchor="middle" font-size="70" fill="#583923">${name} · full photo</text></svg>`});
  }
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>data.errors.push(error.message));
 return {ctx,page,data,width};
}
const viewer=page=>page.locator(selectors.viewer);
const openProduct=async(page,id='gallery')=>{await page.locator('[data-product="'+id+'"]').click();await page.locator('#product-dialog[open]').waitFor();};
const openPhoto=async page=>{await page.locator(selectors.trigger).click();await viewer(page).filter({visible:true}).waitFor();};
const photoClosed=async page=>page.waitForFunction(selector=>!document.querySelector(selector)?.open,selectors.viewer);
const productClosed=async page=>page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));
const menu=async page=>{await page.goto(origin+'/order.html');await page.locator('#product-grid [data-product]').first().waitFor();};
const check=label=>{results.push(label);console.log('PASS '+label);};
async function fit(page,name){
 const img=viewer(page).locator(selectors.image);
 await page.waitForFunction(({selector,name})=>{const img=document.querySelector(selector);return img?.complete&&img.naturalWidth>0&&img.currentSrc.endsWith('/'+name+'.svg');},{selector:selectors.viewer+' '+selectors.image,name});
 const box=await img.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {fit:s.objectFit,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,viewportWidth:innerWidth,viewportHeight:innerHeight};});
 assert.equal(box.fit,'contain','The full source photo must fit without cropping');
 assert(box.width>0&&box.height>0);
 assert(box.left>=-1&&box.top>=-1&&box.right<=box.viewportWidth+1&&box.bottom<=box.viewportHeight+1,JSON.stringify(box));
 assert.deepEqual([box.naturalWidth,box.naturalHeight],pictures[name]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
async function finish(t){
 assert.deepEqual(t.data.errors,[]);assert.deepEqual(t.data.blockedWrites,[]);
 assert.equal(await t.page.locator('#cart .cart-line').count(),0,'Photo viewing must never add to the basket');
 assert.equal(await t.page.locator('#checkout-dialog').evaluate(el=>el.open),false,'Photo viewing must never start checkout');
 await t.ctx.close();
}
try{
 for(const width of [320,390,1440]){
  const t=await make(width),{page}=t;await menu(page);await openProduct(page);
  assert.equal(await page.locator('#detail-photo').evaluate(el=>getComputedStyle(el).objectFit),'contain','The product detail preview must also show the whole photo');
  await page.locator('[data-choice="flavor-0"]').fill('2');await page.locator('[data-choice="flavor-1"]').fill('1');await page.locator('#product-quantity').fill('2');
  const trigger=page.locator(selectors.trigger),productUrl=page.url();
  assert.equal(await trigger.evaluate(el=>el.tagName),'BUTTON');assert.equal(await trigger.getAttribute('type'),'button');
  await trigger.focus();await page.locator('#product-dialog').evaluate(el=>{el.scrollTop=45;});
  const before=await page.evaluate(()=>({scroll:document.querySelector('#product-dialog').scrollTop,pageScroll:scrollY,history:history.length}));
  await page.keyboard.press('Enter');await viewer(page).filter({visible:true}).waitFor();await fit(page,'landscape');
  assert.equal(page.url(),productUrl);assert.equal(await page.evaluate(()=>history.length),before.history);
  await viewer(page).screenshot({path:join(out,'viewer-'+width+'.png')});
  await page.keyboard.press('Escape');await photoClosed(page);
  assert.equal(await page.locator('#product-dialog').evaluate(el=>el.open),true);
  assert.equal(page.url(),productUrl);assert.equal(await page.locator('#product-quantity').inputValue(),'2');
  assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'2');assert.equal(await page.locator('[data-choice="flavor-1"]').inputValue(),'1');
  assert(await trigger.evaluate(el=>el===document.activeElement));
  const after=await page.evaluate(()=>({scroll:document.querySelector('#product-dialog').scrollTop,pageScroll:scrollY,history:history.length}));assert.deepEqual(after,before);
  check('Keyboard opens uncropped photo; Escape preserves parent, choices, quantity, URL, scroll and focus '+width);

  await openPhoto(page);await fit(page,'landscape');await viewer(page).locator(selectors.next).click();await fit(page,'portrait');
  assert.match(await viewer(page).locator(selectors.counter).innerText(),/2\s*(?:of|\/)\s*3/);
  await page.keyboard.press('ArrowRight');await fit(page,'square');await page.keyboard.press('ArrowLeft');await fit(page,'portrait');
  await viewer(page).locator(selectors.previous).click();await fit(page,'landscape');
  for(let i=0;i<6;i++){await page.keyboard.press('Tab');const focus=await viewer(page).evaluate(el=>({inside:el.contains(document.activeElement),tag:document.activeElement.tagName,id:document.activeElement.id,hasFocus:document.hasFocus()}));assert(focus.inside||!focus.hasFocus,'In-page keyboard focus must remain inside the topmost viewer: '+JSON.stringify(focus));}
  await viewer(page).locator(selectors.close).click();await photoClosed(page);assert(await trigger.evaluate(el=>el===document.activeElement));
  check('Click, previous/next, arrow keys, focus containment and close button '+width);

  await page.locator('[data-photo="1"]').click();await openPhoto(page);await fit(page,'portrait');
  await page.keyboard.press('ArrowRight');await fit(page,'square');
  if(width<600){
   const swipe=async(dx,dy=0)=>viewer(page).locator('.photo-viewer-frame').evaluate((frame,{dx,dy})=>{const point=(x,y)=>new Touch({identifier:1,target:frame,clientX:x,clientY:y});frame.dispatchEvent(new TouchEvent('touchstart',{touches:[point(200,250)],changedTouches:[point(200,250)],bubbles:true}));frame.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[point(200+dx,250+dy)],bubbles:true}));},{dx,dy});
   await swipe(-100);await fit(page,'landscape');await swipe(100);await fit(page,'square');await swipe(-20);await fit(page,'square');await swipe(-80,150);await fit(page,'square');
  }
  await viewer(page).locator(selectors.close).click();await photoClosed(page);
  assert((await page.locator('#detail-photo').getAttribute('src')).endsWith('/square.svg'));assert.equal(await page.locator('[data-photo="2"]').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');await productClosed(page);
  check('Selected thumbnail opens its full photo; second Escape closes product '+width);

  await openProduct(page,'single');await openPhoto(page);await fit(page,'portrait');
  for(const selector of [selectors.previous,selectors.next]){
   const control=viewer(page).locator(selector);assert(await control.count()===0||!await control.isVisible()||await control.isDisabled(),'Single-photo products do not expose active gallery arrows');
  }
  await page.keyboard.press('ArrowRight');await fit(page,'portrait');await page.keyboard.press('Escape');await photoClosed(page);
  await page.keyboard.press('Escape');await productClosed(page);
  await openProduct(page,'none');assert.equal(await page.locator(selectors.trigger).count(),0);assert.equal(await viewer(page).filter({visible:true}).count(),0);
  await page.keyboard.press('Escape');await productClosed(page);
  check('Single-photo controls and photo-less product fallback '+width);
  await finish(t);
 }

 const t=await make(390),{page}=t;await page.goto(origin+'/story.html');await menu(page);await openProduct(page);
 await page.locator('[data-choice="flavor-0"]').fill('2');await page.locator('#product-quantity').fill('3');await openPhoto(page);
 await page.goBack();await productClosed(page);await photoClosed(page);assert.equal(new URL(page.url()).pathname,'/order.html');
 await page.goForward();await page.locator('#product-dialog[open]').waitFor();assert.equal(await page.locator('#product-quantity').inputValue(),'3');assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'2');
 assert.equal(await viewer(page).filter({visible:true}).count(),0,'Forward reopens the product without an orphaned photo layer');
 await openPhoto(page);await page.evaluate(()=>document.querySelector('#product-dialog').close());await photoClosed(page);
 check('Browser Back/Forward and parent close clean up photo layer without losing product draft');
 await finish(t);

 const broken=await make(390);await menu(broken.page);await openProduct(broken.page,'missing');await openPhoto(broken.page);
 const failed=viewer(broken.page).getByRole('status');await failed.filter({hasText:'This photo couldn’t load.'}).waitFor();
 await viewer(broken.page).locator(selectors.next).click();await fit(broken.page,'square');
 await viewer(broken.page).locator(selectors.previous).click();await failed.filter({hasText:'This photo couldn’t load.'}).waitFor();
 broken.data.recoverMissing=true;await viewer(broken.page).locator('[data-photo-retry]').click();
 await broken.page.waitForFunction(selector=>{const img=document.querySelector(selector);return img?.complete&&img.naturalWidth===1600;},selectors.viewer+' '+selectors.image);
 assert.equal(await failed.isVisible(),false);await broken.page.keyboard.press('Escape');await photoClosed(broken.page);
 assert.equal(await broken.page.locator('#product-dialog').evaluate(el=>el.open),true);
  await broken.page.waitForFunction(()=>{const img=document.querySelector('#detail-photo');return img?.complete&&img.naturalWidth===1600&&!img.hidden;});
  assert.equal(await broken.page.locator('.product-photo-unavailable').isVisible(),false,'Retry also restores the product detail photo');
 check('Failed image has clear feedback; other photos remain usable and retry recovers');await finish(broken);
 await writeFile(join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));
}finally{await browser.close();}
