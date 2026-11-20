import { api, formatDate } from './client.js';
import { checklistOrders, checklistTitles, loadChecklistPeriod } from './order-checklist-data.js';
import { renderOrderChecklist } from './order-checklist-print.js';

const params = new URLSearchParams(location.search);
const type = params.get('type');
const from = params.get('from');
const to = params.get('to') || from;
const status = document.getElementById('preview-status');
const print = document.getElementById('print-checklist');
const sheet = document.getElementById('order-checklist-print');
print.addEventListener('click', () => window.print());

try {
  const rows = await loadChecklistPeriod(api, type, from, to);
  const orders = checklistOrders(rows, type);
  document.title = checklistTitles[type];
  if (orders.length) {
    const periodLabel = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    const render = (products = []) => {
      sheet.innerHTML = renderOrderChecklist({ orders, type, periodLabel, products });
      for (const photo of sheet.querySelectorAll('.order-flavor-icon')) {
        photo.addEventListener('error', () => photo.remove(), { once: true });
      }
    };
    render();
    status.hidden = true;
    print.disabled = false;
    if (sheet.querySelector('.order-flavors')) {
      // A missing catalog or photo must not delay printing the checklist.
      api('flavor_collection').then(({ flavors }) => {
        if (Array.isArray(flavors) && flavors.length) render(flavors.map(flavor => ({ ...flavor, kind: 'flavor' })));
      }).catch(() => {});
    }
  } else {
    status.textContent = 'No orders match this checklist for the selected dates.';
  }
} catch (error) {
  status.textContent = `Couldn’t load this checklist. ${error.message || 'Please reload to try again.'}`;
}
