import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {dateInManila,addDays} from '../../dist/assets/shop/shop-rules.js';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const root=resolve('dist'),out=resolve('test-results/checkout-admin-progress'),origin='https://progress.test';await mkdir(out,{recursive:true});
const date=addDays(dateInManila(),2),month=dateInManila().slice(0,7),nextMonth=new Date(Number(month.slice(0,4)),Number(month.slice(5)),2).toISOString().slice(0,7),results=[];
const session=id=>id?{user:{id,email:id+'@example.test',email_confirmed_at:'2026-10-01',user_metadata:{}},access_token:'test-only'}:null;
function fixture(){
 const settings={paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],cutoff_time:'',payment_options:[{label:'Sample account',account_name:'Sample only',account_number:'0000000000'}]},flavors=[{id:'vanilla',name:'Vanilla',slug:'vanilla',active:true,in_rotation:true,collection_hidden:false,kind:'flavor',price_cents:0,photos:[],option_groups:[]}];
 const product={id:'box',name:'Vanilla Trio',active:true,kind:'set',price_cents:105000,min_quantity:1,lead_days:0,photos:[],option_groups:[],box_flavors:['vanilla','vanilla','vanilla'],flavor_contents:[{product_id:'vanilla',quantity:3}]};
 const order={id:'order1',reference:'ELIO-SAMPLE',revision:1,order_source:'website',method:'pickup',fulfillment_date:date,created_at:new Date().toISOString(),payment_deadline:new Date(Date.now()+3600000).toISOString(),payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',buyer:{name:'Sample customer',email:'customer@example.test',phone:'09170000000',social_platform:'na',social_username:'N/A'},items:[{product_id:'box',name:'Vanilla Trio',quantity:1,selections:{},flavor_contents:[{product_id:'vanilla',name:'Vanilla',quantity:3}],unit_price_cents:105000,line_total_cents:105000}],subtotal_cents:105000,discount_cents:0,delivery_cents:0,total_cents:105000,payment_options:settings.payment_options,history:[]};
 const inventory=[{product_id:'vanilla',date,capacity:60,remaining:60,reserved:0,available:true,configured:true}];
 return {session:session('owner-a'),settings,flavors,product,order,otherOrder:{...structuredClone(order),id:'order2',reference:'ELIO-OTHER'},catalog:{settings,flavors,products:[product],categories:[],inventory,zones:[]},inventory,menus:[month,nextMonth].map(m=>({month:m+'-01',flavor_ids:['vanilla'],published:true})),calls:[],discount:10500,expiredPromo:false,bootstrapError:null,readError:null,mutationError:null,failAfterMutation:false,gates:new Map(),role:'owner'};
}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
let currentTest;
async function make(width=1440){
 const data=fixture(),context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'}),errors=[];
 await context.addInitScript(()=>{localStorage.setItem('elio-newsletter-popup-v1',JSON.stringify({state:'submitted',firstVisit:Date.now(),updatedAt:Date.now()}));localStorage.setItem('elio-analytics-choice-v1',JSON.stringify({value:'denied',expires:Date.now()+86400000}));});
 await context.exposeBinding('fixtureSession',()=>({data:{session:data.session,user:data.session?.user},error:null}));
 await context.exposeBinding('fixtureRpc',async(_,{action,payload={}})=>{
  data.calls.push({action,payload:structuredClone(payload)});const gate=data.gates.get(action);if(gate)await gate;
  const ok=result=>({data:structuredClone(result),error:null}),fail=error=>({data:null,error});
  if(action==='catalog')return ok(data.catalog);
  if(action==='get_order'){if(data.readError)return fail(data.readError);return ok(payload.order_id==='order2'?data.otherOrder:data.order);}
  if(action==='admin_bootstrap'){if(data.bootstrapError)return fail(data.bootstrapError);return ok({role:data.role,products:[data.product,...data.flavors],categories:[],inventory:data.inventory,promos:[],zones:[],orders:[data.order,data.otherOrder],settings:data.settings,staff:[],inventory_default:60,flavor_menus:{current_month:month+'-01',next_month:nextMonth+'-01',menus:data.menus},email_status:[]});}
  if(action==='quote'){if(data.expiredPromo&&payload.promo_code)return fail({message:'This code has expired.',code:'P0001'});const discount=payload.promo_code?data.discount:0;return ok({...data.order,discount_cents:discount,total_cents:105000-discount,promo_snapshot:payload.promo_code?{code:payload.promo_code}:null});}
  if(action==='save_inventory'){if(data.mutationError)return fail(data.mutationError);for(const row of payload.rows){const old=data.inventory.find(i=>i.product_id===row.product_id&&i.date===row.date);if(old&&row.capacity<old.reserved)return fail({message:'Stock is reserved by another order.',code:'P0001'});if(old)Object.assign(old,row,{configured:true});else data.inventory.push({...row,remaining:row.capacity,reserved:0,configured:true});}return ok(data.inventory);}
  if(action==='preview_edit_order')return ok({...data.order,...payload.changes});
  if(action==='approve_payment'||action==='edit_order'){
   if(data.mutationError)return fail(data.mutationError);
   if(action==='approve_payment')Object.assign(data.order,{payment_status:'paid',fulfillment_status:'confirmed',paid_amount_cents:data.order.total_cents});else Object.assign(data.order,payload.changes);
   data.order.revision++;if(data.failAfterMutation)data.bootstrapError={message:'Connection interrupted',status:503};return ok(data.order);
  }
  if(action==='newsletter_settings')return ok({enabled:false,own_status:'unsubscribed'});
  if(action==='faqs')return ok({content:[]});
  if(action==='account_access')return ok({role:data.role});
  if(action==='my_orders')return ok([]);if(action==='my_vouchers')return ok({vouchers:[],total:0,counts:{available:0,used:0,expired:0}});
  return ok({});
 });
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const callbacks=[];window.fixtureAuthChange=(event,session)=>callbacks.forEach(fn=>fn(event,session));return {auth:{initialize:async()=>({}),getSession:()=>window.fixtureSession(),getUser:()=>window.fixtureSession(),onAuthStateChange:fn=>{callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>{callbacks.forEach(fn=>fn('SIGNED_OUT',null));return {error:null};}},rpc:async(n,p)=>window.fixtureRpc({action:p.p_action,payload:p.p_payload}),functions:{invoke:async()=>({data:{},error:null})}}}`});
  if(u.pathname==='/auth/v1/settings')return route.fulfill({contentType:'application/json',body:'{"external":{"google":false}}',headers:{'access-control-allow-origin':'*'}});
  if(u.origin!==origin)return route.abort();const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));currentTest={data,context,page,errors};return currentTest;
}
const finish=async(t,name)=>{assert.deepEqual(t.errors,[]);assert.equal(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);results.push(name);console.log('PASS '+name);await t.context.close();};
const hold=(data,action)=>{let release;data.gates.set(action,new Promise(r=>release=r));return ()=>{data.gates.delete(action);release();};};
const openCustomer=async t=>{await t.page.goto(origin+'/order.html#order=order1&token=sample-access');await t.page.locator('#proof-form').waitFor();};
const chooseReceipt=async(page,reference='SAMPLE-REF')=>{await page.locator('[name=proof]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from([1,2,3])});await page.locator('[name=payment_reference]').fill(reference);};
const refreshCustomer=async page=>{await page.locator('#refresh-order').click();await page.waitForFunction(()=>document.querySelector('#refresh-order')?.disabled===false);};
const admin=async t=>{await t.page.goto(origin+'/manage.html');await t.page.waitForFunction(()=>document.querySelector('#shop-status')?.textContent==='Shop accepting orders');};
const view=async(page,name)=>{const button=page.locator('[data-view="'+name+'"]').first();if(!await button.isVisible())await page.locator('#dashboard-navigation summary').click();await button.click();await page.locator('#workspace h1').waitFor();};
const openOrder=async page=>{await view(page,'orders');await page.locator('[data-action="open-order"][data-id="order1"]').click();await page.getByRole('heading',{name:'ELIO-SAMPLE',exact:true}).waitFor();};
const editOrder=async page=>{await page.locator('[data-action="edit-order"]').click();await page.locator('[data-form="order-edit"]').waitFor();};
const confirmation=page=>page.getByRole('heading',{name:'Unsaved order changes',exact:true});
// Chromium may make the next native dialog close non-cancelable after another
// close request consumes activation. Exercise the actual browser behavior.
const consumeCloseActivation=page=>page.evaluate(()=>{
 const watcher=new CloseWatcher();watcher.addEventListener('cancel',event=>event.preventDefault());watcher.requestClose();watcher.destroy();
});
try{
 {
  const t=await make(),{page,data}=t;Object.assign(data.order,{payment_status:'paid',fulfillment_status:'confirmed',paid_amount_cents:105000});await admin(t);await openOrder(page);
  await page.evaluate(()=>{const request=window.requestAnimationFrame,queued=[];window.requestAnimationFrame=callback=>{queued.push(callback);return queued.length;};window.finishDelayedFrame=()=>{window.requestAnimationFrame=request;queued.splice(0).forEach(callback=>callback(performance.now()));};});
  await editOrder(page);await page.locator('[name=buyer_phone]').fill('09178889999');await page.evaluate(()=>window.finishDelayedFrame());
  assert.equal(await page.locator('[name=buyer_phone]').evaluate(el=>document.activeElement===el),true,'Delayed dialog autofocus must preserve the field already being edited');
  await page.locator('#save-order-edit').click();await page.getByRole('heading',{name:'ELIO-SAMPLE',exact:true}).waitFor();assert.equal(data.order.buyer.phone,'09178889999');await finish(t,'delayed dialog autofocus preserves ongoing input and saves the edited value');
 }
 for(const width of [390,1440]){
  const t=await make(width),{page,data}=t;await openCustomer(t);await chooseReceipt(page);await page.evaluate(()=>window.originalProof=document.querySelector('[name=proof]'));
  await refreshCustomer(page);assert.equal(await page.evaluate(()=>window.originalProof===document.querySelector('[name=proof]')),true);assert.equal(await page.locator('[name=payment_reference]').inputValue(),'SAMPLE-REF');
  data.readError={message:'Connection interrupted',status:503};await refreshCustomer(page);assert.match(await page.locator('#order-refresh-status').innerText(),/still here/);assert.equal(await page.locator('[name=proof]').evaluate(el=>el.files.length),1);assert(await page.locator('#proof-form [type=submit]').isEnabled());
  data.readError=null;const release=hold(data,'get_order');await page.locator('#refresh-order').click();await page.getByRole('button',{name:'Refreshing…',exact:true}).waitFor();assert(await page.locator('#proof-form [type=submit]').isDisabled());await page.locator('[name=payment_reference]').fill('DURING-REFRESH');release();await page.waitForFunction(()=>document.querySelector('#refresh-order')?.disabled===false);assert.equal(await page.locator('[name=payment_reference]').inputValue(),'DURING-REFRESH');
  await page.locator('[name=proof]').setInputFiles({name:'receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('sample')});assert.match(await page.locator('#proof-error').innerText(),/Choose a JPEG/);assert.equal(data.calls.some(c=>/upload|proof/.test(c.action)),false);await chooseReceipt(page);assert.equal(await page.locator('#proof-error').innerText(),'');
  await page.locator('[name=proof]').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(20*1024*1024+1)});assert.match(await page.locator('#proof-error').innerText(),/20 MB/);await chooseReceipt(page);assert.equal(await page.locator('#copy-payment-amount').count(),0);await page.locator('#proof-form').screenshot({path:join(out,'receipt-'+width+'.png')});
  data.order.payment_status='paid';data.order.paid_amount_cents=105000;await refreshCustomer(page);assert.equal(await page.locator('#proof-form').count(),0);await page.getByRole('heading',{name:'Payment approved',exact:true}).waitFor();await finish(t,'receipt refresh/failed refresh/in-flight editing, immediate validation and rejected CF-11 absent '+width);
 }
 {
  const t=await make(),{page,data}=t;await openCustomer(t);await chooseReceipt(page);await page.evaluate(()=>location.hash='order=order2&token=another-access');await page.getByRole('heading',{name:'ELIO-OTHER',exact:true}).waitFor();assert.equal(await page.locator('[name=proof]').evaluate(el=>el.files.length),0);assert.equal(await page.locator('[name=payment_reference]').inputValue(),'');
  await chooseReceipt(page);data.readError={message:'Access denied',code:'42501',status:403};await page.locator('#refresh-order').click();await page.getByRole('heading',{name:'We couldn’t open that order',exact:true}).waitFor();assert.equal(await page.locator('#proof-form').count(),0);await finish(t,'receipt draft never carries into another order or survives permission failure');
 }
 for(const state of ['expired','paused','refunded','identity']){
  const t=await make(),{page,data}=t;await openCustomer(t);await chooseReceipt(page);
  if(state==='expired')data.order.payment_deadline=new Date(Date.now()-1000).toISOString();
  if(state==='paused')data.order.uploads_paused=true;
  if(state==='refunded')data.order.refund_label=true;
  if(state==='identity'){data.session=session('owner-b');await page.evaluate(next=>window.fixtureAuthChange('SIGNED_IN',next),data.session);await page.waitForFunction(()=>document.querySelector('[name=proof]')?.files.length===0);assert.equal(await page.locator('[name=payment_reference]').inputValue(),'');}
  else{await page.locator('#refresh-order').click();await page.waitForFunction(()=>!document.querySelector('#proof-form'));}
  await finish(t,'receipt draft cleared on '+state);
 }
 {
  const t=await make(),{page,data}=t;await page.goto(origin+'/order.html');await page.locator('[data-product="box"]').click();await page.locator('#add-to-cart').click();await page.locator('#checkout-button').click();
  const form=page.locator('#checkout-form');for(const [name,value]of Object.entries({buyer_name:'Sample',buyer_email:'customer@example.test',buyer_phone:'09170000000'}))await form.locator('[name='+name+']').fill(value);await form.locator('[name=social_platform]').selectOption('na');await form.locator('[name=promo_code]').fill('SAMPLE10');await page.locator('#apply-promo').click();await page.locator('#promo-status.success').waitFor();await page.locator('#review-order').click();await page.locator('#edit-checkout').waitFor();const calls=data.calls.filter(c=>c.action==='quote').length;
  await page.locator('#edit-checkout').click();await page.locator('#promo-status.success').waitFor();assert.match(await page.locator('#checkout-totals').innerText(),/945\.00/);assert.equal(data.calls.filter(c=>c.action==='quote').length,calls);await form.locator('[name=buyer_phone]').fill('09179998888');assert(await page.locator('#promo-status.success').isVisible());
  data.discount=5000;await page.locator('#review-order').click();await page.locator('#edit-checkout').click();assert.match(await page.locator('#checkout-totals').innerText(),/1,000\.00/);data.expiredPromo=true;await page.locator('#review-order').click();await page.locator('#checkout-error').filter({hasText:'expired'}).waitFor();assert.equal(await page.locator('#promo-status.success').count(),0);assert(await page.locator('#review-order').isEnabled());
  data.expiredPromo=false;await page.locator('#apply-promo').click();await page.locator('#promo-status.success').waitFor();await form.locator('[name=promo_code]').fill('ANOTHER');assert.equal(await page.locator('#promo-status.success').count(),0);await finish(t,'unchanged promo survives Edit details; updated/expired quotes and changed context revalidate');
 }
 {
  const t=await make(),{page,data}=t;data.order.payment_status='under_review';await admin(t);await view(page,'orders');await page.locator('[data-filter=payment]').selectOption('under_review');await page.locator('#order-search').fill('SAMPLE');await page.reload();await page.locator('[data-filter=payment]').waitFor();assert.equal(await page.locator('[data-filter=payment]').inputValue(),'under_review');assert.equal(await page.locator('#order-search').inputValue(),'SAMPLE');
  data.bootstrapError={message:'Temporarily unavailable',status:503};await page.reload();await page.getByText('Dashboard unavailable',{exact:true}).waitFor();data.bootstrapError=null;await page.reload();await page.locator('[data-filter=payment]').waitFor();assert.equal(await page.locator('[data-filter=payment]').inputValue(),'under_review');
  data.session=session('owner-b');await page.reload();await page.getByRole('heading',{name:'A little overview',exact:true}).waitFor();await view(page,'orders');assert.equal(await page.locator('[data-filter=payment]').inputValue(),'');await page.locator('[data-filter=payment]').selectOption('paid');data.session=null;await page.evaluate(()=>window.fixtureAuthChange('SIGNED_OUT',null));await page.waitForURL('**/admin-account.html?next=manage.html');assert.equal(await page.evaluate(()=>sessionStorage.getItem('elio-admin-orders-view-v1')),null);await finish(t,'staff orders view restores after reload/network recovery and clears across identities/sign-out');
 }
 {
  const t=await make(),{page,data}=t;await admin(t);await view(page,'inventory');await page.locator('[data-action="inventory-whole-month"]').click();await page.locator('[data-quantity-id=vanilla]').fill('30');await page.locator('#quantity-mode').selectOption('fill_unconfigured');await page.locator('#inventory-month').selectOption(nextMonth);await page.locator('[data-action="inventory-whole-month"]').click();await page.locator('[data-quantity-id=vanilla]').fill('45');await page.locator('#inventory-month').selectOption(month);assert.equal(await page.locator('[data-quantity-id=vanilla]').inputValue(),'30');assert.equal(await page.locator('#quantity-mode').inputValue(),'fill_unconfigured');
  data.mutationError={message:'Stock is reserved by another order.',code:'P0001'};await page.locator('[data-form=inventory] [type=submit]').click();await page.locator('[data-form=inventory] .form-error').filter({hasText:'reserved'}).waitFor();assert.equal(await page.locator('[data-quantity-id=vanilla]').inputValue(),'30');data.mutationError=null;await page.locator('#quantity-mode').selectOption('replace');const release=hold(data,'save_inventory');await page.locator('[data-form=inventory] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#inventory-month').disabled);assert(await page.locator('#quantity-mode').isDisabled());release();await page.waitForFunction(()=>!document.querySelector('#inventory-month').disabled);assert.match(await page.locator('#quantity-save-summary').innerText(),/Select at least/);
  await page.locator('#inventory-month').selectOption(nextMonth);assert.equal(await page.locator('[data-quantity-id=vanilla]').inputValue(),'45');await page.locator('[data-action=reset-quantities]').click();await page.locator('#inventory-month').selectOption(month);await page.locator('#inventory-month').selectOption(nextMonth);assert.notEqual(await page.locator('[data-quantity-id=vanilla]').inputValue(),'45');await finish(t,'independent monthly quantities/mode, failed save retention, save controls and explicit reset');
 }
 for(const width of [390,1440]){
  const t=await make(width),{page,data}=t;Object.assign(data.order,{payment_status:'paid',fulfillment_status:'confirmed',paid_amount_cents:105000});await admin(t);await openOrder(page);await editOrder(page);await page.locator('[name=buyer_phone]').fill('09178889999');await consumeCloseActivation(page);await page.keyboard.press('Escape');await confirmation(page).waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.locator('[name=buyer_phone]').inputValue(),'09178889999');await page.locator('#dialog-close').click();await confirmation(page).waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();await page.locator('[data-action=back-order]').click();await confirmation(page).waitFor();await page.getByRole('button',{name:'Discard changes',exact:true}).click();await page.getByRole('heading',{name:'ELIO-SAMPLE',exact:true}).waitFor();await editOrder(page);assert.equal(await page.locator('[name=buyer_phone]').inputValue(),'09170000000');await page.locator('[name=buyer_phone]').fill('09178889999');await page.locator('[name=buyer_phone]').fill('09170000000');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#admin-dialog').open);assert.equal(await confirmation(page).count(),0);
  await openOrder(page);await editOrder(page);await page.locator('[name=buyer_phone]').fill('09178889999');await page.locator('#save-order-edit').click();await page.getByRole('heading',{name:'ELIO-SAMPLE',exact:true}).waitFor();assert.equal(data.order.buyer.phone,'09178889999');await page.locator('#dialog-close').click();await page.waitForFunction(()=>!document.querySelector('#admin-dialog').open);await finish(t,'order edit Escape/X/Back guards, Keep/Discard/reverted fields and successful save '+width);
 }
 {
  const t=await make(),{page,data}=t;Object.assign(data.order,{payment_status:'paid',fulfillment_status:'completed',paid_amount_cents:105000});await admin(t);await openOrder(page);await page.locator('[data-action=edit-contact]').click();await page.locator('[name=buyer_phone]').fill('09178889999');await page.locator('[data-action=back-order]').click();await confirmation(page).waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();const release=hold(data,'edit_order');await page.locator('[data-form=order-contact] [type=submit]').click();await page.locator('#dialog-close').click();assert(await page.locator('[data-form=order-contact]').isVisible());assert.equal(await confirmation(page).count(),0);release();await page.getByRole('heading',{name:'ELIO-SAMPLE',exact:true}).waitFor();assert.equal(data.order.buyer.phone,'09178889999');await finish(t,'contact correction guard retains changes and blocks exit while saving');
 }
 for(const failure of ['refresh','mutation','uncertain']){
  const t=await make(),{page,data}=t;Object.assign(data.order,{payment_status:'under_review',payment_reference:'SAMPLE-PAYMENT'});data.failAfterMutation=failure==='refresh';if(failure!=='refresh')data.mutationError=failure==='mutation'?{message:'The order changed. Refresh it.',code:'P0001'}:{message:'Connection interrupted'};
  await admin(t);await openOrder(page);await page.locator('[data-action=payment-approve]').click();await page.locator('[data-form=order-action] [type=submit]').click();
  if(failure==='refresh'){await page.locator('#dialog-body [role=status]').filter({hasText:'Order saved.'}).waitFor();assert.match(await page.locator('.order-status-row').innerText(),/Paid/);assert.equal(await page.locator('[data-form=order-action]').count(),0);await page.screenshot({path:join(out,'approval-refresh-failure.png')});}
  else{await page.locator('[data-form=order-action] .form-error').filter({hasText:failure==='mutation'?'order changed':'Connection interrupted'}).waitFor();assert.equal(await page.locator('#dialog-body').getByText('Paid',{exact:true}).count(),0);assert.equal(data.order.payment_status,'under_review');}
  assert.equal(data.calls.filter(c=>c.action==='approve_payment').length,1);await finish(t,'approval '+failure+' distinguishes confirmed mutation from refresh failure with no automatic retry');
 }
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
}catch(error){if(currentTest&&!currentTest.page.isClosed()){await currentTest.page.screenshot({path:join(out,'failure.png'),fullPage:true});const diagnostic={error:error.message,errors:currentTest.errors,calls:currentTest.data.calls.slice(-6),text:await currentTest.page.locator('body').innerText(),invalid:await currentTest.page.locator('input:invalid,select:invalid,textarea:invalid').evaluateAll(list=>list.map(e=>({name:e.name,value:e.value,message:e.validationMessage})))};await writeFile(join(out,'failure.json'),JSON.stringify(diagnostic,null,2));console.log(JSON.stringify({error:diagnostic.error,errors:diagnostic.errors,calls:diagnostic.calls,invalid:diagnostic.invalid}));}throw error;}finally{await browser.close();}
