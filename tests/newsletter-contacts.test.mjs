import assert from 'node:assert/strict';
globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://elio.example.test',SUPABASE_SERVICE_ROLE_KEY:'service',RESEND_BROADCAST_API_KEY:'marketing'})[n]}};
const {syncNewsletterContacts}=await import('../supabase/functions/email-worker/newsletter-contacts.ts');
const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,Math.min(ms,1),...args);
let local,contact,topics,calls,flags,checks=0;
function reset(){local={email:'reader@example.test',status:'subscribed',fresh_consent:true,contact_id:null};contact=null;topics=[{id:'elio',subscription:'opt_out'},{id:'tlb',subscription:'opt_out'}];calls=[];flags={};}
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url),body=options.body?JSON.parse(options.body):null,method=options.method||'GET';calls.push({path:u.pathname,method,body});
 if(u.hostname==='elio.example.test'){
  const action=body.p_action,p=body.p_payload;
  if(action==='newsletter_contact_claim')return Response.json(flags.busy?{busy:true}:{lease_token:'lease',topic_id:'elio',segment_id:'segment',rows:[{subscriber_id:'subscriber',version:1}]});
  if(action==='newsletter_contact_context')return Response.json(flags.stale?{stale:true}:local);
  if(action==='newsletter_contact_opt_out'){local.status='unsubscribed';flags.optOutRecorded=true;return Response.json({version:2});}
  if(action==='newsletter_contact_done'){flags.saved=p;return Response.json({recorded:true});}
  if(action==='newsletter_contact_error')flags.error=p.error;
  if(action==='newsletter_contact_release')flags.released=true;
  return Response.json({recorded:true});
 }
 assert.equal(u.hostname,'api.resend.com');assert.equal(options.headers.Authorization,'Bearer marketing');
 assert(!u.pathname.startsWith('/emails')&&!u.pathname.startsWith('/broadcasts'),'contact-only processing must not send any email');
 if(flags.denied)return Response.json({message:'Denied'},{status:403});
 if(u.pathname==='/contacts'&&method==='POST'){contact={id:'contact',email:body.email,unsubscribed:false};return Response.json({id:contact.id});}
 if(u.pathname.endsWith('/topics')){
  if(method==='PATCH'){for(const change of body){assert.equal(change.id,'elio');topics=topics.map(t=>t.id===change.id?change:t);}if(flags.failAfterOptIn)throw Error('Reply lost');return Response.json({id:'contact'});}
  return Response.json({data:topics,has_more:false});
 }
 if(u.pathname.endsWith('/segments/segment'))return Response.json({id:'contact'});
 if(method==='DELETE'){
  assert(!topics.some(t=>t.subscription==='opt_in'));contact=null;
  if(flags.deleteReplyLost){flags.deleteReplyLost=false;throw Error('Deletion acknowledgement lost');}
  return Response.json({deleted:true});
 }
 return contact?Response.json(contact):Response.json({message:'Missing'},{status:404});
};
async function check(name,fn){reset();await fn();checks++;console.log('PASS '+name);}
try{
 await check('New signup creates a contact and opts into Elio without a campaign',async()=>{
  const stats=await syncNewsletterContacts('fallback');assert.equal(stats.synced,1);assert.equal(flags.saved.contact_id,'contact');assert.equal(topics[0].subscription,'opt_in');assert.equal(topics[1].subscription,'opt_out');assert(calls.some(c=>c.path.endsWith('/segments/segment')&&c.method==='POST'));assert(flags.released);
 });
 await check('A subscriber already in TLB gains only Elio membership',async()=>{
  contact={id:'contact',email:local.email,unsubscribed:false};topics[1].subscription='opt_in';await syncNewsletterContacts('fallback');assert(!calls.some(c=>c.path==='/contacts'&&c.method==='POST'));assert(topics.every(t=>t.subscription==='opt_in'));
 });
 await check('Elio-only unsubscribe deletes the provider contact and retains local consent history',async()=>{
  local.status='unsubscribed';local.contact_id='contact';local.fresh_consent=false;contact={id:'contact',email:local.email,unsubscribed:false};topics[0].subscription='opt_in';const stats=await syncNewsletterContacts('fallback');assert.equal(stats.removed,1);assert.equal(contact,null);assert.equal(flags.saved.contact_id,null);assert.equal(local.status,'unsubscribed');
 });
 await check('An Elio unsubscribe retains a shared TLB contact and leaves its topic untouched',async()=>{
  local.status='unsubscribed';contact={id:'contact',email:local.email};topics.forEach(t=>t.subscription='opt_in');const stats=await syncNewsletterContacts('fallback');assert.equal(stats.retained,1);assert.equal(topics[0].subscription,'opt_out');assert.equal(topics[1].subscription,'opt_in');assert(!calls.some(c=>c.method==='DELETE'&&c.path==='/contacts/contact'));assert.equal(flags.saved.contact_id,'contact');
 });
 await check('Provider unsubscribe is saved locally before deletion and a lost reply never recreates the contact',async()=>{
  local.fresh_consent=false;local.contact_id='contact';contact={id:'contact',email:local.email};flags.deleteReplyLost=true;await syncNewsletterContacts('fallback');assert(flags.optOutRecorded);assert(flags.error);assert.equal(local.status,'unsubscribed');assert.equal(contact,null);await syncNewsletterContacts('fallback');assert.equal(flags.saved.contact_id,null);assert(!calls.some(c=>c.path==='/contacts'&&c.method==='POST'));
 });
 await check('A fresh rejoin restores only the Elio topic; routine synchronization never reverses an opt-out',async()=>{
  contact={id:'contact',email:local.email};await syncNewsletterContacts('fallback');assert.equal(topics[0].subscription,'opt_in');
  reset();local.fresh_consent=false;local.contact_id='contact';contact={id:'contact',email:local.email};topics[1].subscription='opt_in';await syncNewsletterContacts('fallback');assert.equal(local.status,'unsubscribed');assert.equal(topics[0].subscription,'opt_out');assert.equal(topics[1].subscription,'opt_in');
 });
 await check('Global unsubscribe is preserved even for an explicit new signup',async()=>{
  contact={id:'contact',email:local.email,unsubscribed:true};await syncNewsletterContacts('fallback');assert(flags.optOutRecorded);assert(!calls.some(c=>c.method==='PATCH'&&c.body.some(t=>t.subscription==='opt_in')));
 });
 await check('Provider failure remains retryable and cannot acknowledge incomplete topic enrollment',async()=>{
  flags.failAfterOptIn=true;assert.equal((await syncNewsletterContacts('fallback')).failed,1);assert(!flags.saved);flags.failAfterOptIn=false;assert.equal((await syncNewsletterContacts('fallback')).synced,1);assert.equal(calls.filter(c=>c.path==='/contacts'&&c.method==='POST').length,1);
 });
 await check('Stale consent and an active broadcast prevent membership writes',async()=>{
  flags.stale=true;await syncNewsletterContacts('fallback');assert(!calls.some(c=>c.path.startsWith('/contacts')));reset();flags.busy=true;assert.equal((await syncNewsletterContacts('fallback')).pending,true);assert(!calls.some(c=>c.path.startsWith('/contacts')));
 });
 console.log(`Passed ${checks} contact lifecycle checks; no real contacts or emails changed.`);
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;}
