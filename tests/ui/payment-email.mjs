import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fixtures} from '../payment-email.test.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const out=resolve('test-results/payment-email'),results=[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
 for(const fixture of fixtures.filter(f=>['saved-accounts','direct-no-deadline','legacy-preserved','long-content','escaped-content'].includes(f.name))){
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});await page.setContent(fixture.html);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,fixture.name+' overflow at '+width);
   const panel=page.getByRole('heading',{name:'How to pay',exact:true}).locator('xpath=ancestor::table[1]');
   assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('table:not([role="presentation"])').count(),0);
   assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('body>div[lang="en"][dir="ltr"]').count(),1);
   if(fixture.name==='saved-accounts'&&[390,1440].includes(width))await panel.screenshot({path:join(out,`payment-panel-${width}.png`)});
   results.push({scenario:fixture.name,width,overflow:false});
  }
 }
 // Head-style stripping is a fallback check, not certification in Outlook/Gmail.
 await page.setViewportSize({width:768,height:1000});await page.emulateMedia({colorScheme:'dark'});
 await page.setContent(fixtures[0].html.replace(/<style>[\s\S]*?<\/style>/g,''));
 assert(await page.getByText('000012345678',{exact:true}).isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),768);
 assert.deepEqual(errors,[]);await writeFile(join(out,'render-results.json'),JSON.stringify({results,headStrippedAndDarkPreference:true,errors,nativeMailClients:'not tested'},null,2));
 console.log('PASS 20 payment-email browser renders, inline-style fallback and dark preference; no page errors.');
}finally{await browser.close();}
