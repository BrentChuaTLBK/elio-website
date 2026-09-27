import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://affiliate.test',output=resolve(root,'../test-results/affiliates');await mkdir(output,{recursive:true});
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[390,'staff'],[390,'unassigned'],[390,'guest']]){
  const calls=[],affiliates=[],codes=[],payouts=[],errors=[];let earned=0,assigned=role!=='unassigned',holdReport=false,releaseReport;
  const stats=()=>({earned_cents:earned,net_sales_cents:earned*10,estimated_cents:9500,completed_orders:earned>0?1:0,paid_cents:payouts.filter(p=>p.status==='paid').reduce((n,p)=>n+p.amount_cents,0),balance_cents:earned-payouts.filter(p=>p.status==='paid').reduce((n,p)=>n+p.amount_cents,0)});
  const report=p=>({affiliate:affiliates[0],stats:stats(),codes,orders:[{order_id:'test-order',reference:'ELIO-DEMO',code:codes[0]?.code||'ELIOLOVE',created_at:'2026-09-27T02:00:00Z',commission_bps:1000,net_sales_cents:95000,estimated_cents:9500,earned_cents:9500,status:'earned'}],order_total:1,order_offset:p.order_offset||0,payouts,payout_total:payouts.length,payout_offset:p.payout_offset||0,generated_at:new Date().toISOString()});
  const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export const configured=true,ready=Promise.resolve(),initializationError=null,auth={getSession:async()=>({data:{session:${role==='guest'?'null':"{user:{id:'user'}}"}}}),onAuthStateChange:fn=>{window.__authChange=fn;}};
   export async function api(action,payload={}){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
   export async function affiliatePayout(file,payload){if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a JPG, PNG, or WebP receipt.');return api('upload_payout',{...payload,proof_name:file.name});}
   export async function affiliateReceipt(id){await api('receipt',{id});return {url:'${origin}/receipt.png',expires_in:300};}
   export async function upload(){throw Error('Unexpected upload')} export async function newsletterRequest(){throw Error('Unexpected newsletter')} export async function websiteVisitorStats(){return {}};${helpers}`});
   if(url.pathname==='/fixture-api'){
    const {action,payload:p}=route.request().postDataJSON();calls.push({action,payload:p});let data;
    if(action==='admin_bootstrap')data={role,products:[],categories:[],orders:[],inventory:[],zones:[],staff:[],promos:[{id:'affiliate-code',affiliate_managed:true,code:'PRIVATEAFF'},{id:'newsletter-code',newsletter_managed:true,code:'PRIVATENEWS'}],settings:{paused:false}};
    else if(action==='affiliate_admin')data={affiliates:affiliates.map(a=>({...a,balance_cents:stats().balance_cents,earned_cents:earned,code_count:codes.length}))};
    else if(action==='affiliate_report'||action==='affiliate_dashboard'){
     if(!assigned)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'An affiliate code has not been assigned to your account yet.'})});
     data=report(p);if(holdReport)await new Promise(r=>{releaseReport=r;});
    }
    else if(action==='affiliate_save'){data={...p,revision:p.revision+1};const i=affiliates.findIndex(a=>a.id===p.id);if(i<0)affiliates.push(data);else affiliates[i]=data;}
    else if(action==='affiliate_save_code'){data={...p.promo,id:p.id,starts_at:p.starts_at,revision:p.revision+1,used_count:0,reserved_count:0,completed_orders:0,net_sales_cents:0,earned_cents:0};const i=codes.findIndex(c=>c.id===p.id);if(i<0)codes.push(data);else codes[i]=data;}
    else if(action==='upload_payout'){await new Promise(r=>setTimeout(r,100));assert(p.amount_cents<=stats().balance_cents);data={payout:{...p,status:'paid',revision:1,has_proof:true}};payouts.push(data.payout);}
    else if(action==='affiliate_void_payout'){Object.assign(payouts.find(v=>v.id===p.id),{status:'voided',void_reason:p.reason,revision:2});data={};}
    else if(action==='receipt')data={};
    else throw Error('Unexpected '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const file=url.pathname==='/receipt.png'?join(root,'assets/elio-favicon.png'):resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  if(role==='owner'||role==='staff'){
   await page.goto(origin+'/manage.html#affiliates');
   if(role==='staff'){await page.getByText('A little overview',{exact:true}).waitFor();assert.equal(await page.locator('[data-view=affiliates]').isVisible(),false);assert.equal(calls.some(c=>c.action==='affiliate_admin'),false);}
   else{
    await page.getByText('No affiliates yet.',{exact:false}).waitFor();await page.locator('[data-aff=new-affiliate]').click();
    let form=page.locator('.aff-form');await form.locator('[name=name]').fill('Elio Partner');await form.locator('[name=email]').fill('partner@example.test');await form.locator('[name=commission]').fill('10.25');await form.locator('[type=submit]').click();await page.locator('.aff-name').getByText('Elio Partner',{exact:true}).waitFor();
    assert.equal(affiliates[0].commission_bps,1025);assert.equal(affiliates.length,1);
    await page.locator('[data-aff=new-code]').click();await form.locator('[name=code]').fill('elioLOVE');await form.locator('[name=value]').fill('5');await form.locator('[name=minimum]').fill('500');await form.locator('[name=cap]').fill('100');await form.locator('[name=starts]').fill('2026-09-01T00:00');await form.locator('[name=expires]').fill('2026-10-15T23:59');await form.locator('[name=per_account]').fill('2');await form.locator('[name=total]').fill('200');await form.locator('[type=submit]').click();await page.locator('.aff-code-name').getByText('ELIOLOVE',{exact:true}).waitFor();
    assert.equal(codes[0].value,5);assert.equal(codes[0].min_subtotal_cents,50000);assert.equal(codes[0].cap_cents,10000);assert.equal(codes[0].expires_at,'2026-10-15T15:59:00.000Z');assert.equal(codes[0].per_account_limit,2);assert.equal(codes[0].global_limit,200);
    await page.locator('[data-aff=copy-code]').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'ELIOLOVE');
    await page.locator('[data-aff=edit-code]').click();await form.locator('[name=discount_kind]').selectOption('fixed');await form.locator('[name=value]').fill('35.75');await form.locator('[type=submit]').click();await page.getByText('₱35.75 off',{exact:true}).waitFor();assert.equal(codes[0].value,3575);
    await page.locator('[data-aff=edit-affiliate]').click();assert(await form.locator('[name=email]').isEditable()===false);await form.locator('[name=commission]').fill('20');
    // Explicit refresh preserves unsaved form fields and its original revision.
    await page.locator('[data-aff=refresh]').click();assert.equal(await form.locator('[name=commission]').inputValue(),'20');
    await page.locator('[data-view=orders]').click();const dirty=page.getByRole('dialog',{name:'Unsaved affiliate changes',exact:true});await dirty.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await form.locator('[name=commission]').inputValue(),'20');await form.locator('[type=submit]').click();await page.getByText('Current commission:',{exact:false}).waitFor();assert.equal(affiliates[0].commission_bps,2000);
    earned=9500;await page.locator('[data-aff=refresh]').click();await page.locator('.aff-stats .panel').first().getByText('₱95.00',{exact:true}).waitFor();await page.screenshot({path:join(output,`owner-${width}.png`),fullPage:true});
    await page.locator('[data-aff=new-payout]').click();await form.locator('[name=amount]').fill('50');await form.locator('[name=reference]').fill('GCASH-123');await form.locator('[name=proof]').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('test')});await form.locator('[type=submit]').click();await page.getByText('Choose a JPG, PNG, or WebP receipt.',{exact:true}).waitFor();assert.equal(payouts.length,0);
    await form.locator('[name=proof]').setInputFiles(join(root,'assets/elio-favicon.png'));await page.screenshot({path:join(output,`payout-${width}.png`),fullPage:true});await form.locator('[type=submit]').dblclick();await page.getByText('Payment recorded. The balance and Accounting have been updated.',{exact:true}).waitFor();assert.equal(payouts.length,1);assert.equal(payouts[0].amount_cents,5000);await page.locator('.aff-stats .panel').first().getByText('₱45.00',{exact:true}).waitFor();
    await page.locator('[data-aff=receipt]').click();await page.getByRole('dialog',{name:'Payment receipt',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('[data-aff=void-payout]').click();await form.locator('[name=reason]').fill('Wrong payment amount recorded');await form.locator('[type=submit]').click();await page.getByRole('dialog',{name:'Void payment record?',exact:true}).getByRole('button',{name:'Void record',exact:true}).click();await page.getByText('Payment record voided. The balance and Accounting have been updated.',{exact:true}).waitFor();assert.equal(payouts[0].status,'voided');
    // Paid commission later reversed, so the next earnings offset the payment.
    payouts[0].status='paid';earned=0;await page.locator('[data-aff=refresh]').click();await page.getByText('will be offset against future earnings',{exact:false}).waitFor();assert.equal(await page.locator('[data-aff=new-payout]').isDisabled(),true);
    earned=9500;await page.goto(origin+'/affiliate.html');await page.getByText('Welcome, Elio Partner.',{exact:true}).waitFor();assert.equal(await page.locator('[data-aff=edit-code]').count(),0);assert.equal(await page.locator('[data-aff=new-payout]').count(),0);assert.equal(await page.locator('[data-aff=void-payout]').count(),0);
    await page.locator('[data-aff=receipt]').click();await page.getByRole('dialog',{name:'Payment receipt'}).getByRole('button',{name:'Close'}).click();await page.screenshot({path:join(output,`affiliate-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
    // Sign-out must clear a response still in flight, not redisplay private data.
    holdReport=true;await page.locator('#affiliate-refresh').click();await page.waitForTimeout(50);await page.evaluate(()=>window.__authChange('SIGNED_OUT'));releaseReport();await page.getByText('You have signed out.',{exact:true}).waitFor();await page.waitForTimeout(50);assert.equal(await page.locator('.aff-code').count(),0);
   }
  }else{
   await page.goto(origin+'/affiliate.html');if(role==='guest'){await page.getByText('Sign in to your Elio account.',{exact:true}).waitFor();assert.equal(calls.length,0);}else await page.getByText('An affiliate code has not been assigned to your account yet.',{exact:true}).waitFor();
   assert.equal(await page.locator('.aff-code').count(),0);
  }
  assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS ${role} ${width}px affiliate workflows`);
 }
}finally{await browser.close();}
