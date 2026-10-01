import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://slips.test',out=resolve(root,'../test-results/slip-sizing');await mkdir(out,{recursive:true});
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const base={reference:'ELIO-TEST-SLIP',buyer:{name:'TEST — DO NOT FULFILL',phone:'00000000000',social_platform:'na'},method:'delivery',recipient:{name:'TEST — NO RIDER OR DELIVERY',phone:'00000000000'},address:{line1:'SYSTEM TEST ONLY — DO NOT DISPATCH',locality:'Caloocan'},instructions:'AUTHORIZED SYSTEM TEST. No payment made. Do not bake, fulfill, or book a rider. Cancel and restore stock after testing.',fulfillment_date:'2026-09-30',delivery_window:'9:00 AM – 6:00 PM',fulfillment_status:'cancelled',payment_status:'paid',refund_label:true,items:[{name:'The Signature Trio',quantity:1,unit_price_cents:90000,line_total_cents:90000,selection_labels:[]},{name:'Build your own box',quantity:1,unit_price_cents:80000,line_total_cents:80000,selection_labels:['Flavors per box: Matcha','Flavors per box: 2 × Vanilla']}],subtotal_cents:170000,discount_cents:8500,delivery_cents:30000,total_cents:191500,promo_snapshot:{code:'B5HLXN'},private_notes:'NEVER PRINT PRIVATE NOTES'};
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:helpers});
  if(u.pathname==='/test')return route.fulfill({contentType:'text/html',body:`<!doctype html><button id="print">Print</button><p id="error"></p><script type="module">import {printOrderSlips} from '/assets/admin/order-slips.js';document.querySelector('#print').onclick=()=>printOrderSlips(window.orders).catch(e=>document.querySelector('#error').textContent=e.message);</script>`});
  const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();await page.goto(origin+'/test');
 const many={...base,reference:'ELIO-12-ITEMS',instructions:'Keep upright. Handle carefully.',items:Array.from({length:12},(_,i)=>({...base.items[0],name:'Test box '+(i+1),selection_labels:['Vanilla × 1 · Chocolate × 1 · Matcha × 1']})),subtotal_cents:1080000,discount_cents:10000,total_cents:1100000};
 const cases=[['compact-quarter',[base],1],['half-sheet',[many],1],['mixed-batch',[base,many,base,base],2]];
 for(const [name,orders,expectedSheets] of cases){
  await page.evaluate(orders=>{window.orders=orders;document.querySelector('#error').textContent='';},orders);
  const opened=page.waitForEvent('popup');await page.locator('#print').click();const preview=await opened;
  await preview.locator('.print-slips:not([disabled])').waitFor({timeout:15000}).catch(async()=>{throw Error(await preview.locator('[role=status]').textContent());});
  assert.equal(await preview.locator('.slip').count(),orders.length);
  assert.equal(await preview.locator('.print-sheet').count(),expectedSheets);
  if(name==='compact-quarter')assert.equal(await preview.locator('.slip').getAttribute('data-size'),'quarter');
  if(name==='half-sheet')assert.equal(await preview.locator('.slip').getAttribute('data-size'),'half');
  for(const paper of ['a4','letter']){
   await preview.locator('#paper-size').selectOption(paper);await preview.locator('.print-slips:not([disabled])').waitFor();
   const metrics=await preview.locator('.slip').evaluateAll(nodes=>nodes.map(s=>({area:s.offsetWidth*s.offsetHeight,sheetArea:s.parentElement.offsetWidth*s.parentElement.offsetHeight,overflow:[s,...s.querySelectorAll('.slip-left,.slip-right,.slip-details')].some(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)})));
   for(const m of metrics){assert(m.area<=m.sheetArea*.5);assert.equal(m.overflow,false);}
   assert.equal(await preview.locator('.slip-price,.slip-payment,.slip-total').count(),0);
   assert.doesNotMatch(await preview.locator('#slips').textContent(),/₱|PHP|Payment breakdown|Subtotal|Discount|Order total|(?:Pickup|Delivery) fee|B5HLXN/i);
   assert.deepEqual(await preview.locator('.slip-item-title').allTextContents(),orders.flatMap(o=>o.items.map(item=>item.quantity+'×'+item.name)));
   assert(!await preview.locator('#slips').textContent().then(t=>t.includes('NEVER PRINT PRIVATE NOTES')));
   await preview.screenshot({path:join(out,`${name}-${paper}.png`),fullPage:true});
  }
  await preview.pdf({path:join(out,name+'.pdf'),preferCSSPageSize:true,printBackground:true});await preview.close();console.log('PASS '+name+' retains items and quantities without prices within quarter/half-sheet bounds on A4 and Letter');
 }
 const unusual={...many,reference:'ELIO-100-ITEMS',items:Array.from({length:100},(_,i)=>({...many.items[0],name:'Large order box '+(i+1)})),subtotal_cents:9000000,total_cents:9020000};
 const longOptions=Array.from({length:150},(_,i)=>`Option ${i+1}: Vanilla × 1.`).join(' '),longInstructions=Array.from({length:100},(_,i)=>`Instruction ${i+1}: Keep upright.`).join('\n');
 const verbose={...base,reference:'ELIO-LONG-DETAILS',instructions:longInstructions,items:[{...base.items[0],selection_labels:[longOptions]}],subtotal_cents:90000,total_cents:111500};
 for(const order of [unusual,verbose]){
  await page.evaluate(o=>{window.orders=[o];document.querySelector('#error').textContent='';},order);
  const opened=page.waitForEvent('popup');await page.locator('#print').click();const preview=await opened;
  await preview.locator('.print-slips:not([disabled])').waitFor({timeout:15000}).catch(async()=>{throw Error(await preview.locator('[role=status]').textContent());});
  for(const paper of ['a4','letter']){
   await preview.locator('#paper-size').selectOption(paper);await preview.locator('.print-slips:not([disabled])').waitFor();
   const count=await preview.locator('.slip').count();assert(count>1&&count<12,'Only necessary continuation slips should be created');
   assert.equal(await preview.locator('.slip:not([data-size=half])').count(),0);
   assert.equal(await preview.locator('.print-sheet').count(),Math.ceil(count/2));
   const metrics=await preview.locator('.slip').evaluateAll(nodes=>nodes.map(s=>({area:s.offsetWidth*s.offsetHeight,sheetArea:s.parentElement.offsetWidth*s.parentElement.offsetHeight,overflow:[s,...s.querySelectorAll('.slip-left,.slip-right,.slip-details')].some(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)})));
   for(const m of metrics){assert(m.area<=m.sheetArea*.5);assert.equal(m.overflow,false);}
   assert.deepEqual(await preview.locator('.slip-number').allTextContents(),Array.from({length:count},(_,i)=>`Slip ${i+1} of ${count}`));
   assert.equal(await preview.locator('.slip-price,.slip-payment,.slip-total').count(),0,'Prices and payment breakdowns never print');
   assert.doesNotMatch(await preview.locator('#slips').textContent(),/₱|PHP|Payment breakdown|Subtotal|Discount|Order total|(?:Pickup|Delivery) fee|B5HLXN/i);
   assert.equal(await preview.locator('.slip-item[data-continued=false]').count(),order.items.length,'Each item and quantity prints once');
   assert(!await preview.locator('#slips').textContent().then(t=>t.includes('NEVER PRINT PRIVATE NOTES')));
   if(order===verbose){
    assert.equal((await preview.locator('.slip-variation').allTextContents()).join(''),longOptions);
    assert.equal(await preview.locator('.slip-detail').evaluateAll(nodes=>nodes.filter(n=>n.querySelector('h2').textContent.startsWith('Instructions')).map(n=>n.querySelector('p').textContent).join('')),longInstructions);
   }else assert.deepEqual(await preview.locator('.slip-item-title').allTextContents(),order.items.map(item=>'1×'+item.name));
  }
  await preview.locator('.print-sheet').first().screenshot({path:join(out,order.reference+'-first.png')});
  await preview.locator('.print-sheet').last().screenshot({path:join(out,order.reference+'-last.png')});
  await preview.pdf({path:join(out,order.reference+'.pdf'),preferCSSPageSize:true,printBackground:true});await preview.close();
  console.log('PASS '+order.reference+' uses numbered half-sheet continuations only as needed, retaining every item/detail without prices');
 }
}finally{await browser.close();}
