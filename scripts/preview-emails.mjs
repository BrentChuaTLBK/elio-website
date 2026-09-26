import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderEmail} from '../supabase/functions/_shared/emails.ts';
import {emailFrame,emailIntro,emailButton,emailPanel,emailColumns} from '../supabase/functions/_shared/email-design.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(process.argv[2]||'test-results/emails');await mkdir(output,{recursive:true});
const order={id:'00000000-0000-4000-8000-000000000000',reference:'ELIO-PREVIEW',access_token:'preview-only-no-access',buyer_name:'Preview customer',fulfillment_date:'2026-10-04',method:'pickup',payment_deadline:'2026-10-02T04:00:00Z',items:[{product_id:'signature',name:'The Signature Trio',quantity:1,unit_price_cents:90000,line_total_cents:90000,flavor_contents:[{name:'Vanilla',quantity:1},{name:'Chocolate',quantity:1},{name:'Matcha',quantity:1}]},{product_id:'custom',name:'Build your own box',quantity:2,unit_price_cents:100000,line_total_cents:200000,flavor_contents:[{name:'Vanilla',quantity:2},{name:'Gorgonzola',quantity:1}]}],subtotal_cents:290000,discount_cents:0,delivery_cents:0,total_cents:290000,recipient:{name:'Preview recipient',phone:'Sample contact number'},address:{line1:'Sample delivery address',locality:'Quezon City'},delivery_zone_name:'Sample delivery area',delivery_zone_description:'Your saved delivery instructions appear here.'};
const settings={site_url:'https://eliocheesecakes.com',shop_name:'Elio Basque Cheesecake',payment_instructions:'SAMPLE ONLY — please do not send payment. Your saved bank or wallet details appear here.',pickup_address:'Sample pickup location, Quezon City',pickup_hours:'10am–8pm',pickup_instructions:'Include your full name and order reference when booking a rider. Check your order before leaving.\n\nYour saved pickup notes appear here.',delivery_window:'10am–8pm',contact_email:'elio.cheesecakes@gmail.com'};
const photos={signature:'assets/trio-story-concept.webp',custom:'assets/shop-custom-box-concept.webp'};
const events=['order_submitted','payment_approved','payment_rejected','order_cancelled','order_expired','order_updated','fulfillment_reminder','ready_for_pickup','pickup_reminder','out_for_delivery','order_review_required'];
const messages=[];
for(const event of events){
 let {html,text}=renderEmail({event_type:event,order:{...order,method:event==='out_for_delivery'?'delivery':'pickup'},settings,product_photos:photos,reason:'Preview only — no actual order or payment.'});
 html=html.replace(/href="https:\/\/eliocheesecakes.com\/(order|manage).html[^\"]*"/g,'href="#preview-only"');text=text.replace(/https:\/\/eliocheesecakes.com\/(order|manage).html[^\s]+/g,'[inactive preview link]');
 messages.push({key:event,label:event.replaceAll('_',' '),group:'Order emails',note:event==='pickup_reminder'?'Prepared template; no additional reminder schedule enabled.':'Order email design.',html,text});
}
const auth=JSON.parse(await readFile(root+'supabase/templates/manifest.json','utf8'));
const authBundle={};
for(const entry of auth){
 const template=await readFile(root+'supabase/templates/'+entry.file,'utf8');
 authBundle['mailer_subjects_'+entry.key]=entry.subject;authBundle['mailer_templates_'+entry.key+'_content']=template;
 const html=template.replaceAll('{{ .ConfirmationURL }}','#preview-only').replaceAll('{{ .Token }}','123456');
 messages.push({key:'account_'+entry.key,label:entry.label,group:'Account emails',note:'Prepared Supabase template. Hosted activation must be verified separately.',html,text:'ACCOUNT DESIGN PREVIEW — link inactive.'});
}
// Newsletter layouts only. Elio newsletter sending and signup remain disabled.
// No discounts, subscriptions, campaigns or customer emails are created here.
const paragraph=t=>`<p style="margin:0 0 16px;font-size:15px;line-height:1.75">${t}</p>`;
const newsletterFooter='<div style="margin-top:26px;padding-top:20px;border-top:1px solid #dfd1bd;font-size:12px;color:#786858"><p>You’re receiving this because you subscribed to Elio’s newsletter.</p><p><a href="#preview-only" style="color:#63412d;text-decoration:underline">Unsubscribe</a></p><p>[Business mailing address]</p></div>';
const hero='<img src="https://eliocheesecakes.com/assets/trio-story-concept.webp" width="654" alt="An Elio box of three Basque cheesecakes" style="display:block;width:100%;max-width:100%;height:auto;border:0;margin:22px 0;border-radius:5px">';
const drafts=[
 ['newsletter_welcome','Welcome to Elio.',emailIntro('The Elio newsletter','A little Elio, just for you.','Thank you for joining us. Discover new flavors, seasonal boxes, and little moments to savor.')+hero+emailButton('Explore the boxes','https://eliocheesecakes.com/order.html')],
 ['newsletter_offer','A little something for you.',emailIntro('The Elio newsletter','A little something for you.','Your next Elio moment comes with a little extra. Your approved offer details will appear here.')+emailPanel('Your offer code','<p style="margin:0;font:28px/1.5 Georgia,serif;letter-spacing:3px">ELIO-PREVIEW</p>','sand')+emailColumns(emailPanel('The little details',paragraph('Offer value, eligibility, and minimum purchase.')),emailPanel('Made for your next box',paragraph('Expiry date, usage limits, and other offer terms.')))+emailButton('Find your favorites','https://eliocheesecakes.com/order.html')],
 ['newsletter_campaign','Your next favorite awaits.',emailIntro('From Elio','Your next favorite awaits.','Familiar favorites and new discoveries, made to be savored.')+hero+emailPanel('A box to look forward to',paragraph('Use this space for your seasonal story, featured flavors, or a new collection.'))+emailButton('Discover the collection','https://eliocheesecakes.com/flavors.html')],
];
for(const [key,label,content] of drafts)messages.push({key,label,group:'Newsletter drafts',note:'Design only. Newsletter sending is not enabled; offer copy is a placeholder.',html:emailFrame(label,label,content+newsletterFooter),text:'NEWSLETTER DESIGN PREVIEW — no active offer, subscription, or unsubscribe action.'});
for(const m of messages){await writeFile(output+'/'+m.key+'.html',m.html);await writeFile(output+'/'+m.key+'.txt',m.text);}
await writeFile(output+'/messages.json',JSON.stringify(messages));
await writeFile(output+'/supabase-auth-templates.json',JSON.stringify(authBundle,null,2));
const links=['Order emails','Account emails','Newsletter drafts'].map(group=>`<h2>${group}</h2>`+messages.filter(m=>m.group===group).map(m=>`<a href="${m.key}.html" target="email-preview" data-note="${m.note}">${m.label}</a>`).join('')).join('');
await writeFile(output+'/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elio email collection</title><style>body{margin:0;background:#f5efe5;color:#39251c;font:15px/1.6 Arial}header{padding:22px 28px;background:#3d251c;color:#ddb57d}h1{font:32px Georgia;margin:0}header p{margin:6px 0 0;font-size:13px;color:#e5cdb0}main{display:grid;grid-template-columns:255px 1fr}nav{padding:14px 22px;max-height:calc(100vh - 155px);overflow:auto}h2{font:18px Georgia;margin:22px 0 8px}a{display:block;color:#795027;padding:8px 0;text-transform:capitalize;text-decoration:none;border-bottom:1px solid #dfd1bd}a:hover,a:focus{background:#eee3d0}iframe{width:100%;height:calc(100vh - 150px);border:0}#note{padding:10px 24px;font-size:12px;border-bottom:1px solid #dfd1bd;margin:0}@media(max-width:700px){main{display:block}nav{max-height:180px}iframe{height:100vh}}</style><header><h1>ELIO · Emails from our kitchen</h1><p>27 designs · sample orders and prices · preview links are inactive · nothing is sent</p></header><main><nav>${links}</nav><section><p id="note">Order email design.</p><iframe name="email-preview" title="Selected Elio email design" src="payment_approved.html"></iframe></section></main><script>document.querySelectorAll('[data-note]').forEach(a=>a.addEventListener('click',()=>document.querySelector('#note').textContent=a.dataset.note));</script></html>`);
console.log(JSON.stringify({templates:messages.length,output}));
