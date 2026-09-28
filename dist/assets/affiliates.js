import {money,escapeHtml as esc,formatDate,affiliateReceipt} from './admin/client.js';

export const percent=bps=>`${Number(bps)/100}%`;
export const paymentMethods={gcash:'GCash',bank_transfer:'Bank transfer',cash:'Cash',other:'Other'};
export const statuses={earned:'Earned',awaiting_completion:'Awaiting completion',awaiting_payment:'Awaiting payment',refunded:'Reversed · refunded',cancelled:'Cancelled',self_purchase:'Own purchase · excluded',below_minimum:'Below minimum · excluded'};
export function decimalHundredths(value,label='Amount'){
 const text=String(value).trim();
 if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error(`${label} must be a positive number with at most two decimal places.`);
 const [whole,fraction='']=text.split('.'),result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(result)||result>999999999)throw Error(`${label} is too large.`);
 return result;
}
export function manilaInput(value){return value?new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16):'';}
export function manilaTimestamp(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose a valid date and time.');
 const date=new Date(value+':00+08:00');
 if(Number.isNaN(date.getTime())||manilaInput(date)!==value)throw Error('Choose a valid date and time.');
 return date.toISOString();
}
export const dateTime=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' PHT':'—';
export function codeStatus(code,affiliate,at=Date.now()){
 if(!affiliate.active||!code.active)return 'Paused';
 if(new Date(code.expires_at).getTime()<=at)return 'Expired';
 if(new Date(code.starts_at).getTime()>at)return 'Scheduled';
 if(Number(code.used_count)+Number(code.reserved_count)>=Number(code.global_limit))return 'Usage limit reached';
 return 'Active';
}
const button=(action,label,id='',extra='')=>`<button type="button" class="button button-secondary" data-aff="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
const cell=(label,html)=>`<td data-label="${esc(label)}"><div class="aff-cell-value">${html}</div></td>`;
const pages=(kind,offset,total,size)=>total>size?`<div class="aff-pages">${button(kind+'-prev','Previous','',offset===0?'disabled':'')}<span>Page ${Math.floor(offset/size)+1} of ${Math.ceil(total/size)}</span>${button(kind+'-next','Next','',offset+size>=total?'disabled':'')}</div>`:'';
export function renderPayoutDetails(details,owner=false){
 return `<section class="panel aff-payment-details"><div class="section-heading"><h2>${owner?'Payout destination':'Your payout details'}</h2>${owner?'':button('edit-payout-details',details?'Edit details':'Add payout details')}</div>${details?`<dl class="aff-destination"><div><dt>Payment method</dt><dd>${esc(paymentMethods[details.method])}</dd></div>${details.method==='bank_transfer'?`<div><dt>Bank</dt><dd>${esc(details.bank_name)}</dd></div>`:''}<div><dt>Account name</dt><dd>${esc(details.account_name)}</dd></div><div><dt>${details.method==='gcash'?'GCash number':'Account number'}</dt><dd class="aff-account-number">${esc(details.account_number)}</dd></div></dl><div class="row-actions">${button('copy-payout-number',details.method==='gcash'?'Copy GCash number':'Copy account number')}</div><p class="help-text">Updated ${esc(dateTime(details.updated_at))}.</p>`:`<p>${owner?'This affiliate has not added payout details yet. They can save GCash or bank details from their affiliate dashboard.':'Add the GCash or bank account where you would like to receive commission payments.'}</p>`}<p class="help-text">${owner?'Saved by the affiliate.':'One payout method at a time. Only you and the Elio owner can view these details.'}</p></section>`;
}
export function renderPayoutDetailsForm(details){
 const method=details?.method||'gcash',bank=method==='bank_transfer';
 return `<div class="section-heading"><h2>Your payout details</h2></div><form class="aff-destination-form" autocomplete="off"><fieldset><label class="field">Payout method<select name="method"><option value="gcash" ${bank?'':'selected'}>GCash</option><option value="bank_transfer" ${bank?'selected':''}>Bank transfer</option></select></label><label class="field" data-bank-field ${bank?'':'hidden'}>Bank name<input name="bank_name" value="${esc(details?.bank_name||'')}" maxlength="80" minlength="2" ${bank?'required':'disabled'}></label><label class="field">Account name<input name="account_name" value="${esc(details?.account_name||'')}" required minlength="2" maxlength="120" autocomplete="off"></label><label class="field"><span data-number-label>${bank?'Account number':'GCash number'}</span><input name="account_number" value="${esc(details?.account_number||'')}" required maxlength="60" inputmode="${bank?'numeric':'tel'}" autocomplete="off" spellcheck="false"></label><p class="help-text" data-number-help>${bank?'Enter the bank account number, including any leading zeros.':'Use the 11-digit GCash number starting with 09, or its +63 equivalent.'}</p><p class="help-text">Only you and the Elio owner can view these details. Saving a new method replaces the previous one.</p><p class="form-error" role="alert"></p><div class="row-actions"><button type="submit" class="button">Save payout details</button>${button('cancel-payout-details','Cancel')}</div></fieldset></form>`;
}
export function renderAffiliateReport(report,owner=false){
 const {affiliate:a,stats:s}=report;
 const cards=[['Available to pay',money(Math.max(0,s.balance_cents)),'Completed earnings less recorded payments.'],['Earned commission',money(s.earned_cents),'Completed orders, after reversals.'],['Awaiting completion',money(s.estimated_cents),'Estimated commission on paid orders.'],['Paid to date',money(s.paid_cents),'Recorded payments, excluding voids.'],['Net product sales',money(s.net_sales_cents),'Completed orders after discounts.'],['Completed orders',s.completed_orders,'Qualifying orders that earned commission.']];
 return `<div class="aff-stats">${cards.map(([title,value,note])=>`<section class="panel"><span>${title}</span><strong>${esc(value)}</strong><small>${note}</small></section>`).join('')}</div>
 ${s.balance_cents<0?`<p class="notice">${money(-s.balance_cents)} will be offset against future earnings because earlier commissions were reversed after payment.</p>`:''}
 <p class="help-text">Current commission: <strong>${percent(a.commission_bps)}</strong> of product sales after discounts, excluding delivery. Each order keeps the rate saved when placed. Commission is earned on completion and reversed on cancellation or refund. Own-account purchases do not earn commission.</p>
 ${renderPayoutDetails(report.payout_details,owner)}
 <section class="panel aff-codes"><div class="section-heading"><h2>${owner?'Affiliate codes':'Your codes'}</h2>${owner?button('new-code','Add code'):''}</div>${!a.active?'<p class="notice">This affiliate is paused. Codes cannot be used for new orders.</p>':''}
 <div class="aff-code-grid">${report.codes.map(c=>`<article class="aff-code"><div class="section-heading"><strong class="aff-code-name">${esc(c.code)}</strong><span class="badge">${codeStatus(c,a)}</span></div><p><strong>${c.kind==='percent'?c.value+'%':money(c.value)} off</strong> · ${money(c.min_subtotal_cents)} minimum${c.cap_cents!==null&&c.cap_cents!==undefined?' · up to '+money(c.cap_cents):''}</p><p class="help-text">${esc(dateTime(c.starts_at))} – ${esc(dateTime(c.expires_at))}</p><p class="help-text">${c.used_count} paid uses · ${c.reserved_count} reserved / ${c.global_limit} total · ${c.per_account_limit} per account</p><dl class="aff-code-stats"><div><dt>Completed sales</dt><dd>${money(c.net_sales_cents)}</dd></div><div><dt>Commission earned</dt><dd>${money(c.earned_cents)}</dd></div></dl><div class="row-actions">${button('copy-code','Copy code',c.id)}${owner?button('edit-code','Edit code',c.id):''}</div></article>`).join('')||'<p class="muted">No codes assigned yet.</p>'}</div><p class="help-text">Customers must sign in with a verified Elio account. Paid and reserved uses count toward the total limit; paid cancellations and refunds remain counted.</p></section>
 <section class="panel"><div class="section-heading"><h2>Order activity</h2><span class="badge">${report.order_total} orders</span></div><div class="table-wrap"><table class="data-table aff-table aff-responsive"><thead><tr><th>Order / placed</th><th>Code</th><th>Net products</th><th>Rate</th><th>Commission</th><th>Status</th></tr></thead><tbody>${report.orders.map(o=>`<tr>${cell('Order / placed',`<strong>${esc(o.reference)}</strong><small>${esc(dateTime(o.created_at))}</small>`)}${cell('Code',esc(o.code))}${cell('Net products',money(o.net_sales_cents))}${cell('Rate',percent(o.commission_bps))}${cell('Commission',money(o.status==='earned'?o.earned_cents:o.estimated_cents)+(o.status==='awaiting_completion'?'<small>Estimated</small>':''))}${cell('Status',esc(statuses[o.status]||o.status))}</tr>`).join('')||'<tr><td colspan="6">Orders using your codes will appear here.</td></tr>'}</tbody></table></div>${pages('orders',report.order_offset,report.order_total,50)}</section>
 <section class="panel"><div class="section-heading"><h2>Payment history</h2>${owner?button('new-payout','Record payment','',s.balance_cents<=0?'disabled':''):''}</div><div class="table-wrap"><table class="data-table aff-table aff-responsive"><thead><tr><th>Date / method</th><th>Amount</th><th>Reference / notes</th><th>Status</th><th>Receipt</th></tr></thead><tbody>${report.payouts.map(p=>`<tr>${cell('Date / method',esc(formatDate(p.paid_on))+`<small>${esc(paymentMethods[p.payment_method]||p.payment_method)}</small>`)}${cell('Amount',money(p.amount_cents))}${cell('Reference / notes',esc(p.reference||'—')+`<small>${esc(p.note)}</small>`+(p.void_reason?`<small>Void reason: ${esc(p.void_reason)}</small>`:''))}${cell('Status',p.status==='paid'?'Paid':'Voided')}${cell('Receipt',`<div class="row-actions">${button('receipt','View receipt',p.id)}${owner&&p.status==='paid'?button('void-payout','Void record',p.id):''}</div>`)}</tr>`).join('')||'<tr><td colspan="5">No payments recorded yet.</td></tr>'}</tbody></table></div>${pages('payouts',report.payout_offset,report.payout_total,20)}</section>
 <p class="help-text aff-updated">Updated ${esc(dateTime(report.generated_at))}. Refreshes every 30 seconds while this page is open.</p>`;
}
export async function openAffiliateReceipt(id){
 const result=await affiliateReceipt(id),url=new URL(result.url);
 if(url.protocol!=='https:')throw Error('This receipt link is unavailable.');
 const dialog=document.createElement('dialog');dialog.className='aff-receipt';dialog.setAttribute('aria-label','Payment receipt');
 dialog.innerHTML=`<div class="section-heading"><h2>Payment receipt</h2><button type="button" class="button button-secondary">Close</button></div><p class="help-text">This private link expires after five minutes.</p><img alt="Uploaded payment receipt" referrerpolicy="no-referrer"><p><a target="_blank" rel="noopener noreferrer">Open full-size receipt</a></p>`;
 dialog.querySelector('img').src=url.href;dialog.querySelector('a').href=url.href;
 const previous=document.activeElement;dialog.querySelector('button').onclick=()=>dialog.close();
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 dialog.addEventListener('close',()=>{dialog.remove();previous?.focus?.();},{once:true});document.body.append(dialog);dialog.showModal();
}
export function liveAffiliateRefresh(refresh,canRefresh=()=>true){
 let disposed=false,timer;
 const tick=()=>{if(!disposed&&!document.hidden&&canRefresh())refresh();};
 timer=setInterval(tick,30000);document.addEventListener('visibilitychange',tick);window.addEventListener('focus',tick);
 return ()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('focus',tick);};
}
