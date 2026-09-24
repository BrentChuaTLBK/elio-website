import { flavorDetailFields } from './flavor-details.js';
import { PHOTO_ACCEPT, PHOTO_HELP } from './photo-upload.js';
const safeImage = value => typeof value === 'string' && /^(https?:\/\/|assets\/)/.test(value) ? value : '';
import { categoryFields, sortProducts } from './catalog-ordering.js';

// A monthly lineup gates dated stock; publishing opens it to customer orders.
export function menuMonths(state, today) {
  const current = state.flavor_menus?.current_month || `${today.slice(0, 7)}-01`;
  const next = new Date(`${current}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [current, state.flavor_menus?.next_month || next.toISOString().slice(0, 10)];
}
export const monthLabel = month => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`));
export const menuFor = (state, month) => state.flavor_menus?.menus?.find(menu => menu.month === month) || { flavor_ids: [], published: false };

function renderHeadings(state, months, esc, disabled) {
  const headings = state.flavor_menus?.headings || {};
  const fields = [
    ['current', 'This month’s heading', 'Flavors of the Month', months[0]],
    ['next', 'Next month’s heading', 'Coming Next Month', months[1]],
    ['collection', 'Full collection heading', 'The full collection.', ''],
  ];
  return `<section class="panel flavor-headings"><h2>Website headings</h2><p class="muted">Edit the section headings on your flavor collection page. The month and year are added automatically and roll forward each month.</p><form data-form="flavor-headings"><div class="form-error" role="alert"></div><div class="flavor-heading-fields">${fields.map(([key,label,fallback,month]) => {
    const value = state.headingDraft?.[key] ?? headings[key] ?? fallback;
    return `<label class="field">${label}<input type="text" name="${key}" value="${esc(value)}" required maxlength="80" data-heading-month="${month}" ${disabled}><small data-heading-preview>${esc(value)}${month ? ` — ${esc(monthLabel(month))}` : ''}</small></label>`;
  }).join('')}</div><button class="button button-secondary" type="submit" ${disabled}>Save headings</button></form></section>`;
}

export function renderFlavorMenus(state, { today, esc, disabled }) {
  const months = menuMonths(state, today), flavors = sortProducts(state.products.filter(p => p.kind === 'flavor'));
  const panels = months.map((month, i) => {
    const menu = menuFor(state, month), draft=state.lineupDrafts?.[month], selection=draft||menu;
    const baseline={flavor_ids:draft?.expected_flavor_ids||menu.flavor_ids,published:draft?.expected_published??menu.published};
    const dirty=lineupChanged(selection,baseline), choices=flavors.filter(f=>!f.collection_hidden);
    return `<section class="panel flavor-menu-panel"><span class="eyebrow">${i ? 'Next month' : 'This month'}</span><h2>${esc(monthLabel(month))}</h2><span class="badge">${menu.published ? 'Published · orders enabled' : 'Hidden · orders disabled'}</span><form data-form="flavor-lineup" data-month="${month}" data-current="${months[0]}"><div class="form-error" role="alert"></div><input type="hidden" name="expected_flavor_ids" value="${esc(JSON.stringify(baseline.flavor_ids))}"><input type="hidden" name="expected_published" value="${baseline.published}"><fieldset class="lineup-picker"><legend>Click flavors to include them</legend><div class="menu-flavor-list">${choices.map(f=>`<label class="lineup-choice"><input type="checkbox" name="flavor_ids" value="${esc(f.id)}" ${selection.flavor_ids.includes(f.id)?'checked':''} ${disabled}><span>${safeImage(f.photos?.[0])?`<img class="lineup-photo" src="${esc(safeImage(f.photos[0]))}" alt="" loading="lazy">`:""}${esc(f.name)}</span></label>`).join('')||'<p class="muted">Add a flavor to the collection to begin.</p>'}</div></fieldset><p class="lineup-status" role="status">${selection.flavor_ids.length} selected${dirty?' · Unsaved changes':''}</p><label class="check-field"><input type="checkbox" name="published" ${selection.published ? 'checked' : ''} ${disabled}><span>Publish this lineup and allow orders for its dates</span></label><button class="button button-secondary" type="submit" ${disabled||(!dirty?'disabled':'')}>Save lineup</button><p class="help-text">New additions use your automatic daily stock setting. Manage descriptions, photos, and hidden flavors in the library below.</p></form></section>`;
  }).join('');
  return `${renderHeadings(state, months, esc, disabled)}<div class="flavor-menu-panels">${panels}</div><section class="panel menu-collection"><div class="section-heading"><div><h2>Flavor library</h2><p class="muted">Manage all flavor records here. On the website, flavors outside both monthly lineups appear in the full collection; hidden flavors stay private.</p></div><span class="badge">${flavors.length} flavors</span></div><div class="menu-collection-grid">${flavors.map(f => `<article class="menu-collection-card">${safeImage(f.photos?.[0])?`<img class="library-flavor-photo" src="${esc(safeImage(f.photos[0]))}" alt="" loading="lazy">`:""}<h3>${esc(f.name)}</h3><p>${esc(f.description || 'Add a description to introduce this flavor.')}</p><div class="menu-placements">${f.collection_hidden ? '<span class="badge">Hidden · unavailable</span>' : ''}${months.map(month => menuFor(state, month).flavor_ids.includes(f.id) ? `<span class="badge">${esc(monthLabel(month))}</span>` : '').join('') || '<span class="muted">Collection only</span>'}</div><button class="button button-quiet" data-action="edit-flavor-menu" data-id="${esc(f.id)}">${state.role === 'staff' ? 'View flavor' : 'Edit flavor & placement'} →</button></article>`).join('') || '<p class="muted">Add your first flavor to start the collection.</p>'}</div></section>`;
}

