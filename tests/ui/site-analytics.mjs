import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),output=resolve(root,'../test-results/analytics');await mkdir(output,{recursive:true});
const origin='https://eliocheesecakes.com',measurement='G-0DJM12X1FV',key='elio-analytics-choice-v1';
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const modules='<link rel="stylesheet" href="/assets/site-analytics.css"><script type="module" src="/assets/site-analytics.js"></script>';
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private title must not be sent</title>${modules}</head><body><h1>Elio</h1><p data-analytics-status></p><button data-analytics-preference>Allow analytics</button><input type="email" value="buyer@example.test"><dialog id="test-dialog">Newsletter</dialog></body></html>`;
async function setup({width=1440,consent=null,privateBrowser=false,blockedStorage=false,liveTag=false,realPage=false}={}){
 const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),scripts=[],collections=[],errors=[];
 await ctx.addInitScript(({key,consent,privateBrowser,blockedStorage})=>{
  if(consent)localStorage.setItem(key,JSON.stringify({value:consent,expires:Date.now()+86400000}));
  if(privateBrowser)Object.defineProperty(navigator,'globalPrivacyControl',{value:true});
  if(blockedStorage){Storage.prototype.getItem=()=>{throw Error('Blocked storage')};Storage.prototype.setItem=()=>{throw Error('Blocked storage')};}
 },{key,consent,privateBrowser,blockedStorage});
 await ctx.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='www.googletagmanager.com'&&url.pathname==='/gtag/js'){
   scripts.push({url:url.href,referrer:request.headers().referer});
   if(liveTag)return route.continue();
   return route.fulfill({contentType:'text/javascript',body:'window.__googleLoaded = true;'});
  }
  if(/(^|\.)google-analytics\.com$/.test(url.hostname)){
   collections.push({url:url.href,body:request.postData()||''});
   return route.fulfill({status:204,body:''}); // Never send test events to Elio's reports.
  }
  if(!['eliocheesecakes.com','preview.test','localhost'].includes(url.hostname))return route.abort();
  if(url.pathname.startsWith('/assets/')||url.pathname.endsWith('.css')){
   try{return route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[extname(url.pathname)]||'text/plain',body:await readFile(join(root,url.pathname))});}catch{return route.fulfill({status:404,body:''});}
  }
  const body=realPage?await readFile(join(root,'privacy.html'),'utf8'):fixture;
  return route.fulfill({contentType:'text/html',body});
 });
 const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
 return {ctx,page,scripts,collections,errors};
}
const queue=page=>page.evaluate(()=>Array.from(window.dataLayer||[],entry=>Array.from(entry)));
const pause=page=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
try{
 for(const name of ['index','flavors','box','order','newsletter','privacy','terms'])assert.equal((await readFile(join(root,name+'.html'),'utf8')).split('src="assets/site-analytics.js"').length,2);
 for(const name of ['account','admin-account','manage','affiliate'])assert(!(await readFile(join(root,name+'.html'),'utf8')).includes('site-analytics.js'));
 for(const width of [1440,390,320]){
  const t=await setup({width,realPage:true});await t.page.goto(origin+'/privacy.html');
  await t.page.locator('.elio-analytics-choice').waitFor();assert.equal(t.scripts.length,0);assert.deepEqual(await queue(t.page),[]);
  assert.equal(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await t.page.screenshot({path:join(output,`choice-${width}.png`),fullPage:true});
  await t.page.locator('[data-analytics-choice=denied]').click();assert.equal(t.scripts.length,0);
  await t.page.reload();assert.equal(await t.page.locator('.elio-analytics-choice').count(),0);assert.equal(t.scripts.length,0);
  await t.page.locator('[data-analytics-preference]').click();await t.page.waitForFunction(()=>window.__googleLoaded);
  assert.equal(t.scripts.length,1);assert.equal(t.scripts[0].referrer,undefined);
  const messages=await queue(t.page);assert.equal(messages.filter(m=>m[0]==='event'&&m[1]==='page_view').length,1);
  const config=messages.find(m=>m[0]==='config');assert.equal(config[1],measurement);assert.equal(config[2].send_page_view,false);assert.equal(config[2].allow_google_signals,false);
  await t.page.evaluate(()=>{document.cookie='_ga=fixture; path=/; Secure';document.cookie='_ga_0DJM12X1FV=fixture; path=/; Secure';});
  await t.page.locator('[data-analytics-preference]').click();assert.equal(await t.page.evaluate(id=>window['ga-disable-'+id],measurement),true);assert(!await t.page.evaluate(()=>document.cookie.includes('_ga')));
  await t.page.reload();assert.equal(t.scripts.length,1);assert.deepEqual(t.errors,[]);await t.ctx.close();
  console.log(`PASS Analytics consent, preferences and mobile layout ${width}px`);
 }
 const t=await setup({consent:'granted'});await t.page.goto(origin+'/order.html?product=box-123&utm_source=test#your-bag',{referer:origin+'/account.html?code=SECRET_AUTH'});await t.page.waitForFunction(()=>window.__googleLoaded);
 const messages=await queue(t.page),config=messages.find(m=>m[0]==='config')[2];
 assert.equal(config.page_location,origin+'/order.html');assert.equal(config.page_title,'Shop · Elio Cheesecakes');assert.equal(config.page_referrer,origin+'/');assert(!JSON.stringify(messages).match(/SECRET_AUTH|box-123|buyer@|your-bag|Private title/));
 await t.page.evaluate(()=>location.hash='shop-gifting');await pause(t.page);assert.equal((await queue(t.page)).filter(m=>m[0]==='event').length,1);
 await t.page.evaluate(()=>{window.dispatchEvent(new Event('elio-private-order'));window.__disabledBeforeToken=window['ga-disable-G-0DJM12X1FV'];location.hash='order=PRIVATE&token=SECRET';});assert.equal(await t.page.evaluate(()=>window.__disabledBeforeToken),true);
 await t.page.evaluate(()=>location.hash='your-bag');assert.equal(await t.page.evaluate(id=>window['ga-disable-'+id],measurement),true);await t.ctx.close();
 console.log('PASS Canonical page views, clean referrers, no duplicate anchors and private checkout transition');
 for(const path of ['/account.html','/manage.html','/affiliate.html','/order.html#order=PRIVATE&token=SECRET','/newsletter.html#unsubscribe=SECRET','/?code=SECRET','/#access_token=SECRET','/?preview=1']){
  const t=await setup({consent:'granted'});await t.page.goto(origin+path);await pause(t.page);assert.equal(t.scripts.length,0,path);assert.equal(await t.page.locator('.elio-analytics-choice').count(),0,path);await t.ctx.close();
 }
 for(const options of [{privateBrowser:true,consent:'granted'},{blockedStorage:true}]){
  const t=await setup(options);await t.page.goto(origin+'/');await pause(t.page);assert.equal(t.scripts.length,0);
  if(options.blockedStorage){await t.page.locator('[data-analytics-choice=granted]').click();await t.page.waitForFunction(()=>window.__googleLoaded);}
  assert.deepEqual(t.errors,[]);await t.ctx.close();
 }
 const preview=await setup({consent:'granted'});await preview.page.goto('https://preview.test/');await pause(preview.page);assert.equal(preview.scripts.length,0);await preview.ctx.close();
 console.log('PASS Private routes, previews, browser privacy signals and unavailable storage');
 if(process.env.ANALYTICS_LIVE_TAG==='1'){
  const t=await setup({liveTag:true,consent:'granted'});await t.page.goto(origin+'/flavors.html?utm_source=test',{referer:origin+'/account.html?code=PRIVATE_AUTH'});
  for(let i=0;i<40&&!t.collections.length;i++)await t.page.waitForTimeout(250);
  assert(t.collections.length,'The real Google tag must attempt a collection request');
  const events=t.collections.map(r=>{const params=new URL(r.url).searchParams;for(const [k,v] of new URLSearchParams(r.body))params.set(k,v);return params;});
  const views=events.filter(p=>p.get('en')==='page_view');assert.equal(views.length,1);assert.equal(views[0].get('tid'),measurement);assert.equal(views[0].get('dl'),origin+'/flavors.html');assert.equal(views[0].get('dr'),origin+'/');
  assert(!JSON.stringify(t.collections).match(/PRIVATE_AUTH|buyer%40|buyer@|utm_source|Private.title/));
  await t.ctx.close();console.log('PASS Real Google tag emits one clean page view; test collection intercepted, not transmitted');
 }
}finally{await browser.close();}
