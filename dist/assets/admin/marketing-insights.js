// Owner-only reports. Reporting never issues offers or changes newsletter consent.
export function mountMarketingInsights(root,{api,owner,esc,money,today,openOrder,openAffiliate}){
 if(!owner){root.innerHTML='<p class="notice">Sign in as the owner to view marketing insights.</p>';return {destroy(){}};}
 const $=s=>root.querySelector(s),number=n=>Number(n||0).toLocaleString('en-PH');
 const rate=(a,b)=>b?`${(100*a/b).toFixed(1)}%`:'—';
 const sources={home_popup:'Homepage popup',home_footer:'Website newsletter form',checkout:'Checkout',account:'Account preferences',unknown:'Original source unknown'};
 const when=v=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'}).format(new Date(v));
 const metric=(label,value,note='')=>`<div><dt>${label}</dt><dd>${value}</dd>${note?`<small>${note}</small>`:''}</div>`;
 let disposed=false,request=0,detailRequest=0,groups=[],group=null,ledgerId=null,offset=0,tab='offers';
 root.innerHTML=`<div class="view-heading"><div><span class="eyebrow">Marketing</span><h1>Marketing insights</h1><p>See which offers bring customers back.</p></div><button class="button button-secondary" data-insight="refresh">Refresh</button></div>
  <div class="marketing-tabs" role="group" aria-label="Report type"><button class="button" data-insight="offers" aria-pressed="true">Newsletter & offers</button><button class="button button-secondary" data-insight="affiliates" aria-pressed="false">Affiliates</button></div>
  <section class="panel marketing-method"><div class="marketing-filter"><label class="field">Signup / voucher issue month · Manila<input name="cohort-month" type="month" min="2000-01" max="${today.slice(0,7)}" value="${today.slice(0,7)}" required></label></div>
  <p data-method>Newsletter groups use each customer’s first confirmed signup. Automatic offers use the voucher’s issue date. Each recipient gets the same 30-day observation window. Results include only recipients whose full window has ended.</p></section>
  <div class="marketing-results" aria-live="polite"></div><section class="panel marketing-detail" hidden aria-label="Orders behind this report"></section>
  <p class="help-text marketing-footnote">Sales using an offer show attribution, not proof of additional sales. Product sales exclude delivery, refunds, cancelled or expired orders, POS orders and explicitly marked test orders. Later purchases must be placed and paid after the first paid redemption, within the same 30 days. Older source labels may be incomplete.</p>`;
 function closeDetail(){detailRequest++;group=null;ledgerId=null;offset=0;$('.marketing-detail').hidden=true;}
 const pagination=r=>`<div class="marketing-pagination"><button class="button button-secondary" data-insight="previous" ${offset?'':'disabled'}>Previous</button><span>${r.total?`${offset+1}–${Math.min(offset+r.limit,r.total)} of ${number(r.total)}`:'No entries'}</span><button class="button button-secondary" data-insight="next" ${offset+r.limit<r.total?'':'disabled'}>Next</button></div>`;
 function cohortCard(g,i){
  const newsletter=g.kind==='newsletter',title=newsletter?(sources[g.group_key]||g.label):g.label;
  return `<article class="panel marketing-cohort"><div class="section-heading"><div><span class="eyebrow">${newsletter?'Newsletter':'Automatic offer'}</span><h2>${esc(title)}</h2></div><span class="badge">${g.collecting?'Still collecting':'30-day results'}</span></div>
   <dl class="marketing-metrics">${metric(newsletter?'First signups':'Vouchers issued',number(newsletter?g.people:g.issued),newsletter?`${number(g.issued)} received the original welcome code`:'In the selected month')}
   ${metric('Ready to compare',number(g.eligible_issued),'Codes with a complete 30-day window')}
   ${metric('Codes used',number(g.redeemed),`${rate(g.redeemed,g.eligible_issued)} of ready codes`)}
   ${metric('Paid product sales',money(g.sales_cents),`${number(g.paid_orders)} paid orders · after discounts`)}
   ${metric('Products before discount',money(g.gross_cents),'Before delivery')}
   ${metric('Discounts used',money(g.discount_cents),'Delivery excluded')}
   ${metric('Bought again',number(g.later_customers),`${rate(g.later_customers,g.redeemed_customers)} of redeeming customers`)}</dl>
   ${g.collecting?`<p class="help-text">${number(g.collecting)} recipients are still collecting results${g.next_ready_at?`; the next window ends ${esc(when(g.next_ready_at))} (Manila)`:''}. Their outcomes are not included yet.</p>`:''}
   ${g.legacy_attribution?'<p class="help-text">Includes historical signup sources. Earlier rejoins may have changed the saved source; unknown originals are reported separately.</p>':''}
   <button class="button button-secondary" data-insight="orders" data-index="${i}" ${g.paid_orders?'':'disabled'}>View ${number(g.paid_orders)} source orders</button></article>`;
 }
 function affiliateCard(a){return `<article class="panel marketing-cohort"><div class="section-heading"><h2>${esc(a.name)}</h2><span class="badge">${a.active?'Active':'Paused'}</span></div><dl class="marketing-metrics">
  ${metric('Paid product sales',money(a.sales_cents),`${number(a.paid_orders)} paid orders`)}${metric('Awaiting completion',money(a.estimated_cents),'Estimated commission')}
  ${metric('Earned commission',money(a.earned_cents),'Ledger credits less reversals')}${metric('Payments recorded',money(a.paid_cents),'Voided payments excluded')}
  ${metric(a.balance_cents<0?'Offset against future earnings':'Commission to pay',money(Math.abs(a.balance_cents)))}</dl><div class="row-actions"><button class="button button-secondary" data-insight="affiliate" data-id="${esc(a.id)}">Orders & payout history</button><button class="button button-secondary" data-insight="ledger" data-id="${esc(a.id)}">Commission ledger</button></div></article>`;}
 async function load(){
  const month=$('[name="cohort-month"]').value;if(tab==='offers'&&!$('[name="cohort-month"]').reportValidity())return;
  closeDetail();const seq=++request;$('.marketing-results').setAttribute('aria-busy','true');$('.marketing-results').innerHTML='<p class="notice" role="status">Loading your report…</p>';
  $('[data-insight="refresh"]').disabled=true;
  try{
   const r=await api(tab==='offers'?'marketing_insights':'marketing_affiliates',{month});
   if(disposed||seq!==request)return;
   if(tab==='offers'){
    groups=r.groups;$('.marketing-results').innerHTML=(r.missing_payment_records?'<p class="notice">Some paid website orders have no payment approval timestamp. They cannot be included in timed cohorts. Review their payment records before comparing results.</p>':'')+
     (groups.length?`<div class="marketing-grid">${groups.map(cohortCard).join('')}</div>`:'<section class="panel"><h2>No recipients in this month yet</h2><p>Choose another month, or return after the first newsletter signup or automatic voucher is issued.</p></section>');
   }else $('.marketing-results').innerHTML=r.rows.length?`<div class="marketing-grid">${r.rows.map(affiliateCard).join('')}</div>`:'<section class="panel"><h2>No affiliates yet</h2><p>Your partners will appear here after you add them in Affiliates.</p></section>';
  }catch(e){if(!disposed&&seq===request)$('.marketing-results').innerHTML=`<p class="notice" role="alert">Could not load this report. ${esc(e.message)}</p><button class="button button-secondary" data-insight="refresh">Try again</button>`;}
  finally{if(!disposed&&seq===request){$('.marketing-results').setAttribute('aria-busy','false');$('[data-insight="refresh"]').disabled=false;}}
 }
 async function details(){
  const selected=group,seq=++detailRequest,month=$('[name="cohort-month"]').value,box=$('.marketing-detail');box.hidden=false;
  box.innerHTML='<p role="status">Loading source orders…</p>';box.setAttribute('aria-busy','true');
  try{
   const r=await api('marketing_cohort_orders',{month,kind:selected.kind,group_key:selected.group_key,offset});
   if(disposed||seq!==detailRequest)return;
   box.innerHTML=`<div class="section-heading"><h2 tabindex="-1">Source orders · ${esc(selected.kind==='newsletter'?(sources[selected.group_key]||selected.label):selected.label)}</h2><button class="button button-secondary" data-insight="close">Close</button></div>
    <p>${number(r.total)} paid orders · ${money(r.totals.sales_cents)} product sales after discounts · completed 30-day windows only.</p>
    ${r.rows.length?`<ul class="marketing-orders">${r.rows.map(o=>`<li><div><button class="marketing-order-link" data-insight="order" data-id="${esc(o.id)}">${esc(o.reference)}</button><small>Paid ${esc(when(o.approved_at))} · ${esc(o.code)}</small></div><strong>${money(o.sales_cents)}</strong></li>`).join('')}</ul>`:'<p>No eligible orders remain. Refresh the report if an order was changed or refunded.</p>'}
    ${pagination(r)}`;
   box.querySelector('h2').focus({preventScroll:true});box.scrollIntoView({block:'nearest'});
  }catch(e){if(!disposed&&seq===detailRequest)box.innerHTML=`<p role="alert">Could not load source orders. ${esc(e.message)}</p><button class="button button-secondary" data-insight="retry-detail">Try again</button><button class="button button-secondary" data-insight="close">Close</button>`;}
  finally{if(!disposed&&seq===detailRequest)box.setAttribute('aria-busy','false');}
 }
 async function ledger(){
  const seq=++detailRequest,box=$('.marketing-detail');box.hidden=false;box.innerHTML='<p role="status">Loading commission ledger…</p>';box.setAttribute('aria-busy','true');
  try{
   const r=await api('marketing_affiliate_ledger',{id:ledgerId,offset});if(disposed||seq!==detailRequest)return;
   box.innerHTML=`<div class="section-heading"><h2 tabindex="-1">Commission ledger</h2><button class="button button-secondary" data-insight="close">Close</button></div><p>${number(r.total)} entries · ${money(r.earned_cents)} earned after reversals · all time.</p><ul class="marketing-orders">${r.rows.map(e=>`<li><div><button class="marketing-order-link" data-insight="order" data-id="${esc(e.order_id)}">${esc(e.reference)}</button><small>${esc(e.reason)} · ${esc(when(e.created_at))}</small></div><strong>${money(e.amount_cents)}</strong></li>`).join('')}</ul>${pagination(r)}`;
   box.querySelector('h2').focus({preventScroll:true});box.scrollIntoView({block:'nearest'});
  }catch(e){if(!disposed&&seq===detailRequest)box.innerHTML=`<p role="alert">Could not load the commission ledger. ${esc(e.message)}</p><button class="button button-secondary" data-insight="retry-detail">Try again</button><button class="button button-secondary" data-insight="close">Close</button>`;}
  finally{if(!disposed&&seq===detailRequest)box.setAttribute('aria-busy','false');}
 }
 function change(e){if(e.target.name==='cohort-month')void load();}
 async function click(e){
  const b=e.target.closest('[data-insight]');if(!b||b.disabled)return;e.preventDefault();e.stopPropagation();const action=b.dataset.insight;
  if(action==='offers'||action==='affiliates'){
   tab=action;$('.marketing-filter').hidden=tab==='affiliates';$('.marketing-footnote').hidden=tab==='affiliates';
   $('[data-method]').textContent=tab==='affiliates'?'All-time reconciliation. Sales exclude delivery, unpaid, cancelled, expired, refunded and self-purchase orders. Earned commission comes from the ledger, including reversals. Estimates are not yet payable. Each partner’s balance is kept separate.':'Newsletter groups use each customer’s first confirmed signup. Automatic offers use the voucher’s issue date. Each recipient gets the same 30-day observation window. Results include only recipients whose full window has ended.';
   for(const button of root.querySelectorAll('.marketing-tabs button')){const active=button.dataset.insight===tab;button.setAttribute('aria-pressed',String(active));button.classList.toggle('button-secondary',!active);}void load();
  }else if(action==='refresh')void load();
  else if(action==='orders'){group=groups[Number(b.dataset.index)];ledgerId=null;offset=0;void details();}
  else if(action==='ledger'){ledgerId=b.dataset.id;group=null;offset=0;void ledger();}
  else if(action==='next'||action==='previous'){offset=Math.max(0,offset+(action==='next'?50:-50));void (ledgerId?ledger():details());}
  else if(action==='retry-detail')void (ledgerId?ledger():details());
  else if(action==='close'){closeDetail();$('[data-insight="refresh"]').focus();}
  else if(action==='affiliate')openAffiliate(b.dataset.id);
  else if(action==='order'){
   b.disabled=true;
   try{await openOrder(b.dataset.id);}catch(error){if(!disposed){const note=document.createElement('p');note.className='notice';note.setAttribute('role','alert');note.textContent='Could not open this order. '+error.message;$('.marketing-detail').prepend(note);}}
   finally{b.disabled=false;}
  }
 }
 root.addEventListener('change',change);root.addEventListener('click',click);void load();
 return {destroy(){disposed=true;request++;detailRequest++;root.removeEventListener('change',change);root.removeEventListener('click',click);}};
}
