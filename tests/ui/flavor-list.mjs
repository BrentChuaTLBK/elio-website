import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),out=resolve(root,'../test-results/flavor-list'),origin='https://flavor-list.test';await mkdir(out,{recursive:true});
const content=await readFile(join(root,'content.js'),'utf8'),sandbox={window:{}};vm.runInNewContext(content.slice(0,content.indexOf('// The public collection')),sandbox);
const base=JSON.parse(JSON.stringify(sandbox.window.ELIO_CONTENT));
const fixture=()=>({...structuredClone(base),featuredOrder:[],currentMenuShown:true,nextMenuShown:true,currentMonth:'2026-09-01',nextMonth:'2026-10-01',monthlyMenu:['vanilla','chocolate','matcha','gorgonzola'],nextMonthlyMenu:['vanilla','ube','hojicha','speculoos'],flavorHeadings:{current:'This month’s favorites',next:'Coming next month',collection:'The full collection.'},collectionLoaded:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const results=[];
try{
 for(const width of [1440,768,390,320]){
  let data=fixture();data.flavors[0].collection_details={product_type:'Square Basque cheesecake',serving:'Keep chilled. Serve slightly softened.'};
  const errors=[],ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/content.js')return route.fulfill({contentType:'text/javascript',body:`window.ELIO_CONTENT=${JSON.stringify(data)};window.ELIO_CONTENT_READY=Promise.resolve(window.ELIO_CONTENT);`});
   if(['/assets/shop/newsletter.js','/assets/site-maintenance.js','/assets/site-analytics.js','/assets/website-photos.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  let revision=0;
  const loaded=async hash=>{await page.goto(origin+'/flavors.html?fixture='+(++revision)+(hash||''));await page.waitForFunction(()=>document.querySelector('.flavor-result-summary')?.textContent.length>0);await page.evaluate(()=>document.fonts.ready)};
  const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await loaded();assert.equal(await page.locator('#monthly-title').textContent(),'September 2026');assert.equal(await page.locator('#next-month-title').textContent(),'October 2026');assert.equal(await page.locator('#monthly-label').textContent(),'This month’s favorites');
  assert.equal(await page.locator('#monthly-flavors .flavor-tile:visible').count(),4);assert.equal(await page.locator('#next-month-flavors .flavor-tile:visible').count(),4);
  assert.equal(await page.locator('#monthly-flavors .flavor-month-badge').count(),0);assert.equal(await page.getByText('Discover flavor',{exact:true}).count(),0);assert.equal(await page.locator('#flavor-dialog').count(),0);
  assert.equal(await page.locator('#monthly-flavors [data-flavor=vanilla] .flavor-brief').textContent(),data.flavors[0].description);
  assert.match(await page.locator('#monthly-flavors [data-flavor=vanilla] .detail-meta').innerText(),/Keep chilled/);
  const size=await page.locator('#monthly-flavors .flavor-tile-image').first().boundingBox();assert.ok(size.width<=126);
  assert.equal(await page.locator('#monthly-flavors').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width>900?2:1);
  assert.equal(await page.locator('.flavors-grid .flavors-box').count(),0);assert.equal(await page.locator('[data-website-photo]').count(),2);await fits();
  await page.screenshot({path:join(out,`monthly-${width}.png`),fullPage:true});
  await page.getByRole('searchbox').fill(' VÁN ');assert.deepEqual(await page.locator('#monthly-panel .flavor-tile:visible').evaluateAll(nodes=>nodes.map(node=>node.dataset.flavor)),['vanilla','vanilla']);
  for(const term of ['creamy','Earthy and Bold','Keep chilled']){await page.getByRole('searchbox').fill(term);assert.equal(await page.locator('#monthly-panel .flavor-tile:visible').count(),0);}
  await page.getByRole('searchbox',{name:'Find a flavor'}).fill('speculoos');assert.equal(await page.locator('#monthly-flavors .flavor-tile:visible').count(),0);assert.equal(await page.locator('#next-month-flavors .flavor-tile:visible').count(),1);assert.equal(await page.locator('#monthly-empty').isVisible(),true);
  await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'Tea',exact:true}).click();assert.equal(await page.locator('#monthly-panel .flavor-tile:visible').count(),2);assert.match(await page.locator('#filter-status').textContent(),/2 flavors/);
  await page.getByRole('button',{name:'All flavors',exact:true}).click();await page.getByRole('tab',{name:'Full collection',exact:true}).click();assert.equal(await page.locator('#other-flavors-grid .flavor-tile:visible').count(),7);await fits();await page.screenshot({path:join(out,`collection-${width}.png`),fullPage:true});
  await page.getByRole('searchbox').fill('vanilla');assert.deepEqual(await page.locator('#other-flavors-grid .flavor-tile:visible').evaluateAll(nodes=>nodes.map(node=>node.dataset.flavor)),['vanilla']);await page.getByRole('searchbox').fill('');await page.getByRole('tab',{name:'Full collection',exact:true}).focus();
  await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#monthly-tab').getAttribute('aria-selected'),'true');
  await page.getByRole('searchbox').fill('no matching name');await page.evaluate(()=>{location.hash='#flavor-speculoos'});await page.locator('#next-month-flavors [data-flavor=speculoos]:visible').waitFor();assert.equal(await page.getByRole('searchbox').inputValue(),'');assert.equal(await page.evaluate(()=>document.activeElement.dataset.flavor),'speculoos');
  data=fixture();data.currentMonth='2026-12-01';data.nextMonth='2027-01-01';await loaded();assert.equal(await page.locator('#monthly-title').textContent(),'December 2026');assert.equal(await page.locator('#next-month-title').textContent(),'January 2027');
  data=fixture();data.nextMenuShown=false;await loaded();assert.equal(await page.locator('#next-month-menu').isVisible(),false);await page.evaluate(()=>{location.hash='#flavor-speculoos'});await page.locator('#other-flavors-grid [data-flavor=speculoos]:visible').waitFor();assert.equal(await page.locator('#collection-tab').getAttribute('aria-selected'),'true');
  data.currentMenuShown=false;await loaded();assert.equal(await page.locator('#monthly-unavailable').isVisible(),true);assert.equal(await page.locator('#monthly-menu').isVisible(),false);await page.getByRole('tab',{name:'Full collection',exact:true}).click();assert.equal(await page.locator('#other-flavors-grid .flavor-tile:visible').count(),7);
  data=fixture();data.flavors[0].image='assets/home-editorial-hero.webp';data.flavors[0].description='<b>Text only</b> — '+data.flavors[0].description.repeat(4);data.flavors[0].collection_details={product_type:'<img src=x onerror=alert(1)>',serving:'Size and serving details'};
  data.flavors.push(...Array.from({length:24},(_,i)=>({id:'seasonal-'+i,name:'Seasonal cheesecake '+(i+1),line:'A longer flavor name, clearly presented',description:'A full description stays visible as the collection grows. '.repeat(3),category:'classic',sort_order:30-i})));
  await loaded('#collection-panel');assert.equal(await page.locator('#other-flavors-grid .flavor-tile:visible').count(),31);assert.equal(await page.locator('#other-flavors-grid .flavor-brief b').count(),0);assert.equal(await page.locator('#other-flavors-grid .detail-meta img').count(),0);assert.equal(await page.locator('#other-flavors-grid .flavor-brief').first().evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
  const firstSeasonal=await page.locator('#other-flavors-grid .flavor-tile').nth(7).getAttribute('data-flavor');assert.equal(firstSeasonal,'seasonal-23');await fits();
  data={...fixture(),flavors:[],monthlyMenu:[],nextMonthlyMenu:[],currentMenuShown:false,nextMenuShown:false,collectionLoaded:false};await loaded();assert.match(await page.locator('#monthly-unavailable').textContent(),/temporarily unavailable/);await page.getByRole('tab',{name:'Full collection',exact:true}).click();assert.equal(await page.locator('#other-flavors-grid .flavor-tile').count(),0);assert.match(await page.locator('#other-empty').textContent(),/temporarily unavailable/);await fits();assert.deepEqual(errors,[]);
  await ctx.close();results.push({width,passed:true});console.log(`PASS flavor lists, published menus, filtering, deep links, full descriptions and large catalog at ${width}px`);
 }
 await writeFile(join(out,'checks.json'),JSON.stringify(results,null,2));
}finally{await browser.close()}
