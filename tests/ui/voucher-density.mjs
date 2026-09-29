import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),out=resolve(root,'../test-results/voucher-density'),origin='https://voucher-density.test';await mkdir(out,{recursive:true});
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const titles=['Your welcome treat','A little thank-you from Elio','A sweet return','For your next celebration','A treat from our kitchen','Something sweet to share','Your next Elio moment','With love, from Elio'];
const offers=Array.from({length:8},(_,i)=>({id:'voucher-'+i,source:i?'order':'newsletter',title:titles[i],code:'ELIO-'+String(i+1).padStart(5,'0'),kind:i%2?'fixed':'percent',value:i%2?5000+(i-1)*1000:5+i,min_subtotal_cents:i%3?50000:0,cap_cents:10000,status:'available',expires_at:`2030-10-${String(10+i*2).padStart(2,'0')}T12:23:00+08:00`}));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const shots=[];
try{
 for(const width of [600,390,320]){
  let count=1,mode='available';const errors=[];
  const context=await browser.newContext({viewport:{width,height:1200}});
  await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedVoucher=text;}}});});
  await context.exposeBinding('walletApi',async(_,{action,payload})=>{
   assert.equal(action,'my_vouchers');const all=offers.slice(0,count).map(v=>({...v,status:mode}));
   const selected=payload.status==='available'?all.filter(v=>['available','reserved'].includes(v.status)):payload.status==='used'?all.filter(v=>v.status==='used'):all.filter(v=>['expired','inactive'].includes(v.status));
   return {vouchers:selected.slice(payload.offset,payload.offset+50),total:selected.length,offset:payload.offset,limit:50,counts:{available:all.filter(v=>['available','reserved'].includes(v.status)).length,used:all.filter(v=>v.status==='used').length,expired:all.filter(v=>['expired','inactive'].includes(v.status)).length}};
  });
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export async function api(action,payload={}){return window.walletApi({action,payload});}${helpers}`});
   if(u.pathname==='/preview.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/admin/ordering.css"><link rel="stylesheet" href="/assets/admin/elio.css"><link rel="stylesheet" href="/assets/admin/account.css"><link rel="stylesheet" href="/assets/vouchers.css"><style>.customer-account-page .account-dashboard{margin:12px auto;width:calc(100% - 24px)}</style><body class="customer-account-page"><main class="customer-account account-dashboard"><div id="signed-in"><section id="account-vouchers" aria-label="My vouchers"></section></div></main><script type="module">import {mountVouchers} from "/assets/admin/vouchers.js";window.wallet=mountVouchers(document.querySelector("#account-vouchers"));</script></body></html>'});
   const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/preview.html');
  await page.locator('.voucher-card').waitFor();assert.equal(await page.locator('.voucher-compact').count(),0);
  for(count=2;count<=8;count++){
   await page.locator('[data-voucher-refresh]').click();await page.locator('.voucher-compact').first().waitFor();
   assert.equal(await page.locator('.voucher-card').count(),0);assert.equal(await page.locator('.voucher-compact').count(),Math.min(count,4));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const file=`vouchers-${count}-${width}-page-1.png`;await page.mouse.move(0,0);await page.locator('#account-vouchers').screenshot({path:join(out,file)});shots.push({count,width,page:1,file});
   await page.locator('[data-voucher-details]').first().click();await page.locator('.voucher-details-dialog').waitFor();
   const dialog=page.locator('.voucher-details-dialog');assert.match(await dialog.innerText(),/Manila time/);assert.match(await dialog.innerText(),/ELIO-00001/);
   await dialog.locator('[data-voucher-copy]').click();assert.equal(await page.evaluate(()=>window.copiedVoucher),'ELIO-00001');await dialog.getByText('Code copied.',{exact:true}).waitFor();
   if(count===2)await page.screenshot({path:join(out,`voucher-details-${width}.png`)});
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('[data-voucher-details]').first().evaluate(el=>el===document.activeElement),true);
   if(count>4){
    await page.locator('[data-voucher-page=next]').click();await page.getByText(`5–${count} of ${count}`,{exact:true}).waitFor();
    assert.equal(await page.locator('.voucher-compact').count(),count-4);assert.equal(await page.locator('[data-voucher-page=next]').isDisabled(),true);
    const file=`vouchers-${count}-${width}-page-2.png`;await page.mouse.move(0,0);await page.locator('#account-vouchers').screenshot({path:join(out,file)});shots.push({count,width,page:2,file});
    await page.locator('[data-voucher-details]').first().click();assert.match(await page.locator('.voucher-details-dialog').innerText(),/ELIO-00005/);await page.locator('[data-voucher-close]').click();
    await page.locator('[data-voucher-page=previous]').click();await page.getByText(`1–4 of ${count}`,{exact:true}).waitFor();
   }
  }
  count=8;await page.locator('[data-voucher-refresh]').click();await page.locator('[data-voucher-page=next]').click();await page.getByText('5–8 of 8',{exact:true}).waitFor();
  count=1;await page.locator('[data-voucher-refresh]').click();await page.locator('.voucher-card').waitFor();assert.equal(await page.locator('.voucher-compact').count(),0);
  count=2;mode='reserved';await page.locator('[data-voucher-refresh]').click();await page.locator('.voucher-compact').first().waitFor();assert.equal(await page.locator('.voucher-compact a').count(),0);await page.locator('[data-voucher-details]').first().click();assert.match(await page.locator('.voucher-details-dialog').innerText(),/attached to an unpaid order/);await page.locator('[data-voucher-close]').click();
  mode='used';await page.locator('[data-voucher-tab=used]').click();await page.locator('.voucher-compact').first().waitFor();assert.equal(await page.locator('.voucher-compact a').count(),0);
  mode='expired';await page.locator('[data-voucher-tab=expired]').click();await page.locator('.voucher-compact').first().waitFor();assert.equal(await page.locator('.voucher-compact a').count(),0);
  await page.locator('[data-voucher-details]').first().click();await page.evaluate(()=>window.wallet.destroy());assert.equal(await page.locator('.voucher-details-dialog').count(),0);
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS 2–8 voucher layouts, paging, copy, details, status and shrinking count at ${width}px`);
 }
 await writeFile(join(out,'previews.json'),JSON.stringify(shots,null,2));
}finally{await browser.close();}
