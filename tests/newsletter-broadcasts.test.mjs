import assert from 'node:assert/strict';
const vars={SUPABASE_URL:'https://elio.example.test',SUPABASE_SERVICE_ROLE_KEY:'service',RESEND_API_KEY:'transactional'};
globalThis.Deno={env:{get:name=>vars[name]}};
const {deliverBroadcasts,checkBroadcastConfiguration}=await import('../supabase/functions/email-worker/newsletter-broadcasts.ts');
const {renderNewsletterEmail}=await import('../supabase/functions/_shared/newsletter-emails.ts');
const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,Math.min(ms,1),...args);
const segment='segment',topic='topic',contactId='contact';
let state,calls,job,members,remote,checks=0;
const sample={event_type:'newsletter_campaign',campaign:{subject:'Elio news',title:'A little Elio',body:'Our latest flavors',template:'editorial'},settings:{site_url:'https://eliocheesecakes.com',newsletter_mailing_address:'Test address'}};
const reset=()=>{
 state={};calls=[];members=[];remote=null;
 job={campaign_id:'campaign',status:'preparing',provider_id:null,provider_payload:null,payload:structuredClone(sample),recipients:[{id:'subscriber',email:'reader@example.test',synced:false,contact_id:contactId,contact_ready:true}]};
};
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url),body=options.body?JSON.parse(options.body):null;
 calls.push({path:u.pathname,method:options.method||'GET',body,auth:options.headers?.Authorization});
 if(u.hostname==='elio.example.test'){
  const action=body.p_action,p=body.p_payload;
  if(action==='newsletter_broadcast_config')return Response.json({segment_id:segment,topic_id:topic});
  if(action==='newsletter_broadcast_contacts')return Response.json(state.preferenceRows||[]);
  if(action==='newsletter_broadcast_contact_checked'){state.preference=p;return Response.json({recorded:true});}
  if(action==='newsletter_broadcast_claim')return Response.json(state.idle?{idle:true}:state.busy?{busy:true}:{lease_token:'lease',segment_id:segment,topic_id:topic,job});
  if(action==='newsletter_broadcast_contact'){
   if(p.unsubscribed)job.recipients=job.recipients.filter(r=>r.id!==p.subscriber_id);
   else job.recipients=job.recipients.map(r=>r.id===p.subscriber_id?{...r,synced:true,contact_id:p.contact_id}:r);
  }
  if(action==='newsletter_broadcast_payload')job.provider_payload||=p.provider_payload;
  if(action==='newsletter_broadcast_created'){if(state.loseCreationAck)return Response.json({},{status:500});job.provider_id=p.provider_id;}
  if(action==='newsletter_broadcast_begin_send'){
   if(state.consentChanged)return Response.json({},{status:400});
   assert.deepEqual(p.emails,['reader@example.test']);job.status='submitting';
  }
  if(action==='newsletter_broadcast_status'){job.status=p.status;state.status=p.status;}
  if(action==='newsletter_broadcast_error')state.error=p.error;
  if(action==='newsletter_broadcast_release')state.released=true;
  return Response.json(job);
 }
 assert.equal(u.hostname,'api.resend.com');assert(!u.pathname.startsWith('/emails'),'campaign must not use the transactional API');
 if(state.denied)return Response.json({message:'not allowed'},{status:403});
 if(u.pathname==='/broadcasts'&&options.method==='POST'){
  assert.equal(body.send,false);assert.equal(body.segment_id,segment);assert.equal(body.topic_id,topic);
  assert(body.name.length<=70,'Provider campaign name must fit its 70-character limit');
  assert.equal(body.from,'Elio Newsletter <news@eliocheesecakes.com>');assert.match(body.html,/\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  remote={...body,id:'broadcast',status:'draft'};return Response.json({id:remote.id});
 }
 if(u.pathname==='/broadcasts/broadcast/send'){
  state.sends=(state.sends||0)+1;remote.status=state.queued?'queued':'sent';
  if(state.sendTimeout)throw Error('Connection lost after acceptance');
  return Response.json({id:'broadcast'});
 }
 if(u.pathname==='/broadcasts/broadcast')return Response.json({...remote,...(state.modified?{subject:'Modified in Resend'}:{})});
 if(u.pathname==='/segments/segment/contacts')return Response.json({data:members,has_more:false});
 if(u.pathname.startsWith('/contacts/')&&u.pathname.endsWith('/topics')){
  if(options.method==='PATCH'){state.topicPatch=body;return Response.json({id:contactId});}
  return Response.json({data:[{id:topic,subscription:state.optout?'opt_out':'opt_in'}],has_more:false});
 }
 if(u.pathname.endsWith('/segments/segment')){
  const id=u.pathname.split('/')[2];
  if(options.method==='DELETE')members=members.filter(m=>m.id!==id);
  else if(!members.some(m=>m.id===id))members.push({id,email:'reader@example.test',unsubscribed:false});
  return Response.json({id});
 }
 if(u.pathname.startsWith('/contacts/'))return Response.json({id:contactId,email:'reader@example.test',unsubscribed:!!state.globalOptout});
 return Response.json({data:[],id:'check',has_more:false});
};
async function check(name,fn){reset();await fn();console.log('PASS '+name);checks++;}
try{
 await check('Long subjects and emoji fit the provider campaign-name limit without changing the email subject',async()=>{
  job.campaign_id='0926e205-7497-47d7-9c7a-59d41ad95888';
  job.payload.campaign.subject='Your special Elio offer '+ '🍰'.repeat(60);
  const subject=job.payload.campaign.subject;assert.equal((await deliverBroadcasts('key')).accepted,1);
  assert.equal(remote.subject,subject);assert(remote.name.length<=70);assert(!/[\uD800-\uDBFF]$/.test(remote.name));
 });
 await check('Campaigns create a frozen draft, persist its identity and send using only Broadcasts',async()=>{
  const result=await deliverBroadcasts('key');assert.equal(result.accepted,1);assert.equal(state.sends,1);assert.equal(state.status,'sent');assert(state.released);
  assert(calls.findIndex(c=>c.body?.p_action==='newsletter_broadcast_created')<calls.findIndex(c=>c.path.endsWith('/send')));
  assert(!calls.some(c=>c.body?.to));
 });
 await check('Only the reviewed audience is included; unrelated segment membership is removed without deleting contacts',async()=>{
  members=[{id:'other',email:'another-brand@example.test'}];await deliverBroadcasts('key');
  assert(calls.some(c=>c.path==='/contacts/other/segments/segment'&&c.method==='DELETE'));
  assert(!calls.some(c=>c.path==='/contacts/other'&&c.method==='DELETE'));
  assert.deepEqual(members.map(m=>m.email),['reader@example.test']);
 });
 await check('Global and previously registered topic opt-outs never get reactivated',async()=>{
  state.globalOptout=true;await deliverBroadcasts('key');assert(!state.sends);assert.equal(state.status,'cancelled');assert(!state.topicPatch);
  reset();job.recipients[0].contact_id=contactId;state.optout=true;await deliverBroadcasts('key');assert(!state.sends);assert(!state.topicPatch);
 });
 await check('Campaign waits for signup synchronization and cannot grant topic consent',async()=>{
  job.recipients[0].contact_ready=false;const result=await deliverBroadcasts('key');assert(result.pending);assert(!state.sends);assert(!state.topicPatch);
 });
 await check('Consent changes after segment synchronization prevent send',async()=>{
  state.consentChanged=true;await deliverBroadcasts('key');assert(!state.sends);assert(state.error);assert.equal(job.status,'preparing');
 });
 await check('A send timeout resumes the same broadcast without a second send or draft',async()=>{
  state.sendTimeout=true;await deliverBroadcasts('key');assert.equal(job.status,'submitting');assert.equal(state.sends,1);
  state.sendTimeout=false;const before=calls.filter(c=>c.path==='/broadcasts'&&c.method==='POST').length;
  await deliverBroadcasts('key');assert.equal(state.sends,1);assert.equal(job.status,'sent');assert.equal(calls.filter(c=>c.path==='/broadcasts'&&c.method==='POST').length,before);
 });
 await check('Losing draft acknowledgement never sends an unrecorded broadcast',async()=>{
  state.loseCreationAck=true;await deliverBroadcasts('key');assert(!state.sends);assert.equal(job.provider_id,null);assert.equal(remote.status,'draft');
 });
 await check('Queued broadcasts retain the audience and do not synchronize or send again',async()=>{
  state.queued=true;await deliverBroadcasts('key');assert.equal(job.status,'queued');const before=calls.length;
  await deliverBroadcasts('key');assert.equal(state.sends,1);assert(!calls.slice(before).some(c=>c.path.includes('/segments/')&&c.method!=='GET'));
 });
 await check('Resend edits and insufficient key permissions fail closed without transactional fallback',async()=>{
  state.modified=true;await deliverBroadcasts('key');assert(!state.sends);assert.match(state.error,/content changed/);
  reset();state.denied=true;await deliverBroadcasts('key');assert(!state.sends);assert.match(state.error,/full access/);
 });
 await check('Marketing key and read-only configuration check cannot send or mutate contacts',async()=>{
  vars.RESEND_BROADCAST_API_KEY='marketing-key';try{assert.equal((await checkBroadcastConfiguration('regular-key')).configured,true);assert(calls.filter(c=>c.path.startsWith('/segments')||c.path.startsWith('/topics')||c.path.startsWith('/broadcasts')).every(c=>c.method==='GET'&&c.auth==='Bearer marketing-key'));}finally{delete vars.RESEND_BROADCAST_API_KEY;}
 });
 await check('All six branded layouts include Resend unsubscribe placeholders in HTML and text',async()=>{
  for(const template of ['spotlight','offer','letter','editorial','invitation','digest']){
   const message=renderNewsletterEmail({...sample,broadcast:true,campaign:{...sample.campaign,template}});
   assert(message.html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));assert(message.text.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));assert(message.html.includes('#3d251c'));assert(!message.html.includes('unsubscribe='));
  }
 });
 console.log(`Passed ${checks} Broadcast transport checks; no real emails sent.`);
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;}
