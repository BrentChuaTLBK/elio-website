import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Boundary tests: all Auth, database, and Storage calls are mocked. No uploads.
const values={SUPABASE_URL:'https://elio.example.test',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',SUPABASE_ANON_KEY:'test-public-key'};
globalThis.Deno={env:{get:name=>values[name]}};
const {handle:upload}=await import('../supabase/functions/proof-upload/handler.ts');
const {handle:read}=await import('../supabase/functions/proof-url/handler.ts');
const order='12345678-1234-4234-8234-123456789abc',user='12345678-1234-4234-8234-123456789def';
const png=await readFile(new URL('../dist/assets/elio-favicon.png',import.meta.url));
const actualFetch=globalThis.fetch;
let calls=[],setup={},checks=0;
globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  calls.push({path,options});
  if(path==='/auth/v1/user')return Response.json(setup.invalidSession?{}:{id:user},{status:setup.invalidSession?401:200});
  if(path==='/rest/v1/rpc/shop_service'){
    assert.equal(options.headers.apikey,'test-service-key');
    const {p_action:action,p_payload:p}=JSON.parse(options.body);
    if(action==='authorize_upload')return Response.json({allowed:setup.allowUpload!==false});
    if(action==='commit_proof')return setup.commitFails?Response.json({message:'Order has expired.'},{status:400}):Response.json({id:p.order_id,payment_status:'under_review'});
    if(action==='authorize_proof_read')return setup.staffDenied?Response.json({message:'Staff access required.'},{status:403}):Response.json({path:`${order}/receipt.png`});
    throw Error('Unexpected service action '+action);
  }
  if(path.includes('/object/sign/'))return Response.json({signedURL:`/object/sign/payment-proofs/${order}/receipt.png?token=temporary`});
  if(path.startsWith('/storage/v1/object/'))return Response.json({});
  throw Error('Unexpected request');
};
function request({kind='proof',file=png,mime='image/png',origin='https://eliocheesecakes.com',bearer='',token='private-order-token',reference=''}={}){
  const form=new FormData();form.set('kind',kind);form.set('file',new File([file],'receipt.png',{type:mime}));form.set('order_id',order);form.set('token',token);if(reference)form.set('payment_reference',reference);
  return new Request('https://elio.example.test/functions/v1/proof-upload',{method:'POST',headers:{origin,...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:form});
}
const readRequest=bearer=>new Request('https://elio.example.test/functions/v1/proof-url',{method:'POST',headers:{origin:'https://eliocheesecakes.com','content-type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify({order_id:order})});
async function check(name,fn){calls=[];setup={};await fn();checks++;console.log('PASS '+name);}
try{
 await check('preflight allows Elio and rejects unrelated origins',async()=>{
  const good=await upload(new Request('https://elio.example.test/functions/v1/proof-upload',{method:'OPTIONS',headers:{origin:'https://eliocheesecakes.com'}}));assert.equal(good.status,204);assert.equal(good.headers.get('access-control-allow-origin'),'https://eliocheesecakes.com');
  assert.equal((await upload(request({origin:'https://unrelated.example.test'}))).status,403);assert.equal(calls.length,0);
 });
 await check('guest proof requires database authorization before Storage',async()=>{
  setup.allowUpload=false;assert.equal((await upload(request({token:'wrong-token'}))).status,403);assert.equal(calls.length,1);
 });
 await check('renamed files and oversized uploads are refused',async()=>{
  assert.equal((await upload(request({file:'<html>not an image</html>'}))).status,415);
  assert.equal((await upload(request({file:Buffer.alloc(5*1024*1024+1)}))).status,413);assert.equal(calls.length,0);
 });
 await check('guest receipt stores privately and submits for manual review',async()=>{
  const response=await upload(request({reference:'PAY-123'}));assert.equal(response.status,201);assert.equal((await response.json()).order.payment_status,'under_review');
  const storage=calls.find(c=>c.path.startsWith('/storage/'));assert.match(storage.path,new RegExp(`/payment-proofs/${order}/[a-f0-9-]+\\.png$`));assert.equal(storage.options.headers['x-upsert'],'false');
  const commit=JSON.parse(calls.at(-1).options.body).p_payload;assert.equal(commit.user_id,null);assert.equal(commit.payment_reference,'PAY-123');assert.equal(commit.token,'private-order-token');
 });
 await check('guest publishable-key header does not impersonate a user',async()=>{
  assert.equal((await upload(request({bearer:'sb_publishable_test'}))).status,201);assert(!calls.some(c=>c.path==='/auth/v1/user'));
 });
 await check('expired signed-in session is refused',async()=>{
  setup.invalidSession=true;assert.equal((await upload(request({bearer:'expired-jwt'}))).status,401);assert.equal(calls.length,1);
 });
 await check('signed-in identity comes from Auth, never form fields',async()=>{
  assert.equal((await upload(request({bearer:'valid-jwt'}))).status,201);assert.equal(JSON.parse(calls.at(-1).options.body).p_payload.user_id,user);
 });
 await check('expiry after upload deletes the orphan without confirming proof',async()=>{
  setup.commitFails=true;const response=await upload(request());assert.equal(response.status,400);assert.match((await response.json()).error,/expired/);assert.equal(calls.at(-1).options.method,'DELETE');
 });
 await check('product uploads require an authenticated owner authorization',async()=>{
  assert.equal((await upload(request({kind:'product'}))).status,401);assert.equal(calls.length,0);
  setup.allowUpload=false;assert.equal((await upload(request({kind:'product',bearer:'valid-jwt'}))).status,403);assert(!calls.some(c=>c.path.startsWith('/storage/')));
 });
 await check('proof viewing requires authenticated staff, not an order token',async()=>{
  assert.equal((await read(readRequest(''))).status,401);setup.staffDenied=true;assert.equal((await read(readRequest('customer-jwt'))).status,400);assert(!calls.some(c=>c.path.startsWith('/storage/')));
 });
 await check('authorized staff get a five-minute private signed URL',async()=>{
  const response=await read(readRequest('staff-jwt'));assert.equal(response.status,200);const result=await response.json();assert.equal(result.expires_in,300);assert.match(result.url,/^https:\/\/elio.example.test\/storage\/v1\/object\/sign\/payment-proofs\//);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{expiresIn:300});
 });
 console.log(`Passed ${checks} proof endpoint checks; no live files or orders created.`);
}finally{globalThis.fetch=actualFetch;}
