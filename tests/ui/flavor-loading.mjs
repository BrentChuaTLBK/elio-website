import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),out=resolve(root,'../test-results/flavor-loading'),origin='https://flavor-loading.test';await mkdir(out,{recursive:true});
const sandbox={window:{},location:{pathname:'/preview'}};vm.runInNewContext(await readFile(join(root,'content.js'),'utf8'),sandbox);
const initial=JSON.parse(JSON.stringify(sandbox.window.ELIO_CONTENT));
const fixture=()=>({flavors:initial.flavors.map((f,i)=>({id:'flavor-'+i,slug:f.id,name:f.name,tagline:f.line,description:f.description,category_ids:[f.category],sort_order:i})),categories:[{id:'classic',name:'Classic'},{id:'rich',name:'Rich'},{id:'tea',name:'Tea'}],menus:[{month:'2026-09-01',published:true,flavor_ids:['flavor-0','flavor-1','flavor-2','flavor-3']},{month:'2026-10-01',published:true,flavor_ids:['flavor-4','flavor-5','flavor-6']}],current_month:'2026-09-01',next_month:'2026-10-01'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true}),results=[],errors=[];
async function scenario({width=390,mode='success',hash='',javaScriptEnabled=true}={}){
 const ctx=await browser.newContext({viewport:{width,height:950},javaScriptEnabled,serviceWorkers:'block'});
 let release,started;const gate=new Promise(r=>release=r),requested=new Promise(r=>started=r);let calls=0;
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/rest/v1/rpc/shop_api'){
   assert.equal(route.request().postDataJSON().p_action,'flavor_collection');calls++;started();await gate;
   try{if(mode==='network')return await route.abort();if(mode==='http')return await route.fulfill({status:503,json:{error:'Unavailable'}});if(mode==='invalid')return await route.fulfill({json:{flavors:null,menus:[]}});const data=fixture();if(mode==='empty'){data.flavors=[];data.menus=[];}if(mode==='unpublished')data.menus=[];return await route.fulfill({json:data});}catch{return;}
  }
  if(u.origin!==origin)return route.abort();
  if(['/assets/shop/newsletter.js','/assets/site-maintenance.js','/assets/site-analytics.js','/assets/website-photos.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(mode==='module'&&u.pathname==='/assets/shop/flavor-details.js')return route.abort();
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.ttf':'font/ttf'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/flavors.html'+hash,{waitUntil:'domcontentloaded'});if(javaScriptEnabled)await requested;
 return {ctx,page,release,calls:()=>calls};
}
try{
 for(const width of [320,390,768,1440]){
  const {ctx,page,release,calls}=await scenario({width});await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.flavor-skeleton:visible').count(),4);assert.equal(await page.locator('#monthly-flavors').getAttribute('aria-busy'),'true');
  assert.equal(await page.locator('.flavors-toolbar :enabled,.flavor-filters button:enabled').count(),0);
  assert.equal(await page.locator('.flavor-skeleton:not([aria-hidden=true])').count(),0);
  assert.equal(await page.locator('.flavor-skeleton-line').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const before=await page.locator('.flavor-skeleton .flavor-tile-image').first().boundingBox();
  await page.screenshot({path:join(out,`loading-${width}.png`),fullPage:true});
  release();await page.waitForFunction(()=>!document.querySelector('.flavors-shell').hasAttribute('data-loading'));
  assert.equal(await page.locator('.flavor-skeleton,[aria-busy=true]').count(),0);assert.equal(await page.locator('#monthly-flavors .flavor-tile:visible').count(),4);assert.equal(await page.locator('#next-month-flavors .flavor-tile:visible').count(),3);
  assert(await page.getByRole('searchbox').isEnabled());assert.equal(calls(),1);
  const after=await page.locator('#monthly-flavors .flavor-tile-image').first().boundingBox();assert(Math.abs(before.x-after.x)<1);assert(Math.abs(before.width-after.width)<1);
  await page.getByRole('searchbox').fill('creamy');assert.equal(await page.locator('#monthly-panel .flavor-tile:visible').count(),0);await page.getByRole('searchbox').fill('vanilla');assert.equal(await page.locator('#monthly-panel .flavor-tile:visible').count(),1);
  await page.getByRole('searchbox').fill('');await page.locator('#collection-tab').click();assert.equal(await page.locator('#other-flavors-grid .flavor-tile:visible').count(),7);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#monthly-tab').click();await page.screenshot({path:join(out,`loaded-${width}.png`),fullPage:true});
  await ctx.close();results.push(`${width}px delayed real loader: placeholders/disabled controls, actual row dimensions, ready states, name-only search, tabs, no overflow.`);
 }
 for(const mode of ['empty','unpublished','http','network','invalid','timeout','module']){
  const {ctx,page,release,calls}=await scenario({mode});
  if(mode!=='timeout')release();await page.waitForFunction(()=>!document.querySelector('.flavors-shell').hasAttribute('data-loading'));if(mode==='timeout')release();
  assert.equal(await page.locator('.flavor-skeleton,[aria-busy=true]').count(),0);assert.equal(await page.locator('#monthly-menu').isVisible(),false);
  if(mode==='module'){assert.match(await page.locator('#monthly-unavailable').innerText(),/couldn’t load/);assert(await page.getByRole('searchbox').isDisabled());}
  else{assert.match(await page.locator('#monthly-unavailable').innerText(),['empty','unpublished'].includes(mode)?/coming soon/:/temporarily unavailable/);await page.locator('#collection-tab').click();assert.equal(await page.locator('#other-flavors-grid .flavor-tile').count(),mode==='unpublished'?7:0);}
  assert.equal(calls(),1);await ctx.close();results.push(`${mode}: clears placeholders, no stale flavors, truthful final state.`);
 }
 for(const hash of ['#collection-panel','#flavor-speculoos']){
  const {ctx,page,release}=await scenario({hash});release();await page.waitForFunction(()=>!document.querySelector('.flavors-shell').hasAttribute('data-loading'));
  if(hash==='#collection-panel')assert.equal(await page.locator('#collection-tab').getAttribute('aria-selected'),'true');else assert.equal(await page.evaluate(()=>document.activeElement.dataset.flavor),'speculoos');await ctx.close();results.push(hash+': deep link preserved after loading.');
 }
 const {ctx,page,calls}=await scenario({javaScriptEnabled:false});await page.locator('.flavors-shell noscript p').waitFor();assert.equal(await page.locator('.flavor-skeleton:visible').count(),0);assert.equal(await page.locator('#filter-status').isVisible(),false);assert.match(await page.locator('.flavors-shell noscript p').innerText(),/Enable JavaScript/);assert.equal(calls(),0);await ctx.close();results.push('No JavaScript: no permanent loading state; fallback and shop link remain.');
 assert.deepEqual(errors,[]);await writeFile(join(out,'checks.json'),JSON.stringify({results,errors},null,2));console.log(`PASS ${results.length} flavor-loading scenarios, real content loader, zero page errors.`);
}finally{await browser.close();}
