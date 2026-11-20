import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {navigateDashboard} from '../helpers/dashboard-navigation.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT,'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),root=resolve(import.meta.dirname,'../../dist'),origin='https://duplicate.test',out=resolve(root,'../test-results/product-duplicate');await mkdir(out,{recursive:true});
await db.exec(await readFile(resolve(root,'../tests/backend/bootstrap.sql'),'utf8'));
for(const file of (await readdir(resolve(root,'../supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(resolve(root,'../supabase/migrations',file),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
const h=await makeHarness(db);let chain=Promise.resolve();
const invoke=(action,payload={},user=h.ids.owner)=>{const next=chain.then(()=>h.api(action,payload,user));chain=next.catch(()=>{});return next;};
const boxCats=[],flavorCats=[];
for(const [scope,names,target] of [['boxes',['Favorites','Celebrations'],boxCats],['flavors',['Classics','Creamy'],flavorCats]])for(const name of names)target.push((await invoke('save_category',{category:{name,scope}})).id);
const photo=origin+'/fixture-photo.png',label={enabled:true,text:'Best seller',color:'#b85035'};
const flavor=await h.product({kind:'flavor',name:'Vanilla cream',slug:'source-vanilla',tagline:'Classic and creamy',description:'Vanilla bean cheesecake',price_cents:1500,lead_days:0,photos:[photo,photo+'?second'],category_ids:flavorCats,category_id:flavorCats[0],collection_details:{product_type:'Basque cheesecake',serving:'A generous slice'},label});
const other=await h.product({kind:'flavor',name:'Chocolate cream',price_cents:2000,lead_days:0});
const fixed=await h.product({kind:'set',name:'Signature trio',description:'Three rich slices',price_cents:99000,min_quantity:2,lead_days:3,pickup_only:true,box_flavors:[flavor.id,flavor.id,other.id],photos:[photo,photo+'?second'],category_ids:boxCats,category_id:boxCats[0],label});
const custom=await h.product({kind:'custom_box',name:'Custom trio',description:'Choose your favorites',price_cents:95000,min_quantity:1,lead_days:0,allow_same_day:true,photos:[photo],category_ids:boxCats,category_id:boxCats[0]});
const row=id=>h.scalar('select data from elio.products where id=$1',[id]);
const originals=new Map(await Promise.all([fixed,custom,flavor].map(async p=>[p.id,await row(p.id)])));
const menus=await h.scalar("select coalesce(jsonb_agg(to_jsonb(m) order by month),'[]') from elio.flavor_menus m"),stock=await h.scalar("select coalesce(jsonb_agg(to_jsonb(i) order by product_id,date),'[]') from elio.inventory i");
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true}),results=[],errors=[],calls=[],uploads=[];let actor=h.ids.owner,held=null,failBootstrap=false,failUpload=false;
const hold=(options={})=>{let started,release;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);held={...options,started,gate};return {began,release};};
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.addInitScript(()=>{
  window.cutoutGeometry=async file=>{
   if(!file.name.startsWith('cake-cutout.'))return null;
   const image=await createImageBitmap(file),canvas=document.createElement('canvas');
   canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
   const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
   let left=canvas.width,right=-1,bottom=-1;
   for(let i=3;i<data.length;i+=4)if(data[i]>24){
    const pixel=(i-3)/4,x=pixel%canvas.width;
    left=Math.min(left,x);right=Math.max(right,x);bottom=Math.max(bottom,Math.floor(pixel/canvas.width));
   }
   return {width:canvas.width,height:canvas.height,left,right,bottom,cornerAlpha:data[3]};
  };
 });
 await ctx.exposeBinding('duplicateUpload',(_,{path,type,geometry})=>{if(failUpload){failUpload=false;return {error:{message:'Simulated photo upload failure'}};}uploads.push({path,type,geometry});return {};});
 await ctx.exposeBinding('duplicateRpc',async(_,{action,payload})=>{
  calls.push({action,payload:structuredClone(payload)});let plan;
  if(action==='save_product'&&held){plan=held;held=null;plan.started();await plan.gate;}
  if(plan?.fail||(action==='admin_bootstrap'&&failBootstrap)){failBootstrap=false;return {data:null,error:{message:'Simulated connection interruption'}};}
  try{const data=await invoke(action,payload,actor);if(plan?.refreshFailure)failBootstrap=true;if(plan?.lostResponse)return {data:null,error:{message:'Simulated lost response'}};return {data,error:null};}catch(e){return {data:null,error:{message:e.message}};}
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{user:{id:'${h.ids.owner}',email:'owner@example.test'}}}}),getUser:async()=>({data:{user:{id:'${h.ids.owner}'}}}),onAuthStateChange:()=>{}},rpc:async(n,p)=>window.duplicateRpc({action:p.p_action,payload:p.p_payload}),storage:{from:()=>({upload:async(path,file)=>window.duplicateUpload({path,type:file.type,geometry:await window.cutoutGeometry(file)}),getPublicUrl:path=>({data:{publicUrl:'${origin}/fixture-photo.png?uploaded='+path}})})}}}`});
  if(u.origin!==origin)return route.abort();
  if(u.pathname==='/fixture-photo.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9kAAAAASUVORK5CYII=','base64')});
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/manage.html');await navigateDashboard(page,'boxes');
 const dialog=page.locator('#admin-dialog'),form=dialog.locator('[data-form=product]'),closed=()=>page.locator('#admin-dialog:not([open])').waitFor({state:'attached'});
 const copy=async(p)=>{const view=p.kind==='flavor'?'flavors':'boxes';if(await page.locator(`#admin-nav [data-view="${view}"]`).getAttribute('aria-current')!=='page')await navigateDashboard(page,view);await page.locator(`[data-action=duplicate-product][data-id="${p.id}"]`).click();await form.waitFor();};
 const edit=async id=>{await page.locator(`[data-action=edit-product][data-id="${id}"]`).click();await form.waitFor();};
 const writes=()=>calls.filter(c=>c.action==='save_product');
 const visible=async p=>(await invoke(p.kind==='flavor'?'flavor_collection':'catalog',{},null))[p.kind==='flavor'?'flavors':'products'].some(x=>x.id===p.id);
 const fits=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),page.viewportSize().width);if(await dialog.isVisible())assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));};
 await copy(fixed);assert.equal(writes().length,0);assert.equal(await form.locator('[name=name]').inputValue(),'Signature trio (copy)');assert.equal(await form.locator('[name=price]').inputValue(),'990.00');assert.equal(await form.locator('[name=active]').count(),0);assert.equal(await form.locator('[name=category_ids]:checked').count(),2);assert.deepEqual(await form.locator('[data-box-flavor]').evaluateAll(nodes=>nodes.map(n=>n.value)),fixed.box_flavors);assert.equal(await form.locator('.photo-tile').count(),2);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await fits();await form.getByRole('button',{name:'Save draft',exact:true}).scrollIntoViewIfNeeded();await fits();if(width===390||width===1440)await dialog.screenshot({path:join(out,`copy-editor-${width}.png`)});}
 await form.locator('[name=name]').fill('Discard this copy');await form.getByRole('button',{name:'Remove photo 1',exact:true}).click();await form.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.site-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await closed();assert.equal(writes().length,0);assert.deepEqual(await row(fixed.id),originals.get(fixed.id));
 results.push('Opening and cancelling a copy writes nothing; copied recipe, categories, price and photos are editable at 320/390/768/1440px.');
 await page.setViewportSize({width:390,height:900});await copy(fixed);await form.locator('[name=name]').fill('Unsaved mobile edit');const uploadInput=form.locator('#product-photos');await uploadInput.scrollIntoViewIfNeeded();await form.evaluate(f=>window.originalProductForm=f);let photoTop=await uploadInput.evaluate(el=>el.getBoundingClientRect().top);const imageBytes=await readFile(join(root,'assets/elio-favicon.png'));
 await uploadInput.setInputFiles([{name:'mobile-one.png',mimeType:'image/png',buffer:imageBytes},{name:'mobile-two.png',mimeType:'image/png',buffer:imageBytes}]);await page.waitForFunction(()=>document.querySelector('#photo-order-status').textContent.startsWith('4 photos'));
 assert.equal(uploads.length,2);assert.equal(await form.evaluate(f=>f===window.originalProductForm),true);assert.equal(await form.locator('[name=name]').inputValue(),'Unsaved mobile edit');assert.ok(Math.abs(await uploadInput.evaluate(el=>el.getBoundingClientRect().top)-photoTop)<5);assert.ok(await dialog.evaluate(el=>el.scrollTop)>500);assert.equal(await form.getByRole('button',{name:'Save draft',exact:true}).isVisible(),true);await fits();await dialog.screenshot({path:join(out,'mobile-after-photo-upload.png')});
 photoTop=await uploadInput.evaluate(el=>el.getBoundingClientRect().top);failUpload=true;await uploadInput.setInputFiles({name:'mobile-failed.png',mimeType:'image/png',buffer:imageBytes});await form.locator('.form-error').filter({hasText:'Simulated photo upload failure'}).waitFor();assert.equal(await form.locator('.photo-tile').count(),4);assert.equal(await form.evaluate(f=>f===window.originalProductForm),true);assert.ok(Math.abs(await uploadInput.evaluate(el=>el.getBoundingClientRect().top)-photoTop)<5);await form.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.site-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await closed();assert.equal(writes().length,0);await page.setViewportSize({width:1440,height:1000});results.push('Mobile multi-photo uploads and upload errors preserve the same form, edited fields, thumbnails and scroll position near Save.');
 await copy(fixed);await form.locator('[name=name]').fill('Weekend trio');await form.locator('[name=description]').fill('A new weekend box');await form.locator('[name=price]').fill('1099');await form.getByRole('button',{name:'Remove photo 1',exact:true}).click();
 let request=hold({fail:true});await form.getByRole('button',{name:'Save draft',exact:true}).click();await request.began;
 assert.equal(await form.getByRole('button',{name:'Publish product',exact:true}).isDisabled(),true);assert.equal(await form.locator('input:enabled,select:enabled,textarea:enabled').count(),0);await page.locator('#dialog-close').click();assert.equal(await dialog.isVisible(),true);const count=writes().length;await form.evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(writes().length,count);request.release();await form.locator('.form-error').filter({hasText:'Simulated connection interruption'}).waitFor();assert.equal(await form.locator('[name=name]').inputValue(),'Weekend trio');assert.equal(await form.locator('.photo-tile').count(),1);
 await form.getByRole('button',{name:'Save draft',exact:true}).click();await closed();const draftId=writes().at(-1).payload.product.id;assert.equal(draftId,writes().at(-2).payload.product.id);assert.notEqual(draftId,fixed.id);let draft=await row(draftId);
 assert.equal(draft.active,false);assert.equal(draft.price_cents,109900);assert.deepEqual(draft.box_flavors,fixed.box_flavors);assert.deepEqual(draft.category_ids,boxCats);assert.deepEqual(draft.label,label);assert.equal(draft.min_quantity,2);assert.equal(draft.lead_days,3);assert.equal(draft.pickup_only,true);assert.deepEqual(draft.photos,[photo+'?second']);assert.equal(await visible(draft),false);
 await page.reload();await navigateDashboard(page,'boxes');await edit(draftId);assert.equal(await form.locator('[name=name]').inputValue(),'Weekend trio');await form.locator('[name=name]').fill('Weekend trio revised');await form.getByRole('button',{name:'Save draft',exact:true}).click();await closed();assert.equal((await row(draftId)).active,false);await edit(draftId);await form.getByRole('button',{name:'Publish product',exact:true}).click();await closed();draft=await row(draftId);assert.equal(draft.active,true);assert.equal(draft.name,'Weekend trio revised');assert.equal(await visible(draft),true);assert.deepEqual(await row(fixed.id),originals.get(fixed.id));
 results.push('A failed save preserves edits, locks pending controls, and retries one ID; a hidden fixed-box draft persists across reloads, remains editable, and publishes only explicitly.');
 await copy(custom);assert.equal(await form.locator('[name=kind]').inputValue(),'custom_box');request=hold({lostResponse:true});await form.getByRole('button',{name:'Save draft',exact:true}).click();await request.began;request.release();await form.locator('.form-error').filter({hasText:'Simulated lost response'}).waitFor();const lostId=writes().at(-1).payload.product.id;assert.equal((await row(lostId)).active,false);await form.getByRole('button',{name:'Save draft',exact:true}).click();await closed();assert.equal(writes().at(-1).payload.product.id,lostId);assert.equal(await h.scalar("select count(*)::int from elio.products where data->>'name'='Custom trio (copy)'"),1);assert.equal((await row(lostId)).allow_same_day,true);
 await copy(custom);assert.equal(await form.locator('[name=name]').inputValue(),'Custom trio (copy 2)');request=hold({refreshFailure:true});await form.getByRole('button',{name:'Publish product',exact:true}).click();await request.began;request.release();await closed();const directId=writes().at(-1).payload.product.id;assert.equal((await row(directId)).active,true);await page.reload();await navigateDashboard(page,'boxes');assert.equal(await page.locator(`[data-action=edit-product][data-id="${directId}"]`).count(),1);
 results.push('Custom boxes retain same-day settings; lost responses retry one copy, names stay distinct, direct publishing works, and a failed refresh does not invite another create.');
 await copy(flavor);assert.equal(await form.locator('[name=tagline]').inputValue(),flavor.tagline);assert.equal(await form.locator('[name=detail_serving]').inputValue(),flavor.collection_details.serving);await form.locator('[name=name]').fill('Vanilla special');await form.getByRole('button',{name:'Save draft',exact:true}).click();await closed();const flavorId=writes().at(-1).payload.product.id;let flavorDraft=await row(flavorId);assert.equal(flavorDraft.collection_hidden,true);assert.equal(flavorDraft.active,false);assert.equal(flavorDraft.slug,undefined);assert.deepEqual(flavorDraft.collection_details,flavor.collection_details);assert.equal(await visible(flavorDraft),false);assert.equal((await invoke('home_catalog',{},null)).flavors.some(f=>f.id===flavorId),false);
 await edit(flavorId);await form.getByRole('button',{name:'Publish product',exact:true}).click();await closed();flavorDraft=await row(flavorId);assert.equal(flavorDraft.collection_hidden,false);assert.equal(flavorDraft.active,true);assert.equal(await visible(flavorDraft),true);
 assert.deepEqual(await h.scalar("select coalesce(jsonb_agg(to_jsonb(m) order by month),'[]') from elio.flavor_menus m"),menus);assert.deepEqual(await h.scalar("select coalesce(jsonb_agg(to_jsonb(i) order by product_id,date),'[]') from elio.inventory i"),stock);
 for(const [id,original] of originals)assert.deepEqual(await row(id),original);
 results.push('Flavor drafts stay out of the public collection and home page; publication preserves details without copying stock, monthly menus, slug, or changing any source product.');
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-action=new-product]').click();
 await form.locator('[name=name]').fill('New pistachio trio flavor');
 await form.locator('[name=price]').fill('50');
 await form.locator('#product-photos').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:imageBytes});
 await page.waitForFunction(()=>document.querySelector('#photo-order-status').textContent.startsWith('1 photo'));
 const samples=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=80;
  const ctx=canvas.getContext('2d'),png=()=>canvas.toDataURL('image/png').split(',')[1];
  const empty=png();ctx.fillStyle='#7a984f';ctx.fillRect(10,12,35,26);
  const cake=png(),webp=canvas.toDataURL('image/webp',.92).split(',')[1];
  ctx.fillRect(0,0,100,80);return {empty,cake,webp,opaque:png()};
 });
 const chooseCutout=(editor,key)=>{
  const extension=key==='webp'?'webp':'png';
  return editor.locator('[data-cutout-file]').setInputFiles({name:key+'.'+extension,mimeType:'image/'+extension,buffer:Buffer.from(samples[key],'base64')});
 };
 await chooseCutout(form,'empty');await form.locator('[data-cutout-status]').filter({hasText:'empty'}).waitFor();
 await chooseCutout(form,'opaque');await form.locator('[data-cutout-status]').filter({hasText:'solid background'}).waitFor();
 await chooseCutout(form,'cake');await form.locator('[data-cutout-status]').filter({hasText:'Cutout ready'}).waitFor();
 const cutoutUrl=await form.locator('[name=builder_cutout_url]').inputValue();
 const shape=uploads.at(-1).geometry;
 assert.deepEqual([shape.width,shape.height,shape.cornerAlpha],[320,320,0]);
 assert.ok(Math.abs(shape.left-24)<=2&&Math.abs(shape.right-295)<=2&&Math.abs(shape.bottom-275)<=2);
 await form.getByRole('button',{name:'Create flavor',exact:true}).click();await closed();
 const pistachio=(await invoke('admin_bootstrap')).products.find(p=>p.name==='New pistachio trio flavor');
 assert.equal(pistachio.price_cents,5000);assert.equal(pistachio.builder_cutout_url,cutoutUrl);
 assert.equal(pistachio.photos.length,1);assert.notEqual(pistachio.photos[0],cutoutUrl);
 await copy(pistachio);assert.equal(await form.locator('[name=builder_cutout_url]').inputValue(),cutoutUrl);
 await form.locator('[data-remove-cutout]').click();assert.equal(await form.getAttribute('data-dirty'),'true');
 await form.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('.site-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await closed();
 assert.equal((await row(pistachio.id)).builder_cutout_url,cutoutUrl);
 await navigateDashboard(page,'menus');
 const editMenu=async()=>{await page.locator('[data-action=edit-flavor-menu][data-id="'+pistachio.id+'"]').click();return page.locator('[data-form=flavor-menu-editor]');};
 let menuEditor=await editMenu();
 assert.equal(await menuEditor.locator('[name=builder_cutout_url]').inputValue(),cutoutUrl);
 await menuEditor.locator('[name=current_month]').check();
 await menuEditor.locator('[name=next_month]').check();
 await chooseCutout(menuEditor,'webp');
 await menuEditor.locator('[data-cutout-status]').filter({hasText:'Cutout ready'}).waitFor();
 const replacement=await menuEditor.locator('[name=builder_cutout_url]').inputValue();
 assert.notEqual(replacement,cutoutUrl);
 await menuEditor.getByRole('button',{name:'Save flavor',exact:true}).click();await closed();
 const guestFlavor=async()=> (await invoke('catalog',{},null)).flavors.find(f=>f.id===pistachio.id);
 assert.equal((await guestFlavor()).builder_cutout_url,replacement);
 const orderDate=await h.day(3);
 await invoke('save_inventory',{rows:[{product_id:pistachio.id,date:orderDate,capacity:6,available:true}]});
 await invoke('save_settings',{settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],pickup_blocked_dates:[],
  payment_instructions:'Local test only',pickup_address:'Test kitchen',contact_email:'owner@example.test',site_url:origin}});
 const twoBoxes=h.checkout(custom,orderDate,{items:[h.item(custom,2,{flavors:{[pistachio.id]:3}})]});
 const quote=await invoke('quote',twoBoxes,null);
 assert.equal(quote.subtotal_cents,2*(custom.price_cents+3*pistachio.price_cents));
 await invoke('save_inventory',{rows:[{product_id:pistachio.id,date:orderDate,capacity:5,available:true}]});
 await assert.rejects(()=>invoke('quote',twoBoxes,null),/available|stock|pieces|capacity/i);
 menuEditor=await editMenu();await menuEditor.locator('[data-remove-cutout]').click();
 await menuEditor.getByRole('button',{name:'Save flavor',exact:true}).click();await closed();
 const withoutCutout=await guestFlavor();
 assert.equal(withoutCutout.builder_cutout_url,null);assert.deepEqual(withoutCutout.photos,pistachio.photos);assert.equal(withoutCutout.price_cents,5000);
 results.push('On a phone the owner creates a new paid-extra flavor with a separate cake cutout, gets feedback on empty and opaque uploads, duplicates or discards edits, and replaces or clears the cutout from its monthly lineup editor.');
 await navigateDashboard(page,'boxes');for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await fits();assert.ok(await page.locator('.product-card-actions').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1));if(width===390||width===1440)await page.screenshot({path:join(out,`product-cards-${width}.png`),fullPage:true});}
 actor=h.ids.staff;await page.reload();await navigateDashboard(page,'boxes');assert.equal(await page.locator('[data-action=duplicate-product]').count(),0);
 for(const user of [h.ids.staff,h.ids.customer,null])await assert.rejects(()=>invoke('save_product',{product:{...draft,id:undefined,name:'Unauthorized copy'}},user),/owner|Authorized/i);
 assert.equal(await h.scalar("select count(*)::int from elio.products where data->>'name'='Unauthorized copy'"),0);results.push('Cards fit four viewport sizes; staff cannot duplicate and staff/customer/anonymous writes are rejected by the database.');
 assert.deepEqual(errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('PASS product duplication: '+results.length+' scenario groups; no page errors.');
}finally{await browser.close();await db.close();}
