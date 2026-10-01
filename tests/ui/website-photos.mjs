import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve,extname} from 'node:path';
import {photoSlots} from '../../dist/assets/website-photo-slots.js';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve('dist'),out=resolve('test-results/website-photos'),origin='https://eliocheesecakes.com',owner='11111111-1111-4111-8111-111111111111';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const photos=Object.fromEntries(photoSlots.map(s=>[s.id,{path:null,alt:'',position_x:50,position_y:50,revision:0}])),uploads=[],checks=[],control={failSave:false,failRead:false};
const sdk=`export function createClient(){return {
 auth:{initialize:async()=>({error:null}),onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:'${owner}',email:'owner@example.test'}}}}),getUser:async()=>({data:{user:{id:'${owner}'}}})},
 rpc:async(name,body)=>{try{return {data:await window.photoRpc(body)}}catch(error){return {error:{message:error.message}}}},
 storage:{from:bucket=>({upload:async(path,file)=>{await window.photoUpload({bucket,path,type:file.type,size:file.size,header:[...new Uint8Array(await file.slice(0,12).arrayBuffer())]});return {};},getPublicUrl:path=>({data:{publicUrl:'https://dzxyhckkkrzqpwpavngn.supabase.co/storage/v1/object/public/website-images/'+path}})})},functions:{invoke:async()=>({data:{}})}}};`;
