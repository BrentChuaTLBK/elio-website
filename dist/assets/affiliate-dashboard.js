import {api,auth,ready,initializationError,escapeHtml as esc} from './admin/client.js';
import {renderAffiliateReport,openAffiliateReceipt,liveAffiliateRefresh} from './affiliates.js';
const root=document.querySelector('#affiliate-content'),message=document.querySelector('#affiliate-message'),refresh=document.querySelector('#affiliate-refresh');
let report=null,loading=false,orderOffset=0,payoutOffset=0,stop=()=>{},authorized=false,generation=0;
function notice(text){message.textContent=text;message.hidden=!text;}
async function load(){
 if(loading||!authorized)return;loading=true;const token=generation;refresh.disabled=true;root.setAttribute('aria-busy','true');
 try{
  const next=await api('affiliate_dashboard',{order_offset:orderOffset,payout_offset:payoutOffset});
  if(token!==generation||!authorized)return;report=next;
  document.querySelector('#affiliate-name').textContent=`Welcome, ${report.affiliate.name}.`;root.innerHTML=renderAffiliateReport(report);refresh.hidden=false;notice('');
 }catch(e){if(token!==generation||!authorized)return;notice(e.message);if(!report)root.innerHTML='<p>Your affiliate dashboard will appear once an owner assigns your verified Elio account.</p><a class="button button-secondary" href="account.html">My account</a>';}
 finally{loading=false;refresh.disabled=false;root.setAttribute('aria-busy','false');}
}
refresh.addEventListener('click',load);
root.addEventListener('click',async e=>{
 const button=e.target.closest('[data-aff]');if(!button||button.disabled)return;button.disabled=true;
 try{
  const action=button.dataset.aff;
  if(action==='receipt')await openAffiliateReceipt(button.dataset.id);
  else if(action==='copy-code'){await navigator.clipboard.writeText(report.codes.find(c=>c.id===button.dataset.id).code);notice('Code copied.');}
  else if(!loading){const direction=action.endsWith('next')?1:-1;if(action.startsWith('orders-'))orderOffset=Math.max(0,orderOffset+direction*50);else if(action.startsWith('payouts-'))payoutOffset=Math.max(0,payoutOffset+direction*20);await load();}
 }catch(error){notice(error.message);}finally{button.disabled=false;}
});
await ready;
if(initializationError||!auth){notice(initializationError?.message||'The account service is unavailable. Please try again.');root.innerHTML='';root.setAttribute('aria-busy','false');}
else{
 const {data,error}=await auth.getSession();
 if(error||!data.session){root.innerHTML=`<section class="panel"><h2>Sign in to your Elio account.</h2><p>${esc(error?.message||'Use the account assigned to your affiliate code.')}</p><a class="button" href="account.html?next=affiliate.html">Sign in</a></section>`;root.setAttribute('aria-busy','false');}
 else{authorized=true;auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){authorized=false;generation++;stop();report=null;root.innerHTML='<p>You have signed out.</p><a class="button" href="account.html">Sign in</a>';refresh.hidden=true;notice('');}});await load();if(authorized)stop=liveAffiliateRefresh(load);}
}
window.addEventListener('pagehide',()=>stop());
window.addEventListener('pageshow',event=>{if(event.persisted&&authorized){stop=liveAffiliateRefresh(load);load();}});
