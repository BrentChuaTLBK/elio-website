import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ImageMagick,MagickFormat,MagickGeometry} from '@imagemagick/magick-wasm';
import {config} from '../dist/assets/admin/config.js';
import {readPublishedPhotos,sharePhotoSlots,websitePhotoUrl} from '../dist/assets/website-photo-slots.js';
import {renderPhotoPage} from '../lib/public-photo-page.mjs';

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

export async function buildSharePhotos(out, publish, catalogPhoto) {
 const photos = await readPublishedPhotos(config,{timeout:12000});
 const shares = {}, versions = new Map();
 for (const [page,id] of Object.entries(sharePhotoSlots)) {
  const row = photos[id] || photos.home_hero || photos.shop_hero;
  const source = websitePhotoUrl(row?.path,config.supabaseUrl) || catalogPhoto;
  if (!source) throw new Error('No published cheesecake photo is available for link previews');
  const key = [source,row?.position_x,row?.position_y].join(':');
  if (!versions.has(key)) {
   const response = await fetch(source,{redirect:'error',signal:AbortSignal.timeout(15000)});
   if (!response.ok) throw new Error(`Cannot load the published share photo for ${page}: ${response.status}`);
   const bytes = new Uint8Array(await response.arrayBuffer());
   if (bytes.length > 20*1024*1024) throw new Error('Website photo exceeds the upload limit');
   versions.set(key,await publish(shareJpeg(bytes,row?.position_x,row?.position_y),'.jpg'));
  }
  shares[id] = {path:row?.path || null, url:versions.get(key), alt:row?.alt || 'Elio Basque cheesecakes', width:1200, height:630};
  const file = join(out,page === '/' ? 'index.html' : page.slice(1)+'.html');
  await writeFile(file,renderPhotoPage(await readFile(file,'utf8'),page,photos,shares[id]));
 }
 await writeFile(join(out,'assets/published-photos.json'),JSON.stringify({photos,shares}));
}
