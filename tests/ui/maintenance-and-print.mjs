import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://maintenance.test',output=resolve(root,'../test-results/maintenance');await mkdir(output,{recursive:true});
const source=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=source.slice(source.indexOf('export function money('));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const order={reference:'ELIO-PRINTTEST',buyer:{name:'Test customer',phone:'09170000000',social_platform:'na'},method:'pickup',fulfillment_date:'2026-09-30',fulfillment_status:'confirmed',payment_status:'paid',items:[{name:'The Signature Trio',quantity:1,unit_price_cents:90000,line_total_cents:90000,selection_labels:['Vanilla × 1','Chocolate × 1','Matcha × 1']}],subtotal_cents:90000,discount_cents:4500,delivery_cents:0,total_cents:85500,pickup_address:'Test kitchen',pickup_hours:'10 AM–6 PM',private_notes:'NEVER PRINT THIS'};
try{
 for(const width of [1440,390]){
  let settings={mode:'off',announce:false,pause_uploads:true,message:'A few improvements for your next Elio order.',starts_at:null,ends_at:null},revision=1,active=false,errors=[],calls=[];
  const emailAlert={id:'email-test',event_type:'order_review_required',status:'skipped',attempts:1,last_error:'Order no longer needs payment review.',reviewed_at:null};
  let pickupOrder={...order,id:'pickup-test',revision:1,fulfillment_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()),fulfillment_status:'ready_for_pickup',buyer:{...order.buyer,email:'pickup@example.test'}};
  const state=()=>({active,uploads_paused:active&&settings.pause_uploads,announce:settings.announce,message:settings.message,starts_at:settings.starts_at,ends_at:settings.ends_at,server_time:new Date().toISOString()});
  const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};export async function api(action,payload={}){const r=await fetch('/api',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};export async function affiliateReceipt(){};export async function affiliatePayout(){};export async function newsletterRequest(){};export async function upload(){};export async function calendarConnection(){return {}} export async function websiteVisitorStats(){};${helpers}`});
   if(u.pathname==='/api'){
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});let data;
    if(action==='site_status')data=state();
    else if(action==='admin_bootstrap')data={role:'owner',products:[],categories:[],orders:[pickupOrder],inventory:[],zones:[],staff:[],promos:[],email_status:[emailAlert],settings:{paused:false}};
    else if(action==='get_order')data=pickupOrder;
    else if(action==='send_pickup_reminder'){assert.equal(payload.order_id,pickupOrder.id);assert.equal(payload.revision,pickupOrder.revision);assert(payload.idempotency_key);pickupOrder={...pickupOrder,revision:2,pickup_reminder_count:1,pickup_reminder_requested_at:new Date().toISOString()};data=pickupOrder;}
    else if(action==='review_email_alert'){assert.equal(payload.id,emailAlert.id);assert.equal(payload.attempts,1);emailAlert.reviewed_at=new Date().toISOString();data={reviewed:true};}
    else if(action==='maintenance_admin')data={settings,revision,status:state()};
    else if(action==='save_maintenance'){assert.equal(payload.revision,revision);settings=payload.settings;revision++;active=settings.mode==='manual';data={settings,revision,status:state()};}
    else throw Error('Unexpected '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(['/index.html','/order.html'].includes(u.pathname))return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/site-maintenance.css"><script type="module" src="/assets/site-maintenance.js"></script></head><body><header>ELIO</header><main><h1>Storefront</h1></main></body></html>'});
   if(u.pathname==='/print-harness.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><button id="single">Print pickup</button><button id="batch">Print both</button><p id="error"></p><script type="module">import {printOrderSlips} from '/assets/admin/order-slips.js';const order=${JSON.stringify(order)};document.querySelector('#single').onclick=()=>printOrderSlips(order).catch(e=>document.querySelector('#error').textContent=e.message);document.querySelector('#batch').onclick=()=>printOrderSlips(async()=>[order,{...order,reference:'ELIO-DELIVERY',method:'delivery',recipient:{name:'Test recipient',phone:'09170000001'},address:{line1:'Test address',locality:'Quezon City'},delivery_cents:10000,total_cents:95500}]).catch(e=>document.querySelector('#error').textContent=e.message);</script>`});
   if(u.pathname==='/assets/admin/order-print.html')return route.fulfill({status:307,headers:{location:'/assets/admin/order-print'+u.search},body:''});
   const file=resolve(root,'.'+(u.pathname==='/assets/admin/order-print'?u.pathname+'.html':u.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/manage.html');
  await page.getByRole('button',{name:'Acknowledge & dismiss',exact:true}).waitFor();await page.locator('.email-alert').screenshot({path:join(output,`email-alert-${width}.png`)});
  await page.getByRole('button',{name:'Acknowledge & dismiss',exact:true}).click();await page.getByText('Reviewed notifications (1)',{exact:true}).waitFor();
  await page.reload();await page.getByText('Reviewed notifications (1)',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Acknowledge & dismiss',exact:true}).count(),0);
  await page.getByText('Reviewed notifications (1)',{exact:true}).click();await page.locator('.email-reviewed p').waitFor();assert.match(await page.locator('.email-reviewed p').textContent(),/Order no longer needs payment review\./);
  if(!await page.locator('#dashboard-navigation').evaluate(e=>e.open))await page.locator('#dashboard-navigation>summary').click();
  await page.locator('[data-view=orders]').click();await page.locator('[data-action=open-order]').first().click();
  await page.getByRole('button',{name:'Send pickup reminder',exact:true}).click();await page.getByText('Pickup reminder queued. Check Email delivery for its status.',{exact:true}).waitFor();
  assert.equal(calls.filter(call=>call.action==='send_pickup_reminder').length,1);assert.match(await page.locator('.pickup-reminder').textContent(),/pickup@example.test.*Last requested/s);
  await page.locator('.pickup-reminder').screenshot({path:join(output,`pickup-reminder-${width}.png`)});await page.keyboard.press('Escape');
  if(!await page.locator('#dashboard-navigation').evaluate(e=>e.open))await page.locator('#dashboard-navigation>summary').click();
  await page.locator('[data-view=maintenance]').click();await page.locator('.maintenance-form').waitFor();
  const form=page.locator('.maintenance-form');assert.equal(await form.locator('[name=pause_uploads]').isChecked(),true);
  assert.equal(await form.locator('[type=datetime-local]').count(),0);
  const chooseDate=async(name,date)=>{
   const wrapper=form.locator('.accounting-datetime-field').filter({has:page.locator(`[name="${name}"]`)}),picker=wrapper.locator('.accounting-date-picker');
   await picker.locator('summary').click();await picker.locator('[data-date-year]').fill(date.slice(0,4));await picker.locator('[data-date-year]').press('Tab');await picker.locator('[data-date-month]').selectOption(date.slice(5,7));await picker.locator(`[data-date-value="${date}"]`).click();return wrapper;
  };
  await chooseDate('starts','2026-10-01');
  const startPicker=form.locator('.accounting-date-picker').filter({has:page.locator('[name=starts__date]')});
  await startPicker.locator('summary').click();await startPicker.getByRole('button',{name:'Clear date',exact:true}).click();assert.equal(await form.locator('[name=starts]').inputValue(),'');
  await form.locator('[name=mode]').selectOption('scheduled');await form.locator('[type=submit]').click();assert.equal(calls.filter(c=>c.action==='save_maintenance').length,0);assert(await form.locator('[data-date-error]:not([hidden])').count());
  const starts=await chooseDate('starts','2026-10-01');await starts.locator('[data-datetime-hour]').selectOption('23');await starts.locator('[data-datetime-minute]').selectOption('00');
  const ends=await chooseDate('ends','2026-10-02');await ends.locator('[data-datetime-hour]').selectOption('00');await ends.locator('[data-datetime-minute]').selectOption('00');
  const endPicker=ends.locator('.accounting-date-picker');await endPicker.locator('summary').click();
  await page.screenshot({path:join(output,`maintenance-calendar-${width}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await endPicker.locator('[data-date-value="2026-10-02"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.dateValue),'2026-10-03');await page.keyboard.press('Escape');assert.equal(await endPicker.evaluate(e=>e.open),false);assert(await endPicker.locator('summary').evaluate(e=>e===document.activeElement));
  await form.locator('[name=announce]').check();await form.locator('[type=submit]').click();await page.getByText('Maintenance settings saved.',{exact:true}).waitFor();
  assert.equal(await form.locator('[name=starts]').inputValue(),'2026-10-01T23:00');assert.equal(await form.locator('[name=ends]').inputValue(),'2026-10-02T00:00');
  assert.equal(settings.starts_at,'2026-10-01T15:00:00.000Z');assert.equal(settings.ends_at,'2026-10-01T16:00:00.000Z');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(output,`admin-${width}.png`),fullPage:true});
  await page.goto(origin+'/index.html');await page.getByText('Planned maintenance',{exact:true}).waitFor();assert.equal(await page.locator('#site-maintenance-screen').isVisible(),false);assert(await page.getByRole('heading',{name:'Storefront'}).isVisible());
  active=true;await page.reload();await page.getByRole('heading',{name:'A little care behind the scenes.',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Storefront'}).isVisible(),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(output,`storefront-${width}.png`),fullPage:true});
  await page.goto(origin+'/order.html#order=existing');await page.getByText('Website maintenance',{exact:true}).waitFor();assert(await page.getByRole('heading',{name:'Storefront'}).isVisible());assert.equal(await page.locator('#site-maintenance-screen').isVisible(),false);
  active=false;await page.reload();await page.getByText('Planned maintenance',{exact:true}).waitFor();assert.equal(await page.locator('#site-maintenance-screen').isVisible(),false);
  await page.goto(origin+'/print-harness.html');
  for(const kind of ['single','batch']){
   const next=page.waitForEvent('popup');await page.locator('#'+kind).click();const print=await next;print.on('pageerror',e=>errors.push(e.message));
   await print.locator('.print-slips:not([disabled])').waitFor({timeout:15000}).catch(async e=>{throw Error(`${e.message}; preview: ${await print.locator('[role=status]').textContent()}; launcher: ${await page.locator('#error').textContent()}; errors: ${errors.join(', ')}`);});assert.match(print.url(),/order-print\?v=/);assert.equal(await print.locator('.slip').count(),kind==='single'?1:2);
   assert.match(await print.locator('#slips').textContent(),/The Signature Trio/);assert(!((await print.locator('#slips').textContent()).includes('NEVER PRINT THIS')));
   if(kind==='batch')assert.match(await print.locator('#slips').textContent(),/Test recipient.*Test address/s);
   await print.locator('#paper-size').selectOption('letter');assert.equal(await print.locator('.print-sheet').first().getAttribute('data-paper'),'letter');
   await print.evaluate(()=>{window.print=()=>{window.__printed=true;}});await print.locator('.print-slips').click();assert.equal(await print.evaluate(()=>window.__printed),true);
   if(width===1440&&kind==='batch'){await print.screenshot({path:join(output,'pickup-delivery-slips.png'),fullPage:true});await print.pdf({path:join(output,'pickup-delivery-slips.pdf'),preferCSSPageSize:true,printBackground:true});}
   await print.close();assert.equal(await page.locator('#error').textContent(),'');
  }
  assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS maintenance controls, storefront, existing order access, pickup/delivery and batch printing ${width}px`);
 }
}finally{await browser.close();}
