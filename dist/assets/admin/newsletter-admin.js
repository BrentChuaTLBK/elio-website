import {newsletterOfferSummary} from '../shop/newsletter-offer.js';
import {api,escapeHtml as esc,toast,money} from './client.js';
import {createNewsletterCampaigns} from './newsletter-campaigns.js';
const label = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
const badge = status => `<span class="badge ${esc(status)}">${esc(label(status))}</span>`;
const field = (name, title, value, extra = '', help = '') => `<label class="field">${title}<input name="${name}" value="${esc(value || '')}" ${extra}>${help ? `<small>${help}</small>` : ''}</label>`;
const safeHttps = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const date = value => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(parsed)+' PHT' : '—'; };

export function createNewsletterAdmin(options) {
 if(!options.offersOnly)return createNewsletterCampaigns(options);
 const {connected,owner}=options;
 const state={offerSearch:'',offerStatus:'',offerOffset:0,offerLimit:25,data:null,loading:false,busy:false,error:''};
 let root,requestId=0;
 const editable=()=>connected()&&owner();
 const disabled=value=>value?'disabled':'';
 function render(){return '<section class="newsletter-admin" data-newsletter-admin></section>';}
 function mount(container){root=container.querySelector('[data-newsletter-admin]');if(!root)return;root.addEventListener('click',handleClick);root.addEventListener('submit',handleSubmit);paint();if(editable())load();}
 function paint(){if(!root?.isConnected)return;root.innerHTML=`<div class="section-heading"><div><h2>Newsletter welcome codes</h2><p class="muted">Automatically issued to subscribers. View usage and results here; these codes cannot be edited or deleted.</p></div><button type="button" class="button button-secondary" data-nl-action="refresh" ${disabled(!editable()||state.loading||state.busy)}>Refresh</button></div>${state.error?`<p class="form-error" role="alert">${esc(state.error)}</p>`:''}${offerSettingsView(state.data)}${offersView(state.data)}`;}
  function offersView(report) {
    const counts=report?.offer_counts||{},rows=report?.offers||[],total=Number(report?.offer_total)||0;
    const metrics=[['Codes issued',counts.issued],['Active',counts.unused],['Reserved',counts.reserved],['Used',counts.redeemed],['Expired unused',counts.expired],['Inactive',counts.inactive],['Paid orders',counts.paid_order_count],['Product sales',money(counts.sales_cents)],['Discounts given',money(counts.discount_cents)]];
    return `<div class="newsletter-metrics newsletter-offer-metrics">${metrics.map(([name,value])=>`<div class="panel"><span>${name}</span><strong>${esc(value??'—')}</strong></div>`).join('')}</div><section class="panel"><h2>Newsletter welcome offers</h2><p class="muted">All-time totals. Codes apply to products and option surcharges: ${esc(newsletterOfferSummary(report?.settings))} Existing codes keep their issued terms.</p><p class="muted">Reserved means awaiting payment or review. Redeemed codes remain used after a paid cancellation or refund. Paid orders, product sales, and discounts exclude cancelled, expired, or refunded orders; product sales are after discounts and exclude delivery.</p>
      <form class="newsletter-filters" data-nl-offer-filter>${field('offer_search','Search email or code',state.offerSearch,'type="search" maxlength="254"')}<label class="field">Offer status<select name="offer_status">${[['','All statuses'],['active','Unused & active'],['reserved','Reserved'],['used','Redeemed'],['expired','Expired'],['inactive','Inactive']].map(([value,text])=>`<option value="${value}" ${state.offerStatus===value?'selected':''}>${text}</option>`).join('')}</select></label><button type="submit" class="button button-secondary" ${disabled(!editable()||state.loading)}>Apply filters</button></form>
      ${rows.length?`<div class="table-wrap"><table class="data-table newsletter-offers"><thead><tr><th>Subscriber / code</th><th>Issued / expires · Manila</th><th>Status</th><th>Paid orders</th><th>Product sales</th><th>Discounts</th></tr></thead><tbody>${rows.map(offer=>`<tr><td><strong>${esc(offer.email)}</strong><small class="newsletter-code">${esc(offer.code)}</small></td><td>${esc(date(offer.issued_at))}<small>Expires ${esc(date(offer.expires_at))}</small></td><td>${badge(offer.status||'inactive')}</td><td>${Number(offer.paid_order_count)||0}</td><td>${money(offer.sales_cents)}</td><td>${money(offer.discount_cents)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="newsletter-empty">No welcome offers match these filters.</p>'}
      <div class="newsletter-pagination"><span>${total?`${state.offerOffset+1}–${Math.min(state.offerOffset+rows.length,total)} of ${total.toLocaleString()} offers`:'0 offers'}</span><div class="row-actions"><button type="button" class="button button-secondary" data-nl-action="offer-previous" ${disabled(!editable()||state.loading||state.offerOffset===0)}>Previous</button><button type="button" class="button button-secondary" data-nl-action="offer-next" ${disabled(!editable()||state.loading||state.offerOffset+state.offerLimit>=total)}>Next</button></div></div></section>`;
  }
  function offerSettingsView(report) {
    const settings=report?.settings;
    return `<details class="panel newsletter-offer-settings" open><summary>Welcome offer settings</summary><p class="muted">Apply to newly issued codes. Existing codes and expiry dates stay unchanged. The signup popup, account signup and future welcome emails use these settings.</p><form data-nl-offer-settings><fieldset ${disabled(!editable()||state.loading||!settings?.revision)}><div class="newsletter-offer-setting-grid">${field('discount_percent','Discount · %',settings?.discount_percent??5,'type="number" min="1" max="100" step="1" required')}${field('min_subtotal','Minimum product spend · PHP',((settings?.min_subtotal_cents??50000)/100).toFixed(2),'type="number" min="0" max="1000000" step="0.01" required')}${field('cap','Maximum discount · PHP',((settings?.cap_cents??10000)/100).toFixed(2),'type="number" min="0.01" max="1000000" step="0.01" required')}${field('expiry_days','Expires after · days',settings?.expiry_days??14,'type="number" min="1" max="365" step="1" required','Starts when the subscriber joins.')}</div><p class="form-error" role="alert" data-offer-settings-error></p><button type="submit" class="button">Save welcome offer</button></fieldset></form></details>`;
  }

 async function load(){if(!editable())return;const id=++requestId;state.loading=true;state.error='';paint();try{const result=await api('newsletter_admin',{offer_limit:state.offerLimit,offer_offset:state.offerOffset,offer_search:state.offerSearch,offer_status:state.offerStatus});if(id===requestId)state.data=result;}catch(error){if(id===requestId)state.error=error.message;}finally{if(id===requestId){state.loading=false;paint();}}}
 function handleClick(event){const button=event.target.closest('[data-nl-action]');if(!button||button.disabled||state.busy)return;const action=button.dataset.nlAction;if(action==='refresh')load();else if(action==='offer-previous'||action==='offer-next'){state.offerOffset=Math.max(0,state.offerOffset+(action==='offer-next'?state.offerLimit:-state.offerLimit));load();}}
 function handleSubmit(event){if(event.target.matches('[data-nl-offer-settings]')){event.preventDefault();saveOfferSettings(event.target);}else if(event.target.matches('[data-nl-offer-filter]')){event.preventDefault();if(!editable()||state.loading)return;state.offerSearch=event.target.elements.offer_search.value.trim();state.offerStatus=event.target.elements.offer_status.value;state.offerOffset=0;load();}}
  async function saveOfferSettings(form) {
    if(!editable()||state.busy||state.loading||!form.reportValidity())return;
    const button=form.querySelector('[type=submit]'),error=form.querySelector('[data-offer-settings-error]');
    state.busy=true;button.disabled=true;error.textContent='';
    try {
      const settings={discount_percent:Number(form.elements.discount_percent.value),min_subtotal_cents:Math.round(Number(form.elements.min_subtotal.value)*100),cap_cents:Math.round(Number(form.elements.cap.value)*100),expiry_days:Number(form.elements.expiry_days.value),revision:state.data?.settings?.revision};
      const result=await api('newsletter_save_offer_settings',{settings});
      state.data.settings={...state.data.settings,...result};
      toast('Welcome offer saved. New codes will use these terms.');paint();
    } catch(e){error.textContent=e.message||'The settings could not be saved. Please try again.';}
    finally {state.busy=false;if(form.isConnected)button.disabled=false;}
  }

 return {render,mount};
}
