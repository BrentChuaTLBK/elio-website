import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {eventBody} from '../../supabase/functions/calendar-sync/google.ts';
import {handle as upload} from '../../supabase/functions/proof-upload/handler.ts';
import {handle as readProof} from '../../supabase/functions/proof-url/handler.ts';
const root=resolve(import.meta.dirname,'../..'),dist=join(root,'dist'),origin='https://direct-flow.test';
const deps=createRequire(join(process.env.PGLITE_PACKAGE_ROOT,'package.json')),{PGlite}=deps('@electric-sql/pglite'),{pgcrypto}=deps('@electric-sql/pglite/contrib/pgcrypto');
const {chromium}=createRequire(import.meta.url)(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const db=new PGlite({extensions:{pgcrypto}}),browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const originalFetch=globalThis.fetch,files=new Map(),errors=[],sharedRequests=[];
let album,chain=Promise.resolve();const serial=work=>{const next=chain.then(work);chain=next.catch(()=>{});return next;};
globalThis.Deno={env:{get:key=>({SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ALLOWED_ORIGINS:origin}[key]||'')},serve:fn=>{album=fn;}};
await import('../../supabase/functions/order-photos/index.ts');
try{
 await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
 const folder=join(root,'supabase/migrations');
 for(const file of (await readdir(folder)).filter(n=>n.endsWith('.sql')).sort()){const source=await readFile(join(folder,file),'utf8');if(!source.startsWith('-- Hosted infrastructure:'))await db.exec(source);}
 const h=await makeHarness(db),date=await h.day(2);
 globalThis.fetch=async(input,options={})=>{
  const path=new URL(input).pathname;
  if(path==='/auth/v1/user')return Response.json({id:h.ids.staff});
  if(path==='/rest/v1/rpc/shop_api')return Response.json({role:'staff',mfa_required:false});
  if(path==='/rest/v1/rpc/shop_service'){
   const {p_action,p_payload}=JSON.parse(options.body);
   try{return Response.json(await serial(()=>h.service(p_action,p_payload)));}catch(e){return Response.json({message:e.message},{status:400});}
  }
  const signing='/storage/v1/object/sign/',objects='/storage/v1/object/';
  if(path.startsWith(signing))return files.has(path.slice(signing.length))?Response.json({signedURL:path.slice('/storage/v1'.length)+'?token=short-lived'}):Response.json({},{status:404});
  if(path.startsWith(objects)){
   const key=path.slice(objects.length),[bucket,...parts]=key.split('/'),name=parts.join('/');
   if(options.method==='POST'){
    files.set(key,{bytes:Buffer.from(options.body),type:new Headers(options.headers).get('content-type')});
    await serial(()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,name]));
   }else if(options.method==='DELETE')for(const name of JSON.parse(options.body).prefixes){
    files.delete(bucket+'/'+name);await serial(()=>db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,name]));
   }else throw Error('Unexpected storage request.');
   return Response.json({});
  }
  throw Error('Unexpected service request: '+path);
 };
 const sale={order_source:'direct',method:'pickup',fulfillment_date:date,buyer:{name:'Reference client'},items:[{source:'custom',product_id:randomUUID(),name:'Custom cake',unit_price_cents:10000,quantity:1}],paid:true,payment:{method:'cash',cash_received_cents:10000}};
 const create=async p=>h.api('pos_create_order',{...p,expected_quote:await h.api('pos_quote',p,h.ids.staff),idempotency_key:randomUUID()},h.ids.staff);
 const order=await create(sale);
 const customerLink=async o=>{const {token}=await serial(()=>h.api('pos_payment_link',{order_id:o.id},h.ids.staff));return origin+'/order.html#'+new URLSearchParams({order:o.id,token});};
 async function pageFor(user){
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),session=user?{user:{id:user,email:'staff@example.test'},access_token:'staff-fixture'}:null;
  await ctx.exposeBinding('fixtureApi',(_,a,p,k)=>serial(async()=>{try{return {data:await h.api(a,p,user,k),error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}}));
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;
   if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const sess=${JSON.stringify(session)};return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:sess}}),onAuthStateChange:()=>{}},rpc:(name,p)=>window.fixtureApi(p.p_action,p.p_payload,p.p_token),functions:{invoke:async(name,{body})=>{const form=body instanceof FormData,headers={...(form?{}:{'content-type':'application/json'}),...(sess?{authorization:'Bearer staff-fixture'}:{})};const r=await fetch('/functions/v1/'+name,{method:'POST',headers,body:form?body:JSON.stringify(body)});const value=await r.json();return r.ok?{data:value,error:null}:{data:null,error:{message:value.error}};}}}}`});
   if(u.origin!==origin)return route.abort();
   if(p==='/assets/admin/config.js')return route.fulfill({contentType:'text/javascript',body:`export const config={supabaseUrl:${JSON.stringify(origin)},supabasePublishableKey:'sb_publishable_fixture'};`});
   if(p==='/rest/v1/rpc/shop_api'){const v=req.postDataJSON();return route.fulfill({json:await serial(()=>h.api(v.p_action,v.p_payload||{},user,v.p_token))});}
   if(p.startsWith('/functions/v1/')){
    const name=p.split('/').pop(),handler={'order-photos':album,'proof-upload':upload,'proof-url':readProof}[name];
    if(!handler)return route.fulfill({json:{}});
    const headers={...await req.allHeaders(),origin};if(name==='order-photos'&&headers['content-type']?.includes('json')&&req.postDataJSON().action==='shared')sharedRequests.push(Boolean(headers.authorization));
    const reply=await handler(new Request(req.url(),{method:'POST',headers,body:req.postDataBuffer()}));return route.fulfill({status:reply.status,contentType:'application/json',body:await reply.text()});
   }
   if(p.startsWith('/storage/v1/object/sign/')){const file=files.get(p.slice('/storage/v1/object/sign/'.length));return file&&u.searchParams.get('token')==='short-lived'?route.fulfill({contentType:file.type,body:file.bytes}):route.fulfill({status:404});}
   const path=resolve(dist,'.'+p);if(!path.startsWith(dist+sep))return route.abort();
   try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));return page;
 }
 const staff=await pageFor(h.ids.staff),guest=await pageFor(null),link=await customerLink(order);
 await guest.goto(link);await guest.getByRole('heading',{name:order.reference}).waitFor();assert.equal(await guest.locator('[data-pickup-proof],[data-order-photos]').count(),0);
const email=guest.locator('#order-email-form'),optIn=email.locator('[data-newsletter-option]'),saveEmail=email.getByRole('button',{name:'Save email for order updates'});
 await optIn.waitFor();
 assert.equal(await optIn.getByRole('checkbox').isChecked(),false);
 for(const width of [1440,768,390,320]){
   await guest.setViewportSize({width,height:900});
   const panel=await guest.locator('[aria-labelledby=order-email-title]').boundingBox();
   const grid=await guest.locator('.order-layout').boundingBox();
   const field=await email.locator('[name=email]').boundingBox(),check=await optIn.boundingBox(),button=await saveEmail.boundingBox();
   assert(Math.abs(panel.width-grid.width)<2&&panel.y+panel.height<=grid.y+1);
   assert(field.width>panel.width*.78&&field.y+field.height<=check.y+1);
   if(width>800){assert(check.x+check.width<=button.x&&Math.abs((check.y+check.height/2)-(button.y+button.height/2))<2);}
   else {assert(check.y+check.height<=button.y&&Math.abs(check.width-button.width)<2);}
   assert(button.height>=44&&check.height>=44&&button.x+button.width<=width);
   if(width===390||width===1440){
     const out=join(root,'test-results','order-email');await mkdir(out,{recursive:true});
     await guest.locator('[aria-labelledby=order-email-title]').screenshot({path:join(out,'order-email-'+width+'.png')});
   }
 }
 await email.locator('[name=email]').fill('optional@example.test');await email.getByRole('button').click();
 await guest.getByText('Order updates will go to optional@example.test.').waitFor();
 await staff.goto(origin+'/manage.html?order='+order.id+'&section=photos');const photos=staff.locator('[data-order-photos]');
 await photos.getByText('No photos attached yet.').waitFor();
 const file={name:'reference.png',mimeType:'image/png',buffer:await readFile(join(dist,'assets/elio-favicon.png'))};
 await photos.locator('input').setInputFiles(file);await photos.getByText('Photo attached.').waitFor();
 const event=await serial(()=>h.scalar('select desired from elio.calendar_events where order_id=$1',[order.id]));
 const albumUrl=new URL(eventBody(event,'fixture').description.match(/href="([^"]+)">View order reference photos/)[1]);
 await guest.goto(origin+albumUrl.pathname+albumUrl.hash);await guest.waitForFunction(()=>document.querySelector('#photo-album img')?.naturalWidth>0);
 assert.deepEqual(sharedRequests,[false]);assert.doesNotMatch(await guest.locator('main').innerText(),/Reference client|Custom cake|Pickup proof|optional@example/);
 const pickup=staff.locator('[data-pickup-proof]');await pickup.locator('input').setInputFiles(file);await pickup.getByRole('button',{name:'Upload photo'}).click();await pickup.getByRole('button',{name:'Replace photo'}).waitFor();
 await guest.goto(link);await guest.waitForFunction(()=>document.querySelector('[data-pickup-proof] img')?.naturalWidth>0);assert.equal(await guest.locator('[data-order-photos],#order-email-form').count(),0);
 await photos.locator('[data-remove-order-photo]').click();await staff.getByRole('button',{name:'Remove photo',exact:true}).click();await photos.getByText('Photo removed.').waitFor();
 await guest.goto(origin+albumUrl.pathname+albumUrl.hash);await guest.getByText('This photo link is unavailable.').waitFor();
 const delivery=await serial(()=>create({...sale,method:'delivery',delivery_fee_pending:true}));const quoted=await serial(()=>h.action('pos_set_delivery_fee',delivery,{recipient:'elio',fee_cents:2000,reason:'Booked courier'}));
 await guest.goto(await customerLink(quoted));const form=guest.locator('[data-delivery-receipt]');await form.locator('input[type=file]').setInputFiles(file);await form.getByRole('button',{name:'Submit delivery receipt'}).click();await guest.getByText('Your delivery receipt is under review.').waitFor();
 await staff.goto(origin+'/pos.html?delivery_receipt='+delivery.id);await staff.getByRole('link',{name:'View private delivery receipt'}).waitFor();await staff.locator('#dialog').getByRole('button',{name:'Record delivery payment'}).click();await staff.getByLabel('Full delivery payment received by Elio').check();await staff.locator('#dialog button[type=submit]').click();
 await staff.getByText('Delivery details saved.',{exact:true}).waitFor();await guest.reload();await guest.getByText('Separate delivery payment received').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS staff reference album, calendar link revocation, optional private pickup proof, order email and separate delivery receipt');
}finally{globalThis.fetch=originalFetch;await browser.close();await db.close();}
