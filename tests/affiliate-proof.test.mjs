import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://elio.example.test',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',SUPABASE_ANON_KEY:'test-public-key'}[name])}};
const {handle}=await import('../supabase/functions/affiliate-proof/handler.ts');
const user='12345678-1234-4234-8234-123456789abc',affiliate='12345678-1234-4234-8234-123456789def',id='12345678-1234-4234-8234-123456789aaa';
const png=await readFile(new URL('../dist/assets/elio-favicon.png',import.meta.url));
let calls=[],setup={},record=null,checks=0;const actual=fetch;
globalThis.fetch=async(url,options={})=>{
 const path=new URL(url).pathname;calls.push({path,options});
 if(path==='/auth/v1/user')return Response.json(setup.expired?{}:{id:user},{status:setup.expired?401:200});
 if(path==='/rest/v1/rpc/shop_service'){
  const {p_action:a,p_payload:p}=JSON.parse(options.body);assert.equal(p.user_id,user);
  if(a==='affiliate_proof_read')return setup.denied?Response.json({message:'Receipt not available.'},{status:403}):Response.json({affiliate_id:affiliate,path:setup.badPath?'another-affiliate/private.png':`${affiliate}/${id}/12345678-1234-4234-8234-123456789bbb.png`});
  if(a==='affiliate_authorize_payout'){
   if(setup.denied||setup.commitFails&&calls.some(c=>c.options.body&&typeof c.options.body==='string'&&c.options.body.includes('affiliate_commit_payout')))return Response.json({message:'Balance changed or owner access required.'},{status:400});
   return Response.json(record?{recorded:true,payout:record,path:record.proof_path}:{allowed:true});
  }
  if(a==='affiliate_commit_payout'){
   if(setup.commitFails)return Response.json({message:'The balance changed.'},{status:400});
   if(setup.networkBeforeCommit)throw Error('Network unavailable');
   record={id,affiliate_id:affiliate,amount_cents:p.amount_cents,proof_path:p.path,request_hash:p.request_hash,created_by:user};
   if(setup.networkAfterCommit)throw Error('Response lost');
   return Response.json({recorded:true,payout:record,path:p.path});
  }
  throw Error('Unexpected service action '+a);
 }
 if(path.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/affiliate-payout-proofs/private?token=temporary'});
 if(path.startsWith('/storage/v1/object/'))return Response.json({});
 throw Error('Unexpected '+path);
};
function request({file=png,token='verified-owner',origin='https://eliocheesecakes.com',read=false,duplicate=false}={}){
 const headers={origin,...(token?{Authorization:`Bearer ${token}`}:{})};
 if(read)return new Request('https://elio.example.test/functions/v1/affiliate-proof',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'receipt',id})});
 const form=new FormData();for(const [k,v] of Object.entries({id,affiliate_id:affiliate,user_id:'forged-user',amount_cents:'5000',paid_on:'2026-09-27',payment_method:'gcash',reference:'PAY-123',note:'Receipt test'}))form.set(k,v);
 form.set('file',new File([file],'receipt.png',{type:'image/png'}));if(duplicate)form.append('file',new File([file],'two.png',{type:'image/png'}));
 return new Request('https://elio.example.test/functions/v1/affiliate-proof',{method:'POST',headers,body:form});
}
async function check(name,run){calls=[];setup={};record=null;await run();checks++;console.log('PASS '+name);}
try{
 await check('requires authenticated account and trusted origin before upload',async()=>{assert.equal((await handle(request({token:''}))).status,401);assert.equal((await handle(request({origin:'https://hostile.example'}))).status,403);assert.equal(calls.length,0);});
 await check('expired sessions and non-owner payment submissions cannot upload',async()=>{setup.expired=true;assert.equal((await handle(request())).status,401);setup={denied:true};assert.equal((await handle(request())).status,400);assert(!calls.some(c=>c.path.startsWith('/storage/')));});
 await check('validates receipt bytes, size and one-file boundary',async()=>{assert.equal((await handle(request({file:'fake image'}))).status,415);assert.equal((await handle(request({file:Buffer.alloc(5*1024*1024+1)}))).status,413);assert.equal((await handle(request({duplicate:true}))).status,400);assert(!calls.some(c=>c.path.startsWith('/storage/')));});
 await check('corrupt WebP cannot record an affiliate payout',async()=>{const file=Buffer.alloc(22);file.write('RIFF');file.writeUInt32LE(14,4);file.write('WEBPVP8L',8);file.writeUInt32LE(2,16);assert.equal((await handle(request({file}))).status,415);assert(!calls.some(c=>c.path.startsWith('/storage/')));assert.equal(record,null);});
 await check('commits verified identity and private receipt; response strips internal fields',async()=>{const r=await handle(request());assert.equal(r.status,201);const p=(await r.json()).payout;assert.equal(p.amount_cents,5000);assert(!('proof_path' in p));assert(!('request_hash' in p));assert(!('created_by' in p));assert.match(record.proof_path,new RegExp(`^${affiliate}/${id}/[a-f0-9-]+.png$`));assert.match(record.request_hash,/^[a-f0-9]{64}$/);assert.equal(calls.find(c=>c.path.startsWith('/storage/')).options.headers['x-upsert'],'false');});
 await check('retry keeps same fingerprint and never uploads twice',async()=>{await handle(request());const hash=record.request_hash;calls=[];assert.equal((await handle(request())).status,200);assert(!calls.some(c=>c.path.startsWith('/storage/')));assert.equal(JSON.parse(calls.at(-1).options.body).p_payload.request_hash,hash);});
 await check('balance rejection after upload removes only the rejected receipt',async()=>{setup.commitFails=true;assert.equal((await handle(request())).status,400);assert.equal(calls.at(-1).options.method,'DELETE');assert.equal(record,null);});
 await check('lost response after commit recovers without deleting the accepted receipt',async()=>{setup.networkAfterCommit=true;assert.equal((await handle(request())).status,200);assert(record);assert(!calls.some(c=>c.options.method==='DELETE'));});
 await check('failure before commit cleans up only after checking no payment was recorded',async()=>{setup.networkBeforeCommit=true;assert.equal((await handle(request())).status,500);assert.equal(record,null);assert.equal(calls.at(-1).options.method,'DELETE');});
 await check('private receipts enforce database authorization and validated affiliate path',async()=>{setup.denied=true;assert.equal((await handle(request({read:true}))).status,400);setup={badPath:true};assert.equal((await handle(request({read:true}))).status,404);assert(!calls.some(c=>c.path.includes('/sign/')));});
 await check('authorized receipt access expires after five minutes',async()=>{const r=await handle(request({read:true}));assert.equal(r.status,200);const p=await r.json();assert.equal(p.expires_in,300);assert.match(p.url,/^https:\/\/elio.example.test\/storage\/v1\//);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{expiresIn:300});});
 console.log(`Passed ${checks} affiliate proof boundary checks; no live uploads or payments.`);
}finally{globalThis.fetch=actual;}
