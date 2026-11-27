import { flavorVideoUrl } from '../flavor-video.js';
import { escapeHtml, upload } from './client.js';

function preview(path, disabled) {
  const url = flavorVideoUrl(path);
  if (!url) return '';
  return `<video src="${escapeHtml(url)}" controls muted playsinline preload="metadata" aria-label="Texture video preview" style="display:block;width:min(100%,280px);aspect-ratio:1;object-fit:contain;background:#2f221c;border-radius:12px"></video>
    <button type="button" class="button button-secondary" data-remove-video ${disabled}>Remove video</button>`;
}

export function flavorVideoField(product, disabled) {
  const path = product?.texture_video_path || '';
  return `<section class="subsection" data-texture-field><h3>Texture video</h3>
    <input type="hidden" name="texture_video_path" value="${escapeHtml(path)}">
    <div data-video-preview>${preview(path, disabled)}</div>
    <label class="field">Upload or replace video<input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" ${disabled}></label>
    <p class="help-text">Optional. Up to 20 MB. Use MP4 (H.264) for the widest phone support. The clip plays muted when a customer opens this flavor.</p>
    <p class="help-text" role="status" aria-live="polite" data-video-status></p></section>`;
}

export function bindFlavorVideoField(form) {
  const field = form.querySelector('[data-texture-field]');
  if (!field) return;
  const input = field.querySelector('[type=file]'), path = form.elements.texture_video_path;
  const status = field.querySelector('[data-video-status]');
  function setVideo(value) {
    path.value = value;
    field.querySelector('[data-video-preview]').innerHTML = preview(value, '');
    path.dispatchEvent(new Event('input', {bubbles:true}));
    status.textContent = value ? 'Video ready. Save the flavor to use it.' : 'Video removed. Save the flavor to keep this change.';
  }
  field.addEventListener('click', event => {
    if (event.target.closest('[data-remove-video]') && !input.disabled && form.dataset.busy !== 'true') {
      setVideo('');
      input.focus();
    }
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file || input.disabled || form.dataset.busy === 'true') return;
    const controls = [...form.elements].filter(el => !el.disabled && 'disabled' in el);
    form.dataset.busy = 'true';
    controls.forEach(el => { el.disabled = true; });
    status.textContent = 'Uploading video…';
    try {
      const saved = await upload(file, {kind:'flavor-video'});
      if (form.isConnected) setVideo(saved);
    } catch (error) {
      status.textContent = error.message || 'Video upload failed. Choose the file to retry.';
    } finally {
      input.value = '';
      controls.forEach(el => { el.disabled = false; });
      form.dataset.busy = 'false';
    }
  });
}
