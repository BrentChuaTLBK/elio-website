// Checkout steps own same-page entries; no buyer or order data goes into history.
export function checkoutNavigation({dialog,showDetails,showReview,canReview,canNavigate=()=>true,onClose=()=>{}}){
 const id=crypto.randomUUID();let depth=0,step='',restoring=false,pending=null;
 const entry=()=>history.state?.elioCheckout;
 const owned=value=>value?.id===id&&Number.isInteger(value.depth)&&value.depth>0;
 const clean=()=>({...history.state,elioCheckout:null});
 const hide=()=>{step='';depth=0;if(dialog.open)dialog.close();onClose();};
 function enter(next){
  if(restoring||pending)return;
  if(step===next&&owned(entry()))return;
  if(next==='details'&&step==='review'){back();return;}
  depth=owned(entry())?entry().depth+1:1;step=next;
  history.pushState({...history.state,elioCheckout:{id,depth,step}},'',location.href);
 }
 function back(){if(!pending&&canNavigate()&&owned(entry()))history.back();}
 function close(){
  if(pending||!canNavigate())return;
  if(owned(entry())){pending={kind:'close'};history.go(-entry().depth);}
  else hide();
 }
 function finish(url){
  if(pending)return Promise.reject(new Error('Checkout navigation is still finishing.'));
  if(!owned(entry())){hide();history.pushState(clean(),'',url);return Promise.resolve();}
  return new Promise(resolve=>{pending={kind:'finish',url,resolve};history.go(-entry().depth);});
 }
 function restore(){
  const value=entry(),nextDepth=owned(value)?value.depth:0;
  if(pending){const action=pending;pending=null;hide();if(action.kind==='finish'){history.pushState(clean(),'',action.url);action.resolve();}return;}
  if(depth&&!canNavigate()){if(depth!==nextDepth)history.go(depth-nextDepth);return;}
  if(!owned(value)){hide();return;}
  depth=value.depth;step=value.step;restoring=true;
  try{
   if(step==='review'&&canReview())showReview();
   else{step='details';history.replaceState({...history.state,elioCheckout:{id,depth,step}},'',location.href);showDetails();}
  }finally{restoring=false;}
 }
 dialog.setAttribute('closedby','none');
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();close();}});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 window.addEventListener('popstate',restore);
 return {enter,back,close,finish,get step(){return step;},get restoring(){return restoring;},get navigating(){return Boolean(pending);}};
}
