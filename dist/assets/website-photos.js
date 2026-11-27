import {config} from './admin/config.js';
import {photoSlots,readPublishedPhotos,websitePhotoUrl} from './website-photo-slots.js';

const selector = '[data-website-photo]';
const defaults = new Map(photoSlots.map(slot => [slot.id,slot]));
const media = matchMedia('(max-width:600px)');
const cacheKey = 'elio-published-website-photos-v2:' + config.supabaseUrl;

function readCache() {
 try { return JSON.parse(localStorage.getItem(cacheKey)) || {}; } catch { return {}; }
}

async function start() {
 const preview = new URLSearchParams(location.search).get('preview') === '1';
 const embedded = document.getElementById('elio-published-photos');
 let photos = {};
 if (embedded && !preview) {
  photos = JSON.parse(embedded.textContent);
 } else if (!preview && config.supabaseUrl && config.supabasePublishableKey) {
  try { photos = await readPublishedPhotos(config); }
  catch { photos = readCache(); }
 }
 if (!preview) {
  try { localStorage.setItem(cacheKey,JSON.stringify(photos)); } catch {}
 }

 function selectedNode(img) {
  return img.parentElement?.tagName === 'PICTURE'
   ? [...img.parentElement.querySelectorAll('source[data-website-photo]')].find(source => !source.media || matchMedia(source.media).matches) || img
   : img;
 }

 function describe(img) {
  const node = selectedNode(img), id = node.dataset.websitePhoto;
  const saved = node.dataset.websitePhotoApplied && photos[id];
  img.alt = saved?.alt || defaults.get(id)?.alt || '';
  img.style.objectPosition = saved ? `${saved.position_x}% ${saved.position_y}%` : '';
 }

 function apply(node, useOriginal = false) {
  const isSource = node.tagName === 'SOURCE', attr = isSource ? 'srcset' : 'src';
  const saved = photos[node.dataset.websitePhoto];
  const url = useOriginal ? '' : websitePhotoUrl(saved?.path,config.supabaseUrl);
  const target = url || (isSource ? node.dataset.defaultSrcset : node.dataset.defaultSrc);
  if (!target) return;
  if (url) node.dataset.websitePhotoApplied = url;
  else delete node.dataset.websitePhotoApplied;
  if (node.getAttribute(attr) !== target) node.setAttribute(attr,target);
  if (!isSource) {
   describe(node);
   const disclaimer = node.closest('.detail-layout')?.querySelector('[data-photo-disclaimer]');
   if (disclaimer) disclaimer.hidden = Boolean(url);
  }
 }

 function imageFailed(img) {
  if (!img.matches?.('img[data-website-photo]')) return;
  const node = selectedNode(img);
  if (!node.dataset.websitePhotoApplied || img.currentSrc !== node.dataset.websitePhotoApplied) return;
  apply(node,true);
  describe(img);
 }

 function scan(root) {
  if (root.matches?.(selector)) apply(root);
  root.querySelectorAll?.(selector).forEach(node => apply(node));
  if (root.matches?.('img[data-website-photo]') && root.complete && !root.naturalWidth) imageFailed(root);
  root.querySelectorAll?.('img[data-website-photo]').forEach(img => {
   if (img.complete && !img.naturalWidth) imageFailed(img);
  });
 }

 document.addEventListener('error',event => imageFailed(event.target),true);
 scan(document);
 const observer = new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
 });
 observer.observe(document.body,{childList:true,subtree:true});
 media.addEventListener('change',() => document.querySelectorAll('picture img[data-website-photo]').forEach(describe));
}

void start();
