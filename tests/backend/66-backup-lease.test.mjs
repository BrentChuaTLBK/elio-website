import assert from 'node:assert/strict';
export default async function({db,check,state}){
 const h=state.h;let run;
 await check('backup checkpoints renew only a live matching lease and preserve pending changes',async()=>{
  await h.service('order_backup_connect',{user_id:h.ids.owner,spreadsheet_id:'isolated-lease-test-sheet-12345'});
  run=await h.service('order_backup_begin',{force:true});assert.deepEqual(run.proof_archive_revisions,{});
  await assert.rejects(h.api('order_backup_checkpoint',{lease_token:run.lease_token,revision:run.revision},h.ids.owner));
  await assert.rejects(h.service('order_backup_checkpoint',{lease_token:'11111111-1111-4111-8111-111111111111',revision:run.revision}),/expired/);
  await h.api('order_backup_sync_now',{},h.ids.owner);assert.deepEqual(await h.service('order_backup_checkpoint',{lease_token:run.lease_token,revision:run.revision}),{ok:true});
  assert.deepEqual(await h.service('order_backup_begin',{force:true}),{skipped:'busy'});
 })();
 await check('expired backup workers cannot revive or finish after replacement starts',async()=>{
  await db.exec("update elio.order_backup_connection set lease_until=clock_timestamp()-interval '1 second' where id");
  await assert.rejects(h.service('order_backup_checkpoint',{lease_token:run.lease_token,revision:run.revision}),/expired/);
  const replacement=await h.service('order_backup_begin',{force:true});assert.notEqual(replacement.lease_token,run.lease_token);
  await assert.rejects(h.service('order_backup_finish',{lease_token:run.lease_token,revision:run.revision}),/expired/);
  const before=await h.api('order_backup_status',{},h.ids.owner);
  const failed=await h.service('order_backup_finish',{lease_token:replacement.lease_token,revision:replacement.revision,error:'timeout'});assert.equal(failed.last_error,'timeout');assert.equal(failed.last_success_at,before.last_success_at);assert.equal(failed.pending,true);
  await h.api('order_backup_disconnect',{},h.ids.owner);
 })();
}
