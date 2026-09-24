// Pinned codecs load only for HEIC input or browsers without native WebP encoding.
// Photo data stays in this worker; the CDN receives only requests for library code.
const HEIC_CODEC = 'https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/next/heic-to.js';
const WEBP_CODEC = 'https://esm.sh/@jsquash/webp@1.5.0/encode?bundle';

async function decode(file) {
  const header = new Uint8Array(await file.slice(0,256).arrayBuffer());
  const word = (offset, text) => [...text].every((char,i) => header[offset+i] === char.charCodeAt(0));
  const raster = header[0] === 255 && header[1] === 216 && header[2] === 255 ||
    word(0,'\x89PNG\r\n\x1a\n') || word(0,'RIFF') && word(8,'WEBP');
  const heic = word(4,'ftyp') && /heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1/.test(new TextDecoder().decode(header));
  if (!raster && !heic) throw new Error('This file is not a supported photo. Choose a JPEG, PNG, HEIC, or WebP image.');
  try { return await createImageBitmap(file); }
  catch {
    if (!heic) throw new Error('This photo could not be read. Try exporting it again.');
    let codec;
    try { codec = await import(HEIC_CODEC); }
    catch { throw new Error('The HEIC converter could not load. Check your connection and try again.'); }
    try { return await codec.heicTo({blob:file,type:'bitmap'}); }
    catch { throw new Error('This HEIC photo could not be read. Try another photo or export it as JPEG.'); }
  }
}

self.onmessage = async ({data:file}) => {
  let bitmap;
  try {
    bitmap = await decode(file);
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 60000000) throw new Error('Choose a photo with no more than 60 megapixels.');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width,bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close(); bitmap = null;
    let blob = await canvas.convertToBlob({type:'image/webp',quality:0.88});
    // Some browsers return PNG for unsupported encoders. Never upload it as WebP.
    if (blob.type !== 'image/webp') {
      let codec;
      try { codec = await import(WEBP_CODEC); }
      catch { throw new Error('The WebP converter could not load. Check your connection and try again.'); }
      await codec.init(undefined,{locateFile:path => `https://cdn.jsdelivr.net/npm/@jsquash/webp@1.5.0/codec/enc/${path}`});
      const bytes = await codec.default(ctx.getImageData(0,0,canvas.width,canvas.height),{quality:88});
      blob = new Blob([bytes],{type:'image/webp'});
    }
    self.postMessage({blob});
  } catch (error) { self.postMessage({error:error.message || 'The photo could not be converted. Please try another image.'}); }
  finally { bitmap?.close(); }
};
