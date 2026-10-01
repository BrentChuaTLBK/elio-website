import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join,extname,sep} from 'node:path';
import {heicContainer} from '../helpers/image-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://fallback.test',out=resolve(root,'../test-results/upload-fallback');await mkdir(out,{recursive:true});
const heic=process.env.HEIC_TEST_FILE?await readFile(process.env.HEIC_TEST_FILE):heicContainer(),browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const checks=[],errors=[];
try{
 const ctx=await browser.newContext({serviceWorkers:'block'});
 const sdk=`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}}})},functions:{invoke:async(name,{body})=>{await window.capture(name,body.get('file'));window.fields=Object.fromEntries([...body].filter(([key])=>key!=='file'));return {data:{ok:true}};}},storage:{from:bucket=>({upload:async(path,file,options)=>{await window.capture(bucket,file);window.path=path;window.uploadOptions=options;return {};},getPublicUrl:path=>({data:{publicUrl:'/qa/'+path}})})}}};`;
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});if(u.origin!==origin)return route.abort();if(u.pathname==='/test')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Upload fallback tests</title>'});const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:extname(file)==='.js'?'text/javascript':'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/test');
 await page.evaluate(async()=>{
  window.client=await import('/assets/admin/client.js');await client.ready;window.photos=await import('/assets/admin/photo-upload.js');window.originalWorker=Worker;window.records=[];
  window.hash=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).join(',');
  window.capture=async(endpoint,file)=>{records.push({endpoint,type:file.type,name:file.name,size:file.size,hash:await hash(file)});window.lastFile=file;};
  window.makeFile=async(type)=>{const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;const context=canvas.getContext('2d');context.fillStyle='#ab5839';context.fillRect(0,0,300,200);const b=await new Promise(r=>canvas.toBlob(r,type,.94));return new File([b],'photo.'+type.split('/')[1],{type});};
  window.send=async(flow,file)=>flow==='affiliate'?client.affiliatePayout(file,{id:'same-payout',affiliate_id:'same-affiliate',amount_cents:10000}):client.upload(file,['product','website'].includes(flow)?{kind:flow}:{kind:'proof',order_id:'same-order',token:'private-token'});
 });
 for(const type of ['image/png','image/jpeg']){const result=await page.evaluate(async type=>{await send('proof',await makeFile(type));return records.at(-1);},type);assert.equal(result.type,'image/webp');assert.match(result.name,/\.webp$/);}
 checks.push('Successful PNG/JPEG conversion still uploads WebP.');
 for(const failure of ['unavailable','worker-error','invalid-output']){
  await page.evaluate(failure=>{window.Worker=class{constructor(){if(failure==='unavailable')throw Error('Worker unavailable');}terminate(){}postMessage(){queueMicrotask(()=>failure==='worker-error'?this.onerror():this.onmessage({data:{blob:new Blob(['bad conversion'],{type:'image/webp'})}}));}};},failure);
  for(const flow of ['product','website','proof','affiliate'])for(const type of ['image/png','image/jpeg','image/heic']){
   const result=await page.evaluate(async({flow,type,heic})=>{const file=type==='image/heic'?new File([new Uint8Array(heic)],'camera.HEIC',{type}):await makeFile(type);const original=await hash(file);await send(flow,file);return {uploaded:records.at(-1),original,path:window.path,options:window.uploadOptions};},{flow,type,heic:[...heic]});assert.equal(result.uploaded.type,type);assert.equal(result.uploaded.hash,result.original);const extension=type==='image/jpeg'?'jpg':type.split('/')[1];assert.ok(result.uploaded.name.endsWith('.'+extension));if(['product','website'].includes(flow)){assert.ok(result.path.endsWith('.'+extension));assert.equal(result.options.contentType,type);}
  }
  checks.push(failure+': PNG, JPEG and HEIC originals retain identical bytes and correct MIME/extensions across all four upload flows.');
 }
 const retry=await page.evaluate(async()=>{const file=await makeFile('image/png');await send('affiliate',file);const first=lastFile;window.Worker=originalWorker;await send('affiliate',file);return {same:first===lastFile,first:records.at(-2),second:records.at(-1),fields};});assert(retry.same);assert.equal(retry.first.hash,retry.second.hash);assert.equal(retry.second.type,'image/png');assert.equal(retry.fields.id,'same-payout');
 checks.push('A retry keeps the same original bytes even if the converter becomes available, preserving payout idempotency.');
 await page.evaluate(()=>{window.Worker=class{constructor(){throw Error('No worker');}};});
 for(const file of [{name:'bad.png',type:'image/png',bytes:[37,80,68,70]},{name:'bad.heic',type:'image/heic',bytes:[37,80,68,70]},{name:'bad.svg',type:'image/svg+xml',bytes:[60,115,118,103]},{name:'empty.jpg',type:'image/jpeg',bytes:[]}]){const value=await page.evaluate(async file=>{const count=records.length;try{await send('proof',new File([new Uint8Array(file.bytes)],file.name,{type:file.type}));return {accepted:true};}catch(e){return {message:e.message,writes:records.length-count};}},file);assert(value.message);assert.equal(value.writes,0);}
 const generic=await page.evaluate(async bytes=>{const f=new File([new Uint8Array(bytes)],'camera.heif',{type:'application/octet-stream'});await send('website',f);return records.at(-1);},[...heic]);assert.equal(generic.type,'image/heic');
 const oversize=await page.evaluate(async()=>{try{await send('proof',new File([new Uint8Array(20*1024*1024+1)],'large.png',{type:'image/png'}));return 'accepted';}catch(e){return e.message;}});assert.match(oversize,/20 MB/);
 checks.push('Renamed, unsupported, empty and oversized files are rejected; generic HEIF MIME is normalized from the contents.');
 assert.deepEqual(errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({checks,errors,realHeic:Boolean(process.env.HEIC_TEST_FILE)},null,2));console.log('PASS original photo fallback: '+checks.length+' scenario groups; all four upload flows.');
}finally{await browser.close();}
