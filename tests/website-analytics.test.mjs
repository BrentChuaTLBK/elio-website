import assert from 'node:assert/strict';
import { createReporter, parseCount } from '../supabase/functions/website-analytics/reporting.ts';

const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
// An ephemeral test key, never a real Google account credential.
const secret = JSON.stringify({type:'service_account',client_email:'elio-reporting@test-project.iam.gserviceaccount.com',private_key:`-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----\n`,token_uri:'https://untrusted.example.test/token'});
const fixture = (metric, value=7, extra={}) => ({kind:`analyticsData#${metric==='totalUsers'?'runReport':'runRealtimeReport'}`,metricHeaders:[{name:metric,type:'TYPE_INTEGER'}],rows:[{metricValues:[{value:String(value)}]}],rowCount:1,...(metric==='totalUsers'?{metadata:{timeZone:'Asia/Manila'}}:{}),...extra});
let checks=0;
async function test(name,fn){await fn();checks++;console.log(`OK ${name}`);}
function setup(overrides={}) {
  const state={env:{GA_PROPERTY_ID:'123456789',GA_SERVICE_ACCOUNT_JSON:secret},time:Date.parse('2026-09-28T08:00:00Z'),calls:[],...overrides};
  const request=async(url,options)=>{
    state.calls.push({url,options});
    assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
    if(url==='https://oauth2.googleapis.com/token'){
      const assertion=options.body.get('assertion'),[header,claims,signature]=assertion.split('.');
      const payload=JSON.parse(Buffer.from(claims,'base64url'));
      assert.equal(payload.scope,'https://www.googleapis.com/auth/analytics.readonly');
      assert.equal(payload.aud,url);assert.equal(payload.iss,'elio-reporting@test-project.iam.gserviceaccount.com');
      assert.equal(payload.exp-payload.iat,3600);
      assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(`${header}.${claims}`)));
      if(state.tokenFailure)return Response.json({error:'PRIVATE PROVIDER ERROR'},{status:403});
      return Response.json({access_token:'test-google-token',expires_in:3600,token_type:'Bearer'});
    }
    assert(url.startsWith(`https://analyticsdata.googleapis.com/v1beta/properties/${state.env.GA_PROPERTY_ID}:`));
    assert.equal(options.headers.Authorization,'Bearer test-google-token');
    const daily=url.endsWith(':runReport'),body=JSON.parse(options.body);
    assert.deepEqual(body,daily?{dateRanges:[{startDate:'today',endDate:'today'}],metrics:[{name:'totalUsers'}],limit:'1'}:{metrics:[{name:'activeUsers'}],limit:'1'});
    if(state.networkFailure)throw Error('PRIVATE PROVIDER ERROR');
    if(daily&&state.todayFailure)return Response.json({error:{message:'PRIVATE PROVIDER ERROR'}},{status:state.todayFailure});
    if(!daily&&state.realtimeFailure)return Response.json({error:{}},{status:state.realtimeFailure});
    if(state.onReport)state.onReport();
    return Response.json(daily?(state.daily||fixture('totalUsers',17)):(state.realtime||fixture('activeUsers',3)));
  };
  const report=createReporter({getEnv:name=>state.env[name]||'',request,now:()=>state.time});
  return {state,report};
}

