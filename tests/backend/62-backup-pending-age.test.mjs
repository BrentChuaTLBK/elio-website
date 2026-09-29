import assert from 'node:assert/strict';
export default async function({db,check,state}){
 const h=state.h,status=()=>h.api('order_backup_status',{},h.ids.owner);
 await check('fresh backup requests after idle time do not report stale; oldest unsaved work ages correctly',async()=>{
  await db.query("update elio.order_backup_connection set enabled=true,last_error=null,lease_until=null,synced_revision=revision,last_success_at=now()-interval '2 hours'");
  const unchanged=await status();assert.equal(unchanged.state,'connected');assert.equal(unchanged.pending,false);assert.equal(unchanged.pending_since,null);
  await h.api('order_backup_sync_now',{},h.ids.owner);const fresh=await status();assert.equal(fresh.state,'connected');assert.equal(fresh.pending,true);assert(fresh.pending_since);
  await db.query("update elio.order_backup_connection set pending_since=now()-interval '16 minutes'");const stale=await status();assert.equal(stale.state,'stale');
  await h.api('order_backup_sync_now',{},h.ids.owner);assert.equal((await status()).pending_since,stale.pending_since,'Another request must not hide older pending work');
 })();
 await check('backup completion clears pending age; partial success starts a new window and failures retain the prior successful copy',async()=>{
  await db.query("update elio.order_backup_connection set synced_revision=revision-1,last_success_at=now()");const pending=await status();assert.equal(pending.pending,true);assert.equal(pending.state,'connected');
  await db.query('update elio.order_backup_connection set synced_revision=revision');const saved=await status();assert.equal(saved.pending_since,null);assert.equal(saved.pending,false);
  await h.api('order_backup_sync_now',{},h.ids.owner);await db.query("update elio.order_backup_connection set last_error='network'");const failed=await status();assert.equal(failed.state,'error');assert.equal(failed.last_success_at,saved.last_success_at);
  await db.query("update elio.order_backup_connection set last_error=null,last_success_at=null,pending_since=now()-interval '16 minutes'");assert.equal((await status()).state,'stale','First copy also alerts when no worker completes');
  await db.query('update elio.order_backup_connection set synced_revision=revision,last_success_at=now()');
 })();
}
