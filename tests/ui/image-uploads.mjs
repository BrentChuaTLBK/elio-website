import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../../dist'),origin='https://images.test',out=resolve(root,'../test-results/image-uploads');await mkdir(out,{recursive:true});
const heic=await readFile(process.env.HEIC_TEST_FILE);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true}),checks=[];
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 const sdk=`export function createClient(){return {
 auth:{initialize:async()=>({error:null}),onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}}})},
 functions:{invoke:async(name,{body})=>{await window.capture(name,body.get('file'));window.lastFields=Object.fromEntries([...body].filter(([key])=>key!=='file'));return {data:{ok:true}};}},
 storage:{from:bucket=>({upload:async(path,file,options)=>{await window.capture(bucket,file);window.lastPath=path;return {};},getPublicUrl:path=>({data:{publicUrl:'/qa/'+path}})})}}};`;
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))return route.abort();
  if(u.href==='https://esm.sh/@supabase/supabase-js@2.102.0')return route.fulfill({contentType:'text/javascript',body:sdk});
  if(u.origin!==origin)return ['https://esm.sh','https://cdn.jsdelivr.net'].includes(u.origin)?route.continue():route.abort();
  if(u.pathname==='/test')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Image upload checks</title>'});
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:extname(file)==='.js'?'text/javascript':'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();await page.goto(origin+'/test');
 await page.evaluate(async()=>{
  window.uploads=[];window.capture=async(endpoint,file)=>{const bmp=await createImageBitmap(file),bytes=await file.arrayBuffer();uploads.push({endpoint,name:file.name,type:file.type,size:file.size,width:bmp.width,height:bmp.height,header:[...new Uint8Array(bytes.slice(0,12))],hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].join(',')});bmp.close();window.lastFile=file;};
  window.client=await import('/assets/admin/client.js');await client.ready;
  window.makeFile=async(type,width=300,height=200)=>{const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,width,height);x.fillStyle='black';x.font='28px Arial';x.fillText('TEST PHP 100.00',12,55);const b=await new Promise(r=>c.toBlob(r,type,.96));return new File([b],'receipt.'+type.split('/')[1],{type});};
  window.send=async(flow,file)=>flow==='affiliate'?client.affiliatePayout(file,{id:'test-payout',affiliate_id:'test-affiliate',amount_cents:10000,reference:'TEST'}):client.upload(file,['product','website'].includes(flow)?{kind:flow}:{kind:'proof',order_id:'test-order',token:'test-token',payment_reference:'TEST'});
 });
 const webp=result=>{assert.equal(result.type,'image/webp');assert.match(result.name,/\.webp$/);assert.equal(String.fromCharCode(...result.header.slice(8)),'WEBP');assert(result.size<5*1024*1024);};
 for(const flow of ['product','website','proof','affiliate']){
  for(const type of ['image/jpeg','image/png','image/webp']){const result=await page.evaluate(async({flow,type})=>{await send(flow,await makeFile(type));return uploads.at(-1);},{flow,type});webp(result);}
  for(const [name,type] of [['camera.HEIC','image/heic'],['camera.heif','application/octet-stream'],['camera.HEIC','']]){
   const result=await page.evaluate(async({flow,bytes,name,type})=>{await send(flow,new File([new Uint8Array(bytes)],name,{type}));return uploads.at(-1);},{flow,bytes:[...heic],name,type});webp(result);
  }
  checks.push(`${flow}: real JPEG, PNG, WebP, HEIC and HEIF uploads produce WebP, including missing/generic MIME`);
  const resized=await page.evaluate(async flow=>{await send(flow,await makeFile('image/jpeg',6000,2000));return uploads.at(-1);},flow);assert.equal(resized.width,['product','website'].includes(flow)?2400:3200);
  for(const bad of [{name:'bad.jpg',type:'image/jpeg',bytes:[37,80,68,70]},{name:'bad.heic',type:'image/heic',bytes:[37,80,68,70]},{name:'empty.png',type:'image/png',bytes:[]},{name:'document.pdf',type:'application/pdf',bytes:[37,80,68,70]}]){
   const result=await page.evaluate(async({flow,bad})=>{const before=uploads.length;try{await send(flow,new File([new Uint8Array(bad.bytes)],bad.name,{type:bad.type}));return {accepted:true};}catch(e){return {message:e.message,newUploads:uploads.length-before};}},{flow,bad});assert(result.message);assert.equal(result.newUploads,0);
  }
 }
 const retry=await page.evaluate(async()=>{const file=await makeFile('image/png');await send('affiliate',file);const first=lastFile,a=uploads.at(-1);await send('affiliate',file);return {sameFile:first===lastFile,a,b:uploads.at(-1),fields:lastFields};});assert(retry.sameFile);assert.equal(retry.a.hash,retry.b.hash);assert.equal(retry.fields.id,'test-payout');assert.equal(retry.fields.amount_cents,'10000');checks.push('Payout retries reuse the same WebP bytes and preserve payment fields');
 const worker=await readFile(join(root,'assets/admin/photo-worker.js'),'utf8');
 await context.route('**/assets/admin/photo-worker.js',route=>route.fulfill({contentType:'text/javascript',body:`const encode=OffscreenCanvas.prototype.convertToBlob;OffscreenCanvas.prototype.convertToBlob=function(o){return encode.call(this,{...o,type:'image/png'});};\n`+worker}));
 const fallback=await page.evaluate(async()=>{await send('affiliate',await makeFile('image/png'));return uploads.at(-1);});webp(fallback);checks.push('Non-native WebP encoder fallback works for receipts');
 await writeFile(join(out,'report.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({checks},null,2));
}finally{await browser.close();}
