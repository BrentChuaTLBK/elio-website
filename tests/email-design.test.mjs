import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderEmail} from '../supabase/functions/_shared/emails.ts';
import {productPhoto} from '../supabase/functions/_shared/email-design.ts';
const order={id:'order-id',reference:'ELIO-TEST',access_token:'private-order-token',buyer_name:'Test buyer',fulfillment_date:'2026-09-28',method:'pickup',payment_deadline:'2026-09-27T04:00:00Z',items:[{product_id:'box-id',name:'Box <test>',quantity:2,unit_price_cents:90000,line_total_cents:180000,flavor_contents:[{name:'Vanilla',quantity:2},{name:'Matcha',quantity:1}]}],subtotal_cents:180000,discount_cents:10000,delivery_cents:0,total_cents:170000};
const settings={site_url:'https://eliocheesecakes.com',pickup_address:'Saved pickup address',pickup_hours:'10am–8pm',contact_email:'elio.cheesecakes@gmail.com',payment_instructions:'Saved payment instructions'};
const site=new URL(settings.site_url+'/');
let checks=0;
for(const event_type of ['order_submitted','payment_approved','payment_rejected','order_cancelled','order_expired','fulfillment_reminder','ready_for_pickup','out_for_delivery','order_updated','order_review_required']){
 const {html,text}=renderEmail({event_type,order,settings,product_photos:{'box-id':'assets/box.webp'}});
 assert(html.includes('bgcolor="#3d251c"'));
 assert(html.includes('src="https://eliocheesecakes.com/assets/box.webp"'));
 assert(html.includes('alt="Box &lt;test&gt;"'));
 assert(html.includes('Vanilla × 2')&&html.includes('Matcha × 1'));
 assert(html.includes('₱1,700.00')&&text.includes('₱1,700.00'));
 assert.equal(html.includes('order.html#order='),event_type!=='order_review_required');
 if(event_type==='order_review_required')assert(!html.includes('private-order-token'));
 else assert(html.includes('token=private-order-token'));
 checks++;
}
for(const bad of ['javascript:alert(1)','data:image/png;base64,x','http://example.test/photo.jpg','https://user:pass@example.test/photo.jpg','//example.test/photo.jpg'])assert.equal(productPhoto(order.items[0],{'box-id':bad},site),'');
assert.equal(productPhoto(order.items[0],{},site),'');
assert.equal(productPhoto(order.items[0],{'box-id':'https://cdn.example.test/photo.webp'},site),'https://cdn.example.test/photo.webp');
assert(!renderEmail({event_type:'payment_approved',order,settings}).html.includes('<img'));
checks++;
const manifest=JSON.parse(await readFile(new URL('../supabase/templates/manifest.json',import.meta.url),'utf8'));
for(const entry of manifest){const html=await readFile(new URL('../supabase/templates/'+entry.file,import.meta.url),'utf8');assert(html.includes('bgcolor="#3d251c"'));assert.equal((html.match(/<h1 /g)||[]).length,1);if(['confirmation','recovery','invite','magic_link','email_change'].includes(entry.key))assert.equal((html.match(/\{\{ \.ConfirmationURL \}\}/g)||[]).length,2);if(entry.key==='reauthentication')assert(html.includes('{{ .Token }}'));assert(!html.includes('preview-only'));checks++;}
console.log(`Passed ${checks} email design checks: all events, image safety, missing photos, and account template variables.`);
