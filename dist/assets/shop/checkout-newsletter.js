import {escapeHtml as esc} from '../admin/client.js';
import {getNewsletterSettings,subscribeNewsletter,newsletterEmailKnown} from './newsletter.js';
import {newsletterOffer,newsletterOfferSummary} from './newsletter-offer.js';

// Explicit signup happens independently of quote, order submission and payment.
// Keep successful choices only for this page visit; never infer consent from a cart.
const joined = new Set();
export async function mountCheckoutNewsletter(root, emailInput, accountEmail = '') {
 const settings = await getNewsletterSettings();
 if (!root?.isConnected || !settings) return;
 const offer = newsletterOffer(settings);
 const target = () => String(accountEmail || emailInput.value).trim().toLowerCase();
 let busy = false, syncVersion = 0, submittedHere = '';
 if (accountEmail && ['subscribed','suppressed'].includes(settings.own_status)) return;
 root.hidden = false;
 root.innerHTML = `<label class="checkout-newsletter-choice"><input type="checkbox" name="newsletter_opt_in" aria-describedby="checkout-newsletter-help checkout-newsletter-status"><span><strong>Yes, send me the Elio Newsletter</strong><small>Flavor news, exclusive promo codes and special offers.</small></span></label><p id="checkout-newsletter-help"><strong>New subscribers get ${offer.discount_percent}% OFF by email.</strong> No purchase needed. Checking this box joins you immediately. Unsubscribe anytime.</p><p class="checkout-newsletter-terms">${esc(newsletterOfferSummary(settings))} <a href="newsletter.html#terms" target="_blank" rel="noopener">Offer terms</a> · <a href="newsletter.html#privacy" target="_blank" rel="noopener">Email privacy</a></p><p id="checkout-newsletter-status" role="status" aria-live="polite"></p>`;
 const checkbox = root.querySelector('input'), status = root.querySelector('[role=status]');
 const sync = async () => {
  if (!root.isConnected || busy) return;
  const version=++syncVersion,email = target(), accepted = joined.has(email);
  const remembered=accepted || (settings.own_status!=='unsubscribed' && await newsletterEmailKnown(email));
  if(!root.isConnected || version!==syncVersion || busy || target()!==email)return;
  root.hidden=remembered && submittedHere!==email;
  checkbox.checked = accepted;
  checkbox.disabled = accepted || (accountEmail && settings.own_status === 'suppressed');
  status.textContent = accepted ? `Newsletter signup saved for ${email}. New subscribers receive their welcome code by email. Manage emails in your account or use the unsubscribe link.` : checkbox.disabled ? 'Newsletter delivery is paused for this address. Contact Elio for help.' : accountEmail ? `Sent to your account email: ${accountEmail}` : '';
 };
 emailInput.addEventListener('input', sync);
 checkbox.addEventListener('change', async () => {
  if (!checkbox.checked || busy) return;
  const email = target();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
   checkbox.checked = false;status.textContent = 'Enter your email address, then check the box to join.';emailInput.focus();return;
  }
  busy = true;checkbox.disabled = true;status.textContent = 'Joining the Elio Newsletter…';
  try {
   await subscribeNewsletter(email, 'checkout');joined.add(email);submittedHere=email;
   busy = false;sync();
  } catch (error) {
   busy = false;
   if (!root.isConnected) return;
   checkbox.checked = false;checkbox.disabled = false;
   status.textContent = `${error.message || 'Newsletter signup could not be saved.'} Check the box to retry. You can continue your order.`;
  }
 });
 sync();
}
