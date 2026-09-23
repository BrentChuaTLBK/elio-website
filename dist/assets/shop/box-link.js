// Keep existing collection links working in the shop's compact product window.
// The shop resolves listed products or the unlisted collection preview.
const product = new URLSearchParams(location.search).get('collection') || 'your-own';
location.replace(`order.html?product=${encodeURIComponent(product)}`);
