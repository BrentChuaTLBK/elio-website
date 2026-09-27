import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {renderNewsletterEmail} from '../../supabase/functions/_shared/newsletter-emails.ts';

export default async function({db,check,state}) {
 const {api,ids,scalar,service,as}=state.h;
 const get=()=>api('newsletter_settings');
 const save=(settings,user=ids.owner)=>api('newsletter_save_offer_settings',{settings},user);
 const subscribe=async email=>{await db.exec('delete from elio.newsletter_rate_limits');return service('newsletter_subscribe',{email,consent:true,consent_version:'elio-newsletter-v2-single-opt-in',source:'home_popup',ip_hash:createHash('sha256').update(randomUUID()).digest('hex')});};
 const row=email=>db.query('select s.*,p.data as offer from elio.newsletter_subscribers s join elio.promos p on p.id=s.promo_id where s.email=$1',[email]).then(r=>r.rows[0]);
 const emailPayload=email=>scalar("select payload from elio.newsletter_outbox where to_email=$1 and event_type='newsletter_welcome'",[email]);
 let original,oldRow,oldMail,updated;
 await check('Welcome policy is owner-only, strictly validated and rejects stale edits',async()=>{
  original=await get();
  for(const user of [null,ids.customer,ids.staff])await assert.rejects(()=>save(original,user),/owner/i);
  for(const user of [null,ids.customer,ids.owner])await assert.rejects(()=>as(user,()=>db.query('select * from elio.newsletter_offer_settings')),/permission denied/);
  for(const change of [{discount_percent:0},{discount_percent:101},{discount_percent:5.5},{discount_percent:'5'},{min_subtotal_cents:-1},{cap_cents:0},{expiry_days:0},{expiry_days:366},{revision:0}])await assert.rejects(()=>save({...original,...change}));
  assert.deepEqual(await get(),original);
  await subscribe('policy-old@example.test');oldRow=await row('policy-old@example.test');oldMail=await emailPayload('policy-old@example.test');
  updated=await save({...original,discount_percent:10,min_subtotal_cents:75000,cap_cents:15000,expiry_days:7});
  assert.equal(updated.revision,original.revision+1);await assert.rejects(()=>save(original),/changed/);
 })();
 await check('Offer changes update public copy and new codes while issued codes and queued emails stay frozen',async()=>{
  const published=await get();assert.equal(published.discount_percent,10);assert.equal(published.expiry_days,7);
  const admin=await api('newsletter_admin',{},ids.owner);assert.equal(admin.settings.cap_cents,15000);
  assert.deepEqual((await row(oldRow.email)).offer,oldRow.offer);assert.deepEqual((await row(oldRow.email)).offer_expires_at,oldRow.offer_expires_at);assert.deepEqual(await emailPayload(oldRow.email),oldMail);
  await subscribe('policy-new@example.test');const fresh=await row('policy-new@example.test');
  assert.equal(fresh.offer.value,10);assert.equal(fresh.offer.min_subtotal_cents,75000);assert.equal(fresh.offer.cap_cents,15000);
  assert.equal(await scalar('select extract(epoch from offer_expires_at-subscribed_at)::integer from elio.newsletter_subscribers where id=$1',[fresh.id]),7*86400);
  const mail=await emailPayload(fresh.email),render=renderNewsletterEmail(mail);assert.match(render.html,/10%/);assert.match(render.text,/₱750.00/);assert.match(render.text,/₱150.00/);assert.match(render.text,/exclusive promo codes/);
  assert.match(await scalar("select subject from elio.newsletter_outbox where subscriber_id=$1 and event_type='newsletter_welcome'",[fresh.id]),/10%/);
  await subscribe(oldRow.email);assert.deepEqual((await row(oldRow.email)).offer,oldRow.offer);
  const bootstrap=await api('admin_bootstrap',{},ids.owner);assert.equal(bootstrap.promos.some(p=>p.id===fresh.promo_id||p.id===oldRow.promo_id||p.newsletter_managed),false);
  for(const action of ['save_promo','delete_promo'])await assert.rejects(()=>api(action,action==='save_promo'?{promo:{...fresh.offer,value:99}}:{id:fresh.promo_id},ids.owner),/cannot be edited or deleted/);
  await save({...original,revision:updated.revision});
 })();
 await check('Newsletter layouts persist, escape content and freeze with the reviewed campaign',async()=>{
  const campaign={subject:'A note from Elio',title:'A little Elio <script>alert(1)</script>',body:'Our latest kitchen news.\n\nDiscover something lovely.',image_url:'https://example.test/box.webp',cta_label:'Explore Elio',cta_url:'https://example.test/order.html'};
  const htmls=[];
  for(const template of ['spotlight','offer','letter','editorial','invitation','digest']){
   const draft=await api('newsletter_save_campaign',{campaign:{...campaign,template}},ids.owner);assert.equal(draft.template,template);
   const payload=await api('newsletter_preview_campaign',{campaign:draft},ids.owner);const rendered=renderNewsletterEmail(payload);htmls.push(rendered.html);
   assert(!rendered.html.includes('<script>'));assert(rendered.html.includes('&lt;script&gt;'));assert.match(rendered.html,/ELIO/);
   if(template==='offer'){
    await api('newsletter_send_campaign',{campaign_id:draft.id,expected_revision:draft.revision,expected_recipient_count:payload.recipient_count},ids.owner);
    assert.equal(await scalar("select bool_and(payload#>>'{campaign,template}'='offer') from elio.newsletter_outbox where campaign_id=$1",[draft.id]),true);
    await assert.rejects(()=>api('newsletter_save_campaign',{campaign:{...draft,template:'letter'}},ids.owner),/Only draft/);
   }
  }
  assert.equal(new Set(htmls).size,6);assert.match(htmls[0],/The Elio collection/);assert.match(htmls[1],/Exclusively for our subscribers/);assert.match(htmls[2],/With care/);assert.match(htmls[3],/The Elio edit/);assert.match(htmls[4],/An invitation from Elio/);assert.match(htmls[5],/The Elio brief/);
  await assert.rejects(()=>api('newsletter_save_campaign',{campaign:{...campaign,template:'unsafe'}},ids.owner),/valid newsletter template/);
 })();
}
