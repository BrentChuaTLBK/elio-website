import { calendarAddress } from './order-calendar.js';

import { checklistTitles } from './order-checklist-data.js';
import { orderItemDetails, renderOrderFlavors } from './order-item-details.js';

const titles = { ...checklistTitles, preparation: 'Preparation checklist' };
const dateFormat = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
const orderCount = count => `${count} ${count === 1 ? 'order' : 'orders'}`;
const reference = order => order.reference || order.id || 'Order';
const dateOf = order => order.date || order.fulfillment_date || '';

function optionsFor(item, products) {
  const product = products.find(entry => entry.id === item.product_id);
  const { flavors, insulated, extras } = orderItemDetails(item, product);
  const packing = insulated ? `<span class="checklist-item-detail order-packing">Insulated · ${esc(insulated)}</span>` : '';
  const other = extras.length ? `<span class="checklist-item-detail">${Number(item.quantity) > 1 ? 'Per unit · ' : ''}${esc(extras.join(' · '))}</span>` : '';
  return packing + renderOrderFlavors(flavors, { products, esc }) + other;
}

export function renderChecklistItems(order, preparation = true, products = []) {
  const items = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
  if (!items.length) return '<p>Item details unavailable</p>';
  return `<ul class="${preparation ? 'checklist-prep-items' : 'checklist-handoff-items'}">${items.map(item => {
    const name = item.name || item.custom_name || 'Unnamed item';
    const description = item.description || item.custom_description;
    const label = `${esc(item.quantity ?? '?')} × ${esc(name)}`;
    return preparation ? `<li><strong>${label}</strong>${description ? `<span class="checklist-item-detail">${esc(description)}</span>` : ''}${optionsFor(item, products)}</li>` : `<li>${label}</li>`;
  }).join('')}</ul>`;
}

function detail(label, value) {
  return value ? `<p class="checklist-detail"><strong>${label}</strong> ${esc(value)}</p>` : '';
}

function orderRow(order, type, products) {
  const detailed = type === 'orders' || type === 'preparation';
  const pickup = order.method === 'pickup';
  const buyer = order.buyer || {};
  const recipient = order.recipient || {};
  const timeWindow = order.window || (pickup ? order.pickup_hours : order.delivery_window);
  const status = type === 'orders' ? String(order.status || '').replaceAll('_', ' ') : '';
  const meta = [type === 'preparation' ? (pickup ? 'Pickup' : 'Delivery') : '', timeWindow, status].filter(Boolean).join(' · ');
  let handoff = '';
  if (type === 'pickup') {
    handoff = detail('Phone', buyer.phone);
  } else if (type === 'delivery') {
    handoff = detail('Recipient', [recipient.name, recipient.phone].filter(Boolean).join(' · ')) +
      detail('Deliver to', calendarAddress(order) || 'Address not recorded');
    if (!recipient.phone) handoff += detail('Buyer phone', buyer.phone);
  }
  return `<tr class="checklist-order" data-order-reference="${esc(reference(order))}">
    <td class="checklist-mark"><span class="checklist-tick" aria-hidden="true"></span></td>
    <td class="checklist-order-body"><h3>${esc(buyer.name || recipient.name || 'Customer')} <span>${esc(reference(order))}</span></h3>
      ${meta ? `<p class="checklist-window">${esc(meta)}</p>` : ''}${handoff}
      ${renderChecklistItems(order, detailed, products)}${type === 'orders' ? '' : detail('Instructions', order.instructions)}
    </td></tr>`;
}

export function renderOrderChecklist({ orders, type, periodLabel, products = [] }) {
  if (!Object.hasOwn(titles, type)) throw new Error('Choose a checklist type.');
  const days = new Map();
  for (const order of orders) {
    const date = dateOf(order);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(order);
  }
  const tables = [...days.keys()].sort().map(date => {
    const dayOrders = days.get(date).sort((a, b) => reference(a).localeCompare(reference(b), 'en', { numeric: true }));
    const day = new Date(date + 'T12:00:00Z');
    const dayLabel = Number.isFinite(day.getTime()) ? dateFormat.format(day) : 'Date not recorded';
    const groups = new Map([['Pickup', []], ['Delivery', []], ['In-person sales', []]]);
    if (type === 'orders') {
      for (const order of dayOrders) {
        const label = order.source === 'in_person' ? 'In-person sales' : (order.method === 'delivery' ? 'Delivery' : 'Pickup');
        groups.get(label).push(order);
      }
    }
    const body = type === 'orders'
      ? [...groups].filter(([, rows]) => rows.length).map(([label, rows]) => `<tbody><tr class="checklist-method"><th scope="rowgroup" colspan="2">${label}</th></tr>${rows.map(order => orderRow(order, type, products)).join('')}</tbody>`).join('')
      : `<tbody>${dayOrders.map(order => orderRow(order, type, products)).join('')}</tbody>`;
    const countLabel = type === 'orders' ? orderCount(dayOrders.length) : `${titles[type]} · ${orderCount(dayOrders.length)}`;
    return `<table class="checklist-day" aria-label="${esc(dayLabel)}"><colgroup><col class="checklist-mark-column"><col></colgroup>
      <thead><tr><th colspan="2"><div class="checklist-day-heading"><h2>${esc(dayLabel)}</h2><span>${countLabel}</span></div></th></tr></thead>
      ${body}</table>`;
  });
  return `<section class="order-checklist-sheet${type === 'orders' ? ' checklist-all-orders' : ''}"><header class="checklist-heading"><div><h1>${titles[type]}</h1><p>${esc(periodLabel)} · ${orderCount(orders.length)}</p></div><strong>Elio Basque Cheesecake</strong></header>
    ${tables.join('') || '<p>No orders in this period.</p>'}</section>`;
}
