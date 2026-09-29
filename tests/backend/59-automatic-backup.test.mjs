import assert from 'node:assert/strict';
export default async function({db,check,state}){
 const h=state.h;let run;
 await check('only owners can manage Google backup and legacy setup keys are rejected',async()=>{
  for(const action of ['order_backup_status','order_backup_sync_now','order_backup_disconnect'])for(const user of [null,h.ids.customer,h.ids.staff])await assert.rejects(h.api(action,{},user),/owner|permission|sign in|authorized/i);
  await assert.rejects(h.api('order_backup_setup',{},h.ids.owner));await assert.rejects(h.service('order_backup_export',{token:'a'.repeat(64)}));
  await assert.rejects(h.service('order_backup_connect',{user_id:h.ids.staff,spreadsheet_id:'fake-sheet-reference-12345'}),/owner|permission/i);
  await h.service('order_backup_connect',{user_id:h.ids.owner,spreadsheet_id:'fake-sheet-reference-12345'});
 })();
 await check('Google backup leases prevent overlapping runs and preserve later changes',async()=>{
  run=await h.service('order_backup_begin',{});assert(run.snapshot.paid_orders.length>0);assert.deepEqual(await h.service('order_backup_begin',{}),{skipped:'busy'});
  await h.api('order_backup_sync_now',{},h.ids.owner);
  await h.service('order_backup_finish',{lease_token:run.lease_token,revision:run.revision,snapshot_at:run.snapshot.generated_at,active_count:run.snapshot.active_count,paid_history_count:run.snapshot.paid_history_count});
  assert.equal((await h.api('order_backup_status',{},h.ids.owner)).pending,true);
 })();
 await check('failed backups retain last success, unchanged data is skipped, and disconnect revokes leases',async()=>{
  const finish=async(error)=>{run=await h.service('order_backup_begin',{});return h.service('order_backup_finish',{lease_token:run.lease_token,revision:run.revision,snapshot_at:run.snapshot.generated_at,active_count:run.snapshot.active_count,paid_history_count:run.snapshot.paid_history_count,error});};
  const failed=await finish('quota');assert.equal(failed.state,'error');assert(failed.last_success_at);
  const passed=await finish(null);assert.equal(passed.state,'connected');assert.equal(passed.pending,false);assert.deepEqual(await h.service('order_backup_begin',{}),{skipped:'unchanged'});
  run=await h.service('order_backup_begin',{force:true});await h.api('order_backup_disconnect',{},h.ids.owner);await assert.rejects(h.service('order_backup_finish',{lease_token:run.lease_token}),/expired/);
  assert.deepEqual(await h.service('order_backup_begin',{}),{skipped:'disabled'});
 })();
}
