import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {navigateDashboard} from '../helpers/dashboard-navigation.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT||resolve('tests/backend'),'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),root=resolve('dist'),origin='https://admin-approved.test',out=resolve('test-results/approved-batches-2026-10-03/admin');await mkdir(out,{recursive:true});
await db.exec(await readFile('tests/backend/bootstrap.sql','utf8'));
for(const file of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(join('supabase/migrations',file),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
const h=await makeHarness(db),results=[],errors=[],calls=[];let chain=Promise.resolve();
// Browser payloads deliberately bypass the compatibility fixture helper. A missing
// opening revision must fail rather than being filled with the current DB version.
const invoke=(action,payload={})=>{const next=chain.then(()=>h.rawApi(action,payload,h.ids.owner));chain=next.catch(()=>{});return next;};
const settings=()=>h.scalar('select data from elio.settings where id');
const product=id=>h.scalar('select data from elio.products where id=$1',[id]);
const flavor=await h.product({kind:'flavor',name:'Conflict Vanilla',description:'Original flavor description',price_cents:0,lead_days:0});
const box=await h.product({kind:'set',name:'Conflict Trio',description:'Original box description',price_cents:10000,box_flavors:[flavor.id,flavor.id,flavor.id]});
await h.api('save_settings',{settings:{paused:true,shop_name:'Local conflict fixture',contact_email:'owner@example.test',contact_phone:'09171234567',pickup_address:'Local test kitchen',pickup_hours:'10 AM to 6 PM',delivery_window:'10 AM to 6 PM',site_url:origin,payment_options:[{label:'Sample only',account_name:'Local test',account_number:'0000000000'}]}},h.ids.owner);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
async function make(width){const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.exposeBinding('conflictRpc',async(_,{action,payload})=>{calls.push({width,action,payload:structuredClone(payload)});try{return {data:await invoke(action,payload),error:null};}catch(error){return {data:null,error:{message:error.message,code:'P0001'}};}});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{user:{id:'${h.ids.owner}',email:'owner@example.test',email_confirmed_at:'2026-10-01'}}}}),onAuthStateChange:()=>{}},rpc:async(n,p)=>window.conflictRpc({action:p.p_action,payload:p.p_payload})}}`});
  if(u.origin!==origin)return route.abort();const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/manage.html');await page.locator('#admin-nav').waitFor({state:'attached'});return {page,ctx};}
async function discarded(page){await page.locator('.site-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await page.locator('.site-dialog').waitFor({state:'detached'});}
async function kept(page){await page.locator('.site-dialog').getByRole('button',{name:'Keep editing',exact:true}).click();await page.locator('.site-dialog').waitFor({state:'detached'});}
const dirty=async form=>assert.equal(await form.getAttribute('data-dirty'),'true');
async function noDirty(form){await form.locator('[data-draft-status]').filter({hasText:'No unsaved changes'}).waitFor();assert.equal(await form.getAttribute('data-dirty'),'false');}
async function screenshot(page,name,width){await page.waitForFunction(()=>!document.querySelector('#toast-region')?.children.length);await page.mouse.move(0,0);await page.screenshot({path:join(out,`${name}-${width}.png`),fullPage:true});}
async function closeDirty(page){await page.locator('#dialog-close').click();await discarded(page);await page.locator('#admin-dialog').waitFor({state:'hidden'});}
const newsletterEmail='subscriber-lookup-ui@example.test';
await h.service('newsletter_subscribe',{email:newsletterEmail,source:'home_footer',consent:true,consent_version:'elio-newsletter-v2-single-opt-in',ip_hash:'a'.repeat(64)});
for(const [code,active] of [['AUTUMN10',true],['THANKYOU10',false]])await h.api('save_promo',{promo:{code,kind:'percent',value:10,min_subtotal_cents:0,cap_cents:10000,per_account_limit:1,global_limit:20,expires_at:'2099-01-01T00:00:00Z',active}},h.ids.owner);
try{for(const width of [1440,768,390]){
 const {page,ctx}=await make(width);let form;
 await navigateDashboard(page,'boxes');await page.locator(`[data-action=edit-product][data-id="${box.id}"]`).click();form=page.locator('[data-form=product]');await noDirty(form);
 await page.locator('#dialog-close').click();await page.locator('#admin-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('.site-dialog').count(),0);
 await page.locator(`[data-action=edit-product][data-id="${box.id}"]`).click();form=page.locator('[data-form=product]');const old=await form.locator('[name=description]').inputValue();
 await form.locator('[name=description]').fill('Unsaved box edit '+width);await dirty(form);await screenshot(page,'catalog-draft',width);
 await page.locator('#dialog-close').click();await kept(page);assert.equal(await form.locator('[name=description]').inputValue(),'Unsaved box edit '+width);
 await form.locator('[name=description]').fill(old);await noDirty(form);await page.keyboard.press('Escape');await page.locator('#admin-dialog').waitFor({state:'hidden'});
 await page.locator(`[data-action=edit-product][data-id="${box.id}"]`).click();form=page.locator('[data-form=product]');await form.locator('[name=description]').fill('Saved box edit '+width);await form.locator('[data-draft-save]').click();await page.locator('#admin-dialog').waitFor({state:'hidden'});assert.equal((await product(box.id)).description,'Saved box edit '+width);
 results.push({width,check:'Box unchanged/reverted closes directly; changed close keeps input; top save persists; Escape honors state'});
 await navigateDashboard(page,'menus');await page.locator(`[data-action=edit-flavor-menu][data-id="${flavor.id}"]`).click();form=page.locator('[data-form=flavor-menu-editor]');await noDirty(form);await form.locator('[name=description]').fill('Unsaved flavor edit '+width);await dirty(form);await screenshot(page,'flavor-draft',width);await page.keyboard.press('Escape');await kept(page);assert.equal(await form.locator('[name=description]').inputValue(),'Unsaved flavor edit '+width);await closeDirty(page);
 results.push({width,check:'Flavor Escape and close offer Keep editing/Discard; discarding writes nothing'});
 await navigateDashboard(page,'settings');form=page.locator('[data-form=settings]');await noDirty(form);const phone=await form.locator('[name=contact_phone]').inputValue();await form.locator('[name=contact_phone]').fill('Local unsaved contact');await dirty(form);await page.evaluate(()=>scrollTo(0,0));await screenshot(page,'settings-draft',width);
 await navigateDashboard(page,'overview');await kept(page);assert.equal(await form.locator('[name=contact_phone]').inputValue(),'Local unsaved contact');
 const prevented=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});assert.equal(prevented,true);
 const revision=await form.getAttribute('data-edit-revision');await page.locator('[data-action=new-zone]').click();const zone=page.locator('[data-form=zone]');await zone.locator('[name=name]').fill('Refresh fixture '+width);await zone.locator('[name=localities]').fill('Local QA / '+width);await zone.getByRole('button',{name:'Save zone',exact:true}).click();await page.locator('#admin-dialog').waitFor({state:'hidden'});await page.locator('.zone-card strong').filter({hasText:'Refresh fixture '+width}).waitFor();assert.equal(await form.locator('[name=contact_phone]').inputValue(),'Local unsaved contact');assert.equal(await form.getAttribute('data-edit-revision'),revision);await dirty(form);
 await form.locator('[name=contact_phone]').fill(phone);await noDirty(form);await form.locator('[data-add-payment]').click();await dirty(form);await form.locator('.payment-option-editor').last().locator('[data-remove-payment]').click();await noDirty(form);
 await form.locator('[name=contact_phone]').fill('0917'+String(width).padStart(7,'0'));await form.locator('[data-draft-save]').click();await form.locator('[data-draft-status]').filter({hasText:'No unsaved changes'}).waitFor();assert.equal((await settings()).contact_phone,'0917'+String(width).padStart(7,'0'));
 await form.locator('[name=contact_phone]').fill('Discard me');await navigateDashboard(page,'promos');await discarded(page);await page.locator('#promo-search').waitFor();
 results.push({width,check:'Settings navigation/reload guarded; reverted field and add/remove payment clear dirty; top save persists'});
 await page.locator('#promo-search').fill('autumn');assert.equal(await page.locator('#promo-results tbody tr').count(),1);assert.match(await page.locator('#promo-results').innerText(),/AUTUMN10/);await page.locator('#promo-status-filter').selectOption('inactive');assert.match(await page.locator('#promo-results').innerText(),/No matching promo codes/);await page.locator('#promo-search').fill('thank');assert.equal(await page.locator('#promo-results tbody tr').count(),1);await page.locator('#promo-search').fill('');await page.locator('#promo-status-filter').selectOption('');assert.equal(await page.locator('#promo-results tbody tr').count(),2);await screenshot(page,'promo-search',width);
 results.push({width,check:'Regular promo code search is case insensitive, combines with status, and clears independently'});
 await navigateDashboard(page,'newsletter');await page.locator('[data-subscriber-lookup-form]').waitFor();await page.getByLabel('Subscriber email',{exact:true}).fill(newsletterEmail);await page.getByRole('button',{name:'Look up',exact:true}).click();await page.locator('.subscriber-lookup-result').filter({hasText:newsletterEmail}).waitFor();assert.match(await page.locator('.subscriber-lookup-result').innerText(),/Eligible by recorded consent/);await screenshot(page,'subscriber-lookup',width);
 await page.getByLabel('Subscriber email',{exact:true}).fill('no-such-subscriber@example.test');await page.getByRole('button',{name:'Look up',exact:true}).click();await page.getByText('No newsletter subscriber found for this exact email address.',{exact:true}).waitFor();
 results.push({width,check:'Owner subscriber lookup shows real exact-match consent and sync record and a no-match state'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await ctx.close();console.log('PASS approved Admin flows at '+width);
 }assert.deepEqual(errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({results,errors,scope:'Local real application with isolated PGlite backend; no production mutation'},null,2));console.log('PASS '+results.length+' Admin scenarios');
}finally{await browser.close();await db.close();}
