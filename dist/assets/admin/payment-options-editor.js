import {paymentDetails} from '../payment-options.js';

function optionFields(option,index,{esc,disabled=false,open=false}) {
 const field=(name,label,max)=>`<label class="field">${label}<input name="${name}" type="text" value="${esc(option[name]||'')}" required maxlength="${max}" ${disabled?'disabled':''}></label>`;
 return `<div class="payment-option-editor"><details ${open?'open':''}><summary><span data-payment-label>${esc(option.label||`Payment option ${index+1}`)}</span></summary><div class="payment-option-body">${field('label','Method name',80)}${field('account_name','Account name',140)}${field('account_number','Account number',100)}<label class="field payment-option-note">Instructions for this option · optional<textarea name="note" maxlength="500" rows="2" ${disabled?'disabled':''}>${esc(option.note||'')}</textarea></label></div></details><div class="payment-option-actions"><button type="button" class="button button-secondary" data-move-payment="up" aria-label="Move payment option up" ${disabled?'disabled':''}>↑</button><button type="button" class="button button-secondary" data-move-payment="down" aria-label="Move payment option down" ${disabled?'disabled':''}>↓</button><button type="button" class="button button-quiet" data-remove-payment ${disabled?'disabled':''}>Remove</button></div></div>`;
}

export function renderPaymentEditor(settings,{esc,disabled=false}) {
 const details=paymentDetails(settings);
 return `<section class="panel payment-options-editor" data-payment-editor><h2>Payment options</h2><p class="help-text">Customers choose a method and copy its account details. Changes apply to new orders; existing orders keep their saved payment details. Click a method to edit it.</p><div class="payment-option-fields">${details.options.map((option,index)=>optionFields(option,index,{esc,disabled})).join('')}</div><button type="button" class="button button-secondary" data-add-payment ${disabled?'disabled':''}>+ Add payment option</button><label class="field payment-general-note">Payment instructions · optional<textarea name="payment_note" maxlength="2000" rows="3" ${disabled?'disabled':''}>${esc(details.note)}</textarea><small>Shown with the options and included in payment emails.</small></label><p class="help-text">Keep at least one option while orders are open. Payment proof is still required and reviewed by your team.</p><p class="help-text payment-editor-status" data-payment-editor-status role="status"></p></section>`;
}

export function mountPaymentEditor(root,{esc,disabled=false}) {
 const editor=root.querySelector('[data-payment-editor]');if(!editor)return;
 const list=editor.querySelector('.payment-option-fields'),status=editor.querySelector('[data-payment-editor-status]');
 const busy=()=>disabled||editor.closest('form')?.dataset.busy==='true';
 function refresh(){[...list.children].forEach((item,index)=>{
  const label=item.querySelector('[name=label]').value.trim()||`Payment option ${index+1}`;
  item.querySelector('[data-payment-label]').textContent=label;
  for(const direction of ['up','down']){const button=item.querySelector(`[data-move-payment=${direction}]`);button.disabled=disabled||(direction==='up'?index===0:index===list.children.length-1);button.setAttribute('aria-label',`Move ${label} ${direction}`);}
  item.querySelector('[data-remove-payment]').setAttribute('aria-label',`Remove ${label}`);
 });}
 const changed=()=>{status.textContent='Unsaved payment options. Save shop settings to publish.';};
 editor.addEventListener('input',event=>{if(!busy()){if(event.target.name==='label')refresh();changed();}});
 editor.addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
 editor.addEventListener('click',event=>{
  if(busy())return;
  if(event.target.closest('[data-add-payment]')) {
   if(list.children.length>=20){status.textContent='You can save up to 20 payment options.';return;}
   list.insertAdjacentHTML('beforeend',optionFields({},list.children.length,{esc,open:true}));
   refresh();list.lastElementChild.querySelector('input').focus();changed();
  } else if(event.target.closest('[data-remove-payment]')) {
   event.target.closest('.payment-option-editor').remove();refresh();
   editor.querySelector('[data-add-payment]').focus();changed();
  } else if(event.target.closest('[data-move-payment]')) {
   const button=event.target.closest('[data-move-payment]'),row=button.closest('.payment-option-editor');
   if(button.dataset.movePayment==='up'&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);
   else if(button.dataset.movePayment==='down'&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);
   refresh();if(button.disabled)row.querySelector('summary').focus();else button.focus();changed();
  }
 });
 refresh();
}

export function readPaymentEditor(form) {
 return [...form.querySelectorAll('.payment-option-editor')].map(row=>Object.fromEntries(['label','account_name','account_number','note'].map(key=>[key,row.querySelector(`[name="${key}"]`).value.trim()])));
}

