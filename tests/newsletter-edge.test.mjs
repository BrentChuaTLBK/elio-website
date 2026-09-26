import assert from 'node:assert/strict';

const vars = { SUPABASE_URL:'https://elio.example.test',SUPABASE_SERVICE_ROLE_KEY:'server-test-key',RESEND_API_KEY:'provider-key',EMAIL_FROM:'Elio <hello@example.test>' };
globalThis.Deno = { env:{get:name=>vars[name]} };
const {handle} = await import('../supabase/functions/newsletter/handler.ts');
const {deliverNewsletters} = await import('../supabase/functions/email-worker/newsletter-worker.ts');
const {renderNewsletterEmail,newsletterHeaders} = await import('../supabase/functions/_shared/newsletter-emails.ts');
const originalFetch=globalThis.fetch;
const secret='a'.repeat(64), unsub='b'.repeat(64);
const settings={site_url:'https://eliocheesecakes.com',newsletter_mailing_address:'39 Acacia Drive, Quezon City',contact_email:'elio.cheesecakes@gmail.com'};
const subscriber={email:'reader@example.test'};
const confirmation={event_type:'newsletter_confirmation',settings,subscriber,confirmation_token:secret,unsubscribe_token:unsub};
const campaign={id:'campaign-id',revision:1,subject:'The October collection',title:'New flavors <script>',body:'A little something new.\n\nMade to share.',image_url:'https://eliocheesecakes.com/assets/home-editorial-hero.webp',cta_label:'Explore boxes',cta_url:'https://eliocheesecakes.com/order.html'};
const preview={event_type:'newsletter_campaign',campaign,settings,subscriber:{email:'preview@example.test'},unsubscribe_token:'preview-only',recipient_count:7,revision:1,campaign_id:campaign.id};
let calls=[],sends=[],state={},checks=0,prepared=null;
const queueRow=()=>({id:'queue-id',lease_token:'lease-token',event_key:'confirmation/subscriber-v1',to_email:subscriber.email,subject:'Confirm your Elio subscription',first_attempt_at:new Date().toISOString(),payload:confirmation,provider_payload:prepared});
globalThis.fetch=async(url,init)=>{
  const address=String(url),body=init.body?JSON.parse(init.body):{};
  if(address.includes('api.resend.com')){sends.push({body,key:init.headers['Idempotency-Key']});return Response.json(state.providerStatus?{error:'provider rejected'}:{id:'provider-id'},{status:state.providerStatus||200});}
  if(address.endsWith('/auth/v1/user')){calls.push({auth:true});return Response.json(state.badUser?{}:{id:'11111111-1111-4111-8111-111111111111'},{status:state.badUser?401:200});}
  const action=body.p_action;calls.push({action,payload:body.p_payload,authorization:init.headers.Authorization});
  if(action==='newsletter_preview_campaign')return Response.json(state.forbidden?{error:'not owner'}:preview,{status:state.forbidden?403:200});
  if(action==='newsletter_subscribe')return Response.json({accepted:true,queued:!state.rateLimited,rate_limited:state.rateLimited,private:'must not escape'});
  if(action==='newsletter_confirm'||action==='newsletter_activate_account')return Response.json({status:'subscribed',private:'must not escape'});
  if(action==='newsletter_unsubscribe')return Response.json({status:'unsubscribed'});
  if(action==='newsletter_claim_emails')return Response.json(state.empty?[]:[{...queueRow(),...(state.old?{first_attempt_at:'2020-01-01'}:{})}]);
  if(action==='newsletter_prepare_email'){
    state.prepares=(state.prepares||0)+1;
    if(state.skip||(state.skipSecond&&state.prepares===2))return Response.json({skip:true});
    if(body.p_payload.provider_payload&&!prepared)prepared=body.p_payload.provider_payload;
    return Response.json(queueRow());
  }
  if(action==='newsletter_email_sent'&&state.ackFailure)return Response.json({},{status:500});
  if(action==='newsletter_email_failed')state.failure=body.p_payload;
  return Response.json({queued:true});
};
const request=(payload,extra={})=>new Request('https://elio.example.test/functions/v1/newsletter',{
  method:'POST',headers:{'Content-Type':'application/json',Origin:'https://eliocheesecakes.com','cf-connecting-ip':'192.0.2.4',...(extra.authorization?{Authorization:extra.authorization}:{})},body:JSON.stringify(payload),
});
const subscribe={action:'subscribe',email:'Reader@Example.test',source:'home_popup',consent:true};
async function check(name,fn){calls=[];sends=[];state={};prepared=null;await fn();checks++;console.log('PASS '+name);}
try{
  await check('GET links only open an explicit website control and never change consent',async()=>{const response=await handle(new Request('https://elio.example.test/functions/v1/newsletter?action=unsubscribe&token='+unsub));assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'https://eliocheesecakes.com/newsletter.html#unsubscribe='+unsub);assert.equal((await handle(new Request('https://elio.example.test/functions/v1/newsletter?action=confirm&token='+secret))).status,405);assert.equal(calls.length,0);});
  await check('Cross-origin requests are rejected and trusted preflight succeeds',async()=>{assert.equal((await handle(new Request('https://elio.example.test/functions/v1/newsletter',{method:'OPTIONS',headers:{Origin:'https://bad.example'}}))).status,403);assert.equal((await handle(new Request('https://elio.example.test/functions/v1/newsletter',{method:'OPTIONS',headers:{Origin:'https://eliocheesecakes.com'}}))).status,204);assert.equal(calls.length,0);});
  await check('Consent and email validation happen before enqueueing',async()=>{assert.equal((await handle(request({...subscribe,consent:false}))).status,400);assert.equal((await handle(request({...subscribe,email:'bad'}))).status,400);assert.equal(calls.length,0);});
  await check('Honeypot is generic and does not create email work',async()=>{assert.deepEqual(await(await handle(request({...subscribe,website:'spam'}))).json(),{accepted:true});assert.equal(calls.length,0);});
  await check('Subscription normalizes email and hashes the IP without exposing private state',async()=>{const response=await handle(request(subscribe));assert.deepEqual(await response.json(),{accepted:true});assert.equal(calls[0].payload.email,'reader@example.test');assert.match(calls[0].payload.ip_hash,/^[a-f0-9]{64}$/);assert(!JSON.stringify(calls).includes('192.0.2.4'));assert.equal(calls[0].payload.consent_version,'elio-newsletter-v1');state.rateLimited=true;assert.deepEqual(await(await handle(request(subscribe))).json(),{accepted:true});});
  await check('Account activation uses verified identity, never a submitted user ID',async()=>{assert.equal((await handle(request({action:'activate_account',user_id:'attacker'}))).status,401);const response=await handle(request({action:'activate_account',user_id:'attacker'},{authorization:'Bearer valid-user'}));assert.deepEqual(await response.json(),{status:'subscribed'});assert.equal(calls.find(c=>c.action==='newsletter_activate_account').payload.user_id,'11111111-1111-4111-8111-111111111111');});
  await check('Confirmation requires a bounded private token and returns only status',async()=>{assert.equal((await handle(request({action:'confirm',token:'bad'}))).status,400);assert.deepEqual(await(await handle(request({action:'confirm',token:secret}))).json(),{status:'subscribed'});});
  await check('One-click unsubscribe POST works without cookies or sign-in',async()=>{const response=await handle(new Request('https://elio.example.test/functions/v1/newsletter?action=unsubscribe&token='+unsub,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'unsubscribed'});assert.equal(calls[0].action,'newsletter_unsubscribe');});
  await check('Owner preview preserves review revision and safely escapes campaign text',async()=>{const response=await handle(request({action:'preview_campaign',campaign},{authorization:'Bearer owner-jwt'}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.recipient_count,7);assert.equal(result.revision,1);assert(result.html.includes('New flavors &lt;script&gt;'));assert(!result.html.includes('<script>'));assert.equal(calls.find(c=>c.action==='newsletter_preview_campaign').authorization,'Bearer owner-jwt');state.forbidden=true;assert.equal((await handle(request({action:'preview_campaign',campaign},{authorization:'Bearer non-owner'}))).status,403);});
  await check('Branded confirmation and welcome emails contain exact terms and token-only links',async()=>{const email=renderNewsletterEmail(confirmation);assert(email.html.includes('#3d251c'));assert(email.text.includes('Minimum order ₱500'));assert(email.text.includes('Maximum discount ₱100'));assert(email.text.includes('#confirm='+secret));assert(!email.text.includes('Your personal code:'));const welcome=renderNewsletterEmail({...confirmation,event_type:'newsletter_welcome',offer:{code:'AB23CD',value:5,min_subtotal_cents:50000,cap_cents:10000,expires_at:'2026-10-26T00:00:00Z'}});assert(welcome.text.includes('AB23CD'));assert(welcome.text.includes('₱500.00'));assert(welcome.text.includes('₱100.00'));assert(welcome.text.includes('reader@example.test'));assert(welcome.html.includes('unsubscribe='));const headers=newsletterHeaders(confirmation,vars.SUPABASE_URL);assert(headers['List-Unsubscribe'].startsWith('<https://'));assert.equal(headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');});
  await check('Unsafe links and incomplete mailing addresses cannot produce a newsletter',async()=>{assert.throws(()=>renderNewsletterEmail({...preview,campaign:{...campaign,cta_url:'javascript:alert(1)'}}));assert.throws(()=>renderNewsletterEmail({...confirmation,settings:{site_url:settings.site_url}}));});
  await check('Newsletter worker freezes request content before sending and keeps stable idempotency',async()=>{const result=await deliverNewsletters('key','Elio <hello@example.test>');assert.equal(result.accepted,1);assert.equal(sends[0].key,'elio/newsletter/confirmation/subscriber-v1');assert.equal(sends[0].body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.equal(calls.filter(c=>c.action==='newsletter_prepare_email').length,2);});
  await check('Retries reuse the original body even after sender configuration changes',async()=>{state.ackFailure=true;assert.equal((await deliverNewsletters('key','Elio <hello@example.test>')).acknowledgement_pending,1);state.ackFailure=false;await deliverNewsletters('key','Changed <other@example.test>');assert.deepEqual(sends[1],sends[0]);});
  await check('Unsubscribing before either preparation check prevents delivery',async()=>{state.skip=true;assert.equal((await deliverNewsletters('key','sender')).skipped,1);assert.equal(sends.length,0);state.skip=false;state.skipSecond=true;state.prepares=0;assert.equal((await deliverNewsletters('key','sender')).skipped,1);assert.equal(sends.length,0);});
  await check('Expired retry windows stop safely and permanent provider errors do not repeat',async()=>{state.old=true;await deliverNewsletters('key','sender');assert.equal(state.failure.terminal,true);assert.equal(sends.length,0);state.old=false;state.providerStatus=422;await deliverNewsletters('key','sender');assert.equal(state.failure.terminal,true);});
  await check('Provider rate limits retain retryable queue work',async()=>{state.providerStatus=429;await deliverNewsletters('key','sender');assert.equal(state.failure.terminal,false);assert(!calls.some(c=>c.action==='newsletter_email_sent'));});
  console.log(`Passed ${checks} newsletter endpoint, renderer and worker checks; no emails sent.`);
}finally{globalThis.fetch=originalFetch;}
