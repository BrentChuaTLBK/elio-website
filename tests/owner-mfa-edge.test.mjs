import assert from 'node:assert/strict';
import {verifiedUser} from '../supabase/functions/_shared/http.ts';
const realFetch=globalThis.fetch,realDeno=globalThis.Deno;
const id='11111111-1111-4111-8111-111111111111',calls=[];
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-server-key',SUPABASE_ANON_KEY:'public-key'})[name]}};
let access={role:'owner',mfa_required:false},userStatus=200,accessStatus=200;
globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(String(url).endsWith('/auth/v1/user')?{id}:access),{status:String(url).endsWith('/auth/v1/user')?userStatus:accessStatus,headers:{'Content-Type':'application/json'}});};
const req=()=>new Request('https://edge.test',{headers:{authorization:'Bearer verified-user-token'}});
try{
 assert.equal(await verifiedUser(new Request('https://edge.test')),null);assert.equal(calls.length,0);
 await assert.rejects(verifiedUser(new Request('https://edge.test'),true),e=>e.status===401);
 assert.equal(await verifiedUser(req(),true),id);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer verified-user-token');assert.equal(JSON.parse(calls.at(-1).options.body).p_action,'account_access');
 access={role:'owner',mfa_required:true};await assert.rejects(verifiedUser(req(),true),e=>e.status===403);
 access={role:'owner'};await assert.rejects(verifiedUser(req(),true),e=>e.status===403);
 for(const role of ['staff',null]){access={role,mfa_required:false};assert.equal(await verifiedUser(req(),true),id);}
 accessStatus=503;await assert.rejects(verifiedUser(req(),true),e=>e.status===503);accessStatus=200;
 userStatus=401;const before=calls.length;await assert.rejects(verifiedUser(req(),true),e=>e.status===401);assert.equal(calls.length,before+1);
 console.log('PASS Edge owner MFA verifies the caller JWT and fails closed; customer/staff/anonymous paths preserved');
}finally{globalThis.fetch=realFetch;globalThis.Deno=realDeno;}
