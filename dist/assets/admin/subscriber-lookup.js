import {api,escapeHtml as esc} from './client.js';

const date=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' PHT':'Not recorded';
const label=value=>String(value||'Not recorded').replaceAll('_',' ').replace(/^\w/,letter=>letter.toUpperCase());
export function createSubscriberLookup({allowed}){
  const state={email:'',busy:false,result:null,error:''};let root=null;
  function details(){
    if(!state.result)return '';
    if(!state.result.found)return '<p role="status">No newsletter subscriber found for this exact email address.</p>';
    const s=state.result.subscriber,q=s.contact_sync;
    const syncLabel={current:'Up to date',removed:'Contact removed',pending:'Update pending',not_started:'Not started',needs_review:'Needs review'}[q.state]||'Not recorded';
    const eligibility=s.marketing_eligible?'Eligible by recorded consent':s.suppressed?'Not eligible · suppressed':s.status==='unsubscribed'?'Not eligible · unsubscribed':'Not eligible · awaiting consent';
    const rows=[['Newsletter status',label(s.status)],['Signup source',label(s.source)],['Consent recorded',date(s.consent_at)],['Consent version',s.consent_version],['Subscribed',date(s.subscribed_at)],['Unsubscribed',date(s.unsubscribed_at)],['Marketing eligibility',eligibility],['Resend contact sync',syncLabel],['Last sync check',date(q.checked_at)],['Campaign readiness',q.ready?'Ready at last sync check':!q.configured?'Newsletter delivery is not configured':'Not ready at last sync check']];
    return `<p role="status"><strong>${esc(s.email)}</strong></p><dl>${rows.map(([title,value])=>`<div><dt>${esc(title)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="help-text">This shows recorded consent and the last Resend sync. It does not confirm inbox delivery.</p>`;
  }
  function content(){return `<h2>Find a subscriber</h2><p class="muted">Look up one exact email to check consent and newsletter delivery status.</p><form class="subscriber-lookup-form" data-subscriber-lookup-form><label class="field">Subscriber email<input name="subscriber_email" type="email" required maxlength="254" autocomplete="off" placeholder="name@example.com" value="${esc(state.email)}" ${state.busy?'disabled':''}></label><button type="submit" class="button" ${state.busy?'disabled':''}>${state.busy?'Looking up…':'Look up'}</button></form><p class="form-error" role="alert">${esc(state.error)}</p><div class="subscriber-lookup-result" ${!state.result?'hidden':''}>${details()}</div>`;}
  function render(){return allowed()?`<section class="panel subscriber-lookup" data-subscriber-lookup>${content()}</section>`:'';}
  function paint(){if(root?.isConnected&&allowed()){root.innerHTML=content();bind();}}
  function bind(){
    const form=root.querySelector('form');
    form.addEventListener('input',event=>{state.email=event.target.value;state.result=null;root.querySelector('.subscriber-lookup-result').hidden=true;});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(state.busy||!allowed()||!form.reportValidity())return;
      state.email=form.elements.subscriber_email.value.trim();state.busy=true;state.result=null;state.error='';paint();
      try{state.result=await api('newsletter_subscriber_lookup',{email:state.email});}
      catch(error){state.error=error.message||'Could not look up this subscriber. Please try again.';}
      finally{state.busy=false;paint();}
    });
  }
  function mount(container){root=container.querySelector('[data-subscriber-lookup]');if(root&&allowed())bind();}
  return {render,mount};
}
