import { DETAIL_FIELDS, flavorDetails } from '../shop/flavor-details.js';
export function flavorDetailFields(product, {input,textarea,disabled=''}) {
  const details = flavorDetails(product.collection_details);
  return `<details class="subsection flavor-extra-details"><summary>Additional details (optional)</summary><p class="muted">Leave these blank for just the name, tagline and description.</p>${DETAIL_FIELDS.map(([key,label,,limit]) => limit > 120
    ? textarea(`detail_${key}`,label,details[key],'',`maxlength="${limit}" rows="2" ${disabled}`)
    : input(`detail_${key}`,label,details[key],'text',`maxlength="${limit}" ${disabled}`)).join('')}</details>`;
}
export const readFlavorDetails = form => Object.fromEntries(DETAIL_FIELDS.map(([key]) => [key,form.elements.namedItem(`detail_${key}`)?.value.trim() || '']));
