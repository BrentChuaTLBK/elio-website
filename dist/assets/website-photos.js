import {config} from './admin/config.js';
import {websitePhotoUrl} from './website-photo-slots.js';

// Keep the original HTML photos visible if settings or a replacement cannot load.
// This module never blocks rendering, checkout, or the catalog.
if(config.supabaseUrl&&config.supabasePublishableKey&&new URLSearchParams(location.search).get('preview')!=='1'){
 let photos={},loaded=false;
 const checked=new Map(),originals=new WeakMap(),mobile=matchMedia('(max-width:600px)');
 const original=node=>{if(!originals.has(node))originals.set(node,{src:node.getAttribute(node.tagName==='SOURCE'?'srcset':'src'),alt:node.getAttribute('alt'),position:node.style.objectPosition});return originals.get(node);};
 const ready=url=>{if(!checked.has(url))checked.set(url,new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=url;}));return checked.get(url);};
 function position(img){
  const source=img.parentElement?.tagName==='PICTURE'?[...img.parentElement.querySelectorAll('source[data-website-photo]')].find(s=>matchMedia(s.media).matches):null;
  const saved=photos[(source||img).dataset.websitePhoto],fallback=original(img);
  const url=websitePhotoUrl(saved?.path,config.supabaseUrl);
  const applied=(source||img).dataset.websitePhotoApplied===url&&url;
  img.style.objectPosition=applied?`${saved.position_x}% ${saved.position_y}%`:fallback.position;
  img.alt=applied?saved.alt:fallback.alt||'';
 }
 async function apply(node){
  if(!loaded)return;
  const fallback=original(node),saved=photos[node.dataset.websitePhoto],url=websitePhotoUrl(saved?.path,config.supabaseUrl);
  const image=node.tagName==='SOURCE'?node.parentElement.querySelector('img'):node;
  if(image)original(image);
  if(url&&await ready(url)){
   node.setAttribute(node.tagName==='SOURCE'?'srcset':'src',url);node.dataset.websitePhotoApplied=url;
   node.closest('.detail-layout')?.querySelector('[data-photo-disclaimer]')?.setAttribute('hidden','');
  }else{node.setAttribute(node.tagName==='SOURCE'?'srcset':'src',fallback.src);delete node.dataset.websitePhotoApplied;}
  if(image)position(image);
 }
 function scan(root){
  if(root.matches?.('[data-website-photo]'))void apply(root);
  root.querySelectorAll?.('[data-website-photo]').forEach(node=>void apply(node));
 }
 fetch(`${config.supabaseUrl}/rest/v1/rpc/shop_api`,{
  method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},
  body:JSON.stringify({p_action:'website_photos',p_payload:{},p_token:null}),cache:'no-store',signal:AbortSignal.timeout(5000),
 }).then(response=>{if(!response.ok)throw new Error('Photos unavailable');return response.json();}).then(result=>{
  photos=result?.photos||{};loaded=true;scan(document);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node);}))).observe(document.body,{childList:true,subtree:true});
  mobile.addEventListener('change',()=>document.querySelectorAll('picture img[data-website-photo]').forEach(position));
 }).catch(()=>{});
}
