// Toggle photo framing in place without changing product choices or route history.
export function mountProductPhotos({root,parent,photos=[],name='Product'}) {
 if(!root)return {destroy(){}};
 const sources=photos.flatMap(value=>{
  if(typeof value!=='string'||!value.trim())return [];
  try{const url=new URL(value,location.href);return ['http:','https:'].includes(url.protocol)?[url.href]:[];}catch{return [];}
 });
 if(!sources.length){root.textContent='Product photo coming soon.';return {destroy(){}};}
 const element=(tag,attributes={},text)=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
 const frame=element('div',{class:'product-photo-frame'});
 const trigger=element('button',{type:'button',class:'product-photo-open','data-open-photo':'','aria-label':`Show full photo of ${name}`,'aria-pressed':'false'});
 const photo=element('img',{id:'detail-photo',class:'product-dialog-image',alt:name,decoding:'async',draggable:'false'});
 const unavailable=element('span',{class:'product-photo-unavailable','data-photo-retry':'',role:'status',hidden:''},'Photo unavailable — tap to retry');
 const caption=element('span',{class:'product-photo-expand','aria-hidden':'true'},'⤢  Show full photo');
 trigger.append(photo,unavailable,caption);
 const previous=element('button',{type:'button',class:'product-photo-arrow','data-photo-prev':'','aria-label':'Previous photo'},'‹');
 const next=element('button',{type:'button',class:'product-photo-arrow','data-photo-next':'','aria-label':'Next photo'},'›');
 const counter=element('span',{class:'product-photo-counter','data-photo-counter':'','aria-live':'polite','aria-atomic':'true'});
 previous.hidden=next.hidden=counter.hidden=sources.length<2;
 frame.append(trigger,previous,next,counter);
 const thumbnails=element('div',{class:'photo-thumbs','aria-label':'Product photos'});
 const buttons=sources.map((src,i)=>{const button=element('button',{type:'button','data-photo':i,'aria-label':`View photo ${i+1}`});button.append(element('img',{src,alt:'',loading:'lazy',decoding:'async'}));button.addEventListener('click',()=>select(i));thumbnails.append(button);return button;});
 root.replaceChildren(frame);if(sources.length>1)root.append(thumbnails);
 let index=0,full=false,failed=false,touch=null,destroyed=false,suppressClickUntil=0;
 function updateMode(){
  trigger.setAttribute('aria-pressed',String(full));
  trigger.setAttribute('aria-label',failed?`Retry photo of ${name}`:`Show full photo of ${name}`);
  caption.textContent=full?'⤡  Fill frame':'⤢  Show full photo';caption.hidden=failed;
 }
 function select(value){
  if(destroyed)return;
  index=(value+sources.length)%sources.length;failed=false;photo.hidden=false;unavailable.hidden=true;
  photo.alt=`${name} — photo ${index+1} of ${sources.length}`;photo.src=sources[index];
  buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  counter.textContent=`${index+1} / ${sources.length}`;counter.setAttribute('aria-label',`Photo ${index+1} of ${sources.length}`);updateMode();
 }
 trigger.addEventListener('click',event=>{
  if(destroyed||!parent.open)return;
  if(event.detail>0&&performance.now()<suppressClickUntil){event.preventDefault();return;}
  if(failed){select(index);return;}
  full=!full;updateMode();
 });
 const onKeyDown=event=>{
  if(sources.length>1&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();select(index+(event.key==='ArrowRight'?1:-1));}
 };
 root.addEventListener('keydown',onKeyDown);
 previous.addEventListener('click',()=>select(index-1));next.addEventListener('click',()=>select(index+1));
 trigger.addEventListener('touchstart',event=>{touch=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
 trigger.addEventListener('touchmove',event=>{if(event.touches.length!==1)touch=null;},{passive:true});
 trigger.addEventListener('touchcancel',()=>{touch=null;},{passive:true});
 trigger.addEventListener('touchend',event=>{
  const start=touch;touch=null;if(!start||event.touches.length||event.changedTouches.length!==1||window.visualViewport?.scale>1.01)return;
  const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;
  if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){suppressClickUntil=performance.now()+500;if(sources.length>1)select(index+(dx<0?1:-1));}
 },{passive:true});
 photo.addEventListener('error',()=>{if(destroyed)return;failed=true;photo.hidden=true;unavailable.hidden=false;updateMode();});
 select(0);
 return {destroy(){destroyed=true;root.removeEventListener('keydown',onKeyDown);}};
}
