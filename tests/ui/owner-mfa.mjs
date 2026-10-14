import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT||resolve('node_modules'),'playwright'));
const dep=createRequire(join(process.env.PGLITE_PACKAGE_ROOT||resolve('tests/backend'),'package.json')),{PGlite}=dep('@electric-sql/pglite'),{pgcrypto}=dep('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),root=resolve('dist'),origin='https://owner-mfa.test',out=resolve('test-results/approved-batches-2026-10-03/auth');await mkdir(out,{recursive:true});
await db.exec(await readFile('tests/backend/bootstrap.sql','utf8'));
for(const file of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile(join('supabase/migrations',file),'utf8');if(!sql.startsWith('-- Hosted infrastructure:'))await db.exec(sql);}
const h=await makeHarness(db),results=[],errors=[],calls=[];
const client=await readFile(join(root,'assets/admin/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
async function make(width,{enrolled=false,listFailure=false,guest=false,recovery=false}={}){
 await db.query('delete from auth.sessions where user_id=$1',[h.ids.owner]);await db.query('delete from auth.mfa_factors where user_id=$1',[h.ids.owner]);
 if(enrolled)await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[h.ownerFactor,h.ids.owner]);
 await db.query("insert into auth.sessions(id,user_id,factor_id,aal) values($1,$2,$3,'aal1')",[h.ownerSession,h.ids.owner,enrolled?h.ownerFactor:null]);
 const state={aal:'aal1',signed:!guest,listFailure,accessFailure:false,factors:enrolled?[{id:h.ownerFactor,status:'verified',friendly_name:'Password manager authenticator'}]:[]};
 const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.exposeBinding('mfaFixture',async(_,{action,payload={}})=>{
  calls.push({action,payload});
  if(action==='session')return {data:{session:state.signed?{user:{id:h.ids.owner,email:'owner@example.test',email_confirmed_at:'2026-09-01'},aal:state.aal}:null}};
  if(action==='signin'){state.signed=true;return {data:{session:{user:{id:h.ids.owner}}},error:null};}
  if(action==='signout'){state.signed=false;return {error:null};}
  if(action==='update-password'){assert.equal(state.aal,'aal2');state.passwordUpdated=true;return {error:null};}
  if(action==='list'){if(state.listFailure){state.listFailure=false;return {error:{message:'Connection interrupted. Try again.'}};}return {data:{totp:state.factors,all:state.factors}};}
  if(action==='enroll'){
   const id=randomUUID();state.factors.push({id,status:'unverified'});await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'unverified','totp')",[id,h.ids.owner]);
   return {data:{id,totp:{secret:'JBSWY3DPEHPK3PXP',qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><text x="15" y="95" font-size="13">Isolated test QR fixture</text></svg>'}}};
  }
  if(action==='unenroll'){const f=state.factors.find(f=>f.id===payload.factorId);assert.equal(f.status,'unverified');state.factors=state.factors.filter(f=>f!==f);await db.query('delete from auth.mfa_factors where id=$1',[payload.factorId]);return {error:null};}
  if(action==='challenge')return {data:{id:'fixture-challenge'}};
  if(action==='verify'){
   if(payload.code!=='123456')return {error:{message:'Invalid authenticator code. Please try again.'}};
   state.aal='aal2';state.factors.find(f=>f.id===payload.factorId).status='verified';await db.query("update auth.mfa_factors set status='verified' where id=$1",[payload.factorId]);await db.query("update auth.sessions set aal='aal2',factor_id=$2 where id=$1",[h.ownerSession,payload.factorId]);return {data:{}};
  }
  if(action==='api'){
   if(payload.action==='account_access'&&state.accessFailure){state.accessFailure=false;return {error:'Network unavailable. Try again.'};}
   if(payload.action==='affiliate_status')return {data:{assigned:false}};
   try{return {data:await h.as(h.ids.owner,async()=>(await db.query('select public.shop_api($1,$2::jsonb,null) value',[payload.action,JSON.stringify(payload.payload||{})])).rows[0].value,'authenticated',{aal:state.aal})};}catch(e){return {error:e.message};}
  }
  throw Error('Unexpected fixture '+action);
 });
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/auth/v1/settings')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"external":{"google":true}}'});
  if(u.origin!==origin)return route.abort();
  if(u.pathname==='/manage.html'||u.pathname==='/pos.html')return route.fulfill({contentType:'text/html',body:'<h1>Verified destination</h1>'});
  if(u.pathname==='/assets/admin/client.js')return route.fulfill({contentType:'text/javascript',body:`
   const call=(action,payload)=>window.mfaFixture({action,payload});export const ready=Promise.resolve(),initializationError=null,authLink={recovery:${recovery}};
   export const auth={getSession:()=>call('session'),onAuthStateChange:fn=>{window.fixtureAuthChange=fn;},signInWithPassword:()=>call('signin'),updateUser:()=>call('update-password'),signOut:async()=>{const r=await call('signout');window.fixtureAuthChange?.('SIGNED_OUT',null);return r;},mfa:{listFactors:()=>call('list'),enroll:p=>call('enroll',p),unenroll:p=>call('unenroll',p),challenge:p=>call('challenge',p),verify:p=>call('verify',p)}};
   export async function api(action,payload={}){const r=await call('api',{action,payload});if(r.error)throw Error(r.error);return r.data;}${helpers}`});
  const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/admin-account.html');return {ctx,page,state};
}
const submit=async(page,code)=>{await page.getByLabel('Authenticator code',{exact:true}).fill(code);await page.locator('[data-mfa-form] button[type=submit]').click();};
try{
 for(const width of [1440,768,390]){
  const {ctx,page,state}=await make(width);await page.getByRole('button',{name:'Set up authenticator',exact:true}).waitFor();
  await assert.rejects(h.as(h.ids.owner,()=>db.query("select public.shop_api('admin_bootstrap','{}',null)"),'authenticated',{aal:'aal1'}),e=>e.code==='P0MFA');
  await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await page.locator('[data-mfa-qr]').waitFor();
  await page.getByText('Show setup key',{exact:true}).click();assert.equal(await page.locator('[data-mfa-key]').textContent(),'JBSWY3DPEHPK3PXP');
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('JBSWY3DPEHPK3PXP')),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(out,`owner-setup-${width}.png`),fullPage:true});
  const n=calls.filter(c=>c.action==='challenge').length;await submit(page,'12');assert.equal(calls.filter(c=>c.action==='challenge').length,n);
  await submit(page,'000000');await page.getByText('Invalid authenticator code. Please try again.',{exact:true}).waitFor();assert.equal(state.aal,'aal1');
  state.accessFailure=true;await submit(page,'123456');await page.getByText('Network unavailable. Try again.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-mfa-key]').count(),0);assert.equal(await page.locator('[data-mfa-cancel]').count(),0);assert.equal(state.factors[0].status,'verified');
  await submit(page,'123456');await page.waitForURL(origin+'/manage.html');assert.equal((await h.rawApi('admin_bootstrap',{},h.ids.owner)).role,'owner');
  results.push({width,check:'Enrollment; private key stays ephemeral; malformed and wrong codes rejected; post-verify network failure clears setup key and retries; server grants owner access only after AAL2'});await ctx.close();
  const existing=await make(width,{enrolled:true});await existing.page.getByRole('heading',{name:'Verify your identity.',exact:true}).waitFor();await existing.page.getByLabel('Authenticator code',{exact:true}).waitFor();assert.equal(await existing.page.locator('[data-mfa-enroll]').count(),0);
  await existing.page.screenshot({path:join(out,`owner-challenge-${width}.png`),fullPage:true});await existing.page.getByRole('button',{name:'Sign out',exact:true}).click();await existing.page.getByRole('heading',{name:'Sign in to Elio.',exact:true}).waitFor();assert.equal(existing.state.factors.length,1);assert.equal(await existing.page.locator('[data-mfa-key]').count(),0);await existing.ctx.close();
  results.push({width,check:'Existing verified factor challenges without re-enrollment; sign-out keeps factor and returns to sign-in'});
 }
 const cancel=await make(390);await cancel.page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await cancel.page.getByRole('button',{name:'Cancel setup',exact:true}).click();await cancel.page.getByRole('button',{name:'Set up authenticator',exact:true}).waitFor();assert.equal(cancel.state.factors.length,0);assert.equal(cancel.state.aal,'aal1');await cancel.ctx.close();results.push({check:'Cancel removes only the newly created unverified factor'});
 const retry=await make(390,{listFailure:true});await retry.page.getByText('Connection interrupted. Try again.',{exact:true}).waitFor();await retry.page.getByRole('button',{name:'Try again',exact:true}).click();await retry.page.getByRole('button',{name:'Set up authenticator',exact:true}).waitFor();await retry.ctx.close();results.push({check:'Factor-list failure offers successful retry'});
 const signin=await make(390,{enrolled:true,guest:true});await signin.page.getByLabel('Email address',{exact:true}).fill('owner@example.test');await signin.page.getByLabel('Password',{exact:true}).fill('Fixture-password-only');await signin.page.locator('#account-submit').click();await signin.page.getByRole('heading',{name:'Verify your identity.',exact:true}).waitFor();assert.equal(new URL(signin.page.url()).pathname,'/admin-account.html');await signin.ctx.close();results.push({check:'Password sign-in stops for verification before destination navigation'});
 const recovery=await make(390,{enrolled:true,recovery:true});await recovery.page.getByRole('heading',{name:'Verify your identity.',exact:true}).waitFor();assert.equal(recovery.state.passwordUpdated,undefined);await submit(recovery.page,'123456');await recovery.page.getByRole('heading',{name:'Choose a new password.',exact:true}).waitFor();assert.equal(new URL(recovery.page.url()).pathname,'/admin-account.html');await recovery.page.getByLabel('Password',{exact:true}).fill('Fixture-password-only');await recovery.page.getByLabel('Confirm your password',{exact:true}).fill('Fixture-password-only');await recovery.page.locator('#account-submit').click();await recovery.page.waitForURL(origin+'/manage.html');assert.equal(recovery.state.passwordUpdated,true);await recovery.ctx.close();results.push({check:'Owner recovery link challenges first, resumes password form, then updates password at AAL2 and opens destination'});
 assert.deepEqual(errors,[]);await writeFile(join(out,'owner-mfa-ui.json'),JSON.stringify({results,errors,scope:'Real browser application and isolated migrated database; Auth SDK responses simulated, production TOTP is a separate verification'},null,2));console.log('PASS '+results.length+' owner MFA UI scenarios');
}finally{await browser.close();await db.close();}
