import {config} from './dist/assets/admin/config.js';
import {readPublishedPhotos,sharePhotoSlots,websitePhotoUrl,websiteSharePath} from './dist/assets/website-photo-slots.js';
import {publicPage,renderPhotoPage} from './lib/public-photo-page.mjs';

export function createPhotoWorker(fetcher = fetch) {
 let snapshot, latest, nextRead = 0, readSequence = 0;
 const previews = new Map();

 async function publishedPhotos(fallback, refresh) {
  if (!refresh && Date.now() < nextRead) return latest || fallback;
  const sequence = ++readSequence;
  try {
   const photos = await readPublishedPhotos(config,{fetcher,timeout:1800});
   if (sequence === readSequence) { latest = photos; nextRead = Date.now()+15000; }
   return photos;
  } catch {
   if (sequence === readSequence) nextRead = Date.now()+3000;
   return latest || fallback;
  }
 }

 async function shareFor(id, photos, shares) {
  const row = photos[id] || photos.home_hero || photos.shop_hero;
  const built = shares[id];
  if (!row || built?.path === row.path) return built && {...built,alt:row?.alt || built.alt};
  const original = websitePhotoUrl(row.path,config.supabaseUrl);
  if (!original) return built;
  const url = websitePhotoUrl(websiteSharePath(row.path),config.supabaseUrl);
  const fallback = /\.jpe?g$/i.test(original) ? {url:original,alt:row.alt} : built;
  const cached = previews.get(id);
  if (cached?.url === url && cached.until > Date.now()) return cached.ok ? {url,alt:row.alt,width:1200,height:630} : fallback;
  try {
   const response = await fetcher(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(1200)});
   const ok = response.ok && /^image\/jpeg\b/i.test(response.headers.get('content-type') || '');
   previews.set(id,{url,ok,until:Date.now()+(ok ? 3600000 : 30000)});
   if (ok) return {url,alt:row.alt,width:1200,height:630};
  } catch { /* The release contains a verified JPEG for every public page. */ }
  return fallback;
 }

 return {
  async fetch(request, env) {
   const url = new URL(request.url), path = publicPage(url.pathname);
   if (!path || !['GET','HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
   // A dashboard photo can change independently of the static file's ETag.
   const headers = new Headers(request.headers);
   for (const h of ['if-none-match','if-modified-since','if-range','range']) headers.delete(h);
   const asset = await env.ASSETS.fetch(new Request(request.url,{method:'GET',headers}));
   if (asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) return asset;
   const resultHeaders = new Headers(asset.headers);
   for (const h of ['content-length','content-encoding','etag','last-modified','accept-ranges']) resultHeaders.delete(h);
   resultHeaders.set('Cache-Control','no-cache');
   if (request.method === 'HEAD') return new Response(null,{headers:resultHeaders});
   const html = await asset.text();
   try {
    if (!snapshot) {
     const response = await env.ASSETS.fetch(new URL('/assets/published-photos.json',url.origin).href);
     if (!response.ok) throw new Error('Release snapshot unavailable');
     snapshot = await response.json();
    }
    const refresh = /\bno-(?:cache|store)\b|\bmax-age\s*=\s*0\b/i.test(request.headers.get('Cache-Control') || '');
    const photos = url.searchParams.get('preview') === '1' ? {} : await publishedPhotos(snapshot.photos,refresh);
    const share = await shareFor(sharePhotoSlots[path],photos,snapshot.shares);
    return new Response(renderPhotoPage(html,path,photos,share),{headers:resultHeaders});
   } catch {
    return new Response(html,{headers:resultHeaders});
   }
  },
 };
}
export default createPhotoWorker();
