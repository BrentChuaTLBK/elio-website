import {navigateDashboard} from '../helpers/dashboard-navigation.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://payments.test',output=resolve(root,'../test-results/payment-options');await mkdir(output,{recursive:true});
const source=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=source.slice(source.indexOf('export function money('));
const options=[{label:'GCash',account_name:'Test Shop',account_number:'09170000001',note:''},{label:'BDO',account_name:'Test Shop',account_number:'001234567890',note:''},{label:'East West',account_name:'Test Pastries Shop',account_number:'000987654321',note:''}];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try {
 for(const width of [1440,390,320]) {
  const errors=[],calls=[];let settings={shop_name:'Elio',paused:false,payment_options:structuredClone(options),payment_options_revision:1,payment_note:'',contact_email:'shop@example.test',contact_phone:'09170000002',pickup_address:'Test kitchen',pickup_hours:'9 AM–6 PM',site_url:origin,delivery_window:'9 AM–6 PM',reminder_time:'08:00',production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],blocked_dates:[],delivery_blocked_dates:[]};
  const original={id:'payment-test',reference:'ELIO-PAYMENT-TEST',created_at:new Date().toISOString(),revision:1,buyer:{name:'Test customer',email:'buyer@example.test',phone:'09170000003'},items:[{name:'Signature Trio',quantity:1,unit_price_cents:90000,line_total_cents:90000,selection_labels:[]}],subtotal_cents:90000,discount_cents:0,delivery_cents:0,total_cents:90000,method:'pickup',fulfillment_date:'2026-10-01',payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',payment_deadline:new Date(Date.now()+900000).toISOString(),payment_options:structuredClone(options),payment_note:'',payment_instructions:'Accepted Payment Methods:\n\n'+options.map(o=>[o.label,o.account_name,o.account_number].join('\n')).join('\n\n'),pickup_address:'Test kitchen',pickup_hours:'9 AM–6 PM',history:[]};
  let order=structuredClone(original);
  const ctx=await browser.newContext({viewport:{width,height:1100},hasTouch:width<500,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.__clipboardFail)throw Error('blocked');window.__copied.push(text);}},configurable:true});});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};export async function api(action,payload={}){const r=await fetch('/fixture',{method:'POST',body:JSON.stringify({action,payload})});if(!r.ok)throw Error('Unexpected API');return r.json();}export async function upload(file,options){return api('mock_upload',{name:file.name,...options})}export async function affiliateReceipt(){};export async function affiliatePayout(){};export async function newsletterRequest(){};export async function calendarConnection(){return {}} export async function websiteVisitorStats(){return {status:'not_configured'}};${helpers}`});
   if(url.pathname==='/fixture') {
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});let data;
    if(action==='admin_bootstrap')data={role:'owner',orders:[],products:[],categories:[],zones:[],staff:[],inventory:[],promos:[],settings};
    else if(action==='site_status')data={active:false,uploads_paused:false,announce:false,server_time:new Date().toISOString()};
    else if(action==='newsletter_settings')data={enabled:false};
    else if(action==='calendar_list')data={connection:{connected:false},orders:[]};
    else if(action==='catalog')data={settings,products:[],categories:[],zones:[],inventory:[]};
    else if(action==='get_order')data=order;
    else if(action==='save_settings'){settings=payload.settings;data=settings;}
    else if(action==='mock_upload'){assert.equal(payload.order_id,order.id);order={...order,payment_status:'under_review'};data={};}
    else throw Error('Unexpected action '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
   try {
    let body=await readFile(file);
    if(url.pathname==='/order.html')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,tag=>/src=["']assets\/shop\/shop\.js(?:\?[^"']*)?["']/.test(tag)?tag:'');
    return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream',body});
   }catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/order.html#order=payment-test');await page.locator('.payment-option').first().waitFor();assert.equal(await page.locator('.payment-option').count(),3);
  const buttons=page.locator('[data-copy-payment]');for(let index=0;index<6;index++)await buttons.nth(index).click();
  assert.deepEqual(await page.evaluate(()=>window.__copied),options.flatMap(o=>[o.account_name,o.account_number]));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.payment-options').screenshot({path:join(output,`customer-${width}.png`)});
  await page.evaluate(()=>{window.__clipboardFail=true;});await buttons.nth(3).click();assert.match(await page.locator('.payment-copy-status').textContent(),/selected/);assert.equal(await page.evaluate(()=>getSelection().toString()),'001234567890');
  await page.locator('[name=proof]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2FzQAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'Submit payment proof',exact:true}).click();await page.getByRole('heading',{name:'Your payment is under review',exact:true}).waitFor();assert.equal(await page.locator('.payment-options').count(),0);
  for(const changes of [{payment_status:'paid'},{fulfillment_status:'expired'},{refund_label:true},{uploads_paused:true,payment_seconds_remaining:600}]){order={...original,...changes};await page.reload();await page.locator('.order-title').waitFor();assert.equal(await page.locator('.payment-option').count(),0);assert.equal(await page.locator('#proof-form').count(),0);}
  order={...original};delete order.payment_options;await page.reload();await page.locator('.payment-option').first().waitFor();assert.equal(await page.locator('.payment-option').count(),3);
  // The same email URL resolves the current courier link on every visit.
  const trackingPage=origin+'/order.html#order=payment-test&token=fixture-token&section=tracking';
  for(const [changes,expected] of [
   [{delivery_tracking_url:null},null],
   [{delivery_tracking_url:'https://express.grab.com/track/first'},'https://express.grab.com/track/first'],
   [{delivery_tracking_url:'https://share.lalamove.com/tracking/replaced'},'https://share.lalamove.com/tracking/replaced'],
   [{delivery_tracking_url:null},null],
   [{delivery_tracking_url:'https://grab.com'},null],
   [{delivery_tracking_url:'https://lalamove.com'},null],
   [{delivery_tracking_url:'https://express.grab.com/track/first',refund_label:true},null],
   [{delivery_tracking_url:'https://express.grab.com/track/first',fulfillment_status:'cancelled'},null],
  ]){
   order={...original,recipient:{name:'Test customer',phone:'09170000003'},address:{line1:'Test address',locality:'Test city'},payment_status:'paid',method:'delivery',fulfillment_status:'out_for_delivery',...changes};
   await page.goto(trackingPage);await page.reload();try{await page.locator('#delivery-tracking').waitFor({timeout:8000});}catch(error){console.log({changes,errors,body:(await page.locator('body').innerText()).slice(-2200)});throw error;}
   assert.equal(await page.locator('#delivery-tracking a').count(),expected?1:0);
   if(expected){assert.equal(await page.locator('#delivery-tracking a').getAttribute('href'),expected);assert(!expected.includes('fixture-token'));}
   else assert.match(await page.locator('#delivery-tracking').textContent(),/not available yet|order is closed/);
   assert.equal(await page.locator('#print-order').count(),0);
   assert.equal(await page.locator('#delivery-tracking').evaluate(el=>document.activeElement===el),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.locator('#delivery-tracking').screenshot({path:join(output,`tracking-${width}.png`)});
  await page.goto(origin+'/manage.html');await navigateDashboard(page,'settings');assert.equal(await page.locator('.payment-option-editor').count(),3);
  assert.equal(await page.locator('.payment-option-editor details[open]').count(),0);
  const first=page.locator('.payment-option-editor').first();
  await first.locator('summary').click();await first.locator('[name=note]').fill('Edited before reordering');await first.locator('summary').click();
  await first.locator('[data-move-payment=down]').click();
  assert.equal(await page.locator('.payment-option-editor').nth(1).locator('[name=label]').inputValue(),'GCash');
  assert.equal(await page.locator('.payment-option-editor').nth(1).locator('[name=note]').inputValue(),'Edited before reordering');
  await page.locator('.payment-option-editor').nth(1).locator('[data-move-payment=up]').click();
  assert.equal(await page.locator('.payment-option-editor').first().locator('[data-move-payment=up]').isDisabled(),true);
  await page.getByRole('button',{name:'+ Add payment option',exact:true}).click();const fourth=page.locator('.payment-option-editor').nth(3);
  await fourth.locator('[name=label]').fill('Maya');await fourth.locator('[name=account_name]').fill('Test Shop');await fourth.locator('[name=account_number]').fill('09170000004');await fourth.locator('[name=note]').fill('Use your order reference.');
  await page.getByRole('button',{name:'Save shop settings',exact:true}).click();await page.getByText('Shop settings saved.',{exact:true}).waitFor();assert.equal(settings.payment_options.length,4);assert.equal(settings.payment_options[3].account_number,'09170000004');
  await page.reload();await navigateDashboard(page,'settings');assert.equal(await page.locator('.payment-option-editor').count(),4);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.payment-options-editor').screenshot({path:join(output,`admin-${width}.png`)});
  await page.screenshot({path:join(output,`settings-${width}.png`),fullPage:true});
  await page.locator('.payment-option-editor').nth(3).getByRole('button',{name:'Remove Maya'}).click();assert.equal(await page.locator('.payment-option-editor').count(),3);assert.equal(settings.payment_options.length,4);assert.equal(await page.locator('[name=contact_email]').inputValue(),'shop@example.test');
  // Native form validation reveals missing fields even when a method is collapsed.
  await page.locator('.payment-option-editor').first().locator('summary').click();
  await page.locator('.payment-option-editor').first().locator('[name=account_name]').fill('');
  await page.locator('.payment-option-editor').first().locator('summary').click();
  await page.getByRole('button',{name:'Save shop settings',exact:true}).click();
  assert.equal(await page.locator('.payment-option-editor').first().locator('details').evaluate(el=>el.open),true);
  order={...original,payment_options:structuredClone(settings.payment_options)};await page.goto(origin+'/order.html#order=payment-test');await page.getByRole('heading',{name:'Maya',exact:true}).waitFor();assert.equal(await page.locator('.payment-option').count(),4);
  order={...order,order_source:'direct',payment_deadline:null,payment_seconds_remaining:null};await page.reload();await page.locator('#proof-form').waitFor();assert.match(await page.locator('#app').textContent(),/link stays open/i);assert.doesNotMatch(await page.locator('#app').textContent(),/deadline has passed/i);
  for(const [charge,expected] of [
   [{state:'pending',recipient:'elio',fee_cents:null},/To be confirmed.*Pay Elio/],
   [{state:'courier',recipient:'courier',fee_cents:20000},/200.00.*Pay courier directly/],
   [{state:'quoted',recipient:'elio',fee_cents:20000},/200.00.*not yet received/],
   [{state:'paid',recipient:'elio',fee_cents:20000},/Paid to Elio separately/]
  ]){order={...order,recipient:{},address:{},method:'delivery',payment_status:'paid',paid_amount_cents:original.total_cents,fulfillment_status:'confirmed',delivery_charge:charge};await page.reload();await page.getByRole('heading',{name:'Your treats'}).waitFor();assert.match(await page.locator('#app').textContent(),expected);assert.equal(await page.locator('#proof-form').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);assert.equal(calls.filter(c=>c.action==='mock_upload').length,1);await ctx.close();console.log(`PASS payment copy, fallback, proof upload and closed states; admin adds/saves/removes methods ${width}px`);
 }
}finally{await browser.close();}
