import {paymentDetails} from '../payment-options.js';

function optionFields(option,index,{esc,disabled=false}) {
 const field=(name,label,max)=>`<label class="field">${label}<input name="${name}" type="text" value="${esc(option[name]||'')}" required maxlength="${max}" ${disabled?'disabled':''}></label>`;
 return `<fieldset class="payment-option-editor"><legend>Payment option ${index+1}</legend>${field('label','Method name',80)}${field('account_name','Account name',140)}${field('account_number','Account number',100)}<label class="field">Instructions for this option · optional<textarea name="note" maxlength="500" rows="2" ${disabled?'disabled':''}>${esc(option.note||'')}</textarea></label><button type="button" class="button button-secondary" data-remove-payment ${disabled?'disabled':''}>Remove option</button></fieldset>`;
}

export function renderPaymentEditor(settings,{esc,disabled=false}) {
 const details=paymentDetails(settings);
 return `<section class="panel payment-options-editor" data-payment-editor><div class="section-heading"><h2>Payment options</h2><button type="button" class="button button-secondary" data-add-payment ${disabled?'disabled':''}>+ Add payment option</button></div><p class="help-text">Customers see a card for each option, with copy buttons for the account name and number. Changes apply to new orders; existing orders keep their saved payment details.</p><div class="payment-option-fields">${details.options.map((option,index)=>optionFields(option,index,{esc,disabled})).join('')}</div><label class="field payment-general-note">Payment instructions for all options · optional<textarea name="payment_note" maxlength="2000" rows="3" ${disabled?'disabled':''}>${esc(details.note)}</textarea></label><p class="help-text">Full payment is required. Customers have 15 minutes to upload proof for your team to review.</p><p class="help-text" data-payment-editor-status role="status"></p></section>`;
}

export function mountPaymentEditor(root,{esc,disabled=false}) {
 const editor=root.querySelector('[data-payment-editor]');if(!editor)return;
 const list=editor.querySelector('.payment-option-fields'),status=editor.querySelector('[data-payment-editor-status]');
 editor.addEventListener('click',event=>{
  if(disabled||editor.closest('form')?.dataset.busy==='true')return;
  if(event.target.closest('[data-add-payment]')) {
   if(list.children.length>=20){status.textContent='You can save up to 20 payment options.';return;}
   list.insertAdjacentHTML('beforeend',optionFields({},list.children.length,{esc}));
   list.lastElementChild.querySelector('input').focus();status.textContent='New option added. Save shop settings to publish it.';
  } else if(event.target.closest('[data-remove-payment]')) {
   event.target.closest('.payment-option-editor').remove();
   [...list.children].forEach((item,index)=>{item.querySelector('legend').textContent=`Payment option ${index+1}`;});
   editor.querySelector('[data-add-payment]').focus();status.textContent='Option removed from this draft. Save shop settings to publish the change.';
  }
 });
}

export function readPaymentEditor(form) {
 return [...form.querySelectorAll('.payment-option-editor')].map(row=>Object.fromEntries(['label','account_name','account_number','note'].map(key=>[key,row.querySelector(`[name="${key}"]`).value.trim()])));
}
