import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),out=resolve(root,'../test-results/flavor-carousel'),origin='https://carousel.test';await mkdir(out,{recursive:true});
const source=await readFile(join(root,'content.js'),'utf8'),sandbox={window:{}};vm.runInNewContext(source.slice(0,source.indexOf('// The public collection')),sandbox);
const base=JSON.parse(JSON.stringify(sandbox.window.ELIO_CONTENT)),results=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const selectors=path=>path==='index.html'?{track:'#featured-products',section:'.home-flavors',dialog:'#detail-dialog'}:{track:'#order-products',section:'.shop-flavor-section',dialog:'#order-flavor-dialog'};
async function open(path,width,{count=7,motion='reduce',touch=false}={}){
 const data={...structuredClone(base),homeBoxes:[],homeLoaded:true,collectionLoaded:true};data.flavors=data.flavors.slice(0,count);
 const ctx=await browser.newContext({viewport:{width,height:950},reducedMotion:motion,hasTouch:touch,isMobile:touch,serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/content.js')return route.fulfill({contentType:'text/javascript',body:`window.ELIO_CONTENT=${JSON.stringify(data)};window.ELIO_CONTENT.isAvailable=()=>true;window.ELIO_CONTENT_READY=Promise.resolve(window.ELIO_CONTENT);`});
  if(['/assets/shop/shop.js','/assets/shop/faqs.js','/assets/shop/newsletter.js','/assets/site-maintenance.js','/assets/site-analytics.js','/assets/website-photos.js','/calendar.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.ttf':'font/ttf'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push({path,width,message:e.message}));
 await page.goto(origin+'/'+path);const s=selectors(path),track=page.locator(s.track),section=page.locator(s.section);
 await track.locator(count?'.flavor-slide':'.home-catalog-message').first().waitFor();await page.evaluate(()=>document.fonts.ready);await section.scrollIntoViewIfNeeded();
 await page.evaluate(selector=>{window.carouselMetrics=()=>{
  const track=document.querySelector(selector),all=[...track.querySelectorAll('.flavor-slide')],slides=all.filter(n=>!n.hasAttribute('data-carousel-copy'));
  const view=track.getBoundingClientRect(),position=n=>n.getBoundingClientRect().left-view.left+track.scrollLeft-parseFloat(getComputedStyle(track).paddingLeft);
  const start=slides.length?position(slides[0]):0,step=all.length>1?position(all[1])-position(all[0]):track.clientWidth;
  return {index:slides.length?((Math.round((track.scrollLeft-start)/step)%slides.length)+slides.length)%slides.length:0,left:track.scrollLeft,step,start,visible:all.filter(n=>{const r=n.getBoundingClientRect();return Math.min(r.right,view.right)-Math.max(r.left,view.left)>r.width*.6;}).length};
 };},s.track);
 return {...s,ctx,page,track,section};
}
const waitIndex=(page,expected)=>page.waitForFunction(expected=>window.carouselMetrics().index===expected,expected);
const left=track=>track.evaluate(el=>el.scrollLeft);
async function stationary(page,track){await page.waitForTimeout(150);const before=await left(track);await page.waitForTimeout(400);assert(Math.abs(await left(track)-before)<2,'Carousel remains still');}
try{
 for(const width of [1440,768,390,320])for(const path of ['index.html','order.html']){
  const {ctx,page,track,section,dialog}=await open(path,width);
  const originals=track.locator('.flavor-slide:not([data-carousel-copy])');assert.equal(await originals.count(),7);
  assert.equal(await track.locator('[data-carousel-copy]:not([aria-hidden=true]),[data-carousel-copy] a:not([tabindex="-1"])').count(),0);
  assert.equal(await page.evaluate(()=>window.carouselMetrics().visible),width>1000?7:width>700?5:3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await stationary(page,track);
  const next=section.getByRole('button',{name:'Next flavors',exact:true}),previous=section.getByRole('button',{name:'Previous flavors',exact:true});
  for(const expected of [3,6,2]){await next.click();await waitIndex(page,expected);}
  await previous.click();await waitIndex(page,6);await track.press('Home');await waitIndex(page,0);await track.press('ArrowLeft');await waitIndex(page,6);await track.press('ArrowRight');await waitIndex(page,0);await track.press('End');await waitIndex(page,6);
  const copyIndex=await track.locator('[data-carousel-copy]').evaluateAll(nodes=>{const view=nodes[0].parentElement.getBoundingClientRect();return nodes.findIndex(n=>{const r=n.getBoundingClientRect();return r.left+r.width/2>view.left+2&&r.left+r.width/2<view.right-2;});});
  assert(copyIndex>=0,'A loop copy is visible at the end of the catalog');const copy=track.locator('[data-carousel-copy]').nth(copyIndex),flavorIndex=Number(await copy.getAttribute('data-flavor-index'));
  const expectedName=await originals.nth(flavorIndex).locator('h3').textContent();await copy.locator('a').click();await page.locator(dialog+'[open]').waitFor();assert.equal(await page.locator(dialog+' h2').textContent(),expectedName);
  await page.keyboard.press('Escape');await page.locator(dialog+'[open]').waitFor({state:'hidden'});await waitIndex(page,flavorIndex);
  assert.deepEqual(await page.evaluate(()=>({index:Number(document.activeElement.closest('.flavor-slide')?.dataset.flavorIndex),copy:Boolean(document.activeElement.closest('[data-carousel-copy]'))})),{index:flavorIndex,copy:false});
  await track.press('End');await waitIndex(page,6);await page.waitForTimeout(200);await page.setViewportSize({width:width===1440?390:1440,height:950});await waitIndex(page,6);
  await page.setViewportSize({width,height:950});await section.scrollIntoViewIfNeeded();await track.press('Home');await waitIndex(page,0);await track.evaluate(el=>el.blur());await page.mouse.move(0,0);await section.screenshot({path:join(out,path.replace('.html','')+'-'+width+'.png')});
  await ctx.close();results.push({path,width,manual:true,reducedMotion:true,loopCopies:true,focusRestore:true,resize:true});console.log(`PASS ${path} ${width}px: three-flavor navigation, wrapping, keyboard, copy details, focus, sizing and reduced motion`);
 }
 for(const path of ['index.html','order.html']){
  const {ctx,page,track,section,dialog}=await open(path,390,{motion:'no-preference'});
  await page.waitForFunction(()=>document.querySelector('.product-track').classList.contains('is-drifting'));const before=await left(track);await page.waitForTimeout(900);const delta=await left(track)-before;assert(delta>3&&delta<30,`Gentle home-speed drift: ${delta}`);
  await page.emulateMedia({reducedMotion:'reduce'});await track.evaluate(el=>{const m=window.carouselMetrics();el.scrollLeft=m.start+7*m.step-5;});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>{const m=window.carouselMetrics();return m.left>=m.start-1&&m.left<m.start+m.step;});assert.equal(await page.evaluate(()=>window.carouselMetrics().visible),3,'Automatic wrapping keeps the visible row filled');
  await page.evaluate(selector=>document.querySelector(selector).showModal(),dialog);await stationary(page,track);await page.evaluate(selector=>document.querySelector(selector).close(),dialog);
  const resumed=await left(track);await page.waitForFunction(before=>Math.abs(window.carouselMetrics().left-before)>3,resumed);
  if(path==='order.html'){await page.evaluate(()=>document.querySelector('#checkout-dialog').showModal());await stationary(page,track);await page.evaluate(()=>document.querySelector('#checkout-dialog').close());const checkoutClosed=await left(track);await page.waitForFunction(before=>Math.abs(window.carouselMetrics().left-before)>3,checkoutClosed);}
  await page.evaluate(()=>scrollTo(0,0));await stationary(page,track);await section.scrollIntoViewIfNeeded();const visible=await left(track);await page.waitForFunction(before=>Math.abs(window.carouselMetrics().left-before)>3,visible);
  await page.emulateMedia({reducedMotion:'reduce'});await stationary(page,track);
  await ctx.close();results.push({path,autoplay:true,automaticWrap:true,dialogPause:true,offscreenPause:true,motionPreferenceChange:true});console.log(`PASS ${path}: gentle automatic loop, seamless wrap, dialog/offscreen pause, resume and live reduced-motion change`);
 }
 for(const path of ['index.html','order.html'])for(const count of [0,1,2]){
  const {ctx,page,track,section}=await open(path,390,{count});assert.equal(await track.locator('.flavor-slide:not([data-carousel-copy])').count(),count);
  if(count<2){assert.equal(await section.locator('.carousel-controls').isVisible(),false);assert.equal(await track.locator('[data-carousel-copy]').count(),0);await stationary(page,track);}
  else{await section.getByRole('button',{name:'Next flavors',exact:true}).click();await waitIndex(page,1);await section.getByRole('button',{name:'Next flavors',exact:true}).click();await waitIndex(page,0);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await ctx.close();results.push({path,count,smallCatalog:true});
 }
 for(const path of ['index.html','order.html']){
  const {ctx,page,track}=await open(path,390,{touch:true});const cdp=await ctx.newCDPSession(page),box=await track.boundingBox();
  const x=box.x+box.width*.8,y=box.y+box.height*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(const distance of [25,65,115,175]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-distance,y}]});await page.waitForTimeout(35);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>window.carouselMetrics().index!==0);await ctx.close();results.push({path,nativeSwipe:true});console.log(`PASS ${path}: native horizontal touch swipe`);
 }
 assert.deepEqual(errors,[]);console.log(`PASS ${results.length} shared home/shop carousel scenarios with zero page errors`);
}finally{await browser.close();await writeFile(join(out,'checks.json'),JSON.stringify({results,errors},null,2));}
