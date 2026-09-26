import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderEmail} from '../supabase/functions/_shared/emails.ts';
import {productPhoto} from '../supabase/functions/_shared/email-design.ts';
const order={id:'order-id',reference:'ELIO-TEST',access_token:'private-order-token',buyer_name:'Test buyer',fulfillment_date:'2026-09-28',method:'pickup',payment_deadline:'2026-09-27T04:00:00Z',items:[{product_id:'box-id',name:'Box <test>',quantity:2,unit_price_cents:90000,line_total_cents:180000,flavor_contents:[{name:'Vanilla',quantity:2},{name:'Matcha',quantity:1}]}],subtotal_cents:180000,discount_cents:10000,delivery_cents:0,total_cents:170000};
const settings={site_url:'https://eliocheesecakes.com',pickup_address:'Saved pickup address',pickup_hours:'10am–8pm',contact_email:'elio.cheesecakes@gmail.com',payment_instructions:'Saved payment instructions'};
const site=new URL(settings.site_url+'/');
let checks=0;
for(const event_type of ['order_submitted','payment_approved','payment_rejected','order_cancelled','order_expired','fulfillment_reminder','ready_for_pickup','pickup_reminder','out_for_delivery','order_updated','delivery_tracking_updated','order_review_required']){
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
const trackingUrl='https://tracking.example.test/order/ELIO-TEST?courier=grab&view=live';
const deliveryOrder={...order,method:'delivery',delivery_tracking_url:trackingUrl};
for(const event_type of ['order_submitted','payment_approved','out_for_delivery','fulfillment_reminder','order_updated']){
 const tracked=renderEmail({event_type,order:deliveryOrder,settings});
 assert(tracked.html.includes('href="https://tracking.example.test/order/ELIO-TEST?courier=grab&amp;view=live"'));
 assert(tracked.html.includes('Track your delivery')&&tracked.text.includes('Track your delivery:\n'+trackingUrl));
 const noTracking=renderEmail({event_type,order:{...deliveryOrder,delivery_tracking_url:null},settings});
 assert(!noTracking.html.includes('Track your delivery')&&!noTracking.text.includes(trackingUrl));
 const pickup=renderEmail({event_type,order:{...deliveryOrder,method:'pickup'},settings});
 assert(!pickup.html.includes(trackingUrl)&&!pickup.html.includes('Track your delivery')&&!pickup.text.includes(trackingUrl));
 checks++;
}
for(const [tracking_change,heading] of [['added','Your delivery tracking is ready'],['replaced','Your delivery tracking has been updated'],['removed','Your delivery tracking link has been removed']]){
 const old='https://old-tracking.example.test/private-old-link';
 const rendered=renderEmail({event_type:'delivery_tracking_updated',tracking_change,tracking_url:tracking_change==='removed'?null:trackingUrl,previous_tracking_url:tracking_change==='added'?null:old,order:{...deliveryOrder,delivery_tracking_url:tracking_change==='removed'?null:trackingUrl},settings,product_photos:{'box-id':'assets/box.webp'}});
 assert(rendered.html.includes(heading)&&rendered.text.includes(heading));
 assert(!rendered.html.includes(old)&&!rendered.text.includes(old));
 assert(rendered.html.includes('src="https://eliocheesecakes.com/assets/box.webp"'));
 assert(rendered.html.includes('Vanilla × 2')&&rendered.html.includes('₱1,700.00'));
 assert.equal(rendered.html.includes('Track your delivery'),tracking_change!=='removed');
 assert(rendered.html.includes('order.html#order=')&&rendered.text.includes('token=private-order-token'));
 checks++;
}
for(const bad of ['javascript:alert(1)','data:text/html,unsafe','//tracking.example.test/order','/track/order','https://user:pass@tracking.example.test/order','https://tracking.example.test/\nunsafe','https://tracking.example.test/%0aunsafe','https://tracking.example.test/%7funsafe','https://','https://tracking.example.test/unsafe path','https://tracking.example.test/unsafe\\path','https://tracking.example.test/'+ 'x'.repeat(2048)]){
 const rendered=renderEmail({event_type:'delivery_tracking_updated',tracking_change:'added',tracking_url:bad,order:{...deliveryOrder,delivery_tracking_url:bad},settings});
 assert(!rendered.html.includes('Track your delivery')&&!rendered.text.includes('Track your delivery:'));
 checks++;
}
const httpTracking=renderEmail({event_type:'out_for_delivery',order:{...deliveryOrder,delivery_tracking_url:'http://tracking.example.test/order'},settings});
assert(httpTracking.html.includes('href="http://tracking.example.test/order"'));checks++;
const staleRemoval=renderEmail({event_type:'delivery_tracking_updated',tracking_change:'removed',order:deliveryOrder,settings});
assert(!staleRemoval.html.includes('Track your delivery')&&!staleRemoval.text.includes(trackingUrl));checks++;
const manifest=JSON.parse(await readFile(new URL('../supabase/templates/manifest.json',import.meta.url),'utf8'));
for(const entry of manifest){const html=await readFile(new URL('../supabase/templates/'+entry.file,import.meta.url),'utf8');assert(html.includes('bgcolor="#3d251c"'));assert.equal((html.match(/<h1 /g)||[]).length,1);if(['confirmation','recovery','invite','magic_link','email_change'].includes(entry.key))assert.equal((html.match(/\{\{ \.ConfirmationURL \}\}/g)||[]).length,2);if(entry.key==='reauthentication')assert(html.includes('{{ .Token }}'));assert(!html.includes('preview-only'));checks++;}
console.log(`Passed ${checks} email design checks: all events, delivery tracking states and URL safety, images, and account template variables.`);
