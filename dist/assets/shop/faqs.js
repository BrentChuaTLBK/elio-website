import {api,ready,configured} from '../admin/client.js';

export function renderFaqs(section, content) {
  if (!section) return;
  const items = Array.isArray(content?.items) ? content.items : [];
  const grid = section.querySelector('.shop-faq-grid');
  grid.replaceChildren();
  section.hidden = !items.length;
  section.querySelector('h2').textContent = content?.heading || 'Frequently asked questions';
  for (const item of items) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = item.question;
    details.append(summary);
    for (const paragraph of String(item.answer || '').split(/\n\s*\n/)) {
      const text = document.createElement('p');
      text.textContent = paragraph;
      text.style.whiteSpace = 'pre-line';
      details.append(text);
    }
    if (item.link_url && item.link_label) {
      try {
        const url = new URL(item.link_url, location.href);
        if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
          const paragraph = document.createElement('p');
          const link = document.createElement('a');
          link.href = url.href;
          link.textContent = item.link_label;
          paragraph.append(link);details.append(paragraph);
        }
      } catch { /* An invalid link does not hide the answer. */ }
    }
    grid.append(details);
  }
}

const section = document.querySelector('[data-shop-faqs]');
if (section) {
  try {
    await ready;
    if (configured) renderFaqs(section, await api('faqs'));
  } catch {
    // Never restore old static entries that an owner may have hidden or removed.
    section.hidden = true;
  }
}