await test('fixed aggregate reports, signed read-only token and no credentials in response',async()=>{
  const {state,report}=setup();const result=await report();
  assert.deepEqual(result,{status:'ready',visitorsToday:17,activeLast30Minutes:3,timeZone:'Asia/Manila',updatedAt:'2026-09-28T08:00:00.000Z'});
  assert.equal(state.calls.length,3);assert(!JSON.stringify(result).includes('token'));
});
await test('concurrent refreshes share one report; sixty-second cache then refresh reuses token',async()=>{
  const {state,report}=setup();await Promise.all([report(),report(),report()]);assert.equal(state.calls.length,3);
  state.time+=59000;await report();assert.equal(state.calls.length,3);
  state.time+=1001;await report();assert.equal(state.calls.length,5);
  state.time+=3600000;await report();assert.equal(state.calls.length,8);
});
await test('daily cache expires at midnight in the property timezone',async()=>{
  const {state,report}=setup({time:Date.parse('2026-09-28T15:59:59Z')});await report();state.time+=2000;await report();assert.equal(state.calls.length,5);
});
await test('day changing during the query cannot show yesterday as today',async()=>{
  const {state,report}=setup({time:Date.parse('2026-09-28T15:59:59Z')});state.onReport=()=>{state.time=Date.parse('2026-09-28T16:00:01Z');};
  const result=await report();assert.equal(result.status,'partial');assert.equal(result.visitorsToday,null);assert.equal(result.issues.today,'day_changed');
});
await test('missing configuration does not contact Google',async()=>{
  const {state,report}=setup({env:{GA_PROPERTY_ID:'123456789'}});assert.deepEqual(await report(),{status:'not_configured'});assert.equal(state.calls.length,0);
});
await test('invalid property and private key fail without remote requests',async()=>{
  for(const env of [{GA_PROPERTY_ID:'../../other-property',GA_SERVICE_ACCOUNT_JSON:secret},{GA_PROPERTY_ID:'123456789',GA_SERVICE_ACCOUNT_JSON:'{"private_key":"bad"}'}]){
    const {state,report}=setup({env});const result=await report();assert.equal(result.status,'unavailable');assert.equal(result.issues.today,'access');assert.equal(state.calls.length,0);
  }
});
await test('one failed report preserves the other count and redacts provider errors',async()=>{
  for(const [code,issue] of [[403,'access'],[429,'busy'],[500,'network']]){
    const {report}=setup({todayFailure:code});const result=await report();assert.equal(result.status,'partial');assert.equal(result.visitorsToday,null);assert.equal(result.activeLast30Minutes,3);assert.equal(result.issues.today,issue);assert(!JSON.stringify(result).includes('PRIVATE'));
  }
});
await test('token failure and network errors are unavailable, never zero',async()=>{
  for(const setting of [{tokenFailure:true},{networkFailure:true}]){
    const {report}=setup(setting);const result=await report();assert.equal(result.status,'unavailable');assert.equal(result.visitorsToday,null);assert.equal(result.activeLast30Minutes,null);
  }
});
await test('configuration change invalidates existing report and token',async()=>{
  const {state,report}=setup();await report();state.env.GA_PROPERTY_ID='987654321';await report();assert.equal(state.calls.length,6);
});
await test('exact integers and legitimate empty Google responses are zero',async()=>{
  for(const metric of ['totalUsers','activeUsers']){
    assert.equal(parseCount(fixture(metric,0),metric).value,0);
    const response=fixture(metric);delete response.rows;delete response.rowCount;assert.equal(parseCount(response,metric).value,0);
  }
});
await test('missing, mismatched and malformed responses cannot appear as visitor counts',async()=>{
  for(const response of [{},fixture('activeUsers'),fixture('totalUsers',-1),fixture('totalUsers',1.5),fixture('totalUsers',''),fixture('totalUsers','9007199254740992'),fixture('totalUsers',5,{rowCount:2}),fixture('totalUsers',5,{dimensionHeaders:[{name:'pagePath'}]}),fixture('totalUsers',5,{metadata:{timeZone:'invalid/timezone'}})])assert.equal(parseCount(response,'totalUsers').value,null);
});
await test('restricted, pending and privacy-withheld reports stay unavailable',async()=>{
  for(const [metadata,issue] of [[{emptyReason:'pending'},'report_pending'],[{schemaRestrictionResponse:{activeMetricRestrictions:[{metricName:'totalUsers'}]}},'restricted'],[{subjectToThresholding:true},'withheld']]){
    const result=parseCount(fixture('totalUsers',0,{metadata:{timeZone:'Asia/Manila',...metadata}}),'totalUsers');assert.equal(result.value,null);assert.equal(result.issue,issue);
  }
});

const values={SUPABASE_URL:'https://elio.example.test',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',SUPABASE_ANON_KEY:'test-public-key'};
globalThis.Deno={env:{get:name=>values[name]}};
const {handle}=await import('../supabase/functions/website-analytics/handler.ts');
const user='12345678-1234-4234-8234-123456789abc';
let calls=[],denied=false,expired=false;
const actualFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user'))return Response.json(expired?{}:{id:user},{status:expired?401:200});
  if(url.endsWith('/rest/v1/rpc/shop_service')){
    assert.deepEqual(JSON.parse(options.body),{p_action:'authorize_analytics',p_payload:{user_id:user}});
    return denied?Response.json({message:'Authorized staff access required'},{status:403}):Response.json({allowed:true});
  }
  throw Error('Unexpected outbound request');
};
const req=(token='test-session',extra={})=>new Request('https://elio.example.test/functions/v1/website-analytics',{method:'POST',headers:{origin:'https://eliocheesecakes.com',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({user_id:'attacker',property_id:'other-property'}),...extra});
try {
  await test('unauthenticated and public-key calls never reach data service',async()=>{
    for(const token of ['',values.SUPABASE_ANON_KEY,'sb_publishable_fake']){calls=[];assert.equal((await handle(req(token))).status,401);assert.equal(calls.length,0);}
  });
  await test('expired sessions and customer accounts cannot read reports',async()=>{
    expired=true;assert.equal((await handle(req())).status,401);expired=false;
    denied=true;assert.equal((await handle(req())).status,403);denied=false;
  });
  await test('valid staff is checked on every request and client property/user fields ignored',async()=>{
    calls=[];
    for(let i=0;i<2;i++){
      const response=await handle(req());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{status:'not_configured'});
    }
    assert.equal(calls.length,4);
  });
  await test('CORS and HTTP method checks reject unsupported requests',async()=>{
    calls=[];assert.equal((await handle(req('test-session',{headers:{origin:'https://untrusted.example.test'}}))).status,403);
    assert.equal((await handle(new Request('https://elio.example.test/functions/v1/website-analytics'))).status,405);
    assert.equal((await handle(new Request('https://elio.example.test/functions/v1/website-analytics',{method:'OPTIONS',headers:{origin:'https://eliocheesecakes.com'}}))).status,204);
    assert.equal(calls.length,0);
  });
} finally { globalThis.fetch=actualFetch; }
console.log(`Passed ${checks} website analytics checks.`);
