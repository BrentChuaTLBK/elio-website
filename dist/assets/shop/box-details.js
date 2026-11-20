import { escapeHtml as esc } from '../admin/client.js';

// A custom label is display text. Keep the owner's spelling for plural labels,
// abbreviations and local terms. Common singular packaging names work as typed.
const pluralUnits = new Map(Object.entries({
  box: 'boxes', piece: 'pieces', pack: 'packs', tray: 'trays', set: 'sets',
  slice: 'slices', loaf: 'loaves', cake: 'cakes', bag: 'bags', bundle: 'bundles',
  jar: 'jars', pouch: 'pouches', bottle: 'bottles', pc: 'pcs',
}));

export function minimumOrderAmount(product) {
  const minimum = Number(product.min_quantity);
  if (!Number.isInteger(minimum) || minimum <= 1) return '';
  const unit = typeof product.minimum_order_unit === 'string' && product.minimum_order_unit.trim() || 'box';
  const plural = unit.replace(/([a-z]+)(?= of |$)/i, word => {
    const form = pluralUnits.get(word.toLowerCase());
    if (!form) return word;
    if (word === word.toUpperCase()) return form.toUpperCase();
    return word[0] === word[0].toUpperCase() ? form[0].toUpperCase() + form.slice(1) : form;
  });
  return minimum + ' ' + plural;
}

export function productDialogHeader(demo) {
  return `<div class="modal-head"><span class="eyebrow">${demo ? 'Sample product' : 'Made just for you'}</span><button type="button" class="close-button" aria-label="Close product">×</button></div>`;
}

export function productPreparation(product, earliest) {
  const minimum = minimumOrderAmount(product);
  return `<div class="help-card"><strong>Freshly made, with a little notice</strong>${esc(product.lead_days)} full production day${product.lead_days === 1 ? '' : 's'} required.<br>Earliest available: ${esc(earliest)}.${minimum ? '<br>Minimum order: ' + esc(minimum) + '.' : ''}</div>`;
}

export function productPurchaseRow(quantity = 1) {
  return `<div class="product-dialog-bottom"><label class="field no-margin" style="width:max-content" for="product-quantity">Quantity<input id="product-quantity" type="number" min="1" max="999" step="1" value="${esc(quantity)}"></label><button type="button" id="add-to-cart" class="button" disabled>Add to basket</button></div>`;
}

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

export function boxDetails(product = {}, { gallery = false } = {}) {
  return `<div class="product-accordions"><details><summary>What’s in the box</summary><div><p>${esc(product.box_details || 'Three individual square Basque cheesecakes, presented in a single row inside a brown carton with a cream interior.')}</p><p>Each cheesecake is approximately 6 × 6 × 5 cm.</p></div></details><details><summary>Care &amp; serving</summary><div><p>${esc(product.care_instructions || 'Care and serving information is coming soon.')}</p></div></details>${gallery ? '<details class="ep-details"><summary>Box photos</summary><div data-product-gallery></div></details>' : ''}</div>`;
}
