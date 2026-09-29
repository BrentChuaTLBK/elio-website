import {navigateDashboard} from '../helpers/dashboard-navigation.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),output=resolve(root,'../test-results/website-visitors'),origin='https://eliocheesecakes.com';
await mkdir(output,{recursive:true});
// Use the real client.js and dashboard; only the Auth SDK and network are fixtures.
const sdk=`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{user:{id:'staff-fixture'}}}}),onAuthStateChange:()=>{}},rpc:async(name,body)=>({data:await (await fetch('/fixture',{method:'POST',body:JSON.stringify(body)})).json()}),functions:{invoke:async(name,{body,signal})=>{if(!(signal instanceof AbortSignal))throw Error('Missing cancellation signal');const r=await fetch('/functions/v1/'+name,{method:'POST',body:JSON.stringify(body),signal});return r.ok?{data:await r.json()}:{error:{message:'Report unavailable'}};}}};}`;
const ready={status:'ready',visitorsToday:1234,activeLast30Minutes:6,timeZone:'Asia/Manila',updatedAt:'2026-09-28T08:00:00Z'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try {
  for(const width of [1440,390,320]){
    const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,serviceWorkers:'block'}),errors=[];
    let report=ready,requests=0;
    await ctx.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/functions/v1/website-analytics'){
        requests++;assert.deepEqual(route.request().postDataJSON(),{});
        return route.fulfill({contentType:'application/json',body:JSON.stringify(report)});
      }
      if(url.pathname==='/fixture'){
        const {p_action:action}=route.request().postDataJSON();let data;
        if(action==='admin_bootstrap')data={role:'owner',orders:[],products:[],categories:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
        else if(action==='site_status')data={active:false,uploads_paused:false,announce:false,server_time:new Date().toISOString()};
        else throw Error('Unexpected action '+action);
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      }
      const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
      try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
    });
    const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.clock.install();await page.goto(origin+'/manage.html');await navigateDashboard(page,'analytics');
    const panel=page.locator('#website-visitors'),today=panel.locator('[data-traffic-metric=today]'),active=panel.locator('[data-traffic-metric=realtime]');
    await page.waitForFunction(()=>document.querySelector('[data-traffic-metric=today]')?.textContent==='1,234');
    assert.equal(await active.textContent(),'6');assert((await panel.textContent()).includes('Asia/Manila'));
    assert.equal(requests,1);await page.locator('#analytics-period').selectOption('last7');
    await page.locator('#analytics-period').focus();report={...ready,visitorsToday:1235,activeLast30Minutes:7};
    await page.clock.fastForward(61000);await page.waitForFunction(()=>document.querySelector('[data-traffic-metric=today]')?.textContent==='1,235');
    assert.equal(await page.locator('#analytics-period').inputValue(),'last7');assert.equal(await page.locator('#analytics-period').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await panel.screenshot({path:join(output,`ready-${width}.png`)});
    report={...ready,status:'partial',visitorsToday:null,issues:{today:'busy'}};
    await page.clock.fastForward(61000);await page.waitForFunction(()=>document.querySelector('[data-traffic-issue=today]'));
    assert.equal(await today.textContent(),'—');assert.equal(await active.textContent(),'6');
    report={...ready,visitorsToday:0,activeLast30Minutes:0};await page.clock.fastForward(61000);
    await page.waitForFunction(()=>document.querySelector('[data-traffic-metric=today]')?.textContent==='0');assert.equal(await active.textContent(),'0');
    report={status:'not_configured'};await page.clock.fastForward(61000);
    await page.waitForFunction(()=>document.querySelector('#website-visitors')?.textContent.includes('still need reporting access'));assert.equal(await today.textContent(),'—');
    const count=requests;await navigateDashboard(page,'orders');await page.clock.fastForward(61000);assert.equal(requests,count);
    assert.deepEqual(errors,[]);await ctx.close();console.log(`Passed dashboard reporting at ${width}px.`);
  }
} finally {await browser.close();}
