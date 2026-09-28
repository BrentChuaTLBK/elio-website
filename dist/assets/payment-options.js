// Existing orders keep the payment details saved when they were placed.
export function paymentDetails(data={}) {
 if(Array.isArray(data.payment_options))return {options:data.payment_options,note:data.payment_note||''};
 const original=String(data.payment_instructions||'').trim();
 const body=original.replace(/^Accepted Payment Methods:\s*\n+/i,'');
 const blocks=body.split(/\n\s*\n/).map(block=>block.split(/\r?\n/).map(line=>line.trim()));
 if(blocks.length&&blocks.every(lines=>lines.length===3&&lines.every(Boolean)&&/^[+\d][\d +()-]{3,99}$/.test(lines[2])))
  return {options:blocks.map(([label,account_name,account_number])=>({label,account_name,account_number,note:''})),note:''};
 return {options:[],note:original};
}

export function renderPaymentOptions(order,settings,{esc}) {
 const source=Array.isArray(order.payment_options)||order.payment_instructions?order:settings;
 const {options,note}=paymentDetails(source);
 if(!options.length)return `<div class="payment-details">${esc(note||'Please contact the kitchen for payment details.')}</div>`;
 const field=(label,value,method)=>`<div class="payment-copy-row"><div><dt>${label}</dt><dd class="payment-copy-value">${esc(value)}</dd></div><button type="button" class="button-secondary payment-copy" data-copy-payment="field" aria-label="Copy ${esc(method)} ${label.toLowerCase()}">Copy</button></div>`;
 return `<div class="payment-options"><p class="payment-options-intro">Pay using any of these options. Tap Copy to copy the details.</p>${options.map(option=>`<section class="payment-option"><h3>${esc(option.label)}</h3><dl>${field('Account name',option.account_name,option.label)}${field('Account number',option.account_number,option.label)}</dl>${option.note?`<p class="payment-option-note">${esc(option.note)}</p>`:''}</section>`).join('')}${note?`<p class="payment-option-note">${esc(note)}</p>`:''}<p class="payment-copy-status" role="status" aria-live="polite"></p></div>`;
}

export function bindPaymentCopy(root) {
 for(const button of root.querySelectorAll('[data-copy-payment]'))button.onclick=async()=>{
  const value=button.closest('.payment-copy-row').querySelector('.payment-copy-value');
  const status=button.closest('.payment-options').querySelector('.payment-copy-status');
  try {
   await navigator.clipboard.writeText(value.textContent);
   button.textContent='Copied';status.textContent='Copied. You can paste it into your payment app.';
   setTimeout(()=>{button.textContent='Copy';},2000);
  } catch {
   const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(value);selection.removeAllRanges();selection.addRange(range);
   status.textContent='Automatic copying is unavailable. The details are selected so you can copy them manually.';
  }
 };
}
