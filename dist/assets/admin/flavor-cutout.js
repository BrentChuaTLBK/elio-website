import { inspectImage } from '../image-file.js';
import { validatePhoto } from './photo-upload.js';

export function flavorCutoutField(value, { esc, safeImage, disabled }) {
  const url = safeImage(value);
  return `<section class="subsection" data-flavor-cutout>
    <h3>Trio builder photo</h3>
    <input type="hidden" name="builder_cutout_url" value="${esc(url)}">
    <img data-cutout-preview ${url ? 'src="' + esc(url) + '"' : 'hidden'} width="100" height="100" style="object-fit:contain" alt="Cake cutout for this flavor">
    <label class="field">Upload or replace cake cutout
      <input type="file" data-cutout-file accept="image/png,image/webp,.png,.webp" ${disabled}>
    </label>
    <p class="help-text">Optional. Choose a PNG or WebP with a transparent background. The builder uses the menu photo when this is empty.</p>
    <button type="button" class="button button-quiet" data-remove-cutout ${url ? '' : 'hidden'} ${disabled}>Remove cutout</button>
    <p class="help-text" data-cutout-status role="status" aria-live="polite"></p>
  </section>`;
}

function canvas(width, height) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return el;
}

// Fit the visible cake to the same baseline as the supplied 320px box-slot artwork.
export async function prepareFlavorCutout(file) {
  validatePhoto(file);
  const { mime } = inspectImage(new Uint8Array(await file.arrayBuffer()));
  if (mime !== 'image/png' && mime !== 'image/webp') throw new Error('Choose a transparent PNG or WebP for the cake cutout.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('This image could not be opened. Try another photo.'));
      img.src = url;
    });
    const ratio = 440 / Math.max(img.naturalWidth, img.naturalHeight);
    const thumb = canvas(Math.max(1,Math.round(img.naturalWidth * ratio)), Math.max(1,Math.round(img.naturalHeight * ratio)));
    const ctx = thumb.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, thumb.width, thumb.height);
    const { data } = ctx.getImageData(0, 0, thumb.width, thumb.height);
    let left = thumb.width, top = thumb.height, right = -1, bottom = -1, clear = false;
    for (let y = 0; y < thumb.height; y++) {
      for (let x = 0; x < thumb.width; x++) {
        const alpha = data[(y * thumb.width + x) * 4 + 3];
        if (alpha < 16) clear = true;
        if (alpha <= 24) continue;
        left = Math.min(left,x); right = Math.max(right,x);
        top = Math.min(top,y); bottom = Math.max(bottom,y);
      }
    }
    if (right < left) throw new Error('This cutout is empty. Choose an image that shows the cake.');
    if (!clear) throw new Error('This image has a solid background. Use it as the menu photo or choose a transparent cutout.');
    const width = right-left+1, height = bottom-top+1, scale = Math.min(272/width,250/height);
    const square = canvas(320,320);
    square.getContext('2d').drawImage(thumb, left, top, width, height, (320-width*scale)/2, 276-height*scale, width*scale, height*scale);
    const blob = await new Promise(resolve => square.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('This cutout could not be prepared. Try a different photo.');
    return new File([blob], 'cake-cutout.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function bindFlavorCutout(form, { upload, safeImage, onChange }) {
  const section = form?.querySelector('[data-flavor-cutout]');
  if (!section) return;
  const picker = section.querySelector('[data-cutout-file]'), remove = section.querySelector('[data-remove-cutout]');
  const preview = section.querySelector('[data-cutout-preview]'), status = section.querySelector('[data-cutout-status]');
  const value = form.elements.namedItem('builder_cutout_url');
  function change(url) {
    value.value = url;
    preview.hidden = remove.hidden = !url;
    if (url) preview.src = url;
    else preview.removeAttribute('src');
    status.textContent = url ? 'Cutout ready. Save this flavor to use it.' : 'Cutout removed. Save this flavor to keep the change.';
    onChange();
  }
  remove.addEventListener('click', () => {
    if (remove.disabled || form.dataset.busy === 'true') return;
    change('');
    picker.focus();
  });
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file || picker.disabled || form.dataset.busy === 'true') return;
    const enabled = [...form.elements].filter(control => !control.disabled);
    form.dataset.busy = 'true';
    enabled.forEach(control => { control.disabled = true; });
    status.textContent = 'Preparing cake cutout…';
    try {
      const normalized = await prepareFlavorCutout(file);
      if (!form.isConnected) return;
      const result = await upload(normalized, { kind: 'product' });
      if (!form.isConnected) return;
      const url = safeImage(result.url);
      if (!url) throw new Error('The uploaded cutout could not be opened.');
      change(url);
    } catch (error) {
      if (form.isConnected) status.textContent = error.message || 'Could not upload the cutout. Please try again.';
    } finally {
      form.dataset.busy = 'false';
      enabled.forEach(control => { control.disabled = false; });
      picker.value = '';
      if (form.isConnected) onChange();
    }
  });
}
