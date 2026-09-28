import {api,money,escapeHtml as esc,manilaDate,affiliatePayout} from './client.js';
import {percent,decimalHundredths,manilaInput,manilaTimestamp,paymentMethods,renderAffiliateReport,renderPayoutDetails,openAffiliateReceipt,liveAffiliateRefresh,dateTime} from '../affiliates.js?v=mobile-audit-1';
import {confirmDialog} from './site-dialog.js?v=branded-dialogs-1';
import {PHOTO_ACCEPT,RECEIPT_HELP} from './photo-upload.js';

export function mountAffiliates(root,{role,connected}){
 if(!root)return;
 if(!connected||role!=='owner'){root.innerHTML='<p class="notice">Sign in as the owner to manage affiliates.</p>';return;}
 const $=s=>root.querySelector(s),field=(name,label,value='',type='text',attrs='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
 const check=(name,label,on)=>`<label class="check-field"><input name="${name}" type="checkbox" ${on?'checked':''}>${label}</label>`;
 const option=(value,label,current)=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`;
 let rows=[],overview=null,selected=null,report=null,draft=null,loading=false,disposed=false,request=0,orderOffset=0,payoutOffset=0;
 root.innerHTML=`<div class="view-heading"><div><span class="eyebrow">Elio partnerships</span><h1>Affiliates</h1><p>Your partners, their codes and the rewards they earn.</p></div><div class="row-actions"><button class="button button-secondary" data-aff="refresh">Refresh</button><button class="button" data-aff="new-affiliate">Add affiliate</button></div></div><p class="notice aff-message" role="status" hidden></p><section class="panel aff-editor" hidden></section><div class="aff-list"></div><div class="aff-detail" hidden><div class="section-heading aff-detail-heading"><div><h2 class="aff-name"></h2><p class="aff-email"></p></div><button class="button button-secondary" data-aff="edit-affiliate">Edit affiliate</button></div><div class="aff-report"></div></div>`;
 function message(text,bad=false){const el=$('.aff-message');el.textContent=text;el.hidden=!text;el.classList.toggle('danger',bad);}
 function list(){
  $('.aff-list').innerHTML=`<section class="panel"><div class="section-heading"><h2>Your affiliates</h2><span class="badge">${rows.length} accounts</span></div>${rows.length?`<label class="field">View affiliates<select class="aff-select"><option value="">All affiliates · Overview</option>${rows.map(a=>`<option value="${a.id}" ${selected===a.id?'selected':''}>${esc(a.name)} · ${esc(a.email)}${a.active?'':' · Paused'}</option>`).join('')}</select></label><div class="table-wrap"><table class="data-table aff-table"><thead><tr><th>Affiliate</th><th>Commission</th><th>Codes</th><th>Available / offset</th><th></th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${esc(a.name)}</strong><small>${esc(a.email)}${a.active?'':' · Paused'}</small></td><td>${percent(a.commission_bps)}</td><td>${a.code_count}</td><td>${money(a.balance_cents)}</td><td><button class="button button-secondary" data-aff="open" data-id="${a.id}" aria-label="Open ${esc(a.name)}">Open</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No affiliates yet. Add a partner using the email of their verified Elio account, then create their custom code.</p>'}</section>`;
 }
 function overall(){
  let node=$('.aff-overview');if(!node){node=document.createElement('div');node.className='aff-overview';$('.aff-list').before(node);}
  node.hidden=!!selected;if(selected)return;
  if(!overview?.stats){node.innerHTML='<p class="notice">Overall analytics are not available yet. Refresh to try again.</p>';return;}
  const s=overview.stats,card=(key,label,value,note)=>`<article class="panel" data-metric="${key}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
  node.innerHTML=`<div class="section-heading"><h2>All affiliates</h2><span class="badge">All time</span></div><div class="aff-stats">
   ${card('payable','Commission to pay',money(s.payable_cents),'Earned on completed orders, less recorded payments')}
   ${card('sales','Net sales generated',money(s.net_sales_cents),'Paid product sales after discounts, excluding delivery')}
   ${card('paid','Commission paid',money(s.paid_cents),'Recorded payments, excluding voided records')}
   ${card('pending','Awaiting completion',money(s.estimated_cents),'Estimated commission on paid, unfinished orders')}
   ${card('orders','Orders generated',Number(s.paid_orders).toLocaleString(),`${Number(s.completed_orders).toLocaleString()} completed orders`)}
   ${card('partners','Affiliates',Number(s.affiliates).toLocaleString(),`${Number(s.active_affiliates).toLocaleString()} active accounts`)}
  </div>${s.offset_cents>0?`<p class="notice">${money(s.offset_cents)} in previous payments will be offset against those affiliates’ future earnings. This does not reduce amounts owed to other affiliates.</p>`:''}
  <section class="panel aff-leaderboard"><div class="section-heading"><h2>Top affiliates</h2><span class="help-text">By net sales generated</span></div>${overview.top_affiliates.length?`<div class="table-wrap"><table class="data-table aff-table"><thead><tr><th>Affiliate</th><th>Net sales</th><th>Paid orders</th><th>To pay</th><th>Paid</th><th></th></tr></thead><tbody>${overview.top_affiliates.map((a,i)=>`<tr><td><strong>${i+1}. ${esc(a.name)}</strong><small>${esc(a.email)}${a.active?'':' · Paused'}</small></td><td>${money(a.net_sales_cents)}</td><td>${a.paid_orders}</td><td>${money(Math.max(0,a.balance_cents))}</td><td>${money(a.paid_cents)}</td><td><button class="button button-secondary" data-aff="open" data-id="${a.id}" aria-label="View ${esc(a.name)} analytics">View</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No affiliate sales yet. Your top partners will appear here once their customers’ payments are approved.</p>'}</section>
  <p class="help-text aff-overview-note">Includes paid orders awaiting completion. Unpaid, cancelled, refunded and affiliate self-purchases are excluded from sales. Commission becomes payable only when an order is completed. Paused affiliates remain in the totals.</p>`;
 }
 async function load(){
  if(loading||disposed||!root.isConnected)return;loading=true;const seq=++request;
  try{
   const result=await api('affiliate_admin');
   if(disposed||seq!==request)return;rows=result.affiliates;overview=result;list();overall();
   if(selected){const next=await api('affiliate_report',{id:selected,order_offset:orderOffset,payout_offset:payoutOffset});if(disposed||seq!==request)return;report=next;
    $('.aff-detail').hidden=false;$('.aff-name').textContent=report.affiliate.name;$('.aff-email').textContent=rows.find(a=>a.id===selected)?.email||'';$('.aff-report').innerHTML=renderAffiliateReport(report,true);
   }else $('.aff-detail').hidden=true;
  }catch(e){if(!disposed)message('Could not refresh affiliates. '+e.message,true);}finally{loading=false;}
 }
 async function leaveEditor(){
  if(root.dataset.busy==='true')return false;
  if(root.dataset.dirty==='true'&&!await confirmDialog('Discard the unsaved changes in this form?',{title:'Unsaved affiliate changes',confirmLabel:'Discard changes',cancelLabel:'Keep editing'}))return false;
  root.dataset.dirty='false';draft=null;$('.aff-editor').hidden=true;return true;
 }
 function editor(kind,title,body,value){
  draft={...value,formKind:kind};root.dataset.dirty='false';const panel=$('.aff-editor');panel.hidden=false;
  panel.innerHTML=`<div class="section-heading"><h2>${title}</h2><button class="button button-secondary" data-aff="close-editor">Close</button></div><form class="aff-form" data-kind="${kind}">${body}<p class="form-error" role="alert"></p><div class="row-actions"><button class="button" type="submit">${kind==='payout'?'Record payment':kind==='void'?'Void payment record':'Save changes'}</button></div></form>`;
  panel.scrollIntoView({behavior:'smooth',block:'start'});panel.querySelector('input:not([readonly]),textarea,select')?.focus({preventScroll:true});
 }
 function affiliateForm(a=null){
  editor('affiliate',a?'Edit affiliate':'Add affiliate',`<div class="field-row">${field('name','Affiliate name',a?.name||'','text','required maxlength="120"')}${field('email','Elio account email',rows.find(r=>r.id===a?.id)?.email||'','email',`required maxlength="254" ${a?'readonly':''}`)}</div><p class="help-text">${a?'This assignment stays linked to the same Elio account.':'The partner must have an Elio account and verify their email first.'}</p>${field('commission','Commission · %',a?Number(a.commission_bps)/100:'','number','required min="0" max="100" step="0.01" inputmode="decimal"')}<p class="help-text">Applies to future orders only. Existing orders keep their saved rate. Calculated on products after discounts, excluding delivery.</p>${check('active','Active · allow customers to use this affiliate’s codes',a?.active??true)}`,a||{id:crypto.randomUUID(),revision:0});
 }
 function codeForm(c=null){
  const start=c?.starts_at||new Date().toISOString(),end=c?.expires_at||new Date(Date.now()+30*86400000).toISOString();
  editor('code',c?'Edit affiliate code':'Add affiliate code',`${field('code','Custom promo code',c?.code||'','text','required maxlength="40" pattern="[A-Za-z0-9_\\-]{1,40}" autocomplete="off"')}<div class="field-row"><label class="field">Discount type<select name="discount_kind">${option('percent','Percentage (%)',c?.kind||'percent')}${option('fixed','Fixed amount (PHP)',c?.kind||'percent')}</select></label>${field('value','Discount value',c?(c.kind==='fixed'?(c.value/100).toFixed(2):c.value):'','number',`required min="${c?.kind==='fixed'?'0.01':'1'}" step="${c?.kind==='fixed'?'0.01':'1'}" ${c?.kind==='fixed'?'':'max="100"'} inputmode="decimal"`)}</div><div class="field-row">${field('minimum','Minimum product subtotal · PHP',((c?.min_subtotal_cents||0)/100).toFixed(2),'number','required min="0" max="9999999.99" step="0.01" inputmode="decimal"')}${field('cap','Maximum discount · PHP · optional',c?.cap_cents==null?'':(c.cap_cents/100).toFixed(2),'number','min="0" max="9999999.99" step="0.01" inputmode="decimal"')}</div><div class="field-row">${field('starts','Starts · Manila time',manilaInput(start),'datetime-local','required')}${field('expires','Expires · Manila time',manilaInput(end),'datetime-local','required')}</div><div class="field-row">${field('per_account','Uses per account',c?.per_account_limit||1,'number','required min="1" max="2147483647" step="1" inputmode="numeric"')}${field('total','Total uses across customers',c?.global_limit||100,'number','required min="1" max="2147483647" step="1" inputmode="numeric"')}</div>${check('active','Code active',c?.active??true)}<p class="help-text">Edits affect future orders. Existing orders keep their saved discount and commission terms. Pause a code to stop new uses while keeping its history.</p>`,c||{id:crypto.randomUUID(),revision:0});
 }
 function payoutForm(){
  editor('payout','Record a manual payment',`${renderPayoutDetails(report.payout_details,true)}<p>Available to pay: <strong>${money(Math.max(0,report.stats.balance_cents))}</strong></p><p class="help-text">Record a payment you have already made. This reduces the affiliate’s payable balance and adds an expense in Accounting.</p><div class="field-row">${field('amount','Amount paid · PHP','','number',`required min="0.01" max="${(Math.max(0,report.stats.balance_cents)/100).toFixed(2)}" step="0.01" inputmode="decimal"`)}${field('paid_on','Payment date · Manila',manilaDate(),'date',`required max="${manilaDate()}"`)}</div><div class="field-row"><label class="field">Payment method<select name="method">${Object.entries(paymentMethods).map(([v,l])=>option(v,l,report.payout_details?.method||'gcash')).join('')}</select></label>${field('reference','Payment reference · optional','','text','maxlength="200"')}</div><label class="field">Notes shared with affiliate · optional<textarea name="note" maxlength="2000"></textarea></label>${field('proof','Proof of payment','','file',`required accept="${PHOTO_ACCEPT}"`)}<p class="help-text">${RECEIPT_HELP} Only owners and this affiliate can view the receipt. Upload a receipt showing only this payment.</p>`,{id:crypto.randomUUID(),affiliate_id:selected});
 }
 root.addEventListener('input',e=>{if(e.target.closest('.aff-form'))root.dataset.dirty='true';});
 root.addEventListener('change',async e=>{
  if(e.target.closest('.aff-form'))root.dataset.dirty='true';
  if(e.target.name==='discount_kind'){const input=e.target.form.elements.value,fixed=e.target.value==='fixed';input.step=fixed?'0.01':'1';input.min=fixed?'0.01':'1';input.max=fixed?'9999999.99':'100';}
  if(e.target.matches('.aff-select')){const value=e.target.value;if(loading||!await leaveEditor()){e.target.value=selected||'';return;}selected=value||null;report=null;orderOffset=0;payoutOffset=0;await load();}
 });
 root.addEventListener('submit',async e=>{
  if(!e.target.matches('.aff-form'))return;e.preventDefault();e.stopPropagation();const form=e.target;
  if(root.dataset.busy==='true'||!form.reportValidity())return;
  root.dataset.busy='true';const submit=form.querySelector('[type=submit]');submit.disabled=true;const error=form.querySelector('.form-error');error.textContent='';const f=new FormData(form),v=k=>String(f.get(k)||'').trim();
  try{
   if(draft.formKind==='affiliate'){
    const commission=decimalHundredths(v('commission'),'Commission');if(commission>10000)throw Error('Commission cannot exceed 100%.');
    const saved=await api('affiliate_save',{id:draft.id,revision:draft.revision,email:v('email'),name:v('name'),commission_bps:commission,active:f.has('active')});selected=saved.id;
   }else if(draft.formKind==='code'){
    const kind=v('discount_kind'),value=kind==='fixed'?decimalHundredths(v('value'),'Discount'):Number(v('value'));
    if(!Number.isInteger(value)||value<1||(kind==='percent'&&value>100))throw Error('Enter a valid discount. Percentages must be whole numbers from 1 to 100.');
    const starts=manilaTimestamp(v('starts')),expires=manilaTimestamp(v('expires'));if(expires<=starts)throw Error('The expiry must be after the starting date.');
    await api('affiliate_save_code',{id:draft.id,revision:draft.revision,affiliate_id:selected,starts_at:starts,promo:{code:v('code').toUpperCase(),kind,value,min_subtotal_cents:decimalHundredths(v('minimum'),'Minimum'),cap_cents:v('cap')===''?null:decimalHundredths(v('cap'),'Cap'),per_account_limit:Number(v('per_account')),global_limit:Number(v('total')),expires_at:expires,active:f.has('active')}});
   }else if(draft.formKind==='payout'){
    await affiliatePayout(f.get('proof'),{id:draft.id,affiliate_id:draft.affiliate_id,amount_cents:decimalHundredths(v('amount'),'Payment'),paid_on:v('paid_on'),payment_method:v('method'),reference:v('reference'),note:v('note')});
   }else if(draft.formKind==='void'){
    if(!await confirmDialog('Void this recorded payment? This restores the payable balance and removes the accounting expense. The original record and receipt will stay in history.',{title:'Void payment record?',confirmLabel:'Void record',cancelLabel:'Keep record',danger:true}))return;
    await api('affiliate_void_payout',{id:draft.id,revision:draft.revision,reason:v('reason')});
   }
   const success=draft.formKind==='payout'?'Payment recorded. The balance and Accounting have been updated.':draft.formKind==='void'?'Payment record voided. The balance and Accounting have been updated.':'Changes saved.';
   root.dataset.dirty='false';draft=null;$('.aff-editor').hidden=true;await load();message(success);
  }catch(err){error.textContent=err.message;}finally{root.dataset.busy='false';submit.disabled=false;}
 });
 root.addEventListener('click',async e=>{
  const b=e.target.closest('[data-aff]');if(!b)return;e.preventDefault();e.stopPropagation();if(b.disabled||root.dataset.busy==='true')return;
  const action=b.dataset.aff;
  try{
   if(action==='refresh'){await load();return;}
   if(action==='copy-code'){await navigator.clipboard.writeText(report.codes.find(c=>c.id===b.dataset.id).code);message('Code copied.');return;}
   if(action==='copy-payout-number'){await navigator.clipboard.writeText(b.closest('.aff-payment-details').querySelector('.aff-account-number').textContent);message('Account number copied.');return;}
   if(action==='receipt'){b.disabled=true;await openAffiliateReceipt(b.dataset.id);return;}
   if(loading)return;
   if(action.startsWith('orders-')||action.startsWith('payouts-')){const direction=action.endsWith('next')?1:-1;if(action.startsWith('orders'))orderOffset=Math.max(0,orderOffset+direction*50);else payoutOffset=Math.max(0,payoutOffset+direction*20);await load();return;}
   if(!await leaveEditor())return;
   if(action==='new-affiliate')affiliateForm();
   if(action==='edit-affiliate')affiliateForm(report.affiliate);
   if(action==='new-code')codeForm();
   if(action==='edit-code')codeForm(report.codes.find(c=>c.id===b.dataset.id));
   if(action==='new-payout'){
    b.disabled=true;root.dataset.busy='true';
    try{
     const next=await api('affiliate_report',{id:selected,order_offset:orderOffset,payout_offset:payoutOffset});
     if(disposed||!root.isConnected)return;report=next;$('.aff-report').innerHTML=renderAffiliateReport(report,true);payoutForm();
    }finally{root.dataset.busy='false';}
   }
   if(action==='void-payout'){const p=report.payouts.find(p=>p.id===b.dataset.id);editor('void','Correct a payment record',`<p>${money(p.amount_cents)} · ${esc(p.reference||p.paid_on)}</p><p class="help-text">Use this only to correct an incorrect payment record. Voiding does not retrieve money already transferred.</p><label class="field">Reason shared with affiliate<textarea name="reason" required minlength="3" maxlength="2000"></textarea></label>`,p);}
   if(action==='open'){selected=b.dataset.id;report=null;orderOffset=0;payoutOffset=0;await load();$('.aff-detail').scrollIntoView({behavior:'smooth',block:'start'});}
  }catch(err){message(err.message,true);}finally{b.disabled=false;}
 });
 const stop=liveAffiliateRefresh(load,()=>root.isConnected&&root.dataset.busy!=='true'&&root.dataset.dirty!=='true');load();
 return {refresh:load,destroy(){disposed=true;request++;stop();}};
}
