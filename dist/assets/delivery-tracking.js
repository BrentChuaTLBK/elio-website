// Tracking URLs are external links, never executable markup or relative paths.
export function deliveryTrackingUrl(value) {
  if (typeof value !== 'string') return '';
  const link = value.trim();
  if (!link || link.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(link) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(link)) return '';
  try {
    const url = new URL(link);
    return /^https?:\/\//i.test(link) && ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? link : '';
  } catch { return ''; }
}
