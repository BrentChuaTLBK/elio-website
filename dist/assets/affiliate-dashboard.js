import {api,auth,ready,initializationError,escapeHtml as esc} from './admin/client.js';
import {renderAffiliateReport,renderPayoutDetails,renderPayoutDetailsForm,openAffiliateReceipt,liveAffiliateRefresh} from './affiliates.js?v=mobile-audit-1';
import {confirmDialog} from './admin/site-dialog.js?v=branded-dialogs-1';
const root=document.querySelector('#affiliate-content'),message=document.querySelector('#affiliate-message'),refresh=document.querySelector('#affiliate-refresh');
let report=null,loading=false,orderOffset=0,payoutOffset=0,stop=()=>{},authorized=false,generation=0,editing=false,dirty=false,saving=false;
function notice(text){message.textContent=text;message.hidden=!text;}
async function load(){
 if(loading||!authorized||editing||saving)return;loading=true;const token=generation;refresh.disabled=true;root.setAttribute('aria-busy','true');
 try{
  const next=await api('affiliate_dashboard',{order_offset:orderOffset,payout_offset:payoutOffset});
  if(token!==generation||!authorized)return;report=next;
  document.querySelector('#affiliate-name').textContent=`Welcome, ${report.affiliate.name}.`;root.innerHTML=renderAffiliateReport(report);refresh.hidden=false;notice('');
 }catch(e){if(token!==generation||!authorized)return;notice(e.message);if(!report)root.innerHTML='<p>Your affiliate dashboard will appear once an owner assigns your verified Elio account.</p><a class="button button-secondary" href="account.html">My account</a>';}
 finally{loading=false;refresh.disabled=editing||saving;root.setAttribute('aria-busy','false');}
}
async function cancelEdit(){
 if(saving)return false;
 if(dirty&&!await confirmDialog('Discard your unsaved payout details?',{title:'Unsaved payout details',confirmLabel:'Discard changes',cancelLabel:'Keep editing'}))return false;
 if(!authorized||!report)return false;
 editing=false;dirty=false;refresh.disabled=false;
 root.querySelector('.aff-payment-details').outerHTML=renderPayoutDetails(report.payout_details);
 root.querySelector('[data-aff=edit-payout-details]')?.focus();return true;
}
refresh.addEventListener('click',load);
root.addEventListener('input',e=>{if(e.target.closest('.aff-destination-form'))dirty=true;});
root.addEventListener('change',e=>{
 if(!e.target.closest('.aff-destination-form'))return;dirty=true;
 if(e.target.name!=='method')return;
 const form=e.target.form,bank=e.target.value==='bank_transfer';
 form.querySelector('[data-bank-field]').hidden=!bank;form.elements.bank_name.disabled=!bank;form.elements.bank_name.required=bank;
 form.elements.account_number.value='';form.elements.account_number.inputMode=bank?'numeric':'tel';
 form.querySelector('[data-number-label]').textContent=bank?'Account number':'GCash number';
 form.querySelector('[data-number-help]').textContent=bank?'Enter the bank account number, including any leading zeros.':'Use the 11-digit GCash number starting with 09, or its +63 equivalent.';
});
root.addEventListener('submit',async e=>{
 if(!e.target.matches('.aff-destination-form'))return;e.preventDefault();
 const form=e.target;if(!authorized||saving||!form.reportValidity())return;
 const fields=new FormData(form),token=generation;
 const payload={revision:report.payout_details?.revision||0,method:fields.get('method'),account_name:fields.get('account_name'),account_number:fields.get('account_number'),bank_name:fields.get('bank_name')||null};
 saving=true;form.querySelector('fieldset').disabled=true;form.querySelector('.form-error').textContent='';
 try{
  const saved=await api('affiliate_save_payout_details',payload);
  if(!authorized||token!==generation)return;
  report.payout_details=saved;editing=false;dirty=false;root.innerHTML=renderAffiliateReport(report);notice('Payout details saved. The Elio owner can now see them.');root.querySelector('[data-aff=edit-payout-details]')?.focus();
 }catch(error){if(authorized&&token===generation)form.querySelector('.form-error').textContent=error.message;}
 finally{saving=false;if(authorized&&token===generation){form.querySelector('fieldset').disabled=false;refresh.disabled=editing;}}
});
root.addEventListener('click',async e=>{
 const button=e.target.closest('[data-aff]');if(!button||button.disabled)return;button.disabled=true;
 try{
  const action=button.dataset.aff;
  if(action==='edit-payout-details'){
   generation++;editing=true;dirty=false;refresh.disabled=true;root.querySelector('.aff-payment-details').innerHTML=renderPayoutDetailsForm(report.payout_details);root.querySelector('.aff-destination-form select').focus();
  }else if(action==='cancel-payout-details')await cancelEdit();
  else if(action==='copy-payout-number'){await navigator.clipboard.writeText(report.payout_details.account_number);notice('Account number copied.');}
  else if(action==='receipt')await openAffiliateReceipt(button.dataset.id);
  else if(action==='copy-code'){await navigator.clipboard.writeText(report.codes.find(c=>c.id===button.dataset.id).code);notice('Code copied.');}
  else if(!loading&&(action.startsWith('orders-')||action.startsWith('payouts-'))){if(editing&&!await cancelEdit())return;const direction=action.endsWith('next')?1:-1;if(action.startsWith('orders-'))orderOffset=Math.max(0,orderOffset+direction*50);else payoutOffset=Math.max(0,payoutOffset+direction*20);await load();}
 }catch(error){notice(error.message);}finally{button.disabled=false;}
});
await ready;
if(initializationError||!auth){notice(initializationError?.message||'The account service is unavailable. Please try again.');root.innerHTML='';root.setAttribute('aria-busy','false');}
else{
 const {data,error}=await auth.getSession();
 if(error||!data.session){root.innerHTML=`<section class="panel"><h2>Sign in to your Elio account.</h2><p>${esc(error?.message||'Use the account assigned to your affiliate code.')}</p><a class="button" href="account.html?next=affiliate.html">Sign in</a></section>`;root.setAttribute('aria-busy','false');}
 else{authorized=true;auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){authorized=false;generation++;stop();report=null;editing=false;dirty=false;root.innerHTML='<p>You have signed out.</p><a class="button" href="account.html">Sign in</a>';refresh.hidden=true;notice('');}});await load();if(authorized)stop=liveAffiliateRefresh(load);}
}
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>stop());
window.addEventListener('pageshow',event=>{if(event.persisted&&authorized){stop=liveAffiliateRefresh(load);load();}});
