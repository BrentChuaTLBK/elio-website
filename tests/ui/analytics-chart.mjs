import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),output=resolve(root,'../test-results/analytics-chart'),origin='https://chart.test';await mkdir(output,{recursive:true});
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
const day=offset=>new Date(Date.parse(today+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
const dateLabel=date=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}).format(new Date(date+'T12:00:00+08:00'));
const sale=(id,date,amount,changes={})=>({id,reference:id,created_at:date+'T10:00:00+08:00',fulfillment_date:date,method:'pickup',payment_status:'paid',fulfillment_status:'completed',buyer:{email:'fixture@example.test'},items:[],subtotal_cents:amount,discount_cents:0,delivery_cents:0,total_cents:amount,...changes});
const orders=[sale('a',day(-3),13000),sale('b',day(-3),20000),sale('c',day(-2),13000),sale('d',today,58000),sale('refund',day(-2),999999,{refund_label:true}),sale('cancelled',day(-2),999999,{fulfillment_status:'cancelled'}),sale('unpaid',day(-2),999999,{payment_status:'awaiting_payment'})];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{
 for(const width of [1440,390,320]){
  const errors=[],ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};export async function api(action,payload={}){const r=await fetch('/fixture',{method:'POST',body:JSON.stringify({action,payload})});if(!r.ok)throw Error('Unexpected API');return r.json();};export async function calendarConnection(){return {}} export async function websiteVisitorStats(){return {status:'not_configured'}};export async function affiliateReceipt(){};export async function affiliatePayout(){};export async function upload(){};export async function newsletterRequest(){};${helpers}`});
   if(url.pathname==='/fixture'){
    const {action}=route.request().postDataJSON();let data;
    if(action==='admin_bootstrap')data={role:'owner',orders,products:[],categories:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
    else if(action==='site_status')data={active:false,uploads_paused:false,announce:false,server_time:new Date().toISOString()};
    else throw Error('Unexpected action '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/manage.html');await page.locator('[data-view=analytics]').click();
  await page.locator('#analytics-period').selectOption('last7');
  const points=page.locator('.analytics-chart-point'),tooltip=page.locator('.analytics-chart-tooltip'),chart=page.locator('[data-sales-chart]');
  const target=page.locator(`.analytics-chart-point[data-period="${dateLabel(day(-2))}"]`);
  const twoOrders=page.locator(`.analytics-chart-point[data-period="${dateLabel(day(-3))}"]`);
  // Point buttons include the blank area above a bar; interact with the painted
  // bar so the tooltip above it does not overlap the pointer's target.
  const targetBar=target.locator('.analytics-chart-bar'),twoOrderBar=twoOrders.locator('.analytics-chart-bar');
  assert.equal(await points.count(),7);assert.equal(await tooltip.isVisible(),false);assert.equal(await points.first().getAttribute('title'),null);
  if(width===1440){
   await targetBar.hover();await tooltip.waitFor();assert.equal(await tooltip.locator('[data-chart-sales]').textContent(),'₱130.00');assert.equal(await tooltip.locator('[data-chart-orders]').textContent(),'1 paid order');
   await tooltip.hover();assert(await tooltip.isVisible());await page.getByRole('heading',{name:'Sales over time',exact:true}).hover();assert.equal(await tooltip.isVisible(),false);
   await twoOrderBar.click();await page.getByRole('heading',{name:'Sales over time',exact:true}).hover();assert(await tooltip.isVisible());
  }else await twoOrderBar.tap();
  assert.equal(await tooltip.locator('[data-chart-sales]').textContent(),'₱330.00');assert.equal(await tooltip.locator('[data-chart-orders]').textContent(),'2 paid orders');assert.equal(await twoOrders.getAttribute('aria-pressed'),'true');
  if(width===1440)await twoOrderBar.click();else await twoOrderBar.tap();assert.equal(await tooltip.isVisible(),false);
  if(width===1440){await page.getByRole('heading',{name:'Sales over time',exact:true}).hover();assert.equal(await tooltip.isVisible(),false);}
  await target.focus();await target.press('ArrowRight');assert.equal(await tooltip.locator('[data-chart-sales]').textContent(),'₱0.00');assert.equal(await tooltip.locator('[data-chart-orders]').textContent(),'0 paid orders');
  await page.keyboard.press('Escape');assert.equal(await tooltip.isVisible(),false);
  await page.keyboard.press('Home');assert.equal(await points.first().evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('End');assert.equal(await points.last().evaluate(el=>el===document.activeElement),true);assert.equal(await tooltip.locator('[data-chart-sales]').textContent(),'₱580.00');
  const fits=()=>tooltip.evaluate(el=>{const box=el.getBoundingClientRect(),chart=el.closest('[data-sales-chart]').getBoundingClientRect();return box.left>=chart.left&&box.right<=chart.right&&box.top>=chart.top;});assert(await fits());
  await page.getByRole('heading',{name:'Sales over time',exact:true}).click();assert.equal(await tooltip.isVisible(),false);
  if(width===1440)await targetBar.hover();else await targetBar.tap();await tooltip.waitFor();assert(await fits());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.analytics-trend').screenshot({path:join(output,`sales-${width}.png`)});
  await page.locator('#analytics-period').selectOption('this_month');assert.equal(await tooltip.isVisible(),false);
  await points.last().focus();await points.last().press('Enter');assert(await tooltip.isVisible());assert(await fits());
  const scroller=chart.locator('.analytics-chart-scroll');
  if(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth)){
   await scroller.evaluate(el=>{el.scrollLeft=0;});await page.waitForFunction(()=>document.querySelector('.analytics-chart-tooltip').hidden);
   await scroller.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await tooltip.waitFor();assert(await fits());
  }
  await page.getByRole('button',{name:'Refresh analytics',exact:true}).click();assert.equal(await tooltip.isVisible(),false);await points.last().focus();assert(await tooltip.isVisible());
  await page.locator('#analytics-period').selectOption('custom');await page.locator('[name=start]').fill(day(-90));await page.locator('[name=end]').fill(today);await page.getByRole('button',{name:'Apply dates',exact:true}).click();
  await points.last().focus();assert.match(await tooltip.locator('[data-chart-period]').textContent(),/ – /);assert.match(await page.locator('.analytics-trend .badge').textContent(),/Weekly/);
  await page.locator('[name=start]').fill(day(-400));await page.getByRole('button',{name:'Apply dates',exact:true}).click();await points.last().focus();assert.match(await page.locator('.analytics-trend .badge').textContent(),/Monthly/);assert(await fits());
  assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS sales tooltip hover/tap, keyboard, totals/exclusions, scrolling, refresh and daily/weekly/monthly ranges ${width}px`);
 }
}finally{await browser.close();}
