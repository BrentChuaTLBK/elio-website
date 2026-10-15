import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {dateInManila,addDays} from '../../dist/assets/shop/shop-rules.js';

const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),out=join(project,'test-results/product-photo-viewer'),origin='https://product-photo-viewer.test';
await mkdir(out,{recursive:true});
const results=[],date=addDays(dateInManila(),2);
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
const openProduct=async(page,id='gallery')=>{await page.locator('[data-product="'+id+'"]').click();await page.locator('#product-dialog[open]').waitFor();};
const productClosed=async page=>page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));
const menu=async page=>{await page.goto(origin+'/order.html');await page.locator('#product-grid [data-product]').first().waitFor();};
const check=label=>{results.push(label);console.log('PASS '+label);};
async function fit(page,name,mode='cover'){
 await page.waitForFunction(({name,mode})=>{const img=document.querySelector('#detail-photo');return img?.complete&&img.naturalWidth>0&&img.currentSrc.endsWith('/'+name+'.svg')&&getComputedStyle(img).objectFit===mode;},{name,mode});
 assert.equal(await page.locator('[data-open-photo]').getAttribute('aria-pressed'),String(mode==='contain'));
 assert.equal(await page.locator('#product-photo-viewer').count(),0,'Photo display must never create a separate popup');
 assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(await page.locator('#product-dialog').evaluate(el=>el.open),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
async function snapshot(page){
 return page.evaluate(()=>{
  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  return {url:location.href,history:history.length,scroll:document.querySelector('#product-dialog').scrollTop,pageScroll:scrollY,frame:box('.product-photo-frame'),image:box('#detail-photo'),dialog:box('#product-dialog'),quantity:document.querySelector('#product-quantity').value,choices:[...document.querySelectorAll('[data-choice]')].map(el=>[el.dataset.choice,el.value]),focused:document.activeElement.matches('[data-open-photo]')};
 });
}
async function finish(t){
 assert.deepEqual(t.data.errors,[]);assert.deepEqual(t.data.blockedWrites,[]);
 assert.equal(await t.page.locator('#cart .cart-line').count(),0,'Photo viewing must never add to the basket');
 assert.equal(await t.page.evaluate(()=>Boolean(document.querySelector('#checkout-dialog')?.open)),false,'Photo viewing must never start checkout');
 await t.ctx.close();
}
async function swipe(page,dx,dy=0){
 await page.locator('[data-open-photo]').evaluate((frame,{dx,dy})=>{const point=(x,y)=>new Touch({identifier:1,target:frame,clientX:x,clientY:y});frame.dispatchEvent(new TouchEvent('touchstart',{touches:[point(200,250)],changedTouches:[point(200,250)],bubbles:true}));frame.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[point(200+dx,250+dy)],bubbles:true}));},{dx,dy});
}
try{
 for(const width of [320,390,1440]){
  const t=await make(width),{page}=t;await menu(page);await openProduct(page);await fit(page,'landscape');
  await page.locator('[data-choice="flavor-0"]').fill('2');await page.locator('[data-choice="flavor-1"]').fill('1');await page.locator('#product-quantity').fill('2');
  const trigger=page.locator('[data-open-photo]');assert.equal(await trigger.evaluate(el=>el.tagName),'BUTTON');assert.equal(await trigger.getAttribute('type'),'button');
  await trigger.focus();await page.locator('#product-dialog').evaluate(el=>{el.scrollTop=45;});
  const before=await snapshot(page);
  await page.keyboard.press('Enter');await fit(page,'landscape','contain');assert.deepEqual(await snapshot(page),before,'Enter fits photo in place without moving or replacing the product');
  await page.keyboard.press('Space');await fit(page,'landscape');assert.deepEqual(await snapshot(page),before,'Space returns to cropped view without changing the product');
  await trigger.click();await fit(page,'landscape','contain');assert.deepEqual(await snapshot(page),before,'Click fits photo while preserving frame, dialog, choices, quantity, history, scroll and focus');
  await page.screenshot({path:join(out,'inline-full-'+width+'.png')});
  check('Click/Enter/Space toggle in place with unchanged frame, product state, route, scroll and focus '+width);

  await page.locator('[data-photo-next]').click();await fit(page,'portrait','contain');assert.match(await page.locator('[data-photo-counter]').innerText(),/2\s*(?:of|\/)\s*3/);
  await trigger.focus();await page.keyboard.press('ArrowRight');await fit(page,'square','contain');await page.keyboard.press('ArrowLeft');await fit(page,'portrait','contain');
  await page.locator('[data-photo-prev]').click();await fit(page,'landscape','contain');await page.locator('[data-photo="2"]').click();await fit(page,'square','contain');
  assert.equal(await page.locator('[data-photo="2"]').getAttribute('aria-pressed'),'true');
  if(width<600){await swipe(page,-100);await fit(page,'landscape','contain');await swipe(page,100);await fit(page,'square','contain');await swipe(page,-20);await fit(page,'square','contain');await swipe(page,-80,150);await fit(page,'square','contain');}
  await trigger.focus();await page.keyboard.press('Enter');await fit(page,'square');await page.locator('[data-photo-next]').click();await fit(page,'landscape');
  assert.equal(await page.locator('#product-quantity').inputValue(),'2');assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'2');
  check('Buttons, thumbnails, arrow keys and swipe keep selected fit mode and product choices '+width);
  await page.keyboard.press('Escape');await productClosed(page);assert.equal(await page.locator('dialog[open]').count(),0);
  check('One Escape closes the product; there is no second photo dialog '+width);

  await openProduct(page,'single');await fit(page,'portrait');await page.locator('[data-open-photo]').click();await fit(page,'portrait','contain');
  for(const selector of ['[data-photo-prev]','[data-photo-next]']){const control=page.locator(selector);assert(await control.count()===0||!await control.isVisible()||await control.isDisabled(),'Single-photo products do not expose active gallery arrows');}
  await page.keyboard.press('ArrowRight');await fit(page,'portrait','contain');await page.keyboard.press('Escape');await productClosed(page);
  await openProduct(page,'none');assert.equal(await page.locator('[data-open-photo]').count(),0);assert.equal(await page.locator('#product-photo-viewer').count(),0);await page.keyboard.press('Escape');await productClosed(page);
  check('Single-photo toggle and photo-less fallback '+width);await finish(t);
 }

 const t=await make(390),{page}=t;await page.goto(origin+'/story.html');await menu(page);await openProduct(page);
 await page.locator('[data-choice="flavor-0"]').fill('2');await page.locator('#product-quantity').fill('3');await page.locator('[data-open-photo]').click();await fit(page,'landscape','contain');
 await page.goBack();await productClosed(page);assert.equal(new URL(page.url()).pathname,'/order.html');assert.equal(await page.locator('dialog[open]').count(),0);
 await page.goForward();await page.locator('#product-dialog[open]').waitFor();await fit(page,'landscape');assert.equal(await page.locator('#product-quantity').inputValue(),'3');assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'2');
 await page.keyboard.press('Escape');await productClosed(page);await page.goBack();assert.equal(new URL(page.url()).pathname,'/story.html');
 check('Browser Back/Forward preserves product draft and has no added photo history');await finish(t);

 const broken=await make(390);await menu(broken.page);await openProduct(broken.page,'missing');
 const failed=broken.page.locator('[data-photo-retry]');await failed.waitFor();assert.match(await failed.innerText(),/unavailable.*retry/i);
 await broken.page.locator('[data-photo-next]').click();await fit(broken.page,'square');await broken.page.locator('[data-open-photo]').click();await fit(broken.page,'square','contain');
 await broken.page.locator('[data-photo-prev]').click();await failed.waitFor();broken.data.recoverMissing=true;await failed.click();
 await broken.page.waitForFunction(()=>{const image=document.querySelector('#detail-photo');return image?.complete&&image.naturalWidth===1600&&!image.hidden;});
 assert.equal(await failed.isVisible(),false);assert.equal(await broken.page.locator('#detail-photo').evaluate(el=>getComputedStyle(el).objectFit),'contain','Retry preserves full-photo mode');
 assert.equal(await broken.page.locator('[data-open-photo]').getAttribute('aria-pressed'),'true');assert.equal(await broken.page.locator('#product-photo-viewer').count(),0);
 check('Missing-image feedback, alternate photos and inline retry preserve fit mode');await finish(broken);
 await writeFile(join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));
}finally{await browser.close();}
