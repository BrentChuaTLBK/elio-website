import { config } from '../admin/config.js';

// Public editorial data only. This request never reads or changes an auth session.
export async function loadFlavorContent(content) {
  if (new URLSearchParams(location.search).get('preview') === '1') return content;
  content.monthlyMenu = [];
  content.nextMonthlyMenu = [];
  content.currentMenuShown = false;
  content.nextMenuShown = false;
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/shop_api`, {
      method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: 'flavor_collection', p_payload: {}, p_token: null }),
      signal: AbortSignal.timeout(4000), cache: 'no-store',
    });
    if (!response.ok) throw new Error('Flavor collection unavailable');
    const data = await response.json();
    if (!Array.isArray(data.flavors) || !Array.isArray(data.menus)) throw new Error('Invalid flavor collection');
    const initial = content.flavors;
    content.categories = data.categories || [];
    content.featuredOrder = [];
    content.flavors = data.flavors.map(f => {
      const fallback = initial.find(item => item.id === f.slug);
      const image = f.photos?.find(url => typeof url === 'string' && /^(https?:\/\/|assets\/)/.test(url));
      return { ...fallback, id: f.slug || f.id, productId: f.id, name: f.name, description: f.description || '', line: f.tagline ?? fallback?.line ?? '', category_ids: f.category_ids || [], category_sort_orders: f.category_sort_orders || {}, sort_order: f.sort_order || 0, collectionOnly: f.collection_only, uploadedPhoto: Boolean(image), ...(image ? { image, imagePosition: undefined } : {}) };
    });
    const selected = month => {
      const ids = data.menus.find(menu => menu.month === month)?.flavor_ids || [];
      return content.flavors.filter(f => ids.includes(f.productId)).map(f => f.id);
    };
    content.monthlyMenu = selected(data.current_month);
    content.nextMonthlyMenu = selected(data.next_month);
    content.currentMenuShown = data.menus.some(m => m.month === data.current_month && m.published);
    content.nextMenuShown = data.menus.some(m => m.month === data.next_month && m.published);
    content.currentMonth = data.current_month;
    content.nextMonth = data.next_month;
    content.collectionLoaded = true;
  } catch {
    // Never revive a hidden flavor from an old static collection after a failed request.
    content.flavors = [];
    content.collectionLoaded = false;
  }
  return content;
}
