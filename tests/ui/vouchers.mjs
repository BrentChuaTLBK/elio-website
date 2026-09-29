import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {accountingFixture} from '../backend/accounting-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT,'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),project=resolve(import.meta.dirname,'../..'),root=join(project,'dist'),origin='https://vouchers.test',out=join(project,'test-results/vouchers');await mkdir(out,{recursive:true});
await db.exec(await readFile(join(project,'tests/backend/bootstrap.sql'),'utf8'));
for(const name of (await readdir(join(project,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(join(project,'supabase/migrations',name),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
const h=await makeHarness(db),client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const fixture=await accountingFixture(h);await db.query("update elio.settings set data=data||'{\"site_url\":\"https://vouchers.test\",\"paused\":false,\"newsletter_mailing_address\":\"Local QA only\"}'");
let chain=Promise.resolve();const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{
 for(const width of [1440,390,320]){
  const user=randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,`ui-${width}@example.test`]);
  const ctx=await browser.newContext({viewport:{width,height:1000}}),errors=[];let fail=false;
  await ctx.exposeBinding('voucherApi',async(_,{action,payload})=>serial(async()=>{try{if(fail)throw Error('Connection unavailable. Try again.');return {data:await h.api(action,payload,action==='my_vouchers'?user:h.ids.owner)};}catch(e){return {error:e.message};}}));
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export async function api(action,payload={}){const r=await window.voucherApi({action,payload});if(r.error)throw Error(r.error);return r.data;}export async function affiliateReceipt(){};${helpers}`});
   if(u.pathname==='/test.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/admin/ordering.css"><link rel="stylesheet" href="/assets/admin/manage.css"><link rel="stylesheet" href="/assets/admin/elio.css"><link rel="stylesheet" href="/assets/admin/accounting.css"><link rel="stylesheet" href="/assets/vouchers.css"><main style="max-width:1100px;padding:20px;margin:auto"><div id="campaigns"></div><section id="wallet"></section></main><script type="module">import {mountVoucherCampaigns} from "/assets/admin/voucher-campaigns.js";import {mountVouchers} from "/assets/admin/vouchers.js";window.c=mountVoucherCampaigns(document.querySelector("#campaigns"),{owner:true});window.w=mountVouchers(document.querySelector("#wallet"));</script>'});
   const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const p=await ctx.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});await p.goto(origin+'/test.html');
  await p.locator('[data-offer=new]').first().waitFor({timeout:10000}).catch(async e=>{console.error(await p.locator('body').innerText());throw e;});
  await p.locator('[data-offer=new]').first().click();await p.locator('[name=name]').fill(`Thank-you ${width}`);
  await p.locator('[name=kind]').selectOption('percent');await p.locator('[name=value]').fill('10');await p.locator('[name=minimum]').fill('0');
  await p.locator('[name=cap]').fill('100');await p.locator('[name=expiry_mode]').selectOption('fixed');
  await p.locator('[data-offer-date] summary').click();await p.locator('[data-offer-date] .calendar-month').waitFor({state:'visible'});
  await p.locator('[name=expiry_mode]').selectOption('days');
  await p.getByRole('button',{name:'Save draft',exact:true}).click();await p.getByText('Draft saved. Review its terms before activating.').waitFor({timeout:10000}).catch(async e=>{console.error(await p.locator('body').innerText());throw e;});
  const card=p.locator('.offer-card').filter({hasText:`Thank-you ${width}`});await card.getByRole('button',{name:'Edit / activate'}).click();
  assert.equal(await p.locator('[name=status]').inputValue(),'draft');await p.locator('[name=status]').selectOption('active');await p.getByRole('button',{name:'Save campaign',exact:true}).click();await p.getByText('Campaign active. Future qualifying completions will issue vouchers.').waitFor();
  const o=await h.api('create_order',h.checkout(fixture.product,fixture.date),user);await h.proof(o,{user_id:user});await h.action('approve_payment',await h.order(o.id));await h.action('set_fulfillment',await h.order(o.id),{status:'completed'});
  await p.locator('[data-offer=refresh]').click();await p.locator('.offer-card').filter({hasText:`Thank-you ${width}`}).waitFor();await p.locator('[data-voucher-refresh]').click();await p.locator('#wallet .voucher-card').first().waitFor();
  assert.match(await p.locator('#wallet').innerText(),/10% off your next order/);assert(await p.locator('#wallet [href^="order.html#voucher="]').count()>0);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:join(out,`overview-${width}.png`),fullPage:true});
  await p.locator('.offer-card').filter({hasText:`Thank-you ${width}`}).getByRole('button',{name:'View report'}).click();await p.locator('.offer-recipient').waitFor();assert.match(await p.locator('.offer-recipient').innerText(),/skipped/);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:join(out,`report-${width}.png`),fullPage:true});
  await p.locator('[data-voucher-tab=used]').click();await p.getByText('No vouchers here yet. Eligible offers will appear automatically.').waitFor();
  fail=true;await p.locator('[data-voucher-refresh]').click();await p.getByText('Connection unavailable. Try again.').waitFor();fail=false;
  await p.locator('[data-voucher-tab=available]').click();await p.locator('#wallet .voucher-card').first().waitFor();
  assert.deepEqual(errors,[]);console.log(`PASS voucher campaign, account wallet, report and retry at ${width}px`);await ctx.close();
 }
}finally{await browser.close();await db.close();}
