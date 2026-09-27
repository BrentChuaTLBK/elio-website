import assert from 'node:assert/strict';
export default async function({db,check,state}){
 const {api,ids,scalar}=state.h;
 await check('staff can acknowledge email alerts without changing delivery state; acknowledgement persists and new failures resurface',async()=>{
  const row=(await db.query("select id from elio.outbox order by created_at desc limit 1")).rows[0];assert(row);
  await db.query("update elio.outbox set status='skipped',last_error='Order no longer needs payment review.',attempts=1 where id=$1",[row.id]);
  const payload={id:row.id,status:'skipped',attempts:1,last_error:'Order no longer needs payment review.'};
  for(const user of [null,ids.customer,ids.unverified])await assert.rejects(api('review_email_alert',payload,user),/authorized|staff/i);
  await assert.rejects(api('review_email_alert',{...payload,attempts:0},ids.owner),/changed/i);
  assert.equal((await api('review_email_alert',payload,ids.staff)).reviewed,true);
  const first=await scalar('select reviewed_at from elio.outbox where id=$1',[row.id]);assert(first);
  await api('review_email_alert',payload,ids.owner);assert.equal(String(await scalar('select reviewed_at from elio.outbox where id=$1',[row.id])),String(first));
  assert.equal(await scalar('select reviewed_by from elio.outbox where id=$1',[row.id]),ids.staff);
  assert.equal(await scalar('select status from elio.outbox where id=$1',[row.id]),'skipped');
  assert((await api('admin_bootstrap',{},ids.owner)).email_status.find(r=>r.id===row.id).reviewed_at);
  await db.query("update elio.outbox set status='failed',last_error='New provider error',attempts=2 where id=$1",[row.id]);
  assert.equal(await scalar('select reviewed_at from elio.outbox where id=$1',[row.id]),null);
  await assert.rejects(api('review_email_alert',payload,ids.owner),/changed/i);
  await db.query("update elio.outbox set status='sent',last_error=null where id=$1",[row.id]);
  await assert.rejects(api('review_email_alert',payload,ids.owner),/no longer/i);
  assert.equal(await scalar("select has_function_privilege('authenticated','elio.review_email_alert(jsonb)','execute')"),false);
 })();
}
