import assert from 'node:assert/strict';
export default async function({db,check,state}){
 const {api,ids,scalar}=state.h;
 await check('Newsletter library returns only the active subscriber count and saved campaigns to owners',async()=>{
  for(const user of [null,ids.staff,ids.customer])await assert.rejects(()=>api('newsletter_admin',{view:'campaigns'},user),/owner/i);
  const before=await scalar('select count(*) from elio.newsletter_outbox');
  const summary=await api('newsletter_admin',{view:'campaigns'},ids.owner);
  assert.deepEqual(Object.keys(summary).sort(),['campaigns','counts']);assert.deepEqual(Object.keys(summary.counts),['subscribed']);
  assert.equal(summary.counts.subscribed,Number(await scalar("select count(*) from elio.newsletter_subscribers where status='subscribed'")));
  assert(summary.campaigns.length>0);assert(summary.campaigns.every(c=>c.id&&c.subject));
  assert.equal(await scalar('select count(*) from elio.newsletter_outbox'),before);
  const offers=await api('newsletter_admin',{offer_limit:1},ids.owner);assert(offers.settings);assert(offers.offer_counts);assert.equal(offers.offers.length,1);
 })();
}
