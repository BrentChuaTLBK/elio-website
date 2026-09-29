import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
import {accountingFixture} from './accounting-fixture.mjs';
export default async function({db,check,state}) {
 const h=state.h,{ids,api,scalar}=h;
 const options=[{label:'GCash',account_name:'Test Shop',account_number:'09170000001',note:''},{label:'Test Bank',account_name:'Test Shop',account_number:'001234567890',note:'Use your order ID as the reference.'},{label:'Another Bank',account_name:'Test Shop',account_number:'000987654321',note:''}];
 const saved=()=>scalar('select data from elio.settings where id');
 const save=async changes=>api('save_settings',{settings:{...await saved(),...changes}},ids.owner);
 await check('payment options require the owner, validate details and preserve leading zeroes',async()=>{
  for(const user of [null,ids.staff,ids.customer])await assert.rejects(api('save_settings',{settings:{payment_options:options}},user),/owner|sign in|verified|authorized/i);
  for(const payment_options of [null,{},[{label:'GCash',account_name:'Test',account_number:123}], [{label:'',account_name:'Test',account_number:'123'}], [{...options[0],label:'a\nb'}], [{...options[0],note:'a'.repeat(501)}],Array(21).fill(options[0])])await assert.rejects(save({payment_options}));
  await assert.rejects(save({payment_options:[],paused:false}),/at least one/i);
  const result=await save({payment_options:options,payment_note:'Pay only once.'});
  assert.deepEqual(result.payment_options,options);assert.match(result.payment_instructions,/001234567890/);assert.match(result.payment_instructions,/Pay only once/);
  for(const role of ['anon','authenticated','service_role'])for(const name of ['elio.validate_payment_options(jsonb)','elio.payment_options_text(jsonb,text)'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,name]),false);
 })();
 await check('new orders save payment cards and matching email instructions; later settings preserve existing orders',async()=>{
  const f=await accountingFixture(h);const o=await api('create_order',h.checkout(f.product,f.date),ids.customer);
  assert.deepEqual(o.payment_options,options);assert.equal(o.payment_note,'Pay only once.');assert.match(o.payment_instructions,/001234567890/);
  const stale=await saved(),expanded=[...options,{label:'Fourth method',account_name:'Another name',account_number:'000000000004',note:''}];
  await save({payment_options:expanded});const current=await saved();assert.equal(current.payment_options.length,4);assert(current.payment_options_revision>stale.payment_options_revision);
  await assert.rejects(api('save_settings',{settings:{...stale,payment_options:options.slice(0,1)}},ids.owner),/changed.*Refresh/i);
  const old=await h.order(o.id);assert.deepEqual(old.payment_options,options);assert.doesNotMatch(old.payment_instructions,/Fourth method/);
  const f2=await accountingFixture(h);const fresh=await api('create_order',h.checkout(f2.product,f2.date),ids.customer);assert.deepEqual(fresh.payment_options,expanded);assert.match(fresh.payment_instructions,/Fourth method\nAnother name\n000000000004/);
  const q=await scalar('select payload from elio.outbox where order_id=$1 and event_type=\'order_submitted\' limit 1',[fresh.id]);
  assert.equal(q.order.payment_instructions,fresh.payment_instructions);assert.match(renderEmail(q).text,/000000000004/);
  assert.deepEqual(q.order.payment_options,expanded);assert.match(renderEmail(q).html,/Choose one payment method/);assert.match(renderEmail(q).html,/Pay only once\./);
  const oldEmail=await scalar('select payload from elio.outbox where order_id=$1 and event_type=\'order_submitted\' limit 1',[o.id]);
  assert.doesNotMatch(renderEmail({...oldEmail,settings:await saved()}).text,/Fourth method|000000000004/);
  assert.match(renderEmail({...oldEmail,settings:await saved()}).html,/001234567890/);assert.doesNotMatch(renderEmail({...oldEmail,settings:await saved()}).html,/Fourth method|000000000004/);
 })();
 await check('recognized legacy methods migrate without changing account numbers or existing instructions',async()=>{
  const sql=await readFile(new URL('../../supabase/migrations/20260928055726_elio_payment_options.sql',import.meta.url),'utf8');
  const conversion=sql.slice(sql.indexOf('do $$\ndeclare s jsonb;'),sql.indexOf('do $$\ndeclare definition text;'));
  assert(conversion.length>500);const legacy='Accepted Payment Methods:\n\n'+options.map(o=>[o.label,o.account_name,o.account_number].join('\n')).join('\n\n');
  await db.exec('begin');
  try {
   await db.query("update elio.settings set data=(data-'payment_options'-'payment_note'-'payment_options_revision')||jsonb_build_object('payment_instructions',$1::text)",[legacy]);
   await db.exec(conversion);const migrated=await saved();assert.equal(migrated.payment_options.length,3);assert.equal(migrated.payment_instructions,legacy);assert.equal(migrated.payment_options[1].account_number,'001234567890');
   await db.query("update elio.settings set data=(data-'payment_options'-'payment_note'-'payment_options_revision')||'{\"payment_instructions\":\"Accepted Payment Methods: Call us for details\"}'::jsonb");
   await db.exec(conversion);assert.equal((await saved()).payment_options,undefined);
  } finally {await db.exec('rollback');}
 })();
}
