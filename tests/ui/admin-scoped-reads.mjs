import scopedSuite from '../backend/69-admin-scoped-reads.test.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {navigateDashboard} from '../helpers/dashboard-navigation.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT||resolve('tests/backend'),'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),root=resolve('dist'),origin='https://admin-scoped.test',out=resolve('test-results/approved-batches-2026-10-03/admin/scoped-ui');await mkdir(out,{recursive:true});
await db.exec(await readFile('tests/backend/bootstrap.sql','utf8'));
for(const file of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(join('supabase/migrations',file),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
let failNextPage=false;
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
 await ctx.exposeBinding('conflictRpc',async(_,{action,payload})=>{calls.push({width,action,payload:structuredClone(payload)});try{if(action==='admin_order_page'&&failNextPage){failNextPage=false;throw Error('Simulated page read failure');}return {data:await invoke(action,payload),error:null};}catch(error){return {data:null,error:{message:error.message,code:'P0001'}};}});
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{user:{id:'${h.ids.owner}',email:'owner@example.test',email_confirmed_at:'2026-10-01'}}}}),onAuthStateChange:()=>{}},rpc:async(n,p)=>window.conflictRpc({action:p.p_action,payload:p.p_payload})}}`});
  if(u.origin!==origin)return route.abort();const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/manage.html');await page.locator('#admin-nav').waitFor({state:'attached'});return {page,ctx};}
// The same explicit PGlite-only suite provides boundary/refund/recipe fixtures.
await scopedSuite({db,state:{h},check:(_name,fn)=>async()=>fn()});
const complete=await invoke('admin_bootstrap'),total=complete.orders.length;
async function waitPage(page,from,to){await page.locator('#order-pagination [role=status]').filter({hasText:`Showing ${from}–${to} of ${total} matching orders`}).waitFor();}
async function capture(page,name,width){await page.waitForFunction(()=>!document.querySelector('#toast-region')?.children.length);await page.mouse.move(0,0);await page.screenshot({path:join(out,`${name}-${width}.png`),fullPage:false});}
try{for(const width of [1440,768,390]){
 const {page,ctx}=await make(width);
 assert(calls.filter(c=>c.width===width&&c.action==='admin_bootstrap').every(c=>c.payload.scope==='core'));
 await navigateDashboard(page,'boxes');await page.getByRole('heading',{name:'Boxes & sets',exact:true}).waitFor();assert.equal(calls.filter(c=>c.width===width&&c.action==='admin_order_page').length,0);
 await navigateDashboard(page,'orders');await waitPage(page,1,50);assert.equal(await page.locator('#order-table tbody tr').count(),50);assert.equal(await page.locator('[data-order-view=all] span').innerText(),String(total));
 const firstIds=await page.locator('[data-order-row]').evaluateAll(rows=>rows.map(row=>row.dataset.orderRow));await page.locator('[data-print-order]').first().check();
 await page.locator('[data-action=order-page][data-direction="1"]').click();await waitPage(page,51,100);assert.equal(await page.locator('#print-selection-count').innerText(),'1 selected across pages');const secondIds=await page.locator('[data-order-row]').evaluateAll(rows=>rows.map(row=>row.dataset.orderRow));assert(firstIds.every(id=>!secondIds.includes(id)));await page.locator('[data-print-order]').first().check();
 const popupPromise=page.waitForEvent('popup');await page.locator('[data-action=print-selected-orders]').click();const popup=await popupPromise;await popup.getByRole('button',{name:'Print 2 orders',exact:true}).waitFor();await popup.close();
 assert(calls.some(c=>c.width===width&&c.action==='get_order'&&c.payload.order_id===firstIds[0]));assert(calls.some(c=>c.width===width&&c.action==='get_order'&&c.payload.order_id===secondIds[0]));
 await page.locator('[data-action=select-matching-orders]').click();assert.equal(await page.locator('#print-selection-count').innerText(),total+' selected across pages');await page.locator('[data-action=order-page][data-direction="1"]').click();await waitPage(page,101,total);assert.equal(await page.locator('#order-table tbody tr').count(),total-100);assert.equal(await page.locator('#select-print-orders').isChecked(),true);
 await page.locator('[data-action=clear-print-selection]').click();const downloadPromise=page.waitForEvent('download');await page.locator('[data-action=export-orders]').click();const download=await downloadPromise,csv=await readFile(await download.path(),'utf8');assert.equal(csv.split('\r\n').length,total+1);
 await page.evaluate(()=>scrollTo(0,0));await capture(page,'orders-top',width);await page.locator('#order-pagination').scrollIntoViewIfNeeded();await capture(page,'orders-pagination',width);
 results.push({width,check:'Core catalog navigation fetches no order history; 50/50/25 pages keep exact totals, cross-page selection and two-order print, select-all matches and full CSV export'});
 await page.locator('#order-search').fill('Scope buyer 124');await page.locator('#order-count').filter({hasText:'1 orders'}).waitFor();assert.equal(await page.locator('#order-table tbody tr').count(),1);assert.match(await page.locator('#order-table').innerText(),/Scope buyer 124/);await page.locator('[data-action=open-order]').first().click();await page.locator('#print-order').waitFor();await page.locator('#dialog-close').click();
 await page.locator('[data-order-view=review]').click();await page.locator('#order-count').filter({hasText:String(complete.orders.filter(o=>o.payment_status==='under_review'&&o.fulfillment_status==='pending_confirmation'&&!o.refund_label).length)+' orders'}).waitFor();
 await page.locator('[data-order-view=all]').click();await waitPage(page,1,50);await page.locator('[data-filter=fulfillment]').selectOption('refunded');await page.locator('#order-count').filter({hasText:complete.orders.filter(o=>o.refund_label).length+' orders'}).waitFor();await page.locator('[data-action=clear-filters]').click();await waitPage(page,1,50);
 failNextPage=true;await page.locator('#order-search').fill('unloaded error case');await page.locator('#order-table [role=alert]').filter({hasText:'Simulated page read failure'}).waitFor();assert.equal(await page.locator('[data-action=select-matching-orders]').isDisabled(),true);await page.locator('[data-action=clear-filters]').click();await waitPage(page,1,50);
 results.push({width,check:'Search reaches older pages; full order details open; task/refund filters remain exact; failed page read shows an error and disables selection until recovery'});
 await navigateDashboard(page,'analytics');await page.locator('#analytics-period').waitFor();await page.locator('#analytics-period').selectOption('all');await page.waitForFunction(total=>document.querySelector('[data-analytics-metric=orders]')?.textContent.replaceAll(',','')===String(total),total);
 await capture(page,'analytics-global',width);assert(calls.some(c=>c.width===width&&c.action==='admin_analytics'&&c.payload.start===''));
 await navigateDashboard(page,'production');await page.locator('.production-note').waitFor();assert(calls.some(c=>c.width===width&&c.action==='admin_production'));await capture(page,'production-global',width);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push({width,check:'Analytics reports complete all-time order count independently of last page; Production requests its own fulfillment range'});
 await ctx.close();console.log('PASS scoped Admin flows at '+width);
 }assert.deepEqual(errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({results,errors,scope:'Actual local UI and isolated PGlite backend; no production access',totalOrders:total},null,2));console.log('PASS '+results.length+' scoped Admin scenario groups');
}finally{await browser.close();await db.close();}
