import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),output=resolve(root,'../test-results/order-calendar'),origin='https://eliocheesecakes.com';
await mkdir(output,{recursive:true});
const sdk=`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>{}},rpc:async(name,body)=>({data:await (await fetch('/fixture',{method:'POST',body:JSON.stringify(body)})).json()}),functions:{invoke:async(name,{body})=>({data:await (await fetch('/functions/v1/'+name,{method:'POST',body:JSON.stringify(body)})).json()})}};}`;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
const connection={connected:true,calendar_id:'elio@example.test',pending:0,last_success_at:new Date().toISOString()};
const base={date:today,status:'confirmed',buyer:{name:'Buyer',email:'buyer@example.test',phone:'09170000000'},recipient:{name:'Recipient <safe>',phone:'09171111111'},address:{line1:'12 Test Street',locality:'Makati'},items:[{name:'Signature Trio',quantity:1}],window:'9 AM – 6 PM',sync_state:'synced'};
const orders=[{...base,id:'pickup',reference:'ELIO-PICKUP',method:'pickup',pickup_address:'Elio kitchen'},{...base,id:'z',reference:'ELIO-Z',method:'delivery',address:{...base.address,locality:'Quezon City'}},{...base,id:'a',reference:'ELIO-A',method:'delivery'}];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{for(const width of [1440,390,320]){
 const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'}),errors=[],calls=[];
 const products=[{id:'flavor',name:'Vanilla fixture',kind:'flavor',price_cents:0,photos:[],active:true},{id:'box',name:'Box fixture',kind:'set',price_cents:90000,photos:[],active:true,lead_days:2,box_flavors:['flavor','flavor','flavor']}];
 await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});if(url.origin!==origin)return route.abort();
  let data;
  if(url.pathname==='/functions/v1/calendar-sync')data={configured:true,service_account_email:'test@fixture.iam.gserviceaccount.com',connection};
  else if(url.pathname==='/fixture'){
   const {p_action:action,p_payload:payload}=route.request().postDataJSON();calls.push({action,payload});
   if(action==='admin_bootstrap')data={role:'owner',orders:[],products,categories:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
   else if(action==='site_status')data={active:false,uploads_paused:false,announce:false};
   else if(action==='calendar_list')data={orders:orders.filter(o=>o.date>=payload.from&&o.date<=payload.to),connection};
   else if(action==='calendar_sync_now')data=connection;
   else if(action==='delete_product'){const p=products.find(p=>p.id===payload.id);p.deleted_at=new Date().toISOString();p.active=false;data={deleted:true};}
   else throw Error('Unexpected API '+action);
  }
  if(data!==undefined)return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(origin+'/manage.html#calendar');
 await page.locator('[data-calendar-order=a]').waitFor();assert.equal(await page.locator('.calendar-order.pickup').count(),1);assert.equal(await page.locator('.calendar-order.delivery').count(),2);
 assert.deepEqual(await page.locator('.calendar-group-heading.delivery').allTextContents(),['Makati · 1 delivery','Quezon City · 1 delivery']);
 await page.locator('[data-calendar-order=a] [data-calendar-copy=address]').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'12 Test Street, Makati');
 await page.locator('[data-calendar-filter=method]').selectOption('delivery');assert.equal(await page.locator('.calendar-order.pickup').count(),0);
 await page.locator('[data-calendar-filter=area]').selectOption('Makati');assert.equal(await page.locator('.calendar-order').count(),1);
 await page.locator('[data-calendar-filter=search]').fill('safe');assert.equal(await page.locator('.calendar-order').count(),1);
 await page.clock.fastForward(16000);assert.equal(await page.locator('[data-calendar-filter=area]').inputValue(),'Makati');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
 await page.locator('#order-calendar-manager').screenshot({path:join(output,`calendar-${width}.png`)});
 await page.locator('[data-view=boxes]').click();await page.getByText('2 production days',{exact:true}).waitFor();
 await page.locator('[data-view=flavors]').click();await page.locator('[data-action=edit-product][data-id=flavor]').click();
 await page.locator('[data-action=delete-product]').click();const prompt=page.getByRole('dialog',{name:'Delete flavor',exact:true});assert.match(await prompt.textContent(),/Box fixture/);
 await prompt.getByRole('button',{name:'Keep item',exact:true}).click();assert.equal(calls.filter(c=>c.action==='delete_product').length,0);
 await page.locator('[data-action=delete-product]').click();await prompt.getByRole('button',{name:'Delete',exact:true}).click();await page.locator('#admin-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('[data-action=edit-product][data-id=flavor]').count(),0);
 await page.locator('[data-view=boxes]').click();await page.getByText('Unavailable · contains a deleted flavor',{exact:true}).waitFor();
 const count=calls.filter(c=>c.action==='calendar_list').length;await page.clock.fastForward(31000);assert.equal(calls.filter(c=>c.action==='calendar_list').length,count);
 assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS calendar, quick copy, filters, polling, catalog deletion and production days at ${width}px`);
}}finally{await browser.close();}
