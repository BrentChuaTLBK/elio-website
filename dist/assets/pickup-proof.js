// A photo is fetched only for the authorized order that owns this section.
export function bindPickupProof(root, { loadPhoto, uploadPhoto, onSaved }) {
  if (!root) return;
  const view = root.querySelector('[data-view-pickup-proof]');
  const photo = root.querySelector('img');
  const status = root.querySelector('[role=status]');
  let request = 0;
  async function showPhoto() {
    const version = ++request;
    view.disabled = true;
    status.textContent = 'Loading pickup photo…';
    try {
      const { url } = await loadPhoto();
      if (!root.isConnected || version !== request) return;
      if (new URL(url).protocol !== 'https:') throw Error('The photo could not be opened.');
      photo.onload = () => { status.textContent = ''; };
      photo.onerror = () => {
        photo.hidden = true;
        view.hidden = false;
        status.textContent = 'The photo could not load. Try viewing it again.';
      };
      photo.src = url;
      photo.hidden = false;
      view.hidden = true;
    } catch (error) {
      if (root.isConnected && version === request) status.textContent = error.message || 'Please try viewing the photo again.';
    } finally {
      if (version === request) view.disabled = false;
    }
  }
  view.onclick = showPhoto;
  const form = root.querySelector('form');
  if (!form) { void showPhoto(); return; }
  form.onsubmit = async event => {
    event.preventDefault();
    event.stopPropagation();
    const file = form.elements.photo.files[0], button = form.querySelector('button');
    if (!file || button.disabled) return;
    button.disabled = true;
    form.elements.photo.disabled = true;
    status.textContent = 'Uploading pickup photo…';
    try {
      await uploadPhoto(file);
      if (!root.isConnected) return;
      form.reset();
      view.hidden = false;
      await onSaved?.();
      if (root.isConnected) await showPhoto();
    } catch (error) {
      if (root.isConnected) status.textContent = error.message || 'The pickup photo could not be saved. Try again.';
    } finally {
      form.elements.photo.disabled = false;
      button.disabled = false;
    }
  };
}

export function pickupProofSection(order, photoAccept = '') {
  if (order.method !== 'pickup' || (!photoAccept && !order.has_pickup_proof)) return '';
  return `<section class="${photoAccept ? 'detail-section' : 'panel order-section'}" data-pickup-proof>
    <h${photoAccept ? '3' : '2'}>Pickup proof</h${photoAccept ? '3' : '2'}>
    <img alt="Pickup proof for this order" referrerpolicy="no-referrer" style="max-width:100%;max-height:28rem;object-fit:contain" hidden>
    <button type="button" class="button button-secondary" data-view-pickup-proof ${order.has_pickup_proof ? '' : 'hidden'}>View pickup photo</button>
    ${photoAccept ? `<form><label class="field">Pickup photo (optional)<input name="photo" type="file" accept="${photoAccept}" required></label>
      <button class="button button-secondary" type="submit">${order.has_pickup_proof ? 'Replace photo' : 'Upload photo'}</button></form>` : ''}
    <p role="status" aria-live="polite"></p></section>`;
}
