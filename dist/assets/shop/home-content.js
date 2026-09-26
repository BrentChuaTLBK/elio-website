import { config } from '../admin/config.js';
import { mapPublicFlavors } from './flavor-content.js';

// A single anonymous read: no auth session, inventory or private month assignments.
export async function loadHomeContent(content) {
  if (new URLSearchParams(location.search).get('preview') === '1') {
    content.homeBoxes = content.boxCollections.filter(box => !box.customizable);
    content.homeCustomBox = content.boxCollections.find(box => box.customizable) || null;
    content.customBoxId = content.homeCustomBox?.id || null;
    content.homeLoaded = true;
    return content;
  }
  content.homeBoxes = [];
  content.homeCustomBox = null;
  content.customBoxId = null;
  content.monthlyMenu = [];
  content.nextMonthlyMenu = [];
  content.currentMenuShown = false;
  content.nextMenuShown = false;
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/shop_api`, {
      method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: 'home_catalog', p_payload: {}, p_token: null }),
      signal: AbortSignal.timeout(5000), cache: 'no-store',
    });
    if (!response.ok) throw new Error('Homepage collection unavailable');
    const data = await response.json();
    if (!Array.isArray(data.flavors) || !Array.isArray(data.boxes)) throw new Error('Invalid homepage collection');
    content.flavors = mapPublicFlavors(data.flavors, content.flavors);
    content.featuredOrder = [];
    content.homeBoxes = data.boxes;
    content.homeCustomBox = data.custom_box || null;
    content.customBoxId = content.homeCustomBox?.id || data.custom_box_id || null;
    content.homeLoaded = true;
  } catch {
    // A failed request must not bring hidden or removed products back into view.
    content.flavors = [];
    content.homeLoaded = false;
  }
  return content;
}
