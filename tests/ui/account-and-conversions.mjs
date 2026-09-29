import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),output=resolve(root,'../test-results/account'),origin='https://account.test';await mkdir(output,{recursive:true});
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{
 for(const width of [1440,390,320]){
  let subscribed=false,failSave=false,showOrder=false,converted=1,missingTerms=false;const calls=[],errors=[];
  const settings=()=>({enabled:true,discount_percent:5,min_subtotal_cents:50000,cap_cents:10000,expiry_days:14,revision:1,own_status:subscribed?'subscribed':'unsubscribed',known_subscriber:true});
  const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/auth/v1/settings')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{"google":true}}'});
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`
    const guest=location.search.includes('guest');export const configured=true,ready=Promise.resolve(),initializationError=null,authLink={};
    export const auth={getSession:async()=>({data:{session:guest?null:{user:{id:'owner',email:'elio@example.test',email_confirmed_at:'2026-09-01',user_metadata:{}}}}}),onAuthStateChange:fn=>{window.__authChange=fn;},signOut:async()=>({})};
    export async function api(action,payload={}){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
    export async function newsletterRequest(){return {status:'not_subscribed'}};export async function upload(){throw Error('Unexpected upload')};export async function affiliatePayout(){throw Error('Unexpected payout')};export async function affiliateReceipt(){throw Error('Unexpected receipt')};export async function calendarConnection(){return {}} export async function websiteVisitorStats(){return {}};${helpers}`});
   if(u.pathname==='/fixture-api'){
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});let data;
    if(action==='site_status')data={active:false,uploads_paused:false,announce:false,server_time:new Date().toISOString()};
    else if(action==='newsletter_settings')data=settings();
    else if(action==='newsletter_account_preference'){if(failSave)return route.fulfill({status:400,contentType:'application/json',body:'{"error":"Please try again."}'});subscribed=payload.subscribed;data=settings();}
    else if(action==='my_vouchers')data={vouchers:[],total:0,offset:0,limit:50,counts:{available:0,used:0,expired:0}};
    else if(action==='account_access')data={role:'owner'};
    else if(action==='affiliate_status')data={assigned:true};
    else if(action==='my_orders')data=showOrder?[{id:'order-1',reference:'ELIO-TEST01',fulfillment_date:'2026-09-30',method:'pickup',payment_status:'awaiting_payment',total_cents:95000}]:[];
    else if(action==='admin_bootstrap')data={role:'owner',products:[],categories:[],orders:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
    else if(action==='newsletter_admin')data={settings:settings(),offer_counts:{issued:4,expired:1,converted},offer_total:1,offers:[{id:'code',email:'elio@example.test',code:'AB3D4F',issued_at:'2026-09-01',expires_at:'2026-09-08',offer_terms:missingTerms?undefined:{kind:'percent',value:10,min_subtotal_cents:75000,cap_cents:15000},conversion_status:converted?'converted':'expired'}]};
    else throw Error('Unexpected API '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
  await page.goto(origin+'/account.html');await page.getByText('You’re not subscribed to the Elio Newsletter.',{exact:true}).waitFor();
  assert(await page.getByRole('heading',{name:'Welcome back',exact:true}).isVisible());assert(await page.locator('#staff-dashboard').isVisible());assert(await page.locator('#affiliate-dashboard').isVisible());
  assert(await page.getByText('Your next sweet moment starts here',{exact:true}).isVisible());
  const form=page.locator('#email-preference-form');await form.locator('[name=subscribed]').check();await form.getByRole('button',{name:'Save email preference'}).click();await page.getByText('You’re subscribed to the Elio Newsletter.',{exact:true}).waitFor();
  assert.equal(subscribed,true);assert.deepEqual(calls.find(c=>c.action==='newsletter_account_preference').payload,{subscribed:true});
  await page.screenshot({path:join(output,`account-${width}.png`),fullPage:true});
  failSave=true;await form.locator('[name=subscribed]').uncheck();await form.getByRole('button',{name:'Save email preference'}).click();await form.getByText('Please try again.',{exact:true}).waitFor();assert.equal(subscribed,true);
  failSave=false;await form.getByRole('button',{name:'Save email preference'}).click();await page.getByText('You’re not subscribed to the Elio Newsletter.',{exact:true}).waitFor();assert.equal(subscribed,false);
  showOrder=true;await page.locator('[data-orders-refresh]').click();await page.getByText('ELIO-TEST01',{exact:true}).waitFor();assert.match(await page.locator('.account-order').textContent(),/₱950.00.*awaiting payment/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(origin+'/account.html?guest');await page.getByRole('heading',{name:'Sign in to Elio.',exact:true}).waitFor();assert.equal(await page.locator('#signed-in').isVisible(),false);await page.locator('#account-reset').click();await page.getByRole('heading',{name:'Reset your password.',exact:true}).waitFor();assert.equal(await page.locator('#password-field').isVisible(),false);
  await page.goto(origin+'/manage.html');if(width<=760)await page.locator('#dashboard-navigation > summary').click();await page.locator('[data-view=promos]').click();await page.waitForFunction(()=>document.querySelector('.newsletter-conversion-metrics strong')?.textContent==='4');
  assert.equal(await page.locator('.newsletter-conversion-metrics .panel').count(),3);assert.deepEqual(await page.locator('.newsletter-conversion-metrics span').allTextContents(),['Issued','Expired','Converted to a sale']);
  assert.equal(await page.locator('.newsletter-code-details').evaluate(el=>el.open),false);await page.locator('.newsletter-code-details summary').click();
  assert.equal(await page.locator('[name=discount_percent]').inputValue(),'5');
  const terms=page.locator('.newsletter-issued-terms');assert.equal(await terms.locator('strong').textContent(),'10% off');assert.deepEqual(await terms.locator('small').allTextContents(),['Min. spend ₱750.00','Max. discount ₱150.00']);
  assert.match(await page.locator('.newsletter-offers tbody tr').textContent(),/Expires Sep 8, 2026/);
  await page.locator('[name=offer_status]').selectOption('converted');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-nl-action=refresh]').disabled);assert.equal(await page.locator('.newsletter-code-details').evaluate(el=>el.open),true);
  converted=0;await page.locator('[data-nl-action=refresh]').click();await page.waitForFunction(()=>[...document.querySelectorAll('.newsletter-conversion-metrics strong')].at(-1)?.textContent==='0');
  assert.equal(await page.locator('.newsletter-offers [data-action=edit-promo]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(output,`conversions-${width}.png`),fullPage:true});
  if(width<740){await page.locator('.newsletter-offers').evaluate(el=>{el.parentElement.scrollLeft=el.querySelector('.newsletter-issued-terms').offsetLeft;});await page.screenshot({path:join(output,`issued-terms-${width}.png`),fullPage:true});}
  missingTerms=true;await page.locator('[data-nl-action=refresh]').click();await terms.getByText('Terms unavailable',{exact:true}).waitFor();assert.equal(await terms.locator('strong').count(),0);
  assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS account, preferences, recovery, conversions and issued terms ${width}px`);
 }
}finally{await browser.close();}
