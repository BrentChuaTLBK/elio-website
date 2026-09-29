const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function receiptProgress(stage,message=''){
 const received=stage==='received',preparing=stage==='preparing',checking=stage==='checking';
 const title=received?'Receipt received.':checking?'Checking upload status…':preparing?'Preparing your receipt…':'Uploading your receipt…';
 const detail=message||(received?'The kitchen will review your payment and confirm your order. Your reservation stays active while you wait.':checking?'Checking whether your receipt was already received.':preparing?'Getting your image ready for a clear, secure upload.':'Please keep this page open while we send and register your receipt.');
 return `<div class="receipt-progress notice${received?' success':''}"><div class="receipt-progress-title">${received?'':'<span class="receipt-spinner" aria-hidden="true"></span>'}<strong>${title}</strong></div><p>${escape(detail)}</p>${checking?'':`<div class="receipt-steps" aria-hidden="true"><span class="${preparing?'active':'done'}">Prepare</span><span class="${received?'done':preparing?'':'active'}">Upload</span><span class="${received?'done':''}">Received</span></div>`}</div>`;
}

// Retain the actual file/input nodes on failure so cached conversion and retry use the same receipt.
export function bindReceiptUpload(form,{upload,validatePhoto,orderId,token,readOrder,onReceived,onBusy,onSettled,canStart=()=>true,refreshControl}){
 const button=form.querySelector('[type=submit]'),status=form.querySelector('#proof-progress'),errorBox=form.querySelector('#proof-error');
 let pending=false,uncertain=false,accepted=false;
 const controls=[...form.querySelectorAll('input,button'),refreshControl].filter(Boolean);
 const display=stage=>{status.innerHTML=receiptProgress(stage);button.textContent=stage==='checking'?'Checking upload…':stage==='preparing'?'Preparing receipt…':'Uploading receipt…';};
 const showError=(title,message)=>{status.innerHTML='';errorBox.className='notice danger receipt-upload-error';errorBox.innerHTML=`<strong>${escape(title)}</strong><p>${escape(message)}</p>`;};
 const changed=order=>order&&(order.payment_status!=='awaiting_payment'||['cancelled','expired','refunded'].includes(order.fulfillment_status)||order.refund_label||order.uploads_paused);
 form.onsubmit=async event=>{
  event.preventDefault();if(pending||accepted||!canStart())return;
  const file=form.elements.proof.files[0],reference=form.elements.payment_reference.value.trim();
  try{validatePhoto(file)}catch(error){showError('Choose a receipt image.',error.message);return;}
  pending=true;onBusy(true);const disabled=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);form.setAttribute('aria-busy','true');errorBox.textContent='';errorBox.className='';
  let stage='preparing';
  try{
   // A lost response may already have committed. Check before another upload.
   if(uncertain){display('checking');const current=await readOrder();uncertain=false;if(changed(current)){accepted=true;await onReceived(current);return;}}
   display('preparing');
   await upload(file,{kind:'proof',order_id:orderId,token,payment_reference:reference,onProgress:next=>{stage=next;display(next);}});
   accepted=true;status.innerHTML=receiptProgress('received');button.textContent='Receipt received';
   try{await onReceived(await readOrder());}
   catch{status.innerHTML=receiptProgress('received','Your receipt was received, but we couldn’t refresh the order details. Use Refresh status to check the latest review status.');}
  }catch(error){
   uncertain=uncertain||stage==='uploading';
   if(uncertain){
    try{const current=await readOrder();uncertain=false;if(changed(current)){accepted=true;await onReceived(current);return;}}
    catch{ /* Keep the file/reference and reconcile before the next upload attempt. */ }
   }
   showError(stage==='preparing'&&!uncertain?'We couldn’t prepare your receipt.':'We couldn’t confirm your upload.',error.message+' Your selected file and reference are still here.');
   button.textContent=uncertain?'Check upload status':'Retry upload';
  }finally{
   pending=false;form.removeAttribute('aria-busy');controls.forEach((el,index)=>{el.disabled=accepted&&el!==refreshControl?true:disabled[index];});onBusy(false);onSettled?.({accepted});
  }
 };
}
