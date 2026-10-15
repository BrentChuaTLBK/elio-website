// Keep photo browsing separate from product choices and product-route history.
export function mountProductPhotos({root,parent,photos=[],name='Product'}) {
 if(!root)return {destroy(){}};
 const sources=photos.flatMap(value=>{
  if(typeof value!=='string'||!value.trim())return [];
  try{const url=new URL(value,location.href);return ['http:','https:'].includes(url.protocol)?[url.href]:[];}catch{return [];}
 });
 if(!sources.length){root.textContent='Product photo coming soon.';return {destroy(){}};}
 const element=(tag,attributes={},text)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
 const trigger=element('button',{type:'button',class:'product-photo-open','data-open-photo':'','aria-label':`View full photo of ${name}`,'aria-haspopup':'dialog'});
 const photo=element('img',{id:'detail-photo',class:'product-dialog-image',alt:name,decoding:'async'});
 const unavailable=element('span',{class:'product-photo-unavailable',hidden:''},'Photo unavailable — tap to retry');
 trigger.append(photo,unavailable,element('span',{class:'product-photo-expand','aria-hidden':'true'},'⤢  View full photo'));
 const thumbnails=element('div',{class:'photo-thumbs','aria-label':'Product photos'});
 const buttons=sources.map((src,i)=>{const button=element('button',{type:'button','data-photo':i,'aria-label':`View photo ${i+1}`});button.append(element('img',{src,alt:'',loading:'lazy',decoding:'async'}));button.addEventListener('click',()=>select(i));thumbnails.append(button);return button;});
 root.replaceChildren(trigger);if(sources.length>1)root.append(thumbnails);
 const viewer=element('dialog',{id:'product-photo-viewer',class:'elio-commerce product-photo-viewer','aria-labelledby':'photo-viewer-title'});
 const header=element('div',{class:'photo-viewer-head'}),title=element('h2',{id:'photo-viewer-title'},name);
 const closeButton=element('button',{type:'button','data-photo-close':'','aria-label':'Close full photo',autofocus:''},'×');header.append(title,closeButton);
 const frame=element('div',{class:'photo-viewer-frame'}),large=element('img',{'data-viewer-image':'',alt:name,decoding:'async',draggable:'false'});
 const error=element('div',{class:'photo-viewer-error',role:'status',hidden:''}),retry=element('button',{type:'button','data-photo-retry':''},'Try again');
 error.append(element('p',{},'This photo couldn’t load.'),retry);frame.append(large,error);
 const footer=element('div',{class:'photo-viewer-controls'}),previous=element('button',{type:'button','data-photo-prev':'','aria-label':'Previous photo'},'←'),next=element('button',{type:'button','data-photo-next':'','aria-label':'Next photo'},'→'),counter=element('span',{'data-photo-counter':'','aria-live':'polite','aria-atomic':'true'});
 previous.hidden=next.hidden=sources.length<2;footer.append(previous,counter,next);viewer.append(header,frame,footer);document.body.append(viewer);
 let index=0,savedScroll=0,touch=null,destroyed=false;
 function renderLarge(){
  error.hidden=true;large.hidden=false;large.alt=`${name} — photo ${index+1} of ${sources.length}`;large.src=sources[index];
  counter.textContent=`Photo ${index+1} of ${sources.length}`;
 }
 function select(value){
  index=(value+sources.length)%sources.length;photo.hidden=false;unavailable.hidden=true;photo.src=sources[index];
  buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  if(viewer.open)renderLarge();
 }
 function close(){if(viewer.open)viewer.close();}
 function restoreFocus(){if(!destroyed&&parent.open&&trigger.isConnected){trigger.focus({preventScroll:true});parent.scrollTop=savedScroll;}}
 trigger.addEventListener('click',()=>{if(destroyed||!parent.open)return;savedScroll=parent.scrollTop;select(index);renderLarge();viewer.showModal();});
 closeButton.addEventListener('click',close);
 viewer.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close();});
 viewer.addEventListener('close',restoreFocus);
 viewer.addEventListener('keydown',event=>{
  if(sources.length>1&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();select(index+(event.key==='ArrowRight'?1:-1));}
 });
 previous.addEventListener('click',()=>select(index-1));next.addEventListener('click',()=>select(index+1));
 frame.addEventListener('touchstart',event=>{touch=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
 frame.addEventListener('touchmove',event=>{if(event.touches.length!==1)touch=null;},{passive:true});
 frame.addEventListener('touchcancel',()=>{touch=null;},{passive:true});
 frame.addEventListener('touchend',event=>{
  const start=touch;touch=null;if(!start||event.touches.length||event.changedTouches.length!==1||sources.length<2||window.visualViewport?.scale>1.01)return;
  const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;
  if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)select(index+(dx<0?1:-1));
 },{passive:true});
 photo.addEventListener('error',()=>{photo.hidden=true;unavailable.hidden=false;});
 large.addEventListener('error',()=>{large.hidden=true;error.hidden=false;});
 retry.addEventListener('click',()=>select(index));
 parent.addEventListener('close',close);window.addEventListener('popstate',close);
 select(0);
 return {destroy(){destroyed=true;parent.removeEventListener('close',close);window.removeEventListener('popstate',close);close();viewer.remove();}};
}
