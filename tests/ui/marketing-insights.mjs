import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {navigateDashboard} from '../helpers/dashboard-navigation.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://marketing.test',output=resolve(root,'../test-results/marketing');await mkdir(output,{recursive:true});
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const cohort={kind:'newsletter',group_key:'home_popup',label:'home_popup',people:120,issued:120,eligible_issued:100,observed_people:100,collecting:20,redeemed:32,redeemed_customers:32,later_customers:11,paid_orders:52,gross_cents:2880000,discount_cents:144000,sales_cents:2736000,legacy_attribution:10,next_ready_at:'2026-10-01T00:00:00Z'};
const partner={id:'partner-1',name:'Sample partner <script>',active:true,commission_bps:1000,revision:1,paid_orders:20,sales_cents:2000000,estimated_cents:10000,earned_cents:200000,paid_cents:150000,balance_cents:50000};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{for(const [width,role] of [[320,'owner'],[390,'owner'],[768,'owner'],[1440,'owner'],[390,'staff']]){
 const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'}),errors=[],calls=[];let fail=false,failDetail=false,hold=false,release;
 await ctx.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`export const configured=true,ready=Promise.resolve(),initializationError=null,auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
   export async function api(action,payload={}){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
   export async function upload(){} export async function newsletterRequest(){} export async function calendarConnection(){return {}} export async function websiteVisitorStats(){return {}} export async function affiliatePayout(){} export async function affiliateReceipt(){} ${helpers}`});
  if(url.pathname==='/fixture-api'){
   const {action,payload:p}=route.request().postDataJSON();calls.push({action,payload:p});let data;
   if(action==='site_status')data={active:false,announce:false,uploads_paused:false,server_time:new Date().toISOString()};
   else if(action==='admin_bootstrap')data={role,products:[],categories:[],orders:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
   else if(action==='calendar_list')data={orders:[],connection:{connected:false}};
   else if(action==='marketing_insights'){
    if(hold){hold=false;await new Promise(r=>{release=r;});}
    if(fail)return route.fulfill({status:503,json:{error:'Connection interrupted'}});
    data={groups:p.month==='2000-01'?[]:[cohort,{...cohort,kind:'campaign',group_key:'campaign-1',label:'A little thank-you from Elio',legacy_attribution:0,collecting:0}],missing_payment_records:0};
   }else if(action==='marketing_cohort_orders'){
    if(failDetail)return route.fulfill({status:503,json:{error:'Details unavailable'}});
    data={total:52,limit:50,offset:p.offset,totals:{sales_cents:2736000},rows:Array.from({length:p.offset?2:50},(_,i)=>({id:'order-'+(p.offset+i),reference:'ELIO-SAMPLE-'+(p.offset+i),code:'8NX46M',approved_at:'2026-09-02T00:00:00Z',sales_cents:85500}))};
   }else if(action==='marketing_affiliates')data={rows:[partner]};
   else if(action==='marketing_affiliate_ledger')data={total:2,limit:50,offset:0,earned_cents:200000,rows:[{id:'l1',order_id:'order-1',reference:'ELIO-SAMPLE',reason:'Completed order commission',amount_cents:250000,created_at:'2026-09-02T00:00:00Z'},{id:'l2',order_id:'order-1',reference:'ELIO-SAMPLE',reason:'Commission reversal: refunded',amount_cents:-50000,created_at:'2026-09-03T00:00:00Z'}]};
   else if(action==='affiliate_admin')data={affiliates:[{...partner,email:'sample@example.test',code_count:1}],stats:{...partner,affiliates:1,active_affiliates:1,payable_cents:50000,offset_cents:0},top_affiliates:[]};
   else if(action==='affiliate_report')data={affiliate:partner,stats:{...partner,net_sales_cents:2000000,completed_orders:20},codes:[],orders:[],order_total:0,order_offset:0,payouts:[],payout_total:0,payout_offset:0,generated_at:new Date().toISOString()};
   else if(action==='get_order')return route.fulfill({status:503,json:{error:'Order temporarily unavailable'}});
   else throw Error('Unexpected action '+action);
   return route.fulfill({json:data});
  }
  const path=resolve(root,'.'+url.pathname);if(!path.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/manage.html#marketing');
 if(role==='staff'){await page.getByRole('heading',{name:'A little overview'}).waitFor();assert(await page.locator('#admin-nav [data-view=marketing]').isHidden());assert(!calls.some(c=>c.action.startsWith('marketing_')));await ctx.close();continue;}
 await page.getByRole('heading',{name:'Homepage popup'}).waitFor();assert.match(await page.locator('#marketing-insights-manager').innerText(),/32.0% of ready codes/);assert.equal(await page.locator('.marketing-grid script').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,`offers-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'View 52 source orders'}).first().click();await page.getByText('1–50 of 52',{exact:true}).waitFor();await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('51–52 of 52',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Next',exact:true}).isDisabled());await page.getByRole('button',{name:'Previous',exact:true}).click();await page.getByText('1–50 of 52',{exact:true}).waitFor();
 await page.getByRole('button',{name:'ELIO-SAMPLE-0',exact:true}).click();await page.getByText('Order temporarily unavailable',{exact:false}).waitFor();assert(calls.some(c=>c.action==='get_order'&&c.payload.order_id==='order-0'));await page.keyboard.press('Escape');
 failDetail=true;await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText(/Could not load source orders/).waitFor();failDetail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('51–52 of 52',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
 fail=true;await page.locator('[data-insight=refresh]').first().click();await page.getByText(/Could not load this report/).waitFor();fail=false;await page.getByRole('button',{name:'Try again'}).click();await page.getByRole('heading',{name:'Homepage popup'}).waitFor();
 hold=true;await page.locator('[data-insight=refresh]').first().click();await page.getByText('Loading your report…').waitFor();await page.locator('[data-insight=affiliates]').click();await page.getByRole('heading',{name:partner.name,exact:true}).waitFor();release();await page.waitForTimeout(150);assert(await page.getByRole('heading',{name:partner.name,exact:true}).isVisible());
 await page.getByRole('button',{name:'Commission ledger'}).click();await page.getByRole('heading',{name:'Commission ledger'}).waitFor();assert.match(await page.locator('.marketing-detail').innerText(),/Commission reversal: refunded/);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,`affiliates-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Orders & payout history'}).click();await page.locator('.aff-name').waitFor();assert(calls.some(c=>c.action==='affiliate_report'&&c.payload.id===partner.id));
 await navigateDashboard(page,'marketing');await page.getByRole('heading',{name:'Homepage popup'}).waitFor();await page.locator('[name=cohort-month]').fill('2000-01');await page.locator('[name=cohort-month]').press('Tab');await page.getByRole('heading',{name:'No recipients in this month yet'}).waitFor();
 assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS Marketing report integration, money labels, pagination, retries, stale responses, ledger and navigation ${width}px`);
}}finally{await browser.close();}
