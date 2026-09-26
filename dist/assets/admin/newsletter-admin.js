import { api, newsletterRequest, escapeHtml as esc, toast, money } from './client.js';

const fields = ['subject', 'title', 'body', 'image_url', 'cta_label', 'cta_url'];
const blankCampaign = () => ({subject:'',title:'',body:'',image_url:'',cta_label:'',cta_url:'',status:'draft'});
const label = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
const badge = status => `<span class="badge ${esc(status)}">${esc(label(status))}</span>`;
const field = (name, title, value, extra = '', help = '') => `<label class="field">${title}<input name="${name}" value="${esc(value || '')}" ${extra}>${help ? `<small>${help}</small>` : ''}</label>`;
const safeHttps = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const date = value => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(parsed)+' PHT' : '—'; };
const previewData = {
  counts:{subscribed:2,pending:1,unsubscribed:1},total:0,subscribers:[],
  campaigns:[{id:'preview-draft',revision:1,status:'draft',subject:'A little something from Elio',title:'A new moment to savor.',body:'A little news from our kitchen.\n\nDiscover the flavors we have been baking for you.',image_url:'',cta_label:'Explore our boxes',cta_url:'https://example.com/order.html',updated_at:null}],
};

export function createNewsletterAdmin({connected,owner,showDialog,closeDialog}) {
  const state = {tab:'subscribers',search:'',status:'',offset:0,limit:25,offerSearch:'',offerStatus:'',offerOffset:0,offerLimit:25,data:null,loading:false,error:'',draft:blankCampaign(),dirty:false,busy:false};
  let root,requestId=0;
  const editable = () => connected() && owner();
  const readonly = () => !editable() || state.draft.status !== 'draft';
  const disabled = value => value ? 'disabled' : '';
  const data = () => connected() ? state.data : previewData;

  function render() {
    return '<section class="newsletter-admin" data-newsletter-admin></section>';
  }
  function mount(container) {
    root = container.querySelector('[data-newsletter-admin]');
    if (!root) return;
    root.addEventListener('click',handleClick);
    root.addEventListener('submit',handleSubmit);
    root.addEventListener('input',event => {
      if (!event.target.closest('[data-nl-editor]')) return;
      if (fields.includes(event.target.name)) state.draft[event.target.name] = event.target.value;
      state.dirty = true;
      const note = root.querySelector('[data-nl-save-state]');
      if (note) note.textContent = 'Unsaved changes';
    });
    paint();
    if (editable()) load();
  }
  function paint() {
    if (!root?.isConnected) return;
    if (connected() && !owner()) {
      root.innerHTML = '<div class="view-heading"><div><h1>Newsletter</h1><p>Only an owner can manage subscribers and send newsletters.</p></div></div>';
      return;
    }
    const report = data();
    const counts = report?.counts || {};
    root.innerHTML = `<div class="view-heading"><div><span class="eyebrow">Elio Basque Cheesecake</span><h1>Newsletter</h1><p>Keep in touch with the people who asked to hear from Elio.</p></div><button type="button" class="button button-secondary" data-nl-action="refresh" ${disabled(!editable()||state.loading||state.busy)}>Refresh</button></div>
      ${!connected() ? '<p class="notice">Read-only newsletter preview. Connect your owner account to manage subscribers, preview emails, and send.</p>' : ''}
      ${state.tab!=='offers'?`<div class="newsletter-metrics">${[['Confirmed subscribers',counts.subscribed],['Awaiting confirmation',counts.pending],['Unsubscribed',counts.unsubscribed]].map(([name,count])=>`<div class="panel"><span>${name}</span><strong>${Number.isFinite(Number(count))?Number(count).toLocaleString():'—'}</strong></div>`).join('')}</div>`:''}
      <div class="newsletter-tabs" role="group" aria-label="Newsletter sections">${[['subscribers','Subscribers'],['campaigns','Newsletters'],['offers','Welcome offers']].map(([tab,title])=>`<button type="button" class="button ${state.tab===tab?'':'button-secondary'}" data-nl-action="tab" data-tab="${tab}" aria-pressed="${state.tab===tab}">${title}</button>`).join('')}</div>
      ${state.error?`<p class="form-error newsletter-error" role="alert">${esc(state.error)}</p>`:''}
      ${state.loading?'<p class="muted" role="status">Updating newsletter details…</p>':''}
      ${state.tab==='subscribers'?subscribersView(report):state.tab==='offers'?offersView(report):campaignsView(report)}`;
  }
  function subscribersView(report) {
    const rows=report?.subscribers||[],total=Number(report?.total)||0;
    return `<section class="panel"><form class="newsletter-filters" data-nl-filter>
      ${field('search','Search subscribers',state.search,'type="search" maxlength="254" placeholder="Email address"')}
      <label class="field">Status<select name="status">${[['','All statuses'],['subscribed','Confirmed'],['pending','Awaiting confirmation'],['unsubscribed','Unsubscribed']].map(([value,text])=>`<option value="${value}" ${state.status===value?'selected':''}>${text}</option>`).join('')}</select></label>
      <button type="submit" class="button button-secondary" ${disabled(!editable()||state.loading)}>Apply filters</button></form>
      <p class="muted">New subscribers receive a personal 5% welcome code after confirming their email. ₱500 minimum · ₱100 maximum discount · 14 days from confirmation.</p>
      ${rows.length?`<div class="table-wrap"><table class="data-table newsletter-subscribers"><thead><tr><th>Email / source</th><th>Status</th><th>Confirmed / joined · Manila</th><th>Welcome code</th><th>Action</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.email)}</strong><small>${esc(label(row.source))}</small></td><td>${badge(row.status==='subscribed'?'confirmed':row.status)}</td><td>${esc(date(row.confirmed_at||row.created_at))}</td><td>${row.offer_code?`<strong class="newsletter-code">${esc(row.offer_code)}</strong><small>Expires ${esc(date(row.offer_expires_at))}</small>`:'—'}</td><td>${row.status!=='unsubscribed'?`<button type="button" class="button button-quiet" data-nl-action="unsubscribe" data-id="${esc(row.id)}" ${disabled(!editable()||state.loading)}>Unsubscribe</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:`<p class="newsletter-empty">${!report&&state.loading?'Loading subscribers…':!connected()?'Subscriber details appear here after you connect.':state.search||state.status?'No subscribers match these filters.':'No subscribers yet. Confirmed signups will appear here.'}</p>`}
      <div class="newsletter-pagination"><span>${total?`${state.offset+1}–${Math.min(state.offset+rows.length,total)} of ${total.toLocaleString()} subscribers`:'0 subscribers'}</span><div class="row-actions"><button type="button" class="button button-secondary" data-nl-action="previous" ${disabled(!editable()||state.loading||state.offset===0)}>Previous</button><button type="button" class="button button-secondary" data-nl-action="next" ${disabled(!editable()||state.loading||state.offset+state.limit>=total)}>Next</button></div></div></section>`;
  }
  function offersView(report) {
    const counts=report?.offer_counts||{},rows=report?.offers||[],total=Number(report?.offer_total)||0;
    const metrics=[['Codes issued',counts.issued],['Unused & active',counts.unused],['Reserved',counts.reserved],['Redeemed',counts.redeemed],['Expired',counts.expired],['Inactive',counts.inactive],['Paid orders',counts.paid_order_count],['Product sales',money(counts.sales_cents)],['Discounts given',money(counts.discount_cents)]];
    return `<div class="newsletter-metrics newsletter-offer-metrics">${metrics.map(([name,value])=>`<div class="panel"><span>${name}</span><strong>${esc(value??'—')}</strong></div>`).join('')}</div><section class="panel"><h2>Newsletter welcome offers</h2><p class="muted">All-time totals. Codes apply to products and option surcharges: 5% off · ₱500 minimum · ₱100 maximum discount · 14 days from confirmation. Delivery is excluded.</p><p class="muted">Reserved means awaiting payment or review. Redeemed codes remain used after a paid cancellation or refund. Paid orders, product sales, and discounts exclude cancelled, expired, or refunded orders; product sales are after discounts and exclude delivery.</p>
      <form class="newsletter-filters" data-nl-offer-filter>${field('offer_search','Search email or code',state.offerSearch,'type="search" maxlength="254"')}<label class="field">Offer status<select name="offer_status">${[['','All statuses'],['active','Unused & active'],['reserved','Reserved'],['used','Redeemed'],['expired','Expired'],['inactive','Inactive']].map(([value,text])=>`<option value="${value}" ${state.offerStatus===value?'selected':''}>${text}</option>`).join('')}</select></label><button type="submit" class="button button-secondary" ${disabled(!editable()||state.loading)}>Apply filters</button></form>
      ${rows.length?`<div class="table-wrap"><table class="data-table newsletter-offers"><thead><tr><th>Subscriber / code</th><th>Issued / expires · Manila</th><th>Status</th><th>Paid orders</th><th>Product sales</th><th>Discounts</th></tr></thead><tbody>${rows.map(offer=>`<tr><td><strong>${esc(offer.email)}</strong><small class="newsletter-code">${esc(offer.code)}</small></td><td>${esc(date(offer.issued_at))}<small>Expires ${esc(date(offer.expires_at))}</small></td><td>${badge(offer.status||'inactive')}</td><td>${Number(offer.paid_order_count)||0}</td><td>${money(offer.sales_cents)}</td><td>${money(offer.discount_cents)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="newsletter-empty">No welcome offers match these filters.</p>'}
      <div class="newsletter-pagination"><span>${total?`${state.offerOffset+1}–${Math.min(state.offerOffset+rows.length,total)} of ${total.toLocaleString()} offers`:'0 offers'}</span><div class="row-actions"><button type="button" class="button button-secondary" data-nl-action="offer-previous" ${disabled(!editable()||state.loading||state.offerOffset===0)}>Previous</button><button type="button" class="button button-secondary" data-nl-action="offer-next" ${disabled(!editable()||state.loading||state.offerOffset+state.offerLimit>=total)}>Next</button></div></div></section>`;
  }
  function campaignsView(report) {
    const campaign=state.draft,locked=readonly()||state.busy;
    return `<div class="newsletter-compose-layout"><section class="panel newsletter-editor"><div class="section-heading"><h2>${campaign.id?'Newsletter details':'Compose a newsletter'}</h2><button type="button" class="button button-secondary" data-nl-action="new" ${disabled(state.busy)}>New draft</button></div>
      ${campaign.status!=='draft'?`<p class="notice">This newsletter is ${esc(label(campaign.status).toLowerCase())}. Its saved content is read-only.</p>`:''}
      <form data-nl-editor><fieldset ${disabled(locked)}>
        ${field('subject','Email subject',campaign.subject,'required maxlength="150" placeholder="A little news from Elio"')}
        ${field('title','Heading inside the email',campaign.title,'required maxlength="160" placeholder="A new moment to savor."')}
        <label class="field">Message<textarea name="body" rows="9" required maxlength="12000" placeholder="Write your newsletter here…">${esc(campaign.body)}</textarea><small>Use a blank line between paragraphs. Elio’s email design and unsubscribe footer are added automatically.</small></label>
        ${field('image_url','Image URL · optional',campaign.image_url,'type="url" maxlength="2048" placeholder="https://…"','Use an HTTPS link to a product photo or newsletter image.')}
        <div class="field-row">${field('cta_label','Button text · optional',campaign.cta_label,'maxlength="60" placeholder="Explore our boxes"')}${field('cta_url','Button link · optional',campaign.cta_url,'type="url" maxlength="2048" placeholder="https://…"')}</div>
      </fieldset><p class="muted newsletter-save-state" data-nl-save-state>${state.dirty?'Unsaved changes':campaign.id?`Saved ${esc(date(campaign.updated_at))}`:'Your draft has not been saved yet.'}</p>
      <div class="newsletter-editor-actions"><button type="submit" class="button button-secondary" ${disabled(locked)}>Save draft</button><button type="button" class="button button-secondary" data-nl-action="preview" ${disabled(!editable()||state.busy)}>Preview email</button><button type="button" class="button button-secondary" data-nl-action="test" ${disabled(!editable()||state.busy)}>Send a test</button><button type="button" class="button" data-nl-action="review" ${disabled(locked)}>Review & send</button></div>
      <p class="form-error" data-nl-editor-error role="alert"></p></form></section>
      <section class="panel newsletter-campaign-list"><h2>Saved newsletters</h2><p class="muted">Drafts can be edited. Sending adds one email per confirmed subscriber to the delivery queue.</p>
      ${(report?.campaigns||[]).length?`<ul>${report.campaigns.map(item=>`<li><button type="button" data-nl-action="open" data-id="${esc(item.id)}"><strong>${esc(item.subject||'Untitled newsletter')}</strong><span>${badge(item.status)} · ${esc(date(item.updated_at||item.created_at))}</span>${item.status!=='draft'?`<small>${Number(item.queued_count)||0} queued · ${Number(item.sent_count)||0} accepted · ${Number(item.failed_count)||0} failed</small>`:''}</button></li>`).join('')}</ul>`:'<p class="newsletter-empty">Your saved drafts and sent newsletters will appear here.</p>'}</section></div>`;
  }
  async function load() {
    if (!editable()) return;
    const id=++requestId;state.loading=true;state.error='';paint();
    try {
      const result=await api('newsletter_admin',{limit:state.limit,offset:state.offset,search:state.search,status:state.status,offer_limit:state.offerLimit,offer_offset:state.offerOffset,offer_search:state.offerSearch,offer_status:state.offerStatus});
      if(id!==requestId)return;
      state.data=result;
      if(state.offset&&state.offset>=Number(result.total)){state.offset=Math.max(0,Math.ceil(Number(result.total)/state.limit)-1)*state.limit;return load();}
    } catch(error) {if(id===requestId)state.error=error.message||'Newsletter details could not be loaded. Try Refresh.';}
    finally {if(id===requestId){state.loading=false;paint();}}
  }
  function readCampaign() {
    const form=root?.querySelector('[data-nl-editor]');
    if(form&&!form.reportValidity())return null;
    const campaign={...state.draft};
    for(const key of fields)campaign[key]=String(campaign[key]||'').trim();
    if(!campaign.subject||!campaign.title||!campaign.body)throw new Error('Add a subject, heading, and message before continuing.');
    if(campaign.image_url&&!safeHttps(campaign.image_url))throw new Error('Use an HTTPS image URL without a username or password.');
    if(Boolean(campaign.cta_label)!==Boolean(campaign.cta_url))throw new Error('Add both button text and a button link, or leave both blank.');
    if(campaign.cta_url&&!safeHttps(campaign.cta_url))throw new Error('Use an HTTPS button link without a username or password.');
    return campaign;
  }
  function errorMessage(message) {const box=root?.querySelector('[data-nl-editor-error]');if(box)box.textContent=message;else toast(message,'error');}
  async function save(campaign) {
    const saved=await api('newsletter_save_campaign',{campaign});
    state.draft={...campaign,...(saved.campaign||saved)};state.dirty=false;
    const campaigns=state.data?.campaigns||[];
    if(state.data)state.data.campaigns=[state.draft,...campaigns.filter(item=>item.id!==state.draft.id)];
    return state.draft;
  }
  async function editorAction(action) {
    if(!editable()||state.busy)return;
    let campaign;
    try {campaign=readCampaign();if(!campaign)return;} catch(error){errorMessage(error.message);return;}
    state.busy=true;paint();
    try {
      if(action==='save'){await save(campaign);toast('Newsletter draft saved.');return;}
      if(action==='test'){showTest(campaign);return;}
      if(action==='review')campaign=await save(campaign);
      const preview=await newsletterRequest({action:'preview_campaign',campaign});
      if(typeof preview?.html!=='string')throw new Error('The email preview could not be prepared. Please try again.');
      if(!root?.isConnected)return;
      showPreview(campaign,preview,action==='review');
    } catch(error){state.error=error.message||'The newsletter could not be prepared. Please try again.';}
    finally{state.busy=false;paint();}
  }
  function showPreview(campaign,preview,review) {
    const count=Number(preview.recipient_count),valid=Number.isSafeInteger(count)&&count>=0;
    const revision=preview.revision??preview.campaign_revision??campaign.revision;
    if(review&&(!valid||!Number.isSafeInteger(Number(revision))))throw new Error('The current recipient count could not be verified. Please refresh and review again.');
    const message=review?`<p class="notice newsletter-send-summary">Send <strong>${esc(campaign.subject)}</strong> to <strong>${count.toLocaleString()} confirmed subscriber${count===1?'':'s'}</strong>.</p><p class="muted">Recipients who unsubscribe before delivery are skipped. This newsletter can be queued only once.</p>`:`<p class="muted">Subject: <strong>${esc(campaign.subject)}</strong></p>`;
    showDialog(review?'Review newsletter before sending':'Newsletter preview',`<div class="newsletter-preview-dialog">${message}<iframe class="newsletter-email-preview" title="Branded newsletter preview" sandbox="" referrerpolicy="no-referrer"></iframe>${review?`<form data-nl-send><label class="check-field"><input type="checkbox" name="reviewed" required ${disabled(count===0)}><span>I have checked this newsletter and its recipient count.</span></label>${count===0?'<p class="muted">There are no confirmed subscribers to receive this newsletter.</p>':''}<p class="form-error" data-nl-send-error role="alert"></p><div class="dialog-actions"><button type="button" class="button button-secondary" data-nl-cancel>Keep as draft</button><button type="submit" class="button" ${disabled(count===0)}>Send to ${count.toLocaleString()} subscriber${count===1?'':'s'}</button></div></form>`:'<div class="dialog-actions"><button type="button" class="button" data-nl-cancel>Close preview</button></div>'}</div>`);
    const dialog=document.querySelector('#admin-dialog'),frame=dialog.querySelector('iframe');frame.srcdoc=preview.html;
    dialog.querySelector('[data-nl-cancel]').onclick=closeDialog;
    const form=dialog.querySelector('[data-nl-send]');
    if(!form)return;
    let sending=false;
    form.onsubmit=async event=>{
      event.preventDefault();if(sending||!form.reportValidity()||!editable())return;
      sending=true;const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Adding to delivery queue…';
      try {
        const result=await api('newsletter_send_campaign',{campaign_id:campaign.id,expected_revision:Number(revision),expected_recipient_count:count});
        state.draft={...campaign,status:result.status||'queued'};state.dirty=false;
        if(form.isConnected)closeDialog();toast(`${Number(result.queued??result.queued_count)||0} newsletter emails added to the delivery queue.`);await load();
      } catch(error){if(form.isConnected)form.querySelector('[data-nl-send-error]').textContent=error.message||'Sending could not be confirmed. Refresh the newsletter before trying again.';else toast(error.message,'error');}
      finally{sending=false;if(form.isConnected){button.disabled=false;button.textContent=`Send to ${count.toLocaleString()} subscriber${count===1?'':'s'}`;}}
    };
  }
  function showTest(campaign) {
    showDialog('Send a test newsletter',`<form data-nl-test><p class="muted">Send this draft to one address you control. It will not be sent to the subscriber list.</p>${field('recipient','Test recipient email','','type="email" required maxlength="254" autocomplete="email"')}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button button-secondary" data-nl-cancel>Cancel</button><button type="submit" class="button">Send test email</button></div></form>`);
    const form=document.querySelector('[data-nl-test]');form.querySelector('[data-nl-cancel]').onclick=closeDialog;
    let sending=false;
    form.onsubmit=async event=>{
      event.preventDefault();if(sending||!form.reportValidity()||!editable())return;
      sending=true;const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Queueing test…';
      try {await newsletterRequest({action:'test_campaign',campaign,recipient:form.elements.recipient.value.trim()});if(form.isConnected)closeDialog();toast('Test newsletter added to the delivery queue.');}
      catch(error){if(form.isConnected)form.querySelector('.form-error').textContent=error.message;else toast(error.message,'error');}
      finally{sending=false;if(form.isConnected){button.disabled=false;button.textContent='Send test email';}}
    };
  }
  function unsubscribe(id) {
    if(!editable())return;
    const subscriber=state.data?.subscribers.find(row=>row.id===id);if(!subscriber)return;
    showDialog('Unsubscribe from the newsletter',`<form data-nl-unsubscribe><p>Stop newsletter emails to <strong>${esc(subscriber.email)}</strong>?</p><p class="muted">Order and account emails continue. Any welcome code already earned keeps its original terms and expiry.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button button-secondary" data-nl-cancel>Keep subscribed</button><button type="submit" class="button button-danger">Unsubscribe</button></div></form>`);
    const form=document.querySelector('[data-nl-unsubscribe]');form.querySelector('[data-nl-cancel]').onclick=closeDialog;
    let saving=false;
    form.onsubmit=async event=>{
      event.preventDefault();if(saving||!editable())return;saving=true;
      const button=form.querySelector('[type=submit]');button.disabled=true;
      try{await api('newsletter_admin_unsubscribe',{subscriber_id:id});if(form.isConnected)closeDialog();toast('Newsletter subscription cancelled.');await load();}
      catch(error){if(form.isConnected)form.querySelector('.form-error').textContent=error.message;else toast(error.message,'error');}
      finally{saving=false;if(form.isConnected)button.disabled=false;}
    };
  }
  function handleClick(event) {
    const button=event.target.closest('[data-nl-action]');if(!button||button.disabled||state.busy)return;
    const action=button.dataset.nlAction;
    if(action==='tab'){state.tab=button.dataset.tab;paint();}
    else if(action==='refresh')load();
    else if(action==='previous'||action==='next'){state.offset=Math.max(0,state.offset+(action==='next'?state.limit:-state.limit));load();}
    else if(action==='offer-previous'||action==='offer-next'){state.offerOffset=Math.max(0,state.offerOffset+(action==='offer-next'?state.offerLimit:-state.offerLimit));load();}
    else if(action==='new'){state.draft=blankCampaign();state.dirty=false;state.error='';paint();root.querySelector('[name=subject]')?.focus();}
    else if(action==='open'){const campaign=data()?.campaigns.find(item=>item.id===button.dataset.id);if(campaign){state.draft={...blankCampaign(),...campaign};state.dirty=false;state.error='';paint();root.querySelector('[name=subject]')?.focus();}}
    else if(action==='unsubscribe')unsubscribe(button.dataset.id);
    else if(['preview','review','test'].includes(action))editorAction(action);
  }
  function handleSubmit(event) {
    if(event.target.matches('[data-nl-offer-filter]')){
      event.preventDefault();if(!editable()||state.loading)return;
      state.offerSearch=event.target.elements.offer_search.value.trim();state.offerStatus=event.target.elements.offer_status.value;state.offerOffset=0;load();
    } else if(event.target.matches('[data-nl-filter]')){
      event.preventDefault();if(!editable()||state.loading)return;
      state.search=event.target.elements.search.value.trim();state.status=event.target.elements.status.value;state.offset=0;load();
    } else if(event.target.matches('[data-nl-editor]')) {event.preventDefault();editorAction('save');}
  }
  return {render,mount,selectTab:tab=>{if(['subscribers','campaigns','offers'].includes(tab))state.tab=tab;}};
}
