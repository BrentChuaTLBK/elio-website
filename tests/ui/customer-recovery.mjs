import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {dateInManila,addDays} from '../../dist/assets/shop/shop-rules.js';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),out=join(project,'test-results/customer-recovery'),origin='https://customer-friction.test';await mkdir(out,{recursive:true});
const date=addDays(dateInManila(),2),results=[];
const identity=id=>({user:{id,email:id+'@example.test',email_confirmed_at:'2026-09-01',user_metadata:{}},access_token:'test-session'});
function fixture(capacity=30){
 const flavors=['Vanilla','Chocolate'].map((name,i)=>({id:'flavor-'+i,slug:name.toLowerCase(),name,description:'Isolated test flavor',price_cents:0,active:true,in_rotation:true,collection_hidden:false,category_ids:['classic'],photos:[]}));
 const base={active:true,price_cents:10000,lead_days:0,min_quantity:1,photos:[],description:'Isolated test box',sort_order:0};
 const catalog={settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],cutoff_time:''},categories:[],zones:[],flavors,products:[{...base,id:'custom',name:'Build your own box',kind:'custom_box'},{...base,id:'fixed',name:'Vanilla box',kind:'set',flavor_contents:[{product_id:'flavor-0',quantity:3}]}],inventory:flavors.map(f=>({product_id:f.id,date,available:true,capacity,remaining:capacity}))};
 const collection={flavors,categories:[{id:'classic',name:'Classic'}],menus:[{month:date.slice(0,7)+'-01',published:true,flavor_ids:flavors.map(f=>f.id)}],current_month:date.slice(0,7)+'-01',next_month:addDays(date,32).slice(0,7)+'-01'};
 return {catalog,collection,session:null,orderError:null,orderGate:null,collectionGate:null,calls:[]};
}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
async function make({width=Number(process.env.AUDIT_WIDTH||390),capacity=30,session=null,holdCollection=false,initFailure=false,newsletterHold=false}={}){
 const data=fixture(capacity);data.session=session;data.authFailure=initFailure;data.authInitializations=0;data.signedIn=false;data.newsletterHold=newsletterHold;
 data.catalog.settings.pickup_address='Sample kitchen — fixture only';data.catalog.settings.pickup_hours='10 AM–5 PM';
 data.order={id:'sample-order',reference:'ELIO-AUDIT-SAMPLE',method:'pickup',fulfillment_date:date,created_at:new Date().toISOString(),payment_status:'paid',fulfillment_status:'confirmed',paid_amount_cents:10000,buyer:{name:'Sample customer',email:'sample@example.test',phone:'09170000000'},items:[{product_id:'fixed',name:'Vanilla box',quantity:1,selections:{},unit_price_cents:10000,line_total_cents:10000}],subtotal_cents:10000,discount_cents:0,delivery_cents:0,total_cents:10000,pickup_address:'Sample kitchen — fixture only',pickup_hours:'10 AM–5 PM',history:[]};
 if(newsletterHold)data.newsletterGate=new Promise(resolve=>data.releaseNewsletter=resolve);
 if(holdCollection)data.collectionGate=new Promise(r=>data.releaseCollection=r);
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),errors=[];
 await ctx.addInitScript(()=>{localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));});
 await ctx.exposeBinding('testAuth',async(_,{action})=>{if(action==='initialize'){data.authInitializations++;return data.authFailure?{error:{message:'Temporary startup connection failure'}}:{};}if(action==='signin'){data.session=identity('customer-1');data.signedIn=true;}if(action==='signout')data.session=null;return {data:{session:data.session,user:data.session?.user},error:null};});
 await ctx.exposeBinding('auditEdge',async(_,{body})=>{if(body?.action==='activate_account'){data.newsletterCalled=true;if(data.newsletterGate)await data.newsletterGate;}return {data:{status:'not_subscribed'},error:null};});
 await ctx.exposeBinding('testRpc',async(_,{action,payload})=>{
  data.calls.push({action,payload});
  if(action==='get_order')return data.orderReadError?{data:null,error:data.orderReadError}:{data:structuredClone(data.order),error:null};
  if(action==='quote'){const total=data.priceChanged?11000:10000;return {data:{...structuredClone(data.order),buyer:payload.buyer,items:[{...data.order.items[0],unit_price_cents:total,line_total_cents:total}],subtotal_cents:total,total_cents:total},error:null};}
  if(action==='create_order'){
   data.creates=(data.creates||0)+1;
   if(data.savedOrder)return {data:data.savedOrder,error:null};
   const total=data.priceChanged?11000:10000;
   if(payload.expected_quote.total_cents!==total)return {data:null,error:{message:'Prices or availability changed since review. Review your order again.',code:'P0001'}};
   data.savedOrder={...structuredClone(data.order),total_cents:total,subtotal_cents:total,paid_amount_cents:total,access_token:'fixture-only'};
   if(data.loseCreateResponse)return {data:null,error:{message:'Connection interrupted after saving'}};
   return {data:data.savedOrder,error:null};
  }
  if(action==='catalog')return {data:structuredClone(data.catalog),error:null};
  if(action==='my_orders'){const id=data.session?.user.id;if(data.orderGate)await data.orderGate;if(data.orderError)return {data:null,error:data.orderError};return {data:[{id:'order-'+id,reference:'ELIO-'+id,fulfillment_date:date,method:'pickup',payment_status:'paid',total_cents:10000}],error:null};}
  if(action==='my_vouchers')return {data:{vouchers:[],total:0,counts:{available:0,used:0,expired:0}},error:null};
  if(action==='newsletter_settings')return {data:{enabled:false,own_status:'unsubscribed'},error:null};
  if(action==='account_access')return {data:{role:'customer'},error:null};
  if(action==='affiliate_status')return {data:{assigned:false},error:null};
  return {data:{},error:null};
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const callbacks=[];window.__authChange=(event,next)=>callbacks.forEach(fn=>fn(event,next));return {auth:{initialize:()=>window.testAuth({action:'initialize'}),getSession:()=>window.testAuth({action:'session'}),onAuthStateChange:fn=>{callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:()=>window.testAuth({action:'signin'}),signInWithOAuth:async({options})=>{window.__oauthReturn=options.redirectTo;return {data:{},error:null};},signOut:()=>window.testAuth({action:'signout'}),updateUser:()=>window.testAuth({action:'session'}),resetPasswordForEmail:async()=>({}),resend:async()=>({})},rpc:async(n,p)=>window.testRpc({action:p.p_action,payload:p.p_payload}),functions:{invoke:async(name,{body})=>{window.__newsletterWaiting=body?.action==='activate_account';return window.auditEdge({name,body});}}}}`});
  if(u.pathname==='/auth/v1/settings')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{"google":true}}'});
  if(u.pathname==='/rest/v1/rpc/shop_api'){const body=route.request().postDataJSON();if(body.p_action==='flavor_collection'){if(data.collectionGate)await data.collectionGate;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data.collection)});}return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});}
  if(u.origin!==origin)return route.abort();const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page,data,errors};
}
const menu=async page=>{await page.goto(origin+'/order.html');await page.locator('#product-grid [data-product]').first().waitFor();};
const open=async(page,id='custom')=>{await page.locator('[data-product="'+id+'"]').click();await page.locator('#product-dialog[open]').waitFor();};
const close=async page=>{await page.locator('[aria-label="Close product"]').click();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));};
const choose=async(page,values)=>{for(const [id,n] of values)await page.locator('[data-choice="'+id+'"]').fill(String(n));};
const add=async page=>{await page.locator('#add-to-cart').click();await page.waitForFunction(()=>!document.querySelector('#product-dialog').open&&!new URL(location.href).searchParams.has('product'));};
const finish=async(test,name)=>{assert.deepEqual(test.errors,[]);assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);results.push(name);console.log('PASS '+name);await test.ctx.close();};
const checkout=async page=>{await page.locator('#checkout-button').click();for(const [name,value]of Object.entries({buyer_name:'Sample customer',buyer_email:'sample@example.test',buyer_phone:'09170000000'}))await page.locator('[name='+name+']').fill(value);await page.locator('[name=social_platform]').selectOption('na');await page.locator('#review-order').click();await page.locator('#place-order').waitFor();};
try{
 for(const width of [390,1440]){
  {
   const t=await make({width}),{page,data}=t;data.catalog.inventory[0].remaining=1;data.catalog.inventory[0].capacity=1;
   await menu(page);await open(page);await choose(page,[['flavor-0',1]]);assert(await page.getByRole('button',{name:'Increase Vanilla quantity',exact:true}).isDisabled());assert.match(await page.locator('[data-flavor-stock]').first().innerText(),/Vanilla: 1 available/);
   await choose(page,[['flavor-0',9],['flavor-1',2]]);assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'1');await page.locator('#product-quantity').fill('2');assert(await page.locator('#add-to-cart').isDisabled());assert.match(await page.locator('#product-error').innerText(),/Vanilla/);assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'1');await page.locator('#product-quantity').fill('1');assert(await page.locator('#add-to-cart').isEnabled());
   await page.locator('.option-group').screenshot({path:join(out,'stock-'+width+'.png')});await add(page);await open(page);await choose(page,[['flavor-0',1]]);assert.equal(await page.locator('[data-choice="flavor-0"]').inputValue(),'0');await finish(t,'CF14 stock cap, typing, box quantity and existing basket demand '+width);
  }
  {
   const t=await make({width,capacity:6}),{page}=t;await menu(page);await open(page);await choose(page,[['flavor-0',1],['flavor-1',2]]);await page.locator('#product-quantity').fill('2');await add(page);await page.locator('[data-remove="0"]').click();await page.locator('#undo-remove').click();let saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('elio-checkout-v1')));assert.equal(saved.items[0].quantity,2);assert.deepEqual(saved.items[0].selections.flavors,{'flavor-0':1,'flavor-1':2});
   await page.locator('[data-remove="0"]').click();await open(page,'fixed');await page.locator('#product-quantity').fill('2');await add(page);await page.locator('#undo-remove').click();assert.match(await page.locator('#undo-error').innerText(),/Vanilla/);saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('elio-checkout-v1')));assert.equal(saved.items.length,1);assert.equal(saved.items[0].product_id,'fixed');await finish(t,'CF15 exact Undo and shared-stock revalidation '+width);
  }
  {
   const t=await make({width,newsletterHold:true}),{page,data}=t;await page.goto(origin+'/account.html?next=order.html');await page.locator('#account-submit:not(:disabled)').waitFor();await page.locator('[name=email]').fill('sample@example.test');await page.locator('[name=password]').fill('fixture-password');await page.locator('#account-submit').click();await page.waitForURL('**/order.html#your-basket');await page.locator('#cart').waitFor();await page.waitForFunction(()=>window.__newsletterWaiting===true);assert(data.signedIn);assert(data.newsletterCalled);
   const pending=await page.evaluate(()=>localStorage.getItem('elio-newsletter-activation-v1'));assert(pending);assert(!pending.includes('sample@example.test'));data.releaseNewsletter();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('elio-newsletter-activation-v1'))?.done);await finish(t,'CF16 sign-in returns while optional activation waits, then completes '+width);
  }
  {
   const t=await make({width,initFailure:true}),{page,data}=t;await page.goto(origin+'/index.html');await page.evaluate(()=>sessionStorage.setItem('elio-checkout-v1',JSON.stringify({saved_at:Date.now(),items:[{product_id:'fixed',name:'Vanilla box',quantity:1,selections:{},unit_price_cents:10000}],buyer:{name:'Kept buyer',email:'kept@example.test',phone:'09170000000'}})));await page.goto(origin+'/order.html');await page.locator('#retry-menu').waitFor();data.authFailure=false;const before=data.authInitializations;await page.locator('#retry-menu').click();await page.locator('#product-grid [data-product]').first().waitFor();assert.equal(data.authInitializations,before+1);assert.equal(await page.locator('#cart .cart-line').count(),1);await page.locator('#checkout-button').click();assert.equal(await page.locator('[name=buyer_name]').inputValue(),'Kept buyer');await finish(t,'CF17 startup retry reconnects and retains basket/contact details '+width);
  }
  {
   const t=await make({width}),{page,data}=t;await menu(page);await open(page,'fixed');await add(page);await checkout(page);data.priceChanged=true;await page.locator('#place-order').click();await page.getByRole('button',{name:'Review updated total',exact:true}).waitFor();await page.locator('#place-order').click();await page.getByRole('button',{name:/Place order.*110/}).waitFor();assert.equal(data.creates,1);assert.equal(data.calls.filter(c=>c.action==='quote').length,2);assert.match(await page.locator('#checkout-error').innerText(),/100.00.*110.00/);assert.match(await page.locator('#checkout-dialog').innerText(),/sample@example.test/);await page.locator('#checkout-dialog').screenshot({path:join(out,'updated-total-'+width+'.png')});await page.locator('#place-order').click();await page.getByRole('heading',{name:'ELIO-AUDIT-SAMPLE',exact:true}).waitFor();assert.equal(data.savedOrder.total_cents,11000);await finish(t,'CF18 fresh total requires explicit second confirmation '+width);
  }
  {
   const t=await make({width}),{page,data}=t;await menu(page);await open(page,'fixed');await add(page);await checkout(page);data.loseCreateResponse=true;await page.locator('#place-order').click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();data.priceChanged=true;await page.locator('#place-order').click();await page.getByRole('heading',{name:'ELIO-AUDIT-SAMPLE',exact:true}).waitFor();const attempts=data.calls.filter(c=>c.action==='create_order');assert.equal(attempts.length,2);assert.equal(attempts[0].payload.idempotency_key,attempts[1].payload.idempotency_key);assert.deepEqual(attempts[0].payload.expected_quote,attempts[1].payload.expected_quote);assert.equal(data.calls.filter(c=>c.action==='quote').length,1);assert.equal(data.savedOrder.total_cents,10000);await finish(t,'CF18 lost-response retry preserves original quote and order identity '+width);
  }
  {
   const t=await make({width}),{page,data}=t;await page.goto(origin+'/order.html#order=sample-order&token=fixture-only');await page.getByRole('heading',{name:'Payment approved',exact:true}).waitFor();data.orderReadError={message:'Connection interrupted',status:503};await page.locator('#refresh-order').click();await page.locator('#order-refresh-status:not([hidden])').waitFor();assert.equal(await page.getByRole('heading',{name:'Payment approved',exact:true}).count(),1);assert.match(await page.locator('#app').innerText(),/Sample kitchen/);assert.match(await page.locator('#order-refresh-status').innerText(),/last loaded details/);assert(await page.locator('#refresh-order').isEnabled());
   data.orderReadError=null;await page.locator('#refresh-order').click();await page.locator('#order-refresh-status[hidden]').waitFor({state:'attached'});data.orderReadError={message:'Access revoked',status:403,code:'42501'};await page.locator('#refresh-order').click();await page.getByRole('heading',{name:'We couldn’t open that order',exact:true}).waitFor();assert.equal(await page.getByText('ELIO-AUDIT-SAMPLE',{exact:true}).count(),0);await finish(t,'CF19 paid details survive network failure and clear on access denial '+width);
  }
 }
 await writeFile(join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log('PASS all customer recovery browser scenarios');
}finally{await browser.close();}
