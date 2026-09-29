import {api,money,escapeHtml as esc} from './client.js';
const date=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export const voucherValue=v=>v.kind==='fixed'?`${money(v.value)} off`:`${v.value}% off`;
export const voucherTerms=v=>`Minimum product spend ${money(v.min_subtotal_cents)}${v.kind==='percent'?` · Up to ${money(v.cap_cents)} off`:''}`;

export function mountVouchers(root){
 if(!root)return {refresh(){},destroy(){}};
 let alive=true,tab='available',offset=0,request=0;
 function header(counts={}){return `<div class="account-orders-heading"><div><h2>My vouchers</h2><p>A little something for your next order.</p></div><button type="button" class="button button-secondary" data-voucher-refresh>Refresh</button></div><div class="voucher-tabs" aria-label="Voucher status">${[['available','Available'],['used','Used'],['expired','Expired / unavailable']].map(([key,label])=>`<button type="button" data-voucher-tab="${key}" aria-pressed="${tab===key}">${label}${counts[key]!==undefined?` <span>${counts[key]}</span>`:''}</button>`).join('')}</div>`;}
 function card(v){return `<article class="voucher-card"><div class="voucher-card-top"><span class="eyebrow">${v.source==='newsletter'?'Newsletter treat':'A thank-you from Elio'}</span><span class="badge">${esc(v.status==='reserved'?'Reserved for an order':v.status)}</span></div><h3>${esc(voucherValue(v))} your next order</h3><p>${esc(v.title)}</p><p class="voucher-terms">${esc(voucherTerms(v))}<br>Valid until ${esc(date(v.expires_at))} · Manila time</p><p class="voucher-code">${esc(v.code)}</p>${v.status==='reserved'?'<p class="voucher-note">This voucher is attached to an unpaid order. Open Your orders to finish payment.</p>':v.status==='inactive'?'<p class="voucher-note">This offer is no longer available. Contact Elio if you need help.</p>':''}<div class="voucher-actions">${v.status==='available'?`<a class="button" href="order.html#voucher=${encodeURIComponent(v.code)}">Use at checkout</a>`:''}<button class="button button-secondary" type="button" data-voucher-copy="${esc(v.code)}">Copy code</button></div></article>`;}
 async function refresh(focus){
  const version=++request;root.innerHTML=header()+'<p role="status">Loading your vouchers…</p>';
  try{
   const data=await api('my_vouchers',{status:tab,offset});if(!alive||version!==request)return;
   root.innerHTML=header(data.counts)+`<div class="voucher-grid">${data.vouchers.map(card).join('')||'<p class="voucher-empty">No vouchers here yet. Eligible offers will appear automatically.</p>'}</div><p class="voucher-note">Website orders only. One code per order; delivery is excluded. Your newsletter code keeps its original expiry.</p><div class="voucher-pagination">${offset?'<button class="button button-secondary" data-voucher-page="previous">Previous</button>':''}${offset+data.limit<data.total?'<button class="button button-secondary" data-voucher-page="next">Next</button>':''}</div><p data-voucher-message role="status"></p>`;
   if(focus)root.querySelector(focus)?.focus();
  }catch(error){if(alive&&version===request)root.innerHTML=header()+`<p class="notice" role="alert">${esc(error.message||'Your vouchers could not load. Try again.')}</p>`;}
 }
 root.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-voucher-refresh'))return refresh('[data-voucher-refresh]');
  if(button.dataset.voucherTab){tab=button.dataset.voucherTab;offset=0;return refresh(`[data-voucher-tab="${tab}"]`);}
  if(button.dataset.voucherPage){offset=Math.max(0,offset+(button.dataset.voucherPage==='next'?50:-50));return refresh();}
  if(button.dataset.voucherCopy){const message=root.querySelector('[data-voucher-message]');try{await navigator.clipboard.writeText(button.dataset.voucherCopy);if(message)message.textContent='Code copied.';}catch{if(message)message.textContent='Copy is unavailable. Select the code above to copy it.';}}
 });
 void refresh();return {refresh,destroy(){alive=false;request++;root.replaceChildren();}};
}