export function lineupChanged(selection, baseline) {
  return selection.published!==baseline.published || selection.flavor_ids.length!==baseline.flavor_ids.length || selection.flavor_ids.some(id=>!baseline.flavor_ids.includes(id));
}

export function flavorMenuFields(state, id, { today, esc, input, textarea, select, option, check, disabled }) {
  const p = state.products.find(p => p.id === id && p.kind === 'flavor') || {};
  const months = menuMonths(state, today);
  return `<input type="hidden" name="id" value="${esc(p.id || '')}"><input type="hidden" name="expected_month" value="${months[0]}">${input('name', 'Flavor name', p.name, 'text', 'required maxlength="160"')}${input('tagline', 'Tagline', p.tagline ?? window.ELIO_CONTENT?.flavors.find(f => f.id === p.slug)?.line ?? '', 'text', 'maxlength="100"', 'For example: Toasted and mellow.')}${textarea('description', 'Brief description', p.description, 'Shown when a customer opens this flavor.', 'maxlength="6000" rows="4"')}${flavorDetailFields(p,{input,textarea,disabled})}${categoryFields(p,state.categories.filter(c=>c.scope==='flavors'),esc,disabled)}<section class="subsection"><h3>Photo</h3><input type="hidden" name="photos" value="${esc(JSON.stringify(p.photos || []))}"><div id="menu-photo-preview">${p.photos?.[0] && /^(https?:\/\/|assets\/)/.test(p.photos[0]) ? `<img src="${esc(p.photos[0])}" alt="Current flavor cover" style="width:110px;height:90px;object-fit:cover;border-radius:8px">` : ''}</div>${input('cover_photo','Upload / replace cover photo','','file',`id="menu-cover-photo" accept="${PHOTO_ACCEPT}" `+disabled,PHOTO_HELP+' Save the flavor to use this photo.')}</section><section class="subsection"><h3>Visibility & monthly lineups</h3>${check('hidden','Hidden — remove from collection and disable new orders',p.collection_hidden === true,disabled)}${months.map((month,i) => check(i ? 'next_month' : 'current_month', `${i ? 'Next month' : 'This month'} · ${monthLabel(month)}`, menuFor(state,month).flavor_ids.includes(p.id), disabled)).join('')}<p class="help-text">Leave both unchecked for the full collection only. You can select both. Hidden monthly lineups stay private and unavailable to order until published. Removing a flavor clears its unsold quantities for that month; existing orders are kept.</p></section><p class="notice">A flavor needs a published monthly lineup and daily stock to be ordered. Shop closures always apply. Manage surcharges in Flavors and stock in Daily quantities.${p.id ? '' : ' New lineup flavors use the automatic daily stock set in Daily quantities.'}</p>`;
}
