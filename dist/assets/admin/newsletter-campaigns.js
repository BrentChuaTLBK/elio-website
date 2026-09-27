import {api,newsletterRequest,upload,escapeHtml as esc,toast} from './client.js';
import {newsletterTemplates} from './newsletter-templates.js';
import {PHOTO_ACCEPT} from './photo-upload.js';

const fields=['subject','title','body','image_url','cta_label','cta_url','template'];
const blank=()=>({subject:'',title:'',body:'',image_url:'',cta_label:'',cta_url:'',template:'spotlight',status:'draft'});
const disabled=value=>value?'disabled':'';
const safeHttps=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const date=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' PHT':'Not saved yet';
const field=(name,title,value,extra='',help='')=>`<label class="field">${title}<input name="${name}" value="${esc(value||'')}" ${extra}>${help?`<small>${help}</small>`:''}</label>`;
const placeholder='<!doctype html><html><body style="margin:0;background:#f8f3ea;color:#786858;font:14px/1.6 Arial;text-align:center;padding:60px 24px">Your email preview will appear here.</body></html>';

export function createNewsletterCampaigns({connected,owner,showDialog,closeDialog,products=()=>[]}) {
 const state={editor:false,data:null,draft:blank(),dirty:false,busy:false,loading:false,error:'',previewMode:'desktop',previewHtml:'',previewKey:'',previewStatus:''};
 let root,loadId=0,previewId=0,previewTimer;
 const editable=()=>connected()&&owner();
 const locked=()=>!editable()||state.draft.status!=='draft'||state.busy;
 const report=()=>connected()?state.data:{counts:{subscribed:0},campaigns:[]};
 const count=()=>{const n=report()?.counts?.subscribed;return Number.isInteger(n)?`${n.toLocaleString()} current subscriber${n===1?'':'s'} · Owner only`:'Loading subscriber count…';};
 const template=()=>newsletterTemplates.find(t=>t.id===state.draft.template)||newsletterTemplates[0];
 function render(){return '<section class="newsletter-admin newsletter-workspace" data-newsletter-admin></section>';}
 function mount(container){
  root=container.querySelector('[data-newsletter-admin]');if(!root)return;
  root.addEventListener('click',handleClick);root.addEventListener('submit',event=>{if(event.target.matches('[data-nl-editor]')){event.preventDefault();editorAction('save');}});
  root.addEventListener('input',event=>{
   if(!event.target.closest('[data-nl-editor]')||!fields.includes(event.target.name)||locked())return;
   state.draft[event.target.name]=event.target.value;markDirty();schedulePreview();
  });
  root.addEventListener('change',event=>{
   if(event.target.matches('[data-nl-upload]'))uploadPhoto(event.target.files?.[0]);
   else if(event.target.matches('[data-nl-product-photo]')&&!locked()){
    const photo=photoOptions().find(p=>p.id===event.target.value);if(!photo)return;
    state.draft.image_url=photo.url;markDirty();paint();schedulePreview(true);
   }
  });
  paint();if(editable())load();
 }
 function paint(){
  if(!root?.isConnected)return;
  if(connected()&&!owner()){root.innerHTML='<h1>Newsletter</h1><p>Only owners can create and send newsletters.</p>';return;}
  const heading=`<div class="view-heading newsletter-page-heading"><div><span class="eyebrow">Elio Newsletter</span><h1>${state.editor?(state.draft.status==='draft'?'Create something lovely.':'Your newsletter.'):'Newsletters & offers'}</h1><p data-nl-count>${esc(count())}</p></div>${state.editor?`<button type="button" class="button button-secondary" data-nl-action="library" ${disabled(state.busy)}>← All newsletters</button>`:`<button type="button" class="button" data-nl-action="new" ${disabled(!editable()||state.busy)}>Create newsletter</button>`}</div>`;
  const editor=root.querySelector('.newsletter-editor');
  if(state.editor&&editor){
   // Keep the preview document mounted while uploads and saves repaint the form.
   // Repeated srcdoc navigation during a pending preview can blank the iframe.
   const next=document.createElement('template');next.innerHTML=editorView();
   editor.replaceWith(next.content.querySelector('.newsletter-editor'));
   root.querySelector('.newsletter-page-heading').outerHTML=heading;
   root.querySelector('[data-nl-page-error]').textContent=state.error;
   previewStatus(state.previewStatus);schedulePreview();return;
  }
  root.innerHTML=`${heading}
   ${!connected()?'<p class="notice">Preview only. Sign in as an owner to save drafts and send newsletters.</p>':''}
   <p class="form-error" role="alert" data-nl-page-error>${esc(state.error)}</p>
   ${state.editor?editorView():libraryView()}`;
  if(state.editor){const frame=root.querySelector('[data-nl-live-frame]');frame.srcdoc=state.previewHtml||placeholder;schedulePreview();}
 }
 function libraryView(){
  return `<section class="panel newsletter-starting-points"><h2>Choose a starting point</h2><div class="newsletter-template-grid">${newsletterTemplates.map(t=>`<button type="button" class="newsletter-template-card" data-nl-action="template" data-template="${t.id}" ${disabled(!editable())}><span class="newsletter-template-mini ${t.id}" aria-hidden="true"><span>ELIO</span><i></i><b></b><em></em></span><strong>${esc(t.name)}</strong><small>${esc(t.description)}</small></button>`).join('')}</div></section>
   <section class="panel newsletter-campaign-list newsletter-library-list"><h2>Your newsletters</h2>${state.dirty?'<p class="notice">You have an unsaved draft. <button type="button" class="button button-quiet" data-nl-action="resume">Continue editing →</button></p>':''}
   ${(report()?.campaigns||[]).length?`<ul>${report().campaigns.map(item=>`<li><button type="button" data-nl-action="open" data-id="${esc(item.id)}"><span><strong>${esc(item.subject||'Untitled newsletter')}</strong><small>${esc(date(item.updated_at||item.created_at))}</small></span><span class="newsletter-library-status"><span class="badge ${esc(item.broadcast?.status||item.status)}">${esc(item.broadcast?.status||item.status)}</span>${item.broadcast?`<small>Resend Broadcast · ${Number(item.queued_count)||0} reviewed recipients</small>${item.broadcast.error?`<small class="form-error">${esc(item.broadcast.error)}</small>`:''}`:item.status!=='draft'?`<small>${Number(item.queued_count)||0} queued · ${Number(item.sent_count)||0} accepted · ${Number(item.failed_count)||0} failed</small>`:''}<small>${item.status==='draft'?'Edit draft':'View newsletter'} →</small></span></button></li>`).join('')}</ul>`:`<p class="muted">${state.loading?'Loading your newsletters…':'No newsletters yet. Pick a template above to start your first draft.'}</p>`}
   <button type="button" class="button button-quiet" data-nl-action="refresh" ${disabled(!editable()||state.loading)}>Refresh delivery status</button></section>`;
 }
 function photoOptions(){return products().flatMap(product=>{
  const photo=product.photos?.[0];if(!photo)return [];
  try{const url=new URL(photo,'https://eliocheesecakes.com/').href;return safeHttps(url)?[{id:product.id,name:product.name,url}]:[];}catch{return [];}
 });}
 function editorView(){
  const c=state.draft,photos=photoOptions();
  return `<div class="newsletter-studio"><section class="panel newsletter-editor">${c.status!=='draft'?`<p class="notice">This newsletter is ${esc(c.status)}. Its saved content is read-only.</p>`:''}
   <form data-nl-editor><fieldset ${disabled(locked())}>
    <label class="field">Template<select name="template">${newsletterTemplates.map(t=>`<option value="${t.id}" ${c.template===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
    ${field('subject','Email subject',c.subject,'required maxlength="150" placeholder="A little news from Elio"')}
    ${field('title','Email heading',c.title,'required maxlength="160" placeholder="Something lovely to look forward to."')}
    <label class="field">Message<textarea name="body" rows="7" required maxlength="12000" placeholder="Share your news, introduce a flavor, or write your offer and its terms…">${esc(c.body)}</textarea><small>Leave a blank line between paragraphs.</small></label>
    <div class="newsletter-photo-tools"><label class="field">Photo · optional<input type="file" accept="${PHOTO_ACCEPT}" data-nl-upload><small>Upload JPEG, PNG, HEIC/HEIF, or WebP, up to 20 MB. Automatically saved as WebP.</small></label>
     ${photos.length?`<label class="field">Or choose a product photo<select data-nl-product-photo><option value="">Choose from your catalog</option>${photos.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>`:''}
     ${c.image_url&&safeHttps(c.image_url)?`<div class="newsletter-selected-photo"><img src="${esc(c.image_url)}" alt="Selected newsletter photo"><button type="button" class="button button-quiet" data-nl-action="remove-photo" ${disabled(locked())}>Remove photo</button></div>`:''}
     <details class="newsletter-photo-link"><summary>Use a photo link</summary>${field('image_url','Photo URL',c.image_url,'type="url" maxlength="2048" placeholder="https://…"')}</details></div>
    <div class="field-row">${field('cta_label','Button text · optional',c.cta_label,'maxlength="60" placeholder="Explore our boxes"')}${field('cta_url','Button link · optional',c.cta_url,'type="url" maxlength="2048" placeholder="https://…"')}</div>
   </fieldset><p class="muted newsletter-save-state" data-nl-save-state>${state.busy?'Working…':state.dirty?'Unsaved changes':c.id?`Saved ${esc(date(c.updated_at))}`:'Your draft has not been saved yet.'}</p><p class="form-error" role="alert" data-nl-editor-error></p>
   <div class="newsletter-editor-actions"><button type="submit" class="button button-secondary" ${disabled(locked())}>Save draft</button><button type="button" class="button button-secondary" data-nl-action="test" ${disabled(!editable()||state.busy)}>Send a test</button><button type="button" class="button" data-nl-action="review" ${disabled(locked())}>Review & send</button></div></form></section>
   <section class="panel newsletter-live-preview"><div class="section-heading"><h2>Live preview</h2><div class="newsletter-device-toggle" role="group" aria-label="Preview size">${['desktop','mobile'].map(mode=>`<button type="button" data-nl-action="preview-size" data-size="${mode}" aria-pressed="${state.previewMode===mode}">${mode==='desktop'?'Desktop':'Mobile'}</button>`).join('')}</div></div><p class="muted" role="status" data-nl-preview-status>${esc(state.previewStatus||'Updates as you write. Previewing does not send an email.')}</p><div class="newsletter-preview-canvas ${state.previewMode}" data-nl-preview-canvas><iframe data-nl-live-frame title="Live newsletter email preview" sandbox="" referrerpolicy="no-referrer"></iframe></div></section></div>`;
 }
 async function load(){
  if(!editable())return;const id=++loadId;state.loading=true;state.error='';paint();
  try{const result=await api('newsletter_admin',{view:'campaigns'});if(id===loadId)state.data={counts:result.counts,campaigns:result.campaigns||[]};}
  catch(error){if(id===loadId)state.error=error.message||'Could not load newsletters. Please refresh.';}
  finally{if(id===loadId){state.loading=false;paint();}}
 }
 function markDirty(){state.dirty=true;const note=root.querySelector('[data-nl-save-state]');if(note)note.textContent='Unsaved changes';}
 function previewStatus(message){state.previewStatus=message;const node=root?.querySelector('[data-nl-preview-status]');if(node){node.textContent=message;if(message.startsWith('Preview unavailable')){const retry=document.createElement('button');retry.type='button';retry.className='button button-quiet';retry.dataset.nlAction='retry-preview';retry.textContent='Retry preview';node.append(' ',retry);}}}
 function schedulePreview(immediate=false){
  clearTimeout(previewTimer);const id=++previewId;
  if(!state.editor||!root?.isConnected||!editable())return;
  previewTimer=setTimeout(()=>updatePreview(id),immediate?0:450);
 }
 async function updatePreview(id){
  if(id!==previewId||!root?.isConnected||!state.editor)return;
  const c={...state.draft};
  if(c.image_url&&!safeHttps(c.image_url)||c.cta_url&&!safeHttps(c.cta_url)){previewStatus('Use HTTPS links to update the preview.');return;}
  c.subject=c.subject.trim()||'Your Elio newsletter';c.title=c.title.trim()||template().title;c.body=c.body.trim()||'Your message will appear here as you write.';
  if(!c.cta_label.trim()||!c.cta_url.trim()){c.cta_label='';c.cta_url='';}
  const key=JSON.stringify(c);if(state.previewKey===key&&state.previewHtml){previewStatus('Preview up to date.');return;}
  previewStatus('Updating preview…');
  try{
   const result=await newsletterRequest({action:'preview_campaign',campaign:c});
   if(id!==previewId||!root?.isConnected||!state.editor)return;
   if(typeof result?.html!=='string')throw Error('Preview could not be prepared.');
   state.previewHtml=result.html;state.previewKey=key;root.querySelector('[data-nl-live-frame]').srcdoc=result.html;previewStatus('Preview up to date.');
  }catch(error){if(id===previewId)previewStatus('Preview unavailable. Keep editing or try again.');}
 }
 function readCampaign(){
  const form=root?.querySelector('[data-nl-editor]');if(form&&!form.reportValidity())return null;
  const c={...state.draft};for(const name of fields)c[name]=String(c[name]||'').trim();
  if(!c.subject||!c.title||!c.body)throw Error('Add a subject, heading, and message before continuing.');
  if(c.image_url&&!safeHttps(c.image_url))throw Error('Use an HTTPS photo link without a username or password.');
  if(Boolean(c.cta_label)!==Boolean(c.cta_url))throw Error('Add both button text and a button link, or leave both blank.');
  if(c.cta_url&&!safeHttps(c.cta_url))throw Error('Use an HTTPS button link without a username or password.');return c;
 }
 async function uploadPhoto(file){
  if(!file||locked())return;const draft=state.draft;state.busy=true;state.error='';paint();previewStatus('Converting and uploading your photo…');
  try{const result=await upload(file,{kind:'product'});if(!safeHttps(result?.url))throw Error('The upload did not return a valid photo link.');if(state.draft===draft){state.draft.image_url=result.url;state.dirty=true;}}
  catch(error){state.error=error.message||'The photo could not be uploaded. Please try again.';}
  finally{state.busy=false;paint();schedulePreview(true);}
 }
 async function save(campaign){const saved=await api('newsletter_save_campaign',{campaign});state.draft={...campaign,...(saved.campaign||saved)};state.dirty=false;if(state.data)state.data.campaigns=[state.draft,...(state.data.campaigns||[]).filter(c=>c.id!==state.draft.id)];return state.draft;}
 async function editorAction(action){
  if(!editable()||state.busy)return;let c;
  try{c=readCampaign();if(!c)return;}catch(error){root.querySelector('[data-nl-editor-error]').textContent=error.message;return;}
  state.busy=true;state.error='';paint();
  try{
   if(action==='save'){await save(c);toast('Newsletter draft saved.');return;}
   if(action==='test'){showTest(c);return;}
   c=await save(c);const preview=await newsletterRequest({action:'preview_campaign',campaign:c});if(root?.isConnected)showReview(c,preview);
  }catch(error){state.error=error.message||'Could not prepare this newsletter. Please try again.';}
  finally{state.busy=false;paint();}
 }
  function showReview(campaign,preview) {
    const review=true;
    const count=Number(preview.recipient_count),valid=Number.isSafeInteger(count)&&count>=0;
    const revision=preview.revision??preview.campaign_revision??campaign.revision;
    if(review&&(!valid||!Number.isSafeInteger(Number(revision))))throw new Error('The current recipient count could not be verified. Please refresh and review again.');
    const message=review?`<p class="notice newsletter-send-summary">Send <strong>${esc(campaign.subject)}</strong> to <strong>${count.toLocaleString()} subscribed address${count===1?'':'es'}</strong>.</p><p class="muted">Recipients who unsubscribe before delivery are skipped. This newsletter can be queued only once.</p>`:`<p class="muted">Subject: <strong>${esc(campaign.subject)}</strong></p>`;
    showDialog(review?'Review newsletter before sending':'Newsletter preview',`<div class="newsletter-preview-dialog">${message}<iframe class="newsletter-email-preview" title="Branded newsletter preview" sandbox="" referrerpolicy="no-referrer"></iframe>${review?`<form data-nl-send><label class="check-field"><input type="checkbox" name="reviewed" required ${disabled(count===0)}><span>I have checked this newsletter and its recipient count.</span></label>${count===0?'<p class="muted">There are no subscribed addresses to receive this newsletter.</p>':''}<p class="form-error" data-nl-send-error role="alert"></p><div class="dialog-actions"><button type="button" class="button button-secondary" data-nl-cancel>Keep as draft</button><button type="submit" class="button" ${disabled(count===0)}>Send to ${count.toLocaleString()} subscriber${count===1?'':'s'}</button></div></form>`:'<div class="dialog-actions"><button type="button" class="button" data-nl-cancel>Close preview</button></div>'}</div>`);
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

 function leave(next){
  if(state.busy)return;
  if(!state.dirty){next();return;}
  showDialog('Keep your newsletter changes?',`<p>You have unsaved changes. Save your draft before leaving, or discard these edits.</p><div class="dialog-actions"><button type="button" class="button button-secondary" data-nl-keep>Keep editing</button><button type="button" class="button" data-nl-discard>Discard changes</button></div>`);
  document.querySelector('[data-nl-keep]').onclick=closeDialog;
  document.querySelector('[data-nl-discard]').onclick=()=>{closeDialog();state.dirty=false;next();};
 }
 function start(id='spotlight'){
  const t=newsletterTemplates.find(t=>t.id===id)||newsletterTemplates[0];state.draft={...blank(),template:t.id,subject:t.subject,title:t.title};state.dirty=false;state.error='';state.previewHtml='';state.previewKey='';state.editor=true;paint();root?.querySelector('[name=subject]')?.focus();
 }
 function handleClick(event){
  const button=event.target.closest('[data-nl-action]');if(!button||button.disabled||state.busy)return;const action=button.dataset.nlAction;
  if(action==='refresh')load();
  else if(action==='new'||action==='template')leave(()=>start(button.dataset.template));
  else if(action==='library'){state.editor=false;++previewId;clearTimeout(previewTimer);paint();}
  else if(action==='resume'){state.editor=true;paint();}
  else if(action==='retry-preview')schedulePreview(true);
  else if(action==='open')leave(()=>{const c=report()?.campaigns.find(c=>c.id===button.dataset.id);if(c){state.draft={...blank(),...c};state.editor=true;state.dirty=false;state.error='';state.previewHtml='';state.previewKey='';paint();}});
  else if(action==='remove-photo'&&!locked()){state.draft.image_url='';markDirty();paint();}
  else if(action==='preview-size'){state.previewMode=button.dataset.size==='mobile'?'mobile':'desktop';root.querySelector('[data-nl-preview-canvas]').className='newsletter-preview-canvas '+state.previewMode;root.querySelectorAll('[data-size]').forEach(n=>n.setAttribute('aria-pressed',n.dataset.size===state.previewMode));}
  else if(action==='test'||action==='review')editorAction(action);
 }
 // The overview's Create newsletter shortcut opens the editor directly.
 return {render,mount,selectTab:()=>{state.editor=true;}};
}
