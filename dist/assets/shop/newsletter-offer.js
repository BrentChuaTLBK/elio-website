export const defaultNewsletterOffer = Object.freeze({discount_percent:5,min_subtotal_cents:50000,cap_cents:10000,expiry_days:14});
const money = cents => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',minimumFractionDigits:0,maximumFractionDigits:2}).format(cents/100);
export function newsletterOffer(settings = {}) {
  const result = {};
  for (const [key,fallback] of Object.entries(defaultNewsletterOffer)) result[key] = Number.isInteger(settings?.[key]) && settings[key] >= (key==='min_subtotal_cents'?0:1) ? settings[key] : fallback;
  return result;
}
export function newsletterOfferTerms(settings) {
  const value = newsletterOffer(settings);
  return `For new newsletter subscribers, including existing customers. Minimum product subtotal ${money(value.min_subtotal_cents)}; maximum discount ${money(value.cap_cents)}. Your unique code is valid for ${value.expiry_days} ${value.expiry_days===1?'day':'days'} after joining and can be used once. Sign in to an email-verified Elio account with the subscribed email to use it.`;
}
export function newsletterOfferSummary(settings) {
  const value = newsletterOffer(settings);
  return `${value.discount_percent}% off · ${money(value.min_subtotal_cents)} minimum · ${money(value.cap_cents)} maximum discount · ${value.expiry_days} ${value.expiry_days===1?'day':'days'} from joining. Delivery is excluded.`;
}
