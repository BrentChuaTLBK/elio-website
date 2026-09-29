import {api,upload,escapeHtml as esc} from './client.js';
import {config} from './config.js';
import {preparePhoto,PHOTO_ACCEPT,PHOTO_HELP} from './photo-upload.js';
import {photoPages,photoSlots,websitePhotoUrl} from '../website-photo-slots.js';

export function mountWebsitePhotos(root,{owner}){
 if(!owner){root.innerHTML='<p class="notice">Sign in as an owner to change website photos.</p>';return {destroy(){}};}
 let saved={},page='home',alive=true,busy=false;
 const drafts=new Map();
 const draftFor=slot=>{if(!drafts.has(slot.id)){const value=saved[slot.id]||{path:null,revision:0};drafts.set(slot.id,{...value,alt:value.path?value.alt:slot.alt,position_x:value.path?value.position_x:50,position_y:value.path?value.position_y:50,dirty:false});}return drafts.get(slot.id);};
 const sync=()=>{root.dataset.dirty=String([...drafts.values()].some(d=>d.dirty));root.dataset.busy=String(busy);};
 const dispose=d=>{if(d?.preview)URL.revokeObjectURL(d.preview);};
 function card(slot){
  const d=draftFor(slot),custom=Boolean(d.file||d.path),src=d.preview||websitePhotoUrl(d.path,config.supabaseUrl)||slot.src;
  return `<form class="panel website-photo-card" data-photo-slot="${slot.id}"><h2>${esc(slot.name)}</h2><div class="website-photo-preview"><img src="${esc(src)}" alt="${esc(d.alt)}" style="object-position:${d.position_x}% ${d.position_y}%;${slot.ratio<1.1?'max-width:200px;':''}"></div><p class="help-text">${esc(slot.hint)}. Preview shows an approximate crop; layouts vary by screen size.</p><fieldset ${busy?'disabled':''}><label class="field">Replace photo<input class="photo-upload-input" type="file" accept="${PHOTO_ACCEPT}"></label><div data-photo-editor ${custom?'':'hidden'}><label class="field">Image description<input name="alt" maxlength="240" value="${esc(d.alt)}" ${custom?'required':''}><small>Describe the photo for visitors using screen readers.</small></label><div class="photo-crop-controls"><label class="field">Horizontal position<input name="position_x" type="range" min="0" max="100" value="${d.position_x}"></label><label class="field">Vertical position<input name="position_y" type="range" min="0" max="100" value="${d.position_y}"></label></div></div><div class="row-actions photo-card-actions"><button class="button" type="submit" ${d.dirty?'':'disabled'}>Save photo</button><button class="button button-secondary" type="button" data-photo-action="original" ${custom?'':'disabled'}>Restore original</button><button class="button button-quiet" type="button" data-photo-action="reload">Reload saved</button></div></fieldset><p data-photo-status role="status">${d.dirty?(d.path||d.file?'Unsaved photo changes.':'Original selected. Save photo to publish it.'):(d.path?'Your photo is published.':'Using the original website photo.')}</p></form>`;
 }
 function paint(){
  if(!alive)return;sync();const section=photoPages.find(p=>p.id===page);
  root.innerHTML=`<div class="view-heading"><div><span class="eyebrow">Elio Basque Cheesecake</span><h1>Website photos</h1><p>Change the pictures across your website.</p></div></div><div class="panel website-photos-intro"><p>Choose a page, upload a photo, then save it to publish. Each photo is saved separately.</p><p class="help-text">${PHOTO_HELP}</p><p class="help-text">For product pictures, use Flavors or Boxes & sets. Those photos follow the product throughout the shop.</p></div><nav class="website-photo-tabs" aria-label="Pages to edit">${photoPages.map(p=>`<button type="button" data-photo-page="${p.id}" aria-pressed="${p.id===page}" ${busy?'disabled':''}>${esc(p.name)}</button>`).join('')}</nav><div class="website-photo-page-heading"><h2>${esc(section.name)}</h2><a class="text-link" href="${section.href}" target="_blank" rel="noopener">Open page ↗<span class="sr-only"> (opens in a new tab)</span></a></div><div class="website-photo-grid">${photoSlots.filter(s=>s.page===page).map(card).join('')}</div>`;
 }
 const status=(form,message,error=false)=>{const el=form.querySelector('[data-photo-status]');el.textContent=message;el.setAttribute('role',error?'alert':'status');};
 const slotFor=form=>photoSlots.find(s=>s.id===form.dataset.photoSlot);
 function mark(form,d){d.dirty=true;sync();form.querySelector('[type=submit]').disabled=false;status(form,'Unsaved photo changes.');}
 function setBusy(value){busy=value;sync();root.querySelectorAll('fieldset,[data-photo-page]').forEach(el=>el.disabled=value);}
 root.addEventListener('input',event=>{
  const form=event.target.closest('[data-photo-slot]');if(!form||busy||!event.target.name)return;
  const d=draftFor(slotFor(form)),name=event.target.name;d[name]=name==='alt'?event.target.value:Number(event.target.value);
  const img=form.querySelector('img');img.alt=d.alt;img.style.objectPosition=`${d.position_x}% ${d.position_y}%`;mark(form,d);
 });
 root.addEventListener('change',async event=>{
  if(event.target.type!=='file'||busy)return;const form=event.target.closest('form'),slot=slotFor(form),file=event.target.files[0];if(!file)return;
  const d=draftFor(slot);setBusy(true);status(form,'Preparing photo…');
  try{const converted=await preparePhoto(file);if(!alive)return;dispose(d);Object.assign(d,{file,preview:URL.createObjectURL(converted),uploadedPath:null,position_x:50,position_y:50,dirty:true});paint();}
  catch(error){status(form,error.message,true);event.target.value='';}
  finally{setBusy(false);}
 });
 root.addEventListener('click',async event=>{
  if(busy)return;const tab=event.target.closest('[data-photo-page]');if(tab){page=tab.dataset.photoPage;paint();root.querySelector(`[data-photo-page="${page}"]`)?.focus();return;}
  const button=event.target.closest('[data-photo-action]');if(!button)return;const form=button.closest('form'),slot=slotFor(form),d=draftFor(slot);
  if(button.dataset.photoAction==='original'){dispose(d);Object.assign(d,{path:null,file:null,preview:null,uploadedPath:null,alt:slot.alt,position_x:50,position_y:50,dirty:true});paint();root.querySelector(`[data-photo-slot="${slot.id}"] [type=submit]`)?.focus();}
  else{setBusy(true);status(form,'Loading saved photo…');try{const result=await api('website_photos');if(!alive)return;saved[slot.id]=result.photos[slot.id];dispose(d);drafts.delete(slot.id);paint();}catch(error){status(form,error.message,true);}finally{setBusy(false);}}
 });
 root.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-photo-slot]');if(!form)return;event.preventDefault();if(busy)return;const slot=slotFor(form),d=draftFor(slot);if(!d.dirty)return;
  setBusy(true);status(form,'Saving photo…');
  try{
   if(d.file&&!d.uploadedPath)d.uploadedPath=(await upload(d.file,{kind:'website'})).path;
   const result=await api('save_website_photo',{slot:slot.id,revision:d.revision,path:d.file?d.uploadedPath:d.path,alt:d.alt.trim(),position_x:d.position_x,position_y:d.position_y});
   if(!alive)return;saved[slot.id]=result;dispose(d);drafts.delete(slot.id);paint();status(root.querySelector(`[data-photo-slot="${slot.id}"]`),'Saved. This photo is now published.');
  }catch(error){status(form,error.message,true);}finally{setBusy(false);}
 });
 root.innerHTML='<p role="status">Loading website photos…</p>';
 const load=async()=>{try{const result=await api('website_photos');saved=result.photos;paint();}catch(error){if(alive){root.innerHTML=`<p class="notice danger" role="alert">${esc(error.message)}</p><button type="button" class="button" data-photo-retry>Retry</button>`;root.querySelector('[data-photo-retry]').onclick=load;}}};void load();
 return {destroy(){alive=false;drafts.forEach(dispose);}};
}
