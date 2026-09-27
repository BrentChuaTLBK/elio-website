export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/webp,.jpg,.jpeg,.png,.heic,.heif,.webp';
export const PHOTO_HELP = 'JPEG, PNG, HEIC/HEIF, or WebP · up to 20 MB each. Automatically saved as WebP.';
export const RECEIPT_HELP = 'JPEG, PNG, HEIC/HEIF, or WebP · up to 20 MB. Automatically saved as WebP. No PDF files.';
const conversions=new WeakMap();
export function validatePhoto(file) {
  if (!(file instanceof File) || !file.size) throw new Error('Choose a photo to upload.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Each photo must be 20 MB or smaller.');
  const types = ['image/jpeg','image/png','image/heic','image/heif','image/heic-sequence','image/heif-sequence','image/webp'];
  const generic = !file.type || file.type === 'application/octet-stream';
  if (!types.includes(file.type.toLowerCase()) && !(generic && /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name))) {
    throw new Error('Choose a JPEG, PNG, HEIC/HEIF, or WebP photo.');
  }
}

// Decode and encode off the UI thread. Only the resulting WebP reaches Storage.
export async function preparePhoto(file,{receipt=false}={}) {
  validatePhoto(file);
  // Preserve identical encoded bytes when a payment upload is retried. Failed
  // conversions are not cached, so a temporary codec download failure can retry.
  let cached=conversions.get(file);if(!cached){cached=new Map();conversions.set(file,cached);}
  const purpose=receipt?'receipt':'photo';
  if(!cached.has(purpose))cached.set(purpose,convert(file,purpose).catch(error=>{cached.delete(purpose);throw error;}));
  return cached.get(purpose);
}
async function convert(file,purpose) {
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./photo-worker.js', import.meta.url), { type: 'module' });
    const finish = (error, value) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error('Photo conversion took too long. Try a smaller photo.')), 90000);
    worker.onmessage = ({data}) => finish(data.error ? new Error(data.error) : null, data.blob);
    worker.onerror = () => finish(new Error('Photo conversion could not start. Refresh the page and try again.'));
    worker.postMessage({file,purpose});
  });
  const bytes = new Uint8Array(await result.slice(0,12).arrayBuffer());
  const marker = (offset, word) => [...word].every((char,i) => bytes[offset+i] === char.charCodeAt(0));
  if (result.type !== 'image/webp' || !marker(0,'RIFF') || !marker(8,'WEBP')) throw new Error('The photo could not be converted to WebP. Please try again.');
  if (result.size > 5 * 1024 * 1024) throw new Error('The converted photo is too large. Choose a smaller photo.');
  return new File([result], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}
