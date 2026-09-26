export const DETAIL_FIELDS = [
  ['product_type', 'Details heading', '', 120],
  ['serving', 'Size or box details', '', 500],
];
export const flavorDetails = value => Object.fromEntries(DETAIL_FIELDS.map(([key,,fallback]) => [key, typeof value?.[key] === 'string' ? value[key] : fallback]));
export function flavorMetaHtml(flavor, esc) {
  const details = flavorDetails(flavor.collection_details);
  const lines = [details.product_type, details.serving].filter(Boolean);
  return lines.length ? `<p class="detail-meta">${lines.map(esc).join('<br>')}</p>` : '';
}

export function closeFlavorOnBackdrop(dialog, close, enabled = () => true) {
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  let startedOutside = false;
  dialog.addEventListener('pointerdown', event => { startedOutside = enabled() && outside(event); });
  dialog.addEventListener('pointercancel', () => { startedOutside = false; });
  dialog.addEventListener('click', event => {
    if (startedOutside && enabled() && outside(event)) close();
    startedOutside = false;
  });
}
