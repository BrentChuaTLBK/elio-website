import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const {api,service,ids,scalar,as}=state.h;
 const segment=randomUUID(),topic=randomUUID();
 let draft,lease,job,recipientEmails,second;
 const action=(name,p={})=>service('newsletter_broadcast_'+name,{...lease,...p});
 const campaign={subject:'Broadcast integration check',title:'From Elio',body:'A reviewed newsletter.',template:'editorial'};
 const queue=async()=>{
  const d=await api('newsletter_save_campaign',{campaign},ids.owner);
  const count=Number(await scalar("select count(*) from elio.newsletter_subscribers where status='subscribed'"));
  await api('newsletter_send_campaign',{campaign_id:d.id,expected_revision:d.revision,expected_recipient_count:count},ids.owner);
  return d;
 };
 await check('Broadcast state is private and campaigns never enter the transactional claim',async()=>{
  for(const user of [null,ids.customer,ids.staff]) {
   await assert.rejects(()=>as(user,()=>db.query('select * from elio.newsletter_broadcasts')),/permission denied/);
   await assert.rejects(()=>as(user,()=>db.query("select elio.newsletter_broadcast_dispatch('newsletter_broadcast_claim','{}')")),/permission denied/);
  }
  assert.equal(await scalar("select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='elio' and c.relname in ('newsletter_broadcasts','newsletter_broadcast_runtime','newsletter_resend_contacts')"),true);
  assert.equal((await service('newsletter_broadcast_claim')).configured,false);
  // Isolate local fixtures; this suite never connects to a production database.
  await db.exec("update elio.newsletter_broadcasts set status='cancelled'; update elio.newsletter_outbox set status='skipped' where status in ('pending','sending')");
  await db.query('update elio.newsletter_broadcast_runtime set segment_id=$1,topic_id=$2',[segment,topic]);
  draft=await queue();second=await queue();
  const claims=await service('newsletter_claim_emails',{limit:10});
  assert.equal(claims.filter(r=>r.payload.event_type==='newsletter_campaign').length,0);
 })();
 await check('Only one campaign owns the Resend segment and stale workers cannot mutate it',async()=>{
  const claim=await service('newsletter_broadcast_claim');job=claim.job;lease={campaign_id:job.campaign_id,lease_token:claim.lease_token};
  assert.equal(job.campaign_id,draft.id);assert.equal((await service('newsletter_broadcast_claim')).busy,true);
  await assert.rejects(()=>action('context',{lease_token:randomUUID()}),/stale/);
  await assert.rejects(()=>action('contact',{subscriber_id:randomUUID(),contact_id:randomUUID()}),/outside/);
  assert(job.recipients.length>1);
  recipientEmails=job.recipients.map(r=>r.email);
  for(const r of job.recipients)await action('contact',{subscriber_id:r.id,contact_id:randomUUID()});
 })();
 await check('Broadcast content and identity freeze before sending, and consent is checked again',async()=>{
  const body={segment_id:segment,topic_id:topic,send:false,html:'<p>reviewed</p>',text:'reviewed'};
  await assert.rejects(()=>action('payload',{provider_payload:{...body,segment_id:randomUUID()}}),/Invalid broadcast/);
  job=await action('payload',{provider_payload:body});assert.deepEqual(job.provider_payload,body);
  job=await action('payload',{provider_payload:{...body,text:'changed'}});assert.deepEqual(job.provider_payload,body);
  const provider=randomUUID();job=await action('created',{provider_id:provider});
  await assert.rejects(()=>action('created',{provider_id:randomUUID()}),/cannot change/);
  const leaving=job.recipients[0];await db.query('select elio.newsletter_unsubscribe($1)',[leaving.id]);
  await assert.rejects(()=>action('begin_send',{emails:recipientEmails}),/recipients changed/);
  job=await action('context');assert(!job.recipients.some(r=>r.id===leaving.id));
  job=await action('begin_send',{emails:job.recipients.map(r=>r.email)});assert.equal(job.status,'submitting');
  await assert.rejects(()=>action('contact',{subscriber_id:job.recipients[0].id,contact_id:randomUUID()}),/outside/);
  assert.equal(await scalar('select checked_at from elio.newsletter_resend_contacts where subscriber_id=$1',[leaving.id]).then(v=>new Date(v).getTime()),0);
 })();
 await check('Retries retain the same broadcast and hold the segment until sending finishes',async()=>{
  const provider=job.provider_id;
  await action('release');const retry=await service('newsletter_broadcast_claim');
  assert.equal(retry.job.campaign_id,draft.id);assert.equal(retry.job.provider_id,provider);assert.equal(retry.job.status,'submitting');
  lease={campaign_id:draft.id,lease_token:retry.lease_token};
  await action('status',{status:'queued'});await action('release');
  const again=await service('newsletter_broadcast_claim');assert.equal(again.job.campaign_id,draft.id);
  lease={campaign_id:draft.id,lease_token:again.lease_token};await action('status',{status:'sent'});await action('release');
  const report=await api('newsletter_admin',{view:'campaigns'},ids.owner);
  assert.equal(report.campaigns.find(c=>c.id===draft.id).broadcast.status,'sent');
  assert.equal(report.campaigns.find(c=>c.id===draft.id).broadcast.id,provider);
  const next=await service('newsletter_broadcast_claim');assert.equal(next.job.campaign_id,second.id);
  lease={campaign_id:second.id,lease_token:next.lease_token};await action('release');
 })();
 await check('Provider opt-outs update local consent without modifying welcome-code terms',async()=>{
  const row=(await db.query('select * from elio.newsletter_resend_contacts limit 1')).rows[0];
  const before=await scalar('select promo_id from elio.newsletter_subscribers where id=$1',[row.subscriber_id]);
  await service('newsletter_broadcast_contact_checked',{subscriber_id:row.subscriber_id,unsubscribed:true});
  assert.equal(await scalar('select status from elio.newsletter_subscribers where id=$1',[row.subscriber_id]),'unsubscribed');
  assert.equal(await scalar('select promo_id from elio.newsletter_subscribers where id=$1',[row.subscriber_id]),before);
 })();
}
