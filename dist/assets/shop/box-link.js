import { api, ready, configured } from '../admin/client.js';

// Existing collection links open the live product as soon as it is listed.
// Unlisted concepts retain their gallery preview until the owner launches them.
await ready;
if (configured) {
  try {
    const catalog = await api('catalog');
    const slug = new URLSearchParams(location.search).get('collection') || 'your-own';
    const product = catalog.products.find(p => p.slug === slug || p.id === slug);
    if (product) location.replace(`order.html?product=${encodeURIComponent(product.id)}`);
  } catch { /* Keep the gallery usable while the menu service is unavailable. */ }
}
