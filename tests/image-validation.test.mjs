import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ImageMagick,MagickFormat} from '@imagemagick/magick-wasm';
import {validateImage,imageType} from '../supabase/functions/_shared/images.ts';
import {heicContainer} from './helpers/image-fixtures.mjs';

const png=await readFile(new URL('../dist/assets/elio-favicon.png',import.meta.url));
assert.equal((await validateImage(png)).mime,'image/png');
const webp=ImageMagick.read(png,image=>image.write(MagickFormat.WebP,bytes=>Uint8Array.from(bytes)));
const jpeg=ImageMagick.read(png,image=>image.write(MagickFormat.Jpeg,bytes=>Uint8Array.from(bytes)));
for(const [bytes,mime] of [[png,'image/png'],[webp,'image/webp'],[jpeg,'image/jpeg']]){
  assert.equal((await validateImage(bytes)).mime,mime);
  await assert.rejects(()=>validateImage(bytes.slice(0,bytes.length-12)),e=>e.status===415);
}
const corruptWebp=Buffer.alloc(22);corruptWebp.write('RIFF');corruptWebp.writeUInt32LE(14,4);corruptWebp.write('WEBPVP8L',8);corruptWebp.writeUInt32LE(2,16);
assert.equal(imageType(corruptWebp).mime,'image/webp','Reproduces the former header-only acceptance');
await assert.rejects(()=>validateImage(corruptWebp),e=>e.status===415);
// Also reject structurally recognizable formats whose pixel stream is invalid.
const corruptPng=Buffer.from(png);const idat=corruptPng.indexOf('IDAT');assert(idat>0);corruptPng[idat+4]^=255;assert.throws(()=>imageType(corruptPng),e=>e.status===415);await assert.rejects(()=>validateImage(corruptPng),e=>e.status===415);
const hugePng=Buffer.from(png);hugePng.writeUInt32BE(100000,16);hugePng.writeUInt32BE(100000,20);await assert.rejects(()=>validateImage(hugePng),e=>e.status===415);
const concurrent=await Promise.all(Array.from({length:8},()=>validateImage(webp)));assert(concurrent.every(v=>v.mime==='image/webp'));
const heic=heicContainer();assert.deepEqual(await validateImage(heic),{mime:'image/heic',extension:'heic'});
for(const damaged of [heic.subarray(0,heic.length-1),Buffer.from('ftypheic'),Buffer.from(heic)]){if(damaged.length===heic.length)damaged.write('avif',8);await assert.rejects(()=>validateImage(damaged),e=>e.status===415);}
const large=ImageMagick.read(png,image=>{image.resize(4200,3000);return image.write(MagickFormat.Png,bytes=>Uint8Array.from(bytes));});assert.equal((await validateImage(large)).mime,'image/png');
await assert.rejects(()=>validateImage(new Uint8Array(20*1024*1024+1)),e=>e.status===413);
console.log('PASS real PNG/JPEG/WebP decode, damaged/truncated files, forged WebP, oversized dimensions, and concurrent validator reuse');
