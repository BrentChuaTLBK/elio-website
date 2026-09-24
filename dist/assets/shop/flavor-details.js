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
