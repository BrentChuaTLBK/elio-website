import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {initializeImageMagick,ImageMagick} from '@imagemagick/magick-wasm';
import {buildSharePhotos,shareJpeg} from '../scripts/build-share-photos.mjs';
import {createPhotoWorker} from '../worker.mjs';
import {publicPage,renderPhotoPage} from '../lib/public-photo-page.mjs';
import {photoSlots,sharePhotoSlots,websitePhotoUrl,websiteSharePath} from '../dist/assets/website-photo-slots.js';
import {config} from '../dist/assets/admin/config.js';

const origin='https://eliocheesecakes.com',owner='11111111-1111-4111-8111-111111111111';
const row=(n,alt)=>({path:owner+'/'+String(n).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp',alt,position_x:60,position_y:30});
const photos=Object.fromEntries(photoSlots.map(({id},i)=>[id,row(i+1,'Published '+id)]));
const shares=Object.fromEntries(Object.values(sharePhotoSlots).map(id=>[id,{path:photos[id].path,url:'/_immutable/'+id+'.jpg',alt:photos[id].alt,width:1200,height:630}]));
const templates=new Map();
for(const page of Object.keys(sharePhotoSlots)){
 const raw=await readFile(new URL('../dist/'+(page==='/'?'index':page.slice(1))+'.html',import.meta.url),'utf8');
 const baked=renderPhotoPage(raw,page,photos,shares[sharePhotoSlots[page]]);
 assert.equal(baked,renderPhotoPage(baked,page,photos,shares[sharePhotoSlots[page]]),'Repeat rendering '+page);
 templates.set(page,baked);
}
const env={ASSETS:{async fetch(input){
 const path=new URL(typeof input==='string'?input:input.url).pathname;
 if(path==='/assets/published-photos.json')return Response.json({photos,shares});
 if(templates.has(path))return new Response(templates.get(path),{headers:{'content-type':'text/html','etag':'"template"','content-length':'999'}});
 return new Response('static',{headers:{'content-type':'text/plain'}});
}}};
const get=(page,ua='facebookexternalhit/1.1')=>new Request(origin+page,{headers:{'User-Agent':ua}});
const live=structuredClone(photos);
live.shop_hero=row(99,'Quote " and </script><img src=x>');
const read=[];
const worker=createPhotoWorker(async(url,init)=>{
 read.push({url,init});
 if(init.method==='HEAD')return new Response(null,{headers:{'content-type':'image/jpeg'}});
 assert.deepEqual(JSON.parse(init.body),{p_action:'website_photos',p_payload:{},p_token:null});
 return Response.json({photos:live});
});
for(const agent of ['facebookexternalhit/1.1','Viber','Mozilla/5.0']){
 for(const [page,id] of Object.entries(sharePhotoSlots)){
  const resp=await worker.fetch(get(page+'?utm_source=example',agent),env),html=await resp.text();
  assert.equal(resp.status,200);assert.equal(resp.headers.get('etag'),null);assert.equal(resp.headers.get('content-length'),null);
  assert.equal((html.match(/property="og:image"/g)||[]).length,1);
  const preview=html.match(/property="og:image" content="([^"]+)"/)[1];
  assert.equal(preview,id==='shop_hero'?websitePhotoUrl(websiteSharePath(live[id].path),config.supabaseUrl):origin+shares[id].url);
  assert.ok(html.includes('property="og:image:type" content="image/jpeg"'));assert.ok(html.includes('property="og:image:width" content="1200"'));
  const embedded=JSON.parse(html.match(/id="elio-published-photos">([^<]+)<\/script>/)[1]);assert.deepEqual(embedded,live);
  assert(!html.includes('<img src=x>'));assert(!html.includes('utm_source=example'));
  for(const [tag,slot] of Array.from(html.matchAll(/<(?:img|source)\b[^>]*data-website-photo="([^"]+)"[^>]*>/g),m=>[m[0],m[1]])){
   assert.ok(tag.includes('="'+websitePhotoUrl(live[slot].path,config.supabaseUrl)+'"'));
   assert.doesNotMatch(tag,/\s(?:src|srcset)="(?:assets\/|\/_immutable\/)/);
  }
 }
}
assert.equal(read.filter(r=>r.init.method==='POST').length,1);
assert.equal(read.filter(r=>r.init.method==='HEAD').length,1);
live.home_hero=row(100,'Freshly published homepage');
const refreshed=await worker.fetch(new Request(origin+'/',{headers:{'Cache-Control':'max-age=0'}}),env);
assert.ok((await refreshed.text()).includes('src="'+websitePhotoUrl(live.home_hero.path,config.supabaseUrl)+'"'));
assert.equal(read.filter(r=>r.init.method==='POST').length,2);
assert.equal((await worker.fetch(new Request(origin+'/order',{method:'HEAD'}),env)).body,null);
assert.equal(await (await worker.fetch(get('/manage'),env)).text(),'static');
assert.equal(publicPage('/account'),null);
assert.equal(publicPage('/order-photos'),null);
assert.equal(publicPage('/order.html'),'/order');
const offline=createPhotoWorker(async()=>{throw Error('Temporary outage');});
assert.equal(await (await offline.fetch(get('/'),env)).text(),templates.get('/'));
const unavailable=createPhotoWorker(async(url,init)=>init.method==='HEAD'?new Response(null,{status:404}):Response.json({photos:live}));
const html=await (await unavailable.fetch(get('/order?token=synthetic-only'),env)).text();
assert.ok(html.includes('property="og:image" content="'+origin+shares.shop_hero.url+'"'));
assert(!html.includes('synthetic-only'));
console.log('PASS first-response photos and sharing metadata on five public pages, updated uploads, outages and private route isolation.');
const require=createRequire(import.meta.url);
await initializeImageMagick(await readFile(require.resolve('@imagemagick/magick-wasm/magick.wasm')));
const sample=await readFile(new URL('../dist/assets/trio-story-concept.webp',import.meta.url));
const jpeg=shareJpeg(sample,80,35);
assert.deepEqual([...jpeg.subarray(0,3)],[255,216,255]);
ImageMagick.read(jpeg,img=>assert.deepEqual([img.width,img.height],[1200,630]));
console.log('PASS share image content and 1200 × 630 JPEG dimensions.');

const buildOut=resolve('test-results/public-photo-release');await mkdir(join(buildOut,'assets'),{recursive:true});
for(const [page,content] of templates)await writeFile(join(buildOut,page==='/'?'index.html':page.slice(1)+'.html'),content);
const source=websitePhotoUrl(photos.shop_hero.path,config.supabaseUrl);
await buildSharePhotos(buildOut,async()=> '/_immutable/fixture.jpg',null,async url=>{
 if(url.endsWith('/rpc/shop_api')||url===source)return new Response(null,{status:503});
 if(url.endsWith('/assets/published-photos.json'))return Response.json({photos,shares});
 return new Response(sample,{headers:{'content-type':'image/webp'}});
});
const backup=JSON.parse(await readFile(join(buildOut,'assets/published-photos.json'),'utf8'));
assert.equal(backup.shares.shop_hero.path,photos.home_hero.path);
assert.deepEqual(backup.photos,photos);
console.log('PASS release build retains published photos during an outage and uses a real cake when a source image is missing.');
