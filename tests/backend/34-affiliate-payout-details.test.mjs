import assert from 'node:assert/strict';

export default async function({db,check,state}){
 const {api,ids,scalar}=state.h,{affiliate}=state.affiliate;
 const mine=(action,payload={})=>api(action,payload,ids.stranger);
 const current=async()=>(await mine('affiliate_dashboard')).payout_details;
 const owner=()=>api('affiliate_report',{id:affiliate.id},ids.owner);
 const gcash={revision:0,method:'gcash',account_name:'QA Partner',account_number:'+63 917-123-4567',bank_name:'Must not be retained'};
 let saved;
 await check('payout details are optional, private, and writable only by the assigned verified affiliate',async()=>{
  assert.equal(await current(),null);
  for(const role of ['anon','authenticated','service_role']){
   assert.equal(await scalar("select has_table_privilege($1,'elio.affiliate_payout_details','select,insert,update,delete')",[role]),false);
   assert.equal(await scalar("select has_function_privilege($1,'elio.affiliate_save_payout_details(jsonb)','execute')",[role]),false);
  }
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='elio.affiliate_payout_details'::regclass"),true);
  for(const user of [null,ids.unverified,ids.customer,ids.staff])await assert.rejects(api('affiliate_save_payout_details',gcash,user),/verified|assigned/i);
  await assert.rejects(mine('affiliate_save_payout_details',{...gcash,affiliate_id:affiliate.id}),/own affiliate/i);
  saved=await mine('affiliate_save_payout_details',gcash);
  assert.equal(saved.method,'gcash');assert.equal(saved.account_number,'09171234567');assert.equal(saved.bank_name,null);assert.equal(saved.revision,1);
  assert.deepEqual((await owner()).payout_details,saved);assert.deepEqual(await current(),saved);
  assert.equal((await api('affiliate_dashboard',{},ids.owner)).payout_details,null,'Another assigned affiliate must not see these details');
  for(const user of [ids.customer,ids.staff,ids.stranger])await assert.rejects(api('affiliate_report',{id:affiliate.id},user),/owner|authorized/);
  assert(!JSON.stringify(await api('affiliate_admin',{},ids.owner)).includes(saved.account_number));
  assert(!JSON.stringify(await api('affiliate_history',{id:affiliate.id},ids.owner)).includes(saved.account_number),'Audit must not copy payment account numbers');
 })();
 await check('payout details validate methods, account names, phone numbers and bank numbers without altering saved data',async()=>{
  for(const patch of [{method:'cash'},{account_name:''},{account_name:'A'},{account_name:'a'.repeat(121)},{account_number:'0917ABC4567'},{account_number:'0917'},{method:'bank_transfer',bank_name:'',account_number:'00123456'},{method:'bank_transfer',bank_name:'Bank',account_number:'12345'},{method:'bank_transfer',bank_name:'Bank',account_number:'12e34567'}])
   await assert.rejects(mine('affiliate_save_payout_details',{...gcash,revision:1,...patch}),/Choose|Enter/);
  assert.deepEqual(await current(),saved);
 })();
 await check('switching payout methods keeps one destination, preserves leading zeros and rejects stale updates',async()=>{
  const originalStats=(await mine('affiliate_dashboard')).stats;
  const bank={revision:1,method:'bank_transfer',account_name:'QA Bank Holder',account_number:'0012 3456-7890',bank_name:'Test Bank'};
  saved=await mine('affiliate_save_payout_details',bank);assert.equal(saved.account_number,'001234567890');assert.equal(saved.revision,2);assert.equal(saved.bank_name,'Test Bank');
  assert.deepEqual(await mine('affiliate_save_payout_details',bank),saved,'Exact retries are idempotent');
  await assert.rejects(mine('affiliate_save_payout_details',{...gcash,revision:1}),/changed/);
  saved=await mine('affiliate_save_payout_details',{...gcash,revision:2});assert.equal(saved.revision,3);assert.equal(saved.bank_name,null);
  assert.equal(await scalar('select count(*)::int from elio.affiliate_payout_details where affiliate_id=$1',[affiliate.id]),1);
  assert.deepEqual((await mine('affiliate_dashboard')).stats,originalStats,'Changing destination must not affect commissions/payments');
  assert.deepEqual((await owner()).payout_details,saved);
 })();
}
