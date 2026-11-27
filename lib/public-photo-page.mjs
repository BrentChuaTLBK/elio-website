import {photoSlots, sharePhotoSlots, websitePhotoUrl} from '../dist/assets/website-photo-slots.js';
import {config} from '../dist/assets/admin/config.js';

export const siteOrigin = 'https://eliocheesecakes.com';
const slots = new Map(photoSlots.map(slot => [slot.id,slot]));
const escape = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function publicPage(pathname) {
 const path = pathname.replace(/\/index(?:\.html)?\/?$/, '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';
 return Object.hasOwn(sharePhotoSlots,path) ? path : null;
}

function photoTag(tag, photos) {
 const id = tag.match(/\sdata-website-photo="([^"]+)"/)?.[1];
 const slot = slots.get(id);
 if (!slot) return tag;
 const source = tag.startsWith('<source'), attribute = source ? 'srcset' : 'src';
 const fallback = tag.match(/\sdata-default-(?:srcset|src)="([^"]+)"/)?.[1];
 if (!fallback) return tag;
 const saved = photos[id], url = websitePhotoUrl(saved?.path,config.supabaseUrl);
 const clean = tag.slice(0,-1).replace(/\s(?:src|srcset|alt|style|data-website-photo-applied)="[^"]*"/g,'');
 let attrs = ` ${attribute}="${url ? escape(url) : fallback}"`;
 if (url) attrs += ` data-website-photo-applied="${escape(url)}"`;
 if (!source) {
  attrs += ` alt="${escape(url && saved.alt || slot.alt)}"`;
  const focus = row => `${Number(row.position_x)}% ${Number(row.position_y)}%`;
  if (id === 'shop_gift' && photos.shop_gift_mobile) {
   attrs += ` style="--elio-small-photo-focus:${focus(photos.shop_gift_mobile)};object-position:var(--elio-responsive-photo-focus,${url ? focus(saved) : 'center'})"`;
  } else if (url) attrs += ` style="object-position:${focus(saved)}"`;
 }
 return clean + attrs + '>';
}

export function renderPhotoPage(html, path, photos, share) {
 const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] || 'Elio Basque Cheesecake';
 const description = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || title;
 // Title and description are already HTML-escaped in the authored document.
 const tags = [
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Elio Basque Cheesecake">',
  `<meta property="og:title" content="${title.replaceAll('"','&quot;')}">`,
  `<meta property="og:description" content="${description}">`,
  `<meta property="og:url" content="${siteOrigin}${path}">`,
  '<meta name="twitter:card" content="summary_large_image">',
 ];
 if (share) {
  const image = escape(new URL(share.url,siteOrigin).href);
  tags.push(`<meta property="og:image" content="${image}">`, '<meta property="og:image:type" content="image/jpeg">',
   `<meta property="og:image:alt" content="${escape(share.alt)}">`, `<meta name="twitter:image" content="${image}">`);
  if (share.width && share.height) tags.push(`<meta property="og:image:width" content="${Number(share.width)}">`,`<meta property="og:image:height" content="${Number(share.height)}">`);
 }
 const json = JSON.stringify(photos).replace(/[<>&\u2028\u2029]/g,c => '\\u' + c.charCodeAt(0).toString(16).padStart(4,'0'));
 tags.push(`<script type="application/json" id="elio-published-photos">${json}</script>`);
 return html.replace(/<(?:img|source)\b[^>]*\sdata-website-photo="[^"]+"[^>]*>/gi,tag => photoTag(tag,photos))
  .replace(/<!--elio-public-photos-->[\s\S]*?<!--\/elio-public-photos-->/, () => `<!--elio-public-photos-->\n${tags.join('\n')}\n<!--/elio-public-photos-->`);
}
