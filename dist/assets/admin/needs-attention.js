import {needsPaymentReview,isActiveFulfillment} from './refund-status.js';
export function attentionItems({orders=[],email_status=[]},now=Date.now()){
 const items=[];
 for(const order of orders){
  if(needsPaymentReview(order)){
   // This is order age, not elapsed time since a proof upload or a promised SLA.
   const at=order.created_at,age=now-Date.parse(at);
   if(Number.isFinite(age)&&age>=60*60*1000)items.push({kind:'payment',orderId:order.id,title:`Review payment · ${order.reference}`,detail:'Awaiting review; order placed over an hour ago.',at});
  }
  if(isActiveFulfillment(order)&&order.payment_status==='paid'&&order.method==='delivery'&&order.delivery_charge?.state==='quoted')items.push({kind:'delivery',orderId:order.id,title:`Delivery payment · ${order.reference}`,detail:'Quoted delivery fee has not been recorded as received.',at:order.updated_at||order.created_at});
 }
 for(const row of email_status){if(row.last_error&&!['sent','skipped'].includes(row.status)&&!row.reviewed_at)items.push({kind:'email',orderId:row.order_id,title:'Email sending needs review',detail:'Open Email delivery below to inspect the error.',at:row.updated_at||row.created_at});}
 return items.sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
}
export function renderAttention(state,{esc,dateTime}){
 const rows=attentionItems(state);
 return `<section class="panel needs-attention"><div class="section-heading"><h2>Needs attention</h2><span class="badge">${rows.length}</span></div><p class="help-text">Based on loaded orders and recent email notices. Highlights payment reviews for orders placed over an hour ago.</p>${rows.length?`<ul>${rows.slice(0,6).map(row=>`<li><div><strong>${esc(row.title)}</strong><p>${esc(row.detail)}</p>${row.at?`<small>${esc(dateTime(row.at))}</small>`:''}</div>${row.orderId?`<button class="button button-secondary" data-action="open-order" data-id="${esc(row.orderId)}">View order</button>`:''}</li>`).join('')}</ul>${rows.length>6?'<p class="help-text">Showing the oldest six. Review Orders and Email delivery for the rest.</p>':''}`:'<p class="muted">No older payment reviews, quoted delivery balances or unresolved email errors in the loaded records.</p>'}<div data-attention-calendar role="status">Checking calendar sync…</div></section>`;
}
export async function loadAttentionCalendar(root,{api,esc,dateTime}){
 const slot=root.querySelector('[data-attention-calendar]');if(!slot)return;
 try{const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const result=await api('calendar_list',{from:today,to:today});if(!slot.isConnected)return;const c=result.connection;
  slot.innerHTML=c?.last_error||c?.failed?`<p class="notice">Calendar sync needs attention${c.last_success_at?` · Last successful sync ${esc(dateTime(c.last_success_at))}`:''}. <button class="button button-quiet" data-view="calendar">Open calendar</button></p>`:(!c?.connected?'<p class="help-text">Google Calendar is not connected. <button class="button button-quiet" data-view="calendar">Open calendar</button></p>':'');
 }catch{if(slot.isConnected)slot.innerHTML='<p class="help-text">Calendar sync status could not load. <button class="button button-quiet" data-view="calendar">Check calendar</button></p>';}
}
