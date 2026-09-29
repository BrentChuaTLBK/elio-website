import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderNewsletterEmail} from '../../supabase/functions/_shared/newsletter-emails.ts';
export default async function({db,check,state}){
 const {api,ids,as,scalar}=state.h;
 const terms={trigger:'first_completed',kind:'fixed',value:5000,min_subtotal_cents:50000,cap_cents:null,customer_limit:1,expiry_mode:'days',expiry_days:30};
 const draft={name:'A little thank-you <script>',terms};
 await check('Campaign subjects validate, round-trip, and survive saves from older clients',async()=>{
  const save=campaign=>api('voucher_save_campaign',{campaign},ids.owner);
  for(const subject of ['', '   ', 'x'.repeat(201), 'Hello\r\nBcc: other@example.test', 'Hello\tworld']){
   await assert.rejects(()=>save({...draft,email_subject:subject}),/email subject/);
   await assert.rejects(()=>api('voucher_email_preview',{campaign:{...draft,email_subject:subject}},ids.owner),/email subject/);
  }
  await assert.rejects(()=>as(ids.owner,()=>db.query("select elio.voucher_email_subject('test')")),/permission denied/);
  let saved=await save({...draft,email_subject:'  Here’s ₱50 for your next Elio box 🍰  '});
  assert.equal(saved.email_subject,'Here’s ₱50 for your next Elio box 🍰');
  assert.equal((await api('voucher_email_preview',{id:saved.id},ids.owner)).subject,saved.email_subject);
  assert.equal((await api('voucher_campaigns',{},ids.owner)).campaigns.find(c=>c.id===saved.id).email_subject,saved.email_subject);
  const oldClient={...saved};delete oldClient.email_subject;
  saved=await save(oldClient);assert.equal(saved.email_subject,'Here’s ₱50 for your next Elio box 🍰');
  const boundary=await save({...saved,email_subject:'x'.repeat(200)});assert.equal(boundary.email_subject.length,200);
 })();
 await check('Email copy validates, previews safely, and preserves older-client edits',async()=>{
  const save=campaign=>api('voucher_save_campaign',{campaign},ids.owner);
  const copy={eyebrow:'For our Elio friends',heading:'Enjoy {{discount}} — <sweet>!',message:'Thanks for choosing Elio.\nEnjoy {{discount}} next time.\n\n<script>Keep this as text</script>'};
  for(const invalid of [null,'bad',{heading:''},{eyebrow:'x'.repeat(121)},{heading:'x'.repeat(201)},{message:'x'.repeat(4001)},{message:' \n '},{heading:'Line\n2'},{message:'Bad\tcontrol'},{message:123}]){
   await assert.rejects(()=>save({...draft,email_copy:invalid}));
   await assert.rejects(()=>api('voucher_email_preview',{campaign:{...draft,email_copy:invalid}},ids.owner));
  }
  await assert.rejects(()=>as(ids.owner,()=>db.query("select elio.voucher_email_copy('{}')")),/permission denied/);
  let saved=await save({...draft,email_copy:copy});assert.deepEqual(saved.email_copy,copy);
  const sample=await api('voucher_email_preview',{id:saved.id},ids.owner),rendered=renderNewsletterEmail(sample);
  assert.match(rendered.html,/For our Elio friends/);assert.match(rendered.html,/Enjoy ₱50.00 — &lt;sweet&gt;!/);assert.match(rendered.html,/Elio.<br>Enjoy ₱50.00/);assert.match(rendered.html,/&lt;script&gt;/);assert(!rendered.html.includes('<script>'));
  assert.match(rendered.text,/\n\n<script>Keep this as text<\/script>/);assert.match(rendered.text,/Minimum product spend: ₱500.00/);assert.match(rendered.text,/ELIO-PREVIEW/);
  const customized=await api('voucher_email_preview',{campaign:{...saved,email_copy:{...copy,heading:'A gift for you'},terms:{...terms,kind:'percent',value:10,cap_cents:10000}}},ids.owner);
  assert.match(renderNewsletterEmail(customized).text,/10% off products/);assert.match(renderNewsletterEmail(customized).text,/Maximum discount: ₱100.00/);
  const oldClient={...saved};delete oldClient.email_copy;saved=await save(oldClient);assert.deepEqual(saved.email_copy,copy);
  const normalized=await save({...saved,email_copy:{...copy,message:'Line one\r\nLine two'}});assert.equal(normalized.email_copy.message,'Line one\nLine two');
 })();
 const totals=()=>scalar("select jsonb_build_object('promos',(select count(*) from elio.promos),'vouchers',(select count(*) from elio.vouchers),'emails',(select count(*) from elio.newsletter_outbox),'campaigns',(select count(*) from elio.voucher_campaigns))");
 await check('Email preview is owner-only and validates saved or unsaved campaign terms',async()=>{
  for(const who of [null,ids.staff,ids.customer])await assert.rejects(()=>api('voucher_email_preview',{campaign:draft},who),/owner/i);
  await assert.rejects(()=>as(ids.owner,()=>db.query("select elio.voucher_email_preview('{}')")),/permission denied/);
  await assert.rejects(()=>api('voucher_email_preview',{id:randomUUID()},ids.owner),/Choose a campaign/);
  await assert.rejects(()=>api('voucher_email_preview',{campaign:{...draft,terms:{...terms,value:-1}}},ids.owner));
  await assert.rejects(()=>api('voucher_email_preview',{campaign:{...draft,terms:{...terms,expiry_mode:'fixed',expires_at:'infinity'}}},ids.owner),/valid expiry/);
 })();
 await check('Email previews use the actual voucher renderer without issuing codes or changing campaigns',async()=>{
  const saved=await api('voucher_save_campaign',{campaign:draft},ids.owner),before=await totals();
  const sample=await api('voucher_email_preview',{id:saved.id},ids.owner);
  assert.equal(sample.offer.code,'ELIO-PREVIEW');assert.equal(sample.subscriber.email,'preview@example.test');
  assert.equal(sample.subject,'A little thank-you from Elio · your next-order voucher');
  assert(Math.abs(Date.parse(sample.offer.expires_at)-Date.now()-30*86400000)<5000);
  const rendered=renderNewsletterEmail(sample);assert.match(rendered.text,/₱50.00/);assert.match(rendered.text,/₱500.00/);assert.match(rendered.html,/&lt;script&gt;/);assert(!rendered.html.includes('<script>'));assert.match(rendered.html,/unsubscribe links are disabled/);
  const changed={...saved,name:'Unsaved changes',email_subject:'Something sweet for you 🍰',terms:{...terms,kind:'percent',value:10,cap_cents:10000,min_subtotal_cents:0,expiry_mode:'fixed',expires_at:'2030-10-30T12:00:00+08:00'}};
  const other=await api('voucher_email_preview',{campaign:changed},ids.owner),email=renderNewsletterEmail(other);
  assert.equal(other.subject,'Something sweet for you 🍰');assert.equal((await api('voucher_email_preview',{id:saved.id},ids.owner)).subject,sample.subject);
  assert.equal(other.title,'Unsaved changes');assert.match(email.text,/10%/);assert.match(email.text,/₱100.00/);assert.match(email.text,/Oct 30, 2030, 12:00 PM/);
  assert.equal((await api('voucher_email_preview',{id:saved.id},ids.owner)).offer.value,5000);
  assert.deepEqual(await totals(),before);assert.equal(await scalar('select revision from elio.voucher_campaigns where id=$1',[saved.id]),1);
 })();
}
