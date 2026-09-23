import { escapeHtml as esc } from '../admin/client.js';

export function insideBox(product, flavors = [], content = window.ELIO_CONTENT) {
  if (product.customizable || product.kind === 'custom_box') return '';
  const lookup = ref => flavors.find(f => f.id === ref || f.slug === ref) || content?.flavors.find(f => f.id === ref);
  const recipe = product.box_flavors || product.flavors;
  const pieces = recipe?.length ? recipe.map(lookup).filter(Boolean) : (product.flavor_contents || []).flatMap(f => Array.from({ length: Math.min(3, f.quantity) }, () => ({ ...lookup(f.product_id), name: f.name })));
  if (!pieces.length) return '';
  const tiles = pieces.map(f => {
    const fallback = content?.flavors.find(item => item.id === f.slug || item.id === f.id || item.name === f.name);
    const image = f.photos?.[0] || f.image || fallback?.image;
    const position = fallback?.imagePosition;
    const safe = typeof image === 'string' && /^(https?:\/\/|assets\/)/.test(image);
    const photo = safe ? `<img src="${esc(image)}" alt="">` : position !== undefined ? `<img class="inside-box-concept" src="${esc(content.productImage)}" alt="" style="left:-${parseFloat(position) * 2}%">` : `<span class="inside-box-initial">${esc(f.name?.[0] || 'E')}</span>`;
    return `<li><span class="inside-box-photo" aria-hidden="true">${photo}</span><span>${esc(f.name)}</span></li>`;
  }).join('');
  return `<section class="inside-box" aria-label="Inside your box"><p class="inside-box-label">Inside your box</p><ul>${tiles}</ul><p class="inside-box-note">A curated set of three. To choose different flavors, <a href="order.html?product=your-own">build your own box</a>.</p></section>`;
}

export function boxDetails(product = {}) {
  return `<div class="product-accordions"><details><summary>What’s in the box</summary><div><p>${esc(product.box_details || 'Three individual square Basque cheesecakes, presented in a single row inside a brown carton with a cream interior.')}</p><p>Each cheesecake is approximately 6 × 6 × 5 cm.</p></div></details><details><summary>Care &amp; serving</summary><div><p>${esc(product.care_instructions || 'Care and serving information is coming soon.')}</p></div></details></div>`;
}