async function rpc({p_action:a,p_payload:p={}}){
 if(a==='site_status')return {active:false,announce:false,server_time:new Date().toISOString()};
 if(a==='website_photos'){if(control.failRead)throw Error('Temporary service failure');return {photos:structuredClone(photos)};}
 if(a==='save_website_photo'){
  if(control.failSave){control.failSave=false;throw Error('Temporary save failure. Try again.');}
  if(p.revision!==photos[p.slot].revision)throw Error('This photo changed. Reload the saved photo before saving again.');
  const row={path:p.path,alt:p.path?p.alt:'',position_x:p.path?p.position_x:50,position_y:p.path?p.position_y:50,revision:p.revision+1};photos[p.slot]=row;return row;
 }
 if(a==='admin_bootstrap')return {role:'owner',products:[],categories:[],orders:[],inventory:[],promos:[],zones:[],settings:{paused:false},staff:[]};
 if(a==='home_catalog')return {flavors:[],boxes:[]};
 if(a==='flavor_collection')return {flavors:[],monthly:[],next_monthly:[]};
 return {};
}
async function context(width){
 const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
 await ctx.exposeFunction('photoRpc',rpc);await ctx.exposeFunction('photoUpload',async info=>uploads.push(info));
 await ctx.addInitScript(()=>{localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.href==='https://esm.sh/@supabase/supabase-js@2.102.0')return route.fulfill({contentType:'text/javascript',body:sdk});
  if(u.pathname==='/rest/v1/rpc/shop_api'){try{return route.fulfill({contentType:'application/json',body:JSON.stringify(await rpc(route.request().postDataJSON()))});}catch{return route.fulfill({status:503,body:'{}'});}}
  if(u.pathname.startsWith('/storage/v1/object/public/website-images/')){
   if(u.pathname.includes('ffffffff-ffff-ffff-ffff-ffffffffffff'))return route.fulfill({status:404});
   return route.fulfill({contentType:'image/webp',body:await readFile(join(root,'assets/home-editorial-gift.webp'))});
  }
  if(u.origin!==origin)return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  try{const path=join(root,u.pathname==='/'?'index.html':u.pathname);return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.ttf':'font/ttf'})[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.fulfill({status:404,body:''});}
 });return ctx;
}
async function clearLayout(page){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
try{
 const ctx=await context(1440),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/manage.html#website-photos');await page.getByRole('heading',{name:'Website photos',exact:true}).waitFor();await clearLayout(page);
 const card=()=>page.locator('[data-photo-slot="home_hero"]');
 assert.equal(await page.locator('[data-photo-slot]').count(),5);
 const png=await page.screenshot({clip:{x:0,y:0,width:600,height:400}});
 await card().locator('[type=file]').setInputFiles({name:'new-banner.png',mimeType:'image/png',buffer:png});
 await card().getByText('Unsaved photo changes.',{exact:true}).waitFor();
 assert.equal(photos.home_hero.path,null);assert.equal(uploads.length,0);
 await card().locator('[name=alt]').fill('Freshly baked cheesecakes');
 await card().locator('[name=position_x]').fill('72');await card().locator('[name=position_y]').fill('38');
 await page.locator('[data-view=settings]').click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert(await card().isVisible());
 control.failSave=true;await card().getByRole('button',{name:'Save photo',exact:true}).click();await card().getByRole('alert').waitFor();assert.equal(photos.home_hero.path,null);
 assert.equal(uploads.length,1);assert.equal(uploads[0].bucket,'website-images');assert.equal(uploads[0].type,'image/webp');assert.equal(String.fromCharCode(...uploads[0].header.slice(8)),'WEBP');
 await card().getByRole('button',{name:'Save photo',exact:true}).click();await card().getByText('Saved. This photo is now published.',{exact:true}).waitFor();assert.equal(uploads.length,1);assert.equal(photos.home_hero.position_x,72);
 await card().locator('[name=alt]').fill('Pending conflicting description');photos.home_hero.revision++;
 await card().getByRole('button',{name:'Save photo',exact:true}).click();await card().getByRole('alert').waitFor();assert.equal(photos.home_hero.alt,'Freshly baked cheesecakes');
 await card().getByRole('button',{name:'Reload saved',exact:true}).click();await card().getByText('Your photo is published.',{exact:true}).waitFor();assert.equal(await card().locator('[name=alt]').inputValue(),'Freshly baked cheesecakes');
 await card().getByRole('button',{name:'Restore original',exact:true}).click();assert.notEqual(photos.home_hero.path,null);await card().getByRole('button',{name:'Save photo',exact:true}).click();await card().getByText('Saved. This photo is now published.',{exact:true}).waitFor();assert.equal(photos.home_hero.path,null);
 checks.push('Owner upload converts PNG to WebP, previews before publishing, retains failed drafts, retries without duplicate uploads, rejects stale saves, and restores the original only on Save.');
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await clearLayout(page);await page.screenshot({path:join(out,'admin-'+width+'.png'),fullPage:true});}
 for(const p of ['story','shop','flavors']){await page.locator(`[data-photo-page="${p}"]`).click();assert.equal(await page.locator('[data-photo-slot]').count(),photoSlots.filter(s=>s.page===p).length);await clearLayout(page);}
 await ctx.close();assert.deepEqual(errors,[]);
 checks.push('All 14 photo slots grouped by page; admin navigation and layouts pass at 1440, 768, 390 and 320 pixels.');
 // Publish independent fixtures for every binding, including a dynamically inserted popup image.
 for(const [i,slot] of photoSlots.entries())photos[slot.id]={path:owner+'/'+`${String(i+1).padStart(8,'0')}-2222-4222-8222-222222222222.webp`,alt:'Replacement '+slot.id,position_x:23+i,position_y:40,revision:2};
 for(const width of [1440,390,320]){
  const ctx=await context(width),page=await ctx.newPage();
  for(const file of ['index.html','story.html','order.html','flavors.html']){
   await page.goto(origin+'/'+file);await page.waitForFunction(()=>[...document.querySelectorAll('[data-website-photo]')].every(n=>n.dataset.websitePhotoApplied));await clearLayout(page);
   const applied=await page.locator('[data-website-photo]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.websitePhoto,src:n.getAttribute(n.tagName==='SOURCE'?'srcset':'src')})));
   for(const n of applied)assert(n.src.endsWith(photos[n.id].path),JSON.stringify(n));
   if(file==='index.html'){
    await page.evaluate(()=>location.hash='#box');
    await page.locator('[data-website-photo=home_gift_detail]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-website-photo=home_gift_detail]').dataset.websitePhotoApplied);
    assert(await page.locator('[data-photo-disclaimer]').isHidden());await page.keyboard.press('Escape');
   }
   if(file==='order.html'){
    const gift=page.locator('img[data-website-photo=shop_gift]');const actual=await gift.evaluate(img=>({src:img.currentSrc,position:img.style.objectPosition,alt:img.alt}));const id=width<=600?'shop_gift_mobile':'shop_gift';assert(actual.src.endsWith(photos[id].path));assert.equal(actual.alt,photos[id].alt);
    await page.setViewportSize({width:width<=600?1440:390,height:1000});await page.waitForTimeout(50);const switched=width<=600?'shop_gift':'shop_gift_mobile';assert.equal(await gift.getAttribute('alt'),photos[switched].alt);await page.setViewportSize({width,height:1000});
   }
   await page.locator('.elio-footer').screenshot({path:join(out,file.replace('.html','')+'-footer-'+width+'.png')});
  }
  await ctx.close();
 }
 checks.push('Every public binding uses its own saved photo and description; dynamic gifting popup and responsive shop picture switch correctly. Footers fit all four pages at 1440, 390 and 320 pixels.');
 const ctx2=await context(390),fallback=await ctx2.newPage();control.failRead=true;await fallback.goto(origin+'/story.html');await fallback.waitForTimeout(300);assert((await fallback.locator('[data-website-photo=story_hero]').getAttribute('src')).startsWith('assets/'));
 control.failRead=false;photos.story_hero.path=owner+'/ffffffff-ffff-ffff-ffff-ffffffffffff.webp';await fallback.reload();await fallback.waitForTimeout(300);assert((await fallback.locator('[data-website-photo=story_hero]').getAttribute('src')).startsWith('assets/'));await clearLayout(fallback);await ctx2.close();
 checks.push('Settings outage and missing replacement image retain the original photo.');
}finally{await browser.close();await writeFile(join(out,'checks.json'),JSON.stringify(checks,null,2));}
console.log(JSON.stringify(checks,null,2));
