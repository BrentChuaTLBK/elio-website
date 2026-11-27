import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ImageMagick,MagickFormat,MagickGeometry} from '@imagemagick/magick-wasm';
import {config} from '../dist/assets/admin/config.js';
import {readPublishedPhotos,sharePhotoSlots,websitePhotoUrl,publicPhotoRows} from '../dist/assets/website-photo-slots.js';
import {renderPhotoPage,siteOrigin} from '../lib/public-photo-page.mjs';

export function shareJpeg(bytes, x = 50, y = 50) {
 return ImageMagick.read(bytes,image => {
  image.autoOrient();
  const scale = Math.max(1200 / image.width,630 / image.height);
  const width = Math.ceil(image.width * scale), height = Math.ceil(image.height * scale);
  image.resize(width,height);
  image.crop(new MagickGeometry(Math.round((image.width-1200)*x/100),Math.round((image.height-630)*y/100),1200,630));
  image.strip();
  image.quality = 86;
  return image.write(MagickFormat.Jpeg,encoded => Buffer.from(encoded));
 });
}

async function publishedRows(fetcher) {
 try { return await readPublishedPhotos(config,{fetcher,timeout:12000}); }
 catch {
  const previous = await fetcher(siteOrigin+'/assets/published-photos.json',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if (!previous.ok) throw new Error('Published website photo settings could not be read');
  return publicPhotoRows((await previous.json()).photos,config.supabaseUrl);
 }
}

export async function buildSharePhotos(out, publish, catalogPhoto, fetcher = fetch) {
 const photos = await publishedRows(fetcher);
 const shares = {}, versions = new Map();
 async function makePreview(source, row) {
  const key = [source,row?.position_x,row?.position_y].join(':');
  if (!versions.has(key)) {
   let version = null;
   try {
    const response = await fetcher(source,{redirect:'error',signal:AbortSignal.timeout(15000)});
    if (response.ok) {
     const bytes = new Uint8Array(await response.arrayBuffer());
     if (bytes.length <= 20*1024*1024) version = await publish(shareJpeg(bytes,row?.position_x,row?.position_y),'.jpg');
    }
   } catch { /* Try the next published photo. */ }
   versions.set(key,version);
  }
  return versions.get(key);
 }
 for (const [page,id] of Object.entries(sharePhotoSlots)) {
  for (const row of [photos[id],photos.home_hero,photos.shop_hero,photos.home_box,null]) {
   const source = row ? websitePhotoUrl(row.path,config.supabaseUrl) : row === null && catalogPhoto;
   if (!source) continue;
   const url = await makePreview(source,row);
   if (url) {
    shares[id] = {path:row?.path || null,url,alt:row?.alt || 'Elio Basque cheesecakes',width:1200,height:630};
    break;
   }
  }
  if (!shares[id]) throw new Error('No published cheesecake photo could be opened for '+page);
  const file = join(out,page === '/' ? 'index.html' : page.slice(1)+'.html');
  await writeFile(file,renderPhotoPage(await readFile(file,'utf8'),page,photos,shares[id]));
 }
 await writeFile(join(out,'assets/published-photos.json'),JSON.stringify({photos,shares}));
}
