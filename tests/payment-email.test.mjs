import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {renderEmail} from '../supabase/functions/_shared/emails.ts';

export const options=[
 {label:'GCash',account_name:'Elio Sample Account',account_number:'09XX XXX XXXX',note:''},
 {label:'BDO',account_name:'Elio Sample Account',account_number:'000012345678',note:''},
 {label:'EastWest',account_name:'Elio Sample Account',account_number:'000098765432',note:''},
];
const note='Please include your order reference when sending payment.';
const instructions=(methods,tail=note)=>['Accepted Payment Methods:',methods.map(m=>[m.label,m.account_name,m.account_number,m.note].filter(Boolean).join('\n')).join('\n\n'),tail].filter(Boolean).join('\n\n');
export const order={id:'payment-layout-sample',reference:'ELIO-PREVIEW',access_token:'sample-inactive-token',buyer_name:'Sample customer',order_source:'website',fulfillment_date:'2026-10-07',method:'pickup',payment_deadline:'2026-10-04T04:15:00Z',items:[{name:'The Signature Trio',quantity:1,unit_price_cents:90000,line_total_cents:90000,flavor_contents:[{name:'Vanilla',quantity:1},{name:'Matcha',quantity:1},{name:'Chocolate',quantity:1}]}],subtotal_cents:90000,discount_cents:0,delivery_cents:0,total_cents:90000,payment_options:options,payment_note:note,payment_instructions:instructions(options),pickup_address:'Sample pickup location · Quezon City',pickup_hours:'10am–8pm'};
export const settings={site_url:'https://eliocheesecakes.com',payment_options:[{label:'CHANGED ACCOUNT',account_name:'New details',account_number:'999999'}],payment_instructions:'CHANGED ACCOUNT 999999',payment_note:'CHANGED NOTE',delivery_window:'10am–8pm'};
export const fixtures=[];
let checks=0;
function check(name,changes,verify){const payload={event_type:'order_submitted',order:{...order,...changes},settings},result=renderEmail(payload);verify(result,payload);fixtures.push({name,payload,...result});checks++;}
check('saved-accounts',{},({html,text})=>{
 for(const detail of ['09XX XXX XXXX','000012345678','000098765432',note]){assert(html.includes(detail));assert(text.includes(detail));}
 assert(!html.includes('CHANGED')&&!text.includes('CHANGED'));
 assert(html.indexOf('Amount to pay')<html.indexOf('Upload your payment proof by'));
 assert(html.indexOf('Upload your payment proof by')<html.indexOf('Choose one payment method'));
 assert(html.includes('Oct 4, 2026, 12:15 PM (Asia/Manila)'));
 assert(!html.includes('Payment instructions'));
 assert(html.includes('role="presentation"')&&html.includes('table-layout:fixed'));
 assert(html.includes('View order &amp; upload payment proof')&&text.includes('token=sample-inactive-token'));
});
const withNotes=options.map((option,index)=>({...option,note:index===1?'Saved sample instruction.\nSecond line of saved instructions.':''}));
check('per-account-notes',{payment_options:withNotes,payment_instructions:instructions(withNotes)},({html,text})=>{assert(html.includes('Saved sample instruction.<br>Second line of saved instructions.'));assert(text.includes('Saved sample instruction.\nSecond line of saved instructions.'));});
check('direct-no-deadline',{order_source:'direct',payment_deadline:null},({html,text})=>{for(const content of [html,text]){assert(content.includes('no automatic payment deadline'));assert(!content.includes('Upload your payment proof by'));assert(!content.includes('Invalid Date'));}});
check('delivery-discount',{method:'delivery',subtotal_cents:100000,discount_cents:5000,delivery_cents:15000,total_cents:110000,recipient:{name:'Sample recipient',phone:'Sample phone'},address:{line1:'Sample address',locality:'Quezon City'}},({html,text})=>{assert(html.includes('₱1,100.00'));assert(text.includes('Amount to pay: ₱1,100.00'));assert(html.includes('Delivery details'));});
check('legacy-preserved',{payment_options:undefined,payment_note:undefined,payment_instructions:'Saved special bank\n000000123\nDo not pay twice. Call us for split payments.'},({html,text})=>{assert(!html.includes('Choose one payment method'));for(const s of ['Saved special bank','000000123','Do not pay twice. Call us for split payments.']){assert(html.includes(s));assert(text.includes(s));}assert(!html.includes('CHANGED'));});
check('custom-instructions-preserved',{payment_instructions:instructions(options)+'\n\nCustom exception: contact the kitchen first.'},({html,text})=>{assert(html.includes('Custom exception: contact the kitchen first.'));assert(text.includes('000012345678'));assert(!html.includes('Choose one payment method'));});
check('empty-structured-legacy',{payment_options:[],payment_instructions:'Saved manual instructions'},({html})=>assert(html.includes('Saved manual instructions')));
check('malformed-options-fallback',{payment_options:[{label:'Broken',account_name:'Name',account_number:123}],payment_instructions:'Saved fallback 00123'},({html})=>assert(html.includes('Saved fallback 00123')));
check('structured-no-legacy',{payment_instructions:undefined},({html,text})=>{assert(html.includes('Choose one payment method'));assert(text.includes('000012345678'));assert(!html.includes('CHANGED'));});
check('legacy-settings-fallback',{payment_options:undefined,payment_note:undefined,payment_instructions:undefined},({html})=>assert(html.includes('CHANGED ACCOUNT 999999')));
const unsafe=[{label:'<script>alert(1)</script>',account_name:'A & B <img src=x onerror=alert(1)>',account_number:'000123',note:'<b>Do not interpret as HTML</b>'}];
check('escaped-content',{payment_options:unsafe,payment_instructions:instructions(unsafe,'Saved <i>note</i>'),payment_note:'Saved <i>note</i>'},({html,text})=>{assert(!html.includes('<script>')&&!html.includes('<img src=x'));assert(html.includes('&lt;script&gt;'));assert(html.includes('Saved &lt;i&gt;note&lt;/i&gt;'));assert(text.includes('<b>Do not interpret as HTML</b>'));});
const long=[{label:'Sample bank '+('A'.repeat(80)),account_name:'Sample name '+('Long '.repeat(28)),account_number:'0'.repeat(100),note:'Payment note. '.repeat(30)}];
check('long-content',{payment_options:long,payment_note:'General instructions. '.repeat(80),payment_instructions:instructions(long,'General instructions. '.repeat(80))},({html})=>assert(html.includes('0'.repeat(100))));
check('manila-midnight',{payment_deadline:'2026-12-31T16:05:00Z'},({html,text})=>{assert(html.includes('Jan 1, 2027, 12:05 AM (Asia/Manila)'));assert(text.includes('Jan 1, 2027'));});
check('zero-total',{total_cents:0,subtotal_cents:0},({text})=>assert(text.includes('Amount to pay: ₱0.00')));
check('crlf-snapshot',{payment_instructions:order.payment_instructions.replaceAll('\n','\r\n')},({html})=>assert(html.includes('Choose one payment method')));
const out=resolve('test-results/payment-email');await mkdir(out,{recursive:true});
for(const f of fixtures)await writeFile(resolve(out,f.name+'.html'),f.html.replace(/href="[^"]*"/g,'href="#preview-only"'));
await writeFile(resolve(out,'content-results.json'),JSON.stringify({checks,scenarios:fixtures.map(f=>f.name)},null,2));
console.log(`PASS ${checks} payment email scenarios: saved accounts/notes, legacy fallback, direct orders, totals, escaping and Manila dates.`);
