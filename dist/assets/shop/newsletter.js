import { api, auth, ready, configured, newsletterRequest } from '../admin/client.js';

const popupKey = 'elio-newsletter-popup-v1';
const startedAt = Date.now();
const dismissalPeriod = 24 * 60 * 60 * 1000;
const acceptedMessage = 'Thank you. Check your inbox for the next step. If eligible, your personal welcome code will arrive after you confirm your subscription.';
export const newsletterTerms = 'For new newsletter subscribers, including existing customers. Minimum product subtotal ₱500; maximum discount ₱100. Your unique code is valid for 14 days after confirmation and can be used once. Sign in to an email-verified Elio account with the subscribed email to use it.';
let settingsPromise, activeSettings, memoryState, refreshPopup = () => {};
let settingsVersion = 0;

export function getNewsletterSettings(refresh = false) {
  if (!settingsPromise || refresh) {
    const version = ++settingsVersion;
    settingsPromise = (async () => {
    await ready;
    if (!configured || new URLSearchParams(location.search).get('preview') === '1') return null;
    try {
      const settings = await api('newsletter_settings');
      if (version === settingsVersion) {
        activeSettings = settings;
        if (settings?.opted_in || settings?.known_subscriber || ['pending', 'subscribed', 'unsubscribed', 'suppressed'].includes(settings?.own_status)) rememberNewsletterOptIn();
        refreshPopup();
      }
      return settings?.enabled === true ? settings : null;
    }
    catch { return null; }
    })();
  }
  return settingsPromise;
}

export function rememberNewsletterOptIn() { rememberPopup('submitted');refreshPopup(); }

export async function activateAccountNewsletter() {
  const result = await newsletterRequest({ action: 'activate_account' });
  if (result?.status === 'subscribed') rememberNewsletterOptIn();
  await getNewsletterSettings(true);
  return result;
}

export async function subscribeNewsletter(email, source, website = '') {
  const result = await newsletterRequest({ action: 'subscribe', email: email.trim(), source, consent: true, website });
  if (result?.accepted !== true) throw new Error('We couldn’t finish your request. Please try again.');
  rememberNewsletterOptIn();
  return acceptedMessage;
}

function popupState() {
  try { return JSON.parse(localStorage.getItem(popupKey) || 'null') || memoryState; } catch { return memoryState; }
}
function rememberPopup(state) {
  memoryState = { firstVisit: popupState()?.firstVisit || startedAt, state, updatedAt: Date.now() };
  try { localStorage.setItem(popupKey, JSON.stringify(memoryState)); } catch { /* Keep this visit usable when browser storage is unavailable. */ }
}
function formMarkup(id, source) {
  return `<form class="elio-newsletter-form" data-newsletter-form data-newsletter-source="${source}">
    <label class="elio-newsletter-label" for="${id}-email">Email address</label>
    <input class="elio-newsletter-email" id="${id}-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required>
    <div class="newsletter-trap" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
    <label class="elio-newsletter-consent"><input type="checkbox" name="consent" required><span>Join the Elio Newsletter. Unsubscribe anytime.</span></label>
    <button class="elio-newsletter-submit" type="submit">Join</button>
    <p class="elio-newsletter-status" data-newsletter-status role="status" aria-live="polite"></p>
    <p class="elio-newsletter-links"><a href="newsletter.html#terms" target="_blank" rel="noopener">Offer terms</a> · <a href="newsletter.html#privacy" target="_blank" rel="noopener">Email privacy</a></p>
  </form>`;
}

function bindForm(form) {
  if (form.dataset.newsletterBound) return;
  form.dataset.newsletterBound = 'true';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.busy === 'true' || !form.reportValidity() || !form.elements.consent.checked) return;
    const button = form.querySelector('[type="submit"]'), status = form.querySelector('[data-newsletter-status]');
    const label = button.textContent;
    form.dataset.busy = 'true';button.disabled = true;button.textContent = 'Sending your request…';status.textContent = '';status.classList.remove('is-error');
    try {
      status.textContent = await subscribeNewsletter(form.elements.email.value, form.dataset.newsletterSource, form.elements.website?.value || '');
      form.querySelectorAll('input').forEach(input => { input.disabled = true; });
      button.textContent = 'Check your inbox';
    } catch (error) {
      status.textContent = error.message || 'We couldn’t finish your request. Please try again.';status.classList.add('is-error');button.disabled = false;button.textContent = label;
    } finally { form.dataset.busy = 'false'; }
  });
}

function excludedVisit() {
  const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.slice(1));
  return query.get('preview') === '1' || ['code', 'token_hash', 'access_token', 'error'].some(key => query.has(key) || hash.has(key)) || ['order', 'token', 'refresh_token', 'type'].some(key => hash.has(key));
}

function schedulePopup(settings) {
  if (!document.body.hasAttribute('data-newsletter-popup') || excludedVisit()) return;
  const firstVisit = popupState()?.firstVisit || startedAt;
  if (!popupState()) { memoryState = { firstVisit };try { localStorage.setItem(popupKey, JSON.stringify(memoryState)); } catch { /* Use in-memory state for this visit. */ } }
  let dialog, timer, interrupted = false;
  function show() {
    clearTimeout(timer);
    const saved = popupState();
    const anotherModal = [...document.querySelectorAll('dialog[open]')].some(item => item !== dialog) || document.querySelector('#mobile-nav:not([hidden])');
    if (dialog?.open) {
      if (anotherModal) { interrupted = true;dialog.close(); }
      return;
    }
    if (saved?.state === 'submitted' || activeSettings?.enabled !== true || excludedVisit()) return;
    if (interrupted) {
      if (!document.hidden && !anotherModal) { interrupted = false;dialog.showModal(); }
      return;
    }
    const eligibleAt = ['dismissed', 'shown'].includes(saved?.state)
      ? (saved.updatedAt || saved.firstVisit || startedAt) + dismissalPeriod
      : firstVisit + (Number(settings.popup_delay_ms) || 5000);
    if (Date.now() < eligibleAt) { timer = setTimeout(show, eligibleAt - Date.now());return; }
    if (document.hidden || anotherModal) return;
    dialog?.remove();
    dialog = document.createElement('dialog');dialog.id = 'elio-newsletter-dialog';dialog.className = 'elio-newsletter-dialog';dialog.setAttribute('aria-labelledby', 'elio-newsletter-title');
    dialog.innerHTML = `<button class="elio-newsletter-close" type="button" aria-label="Close newsletter signup"><span aria-hidden="true">×</span></button><div class="elio-newsletter-layout"><div class="elio-newsletter-photo"><img src="assets/trio-story-concept.webp" width="1440" height="960" alt="An Elio box of three square Basque cheesecakes"></div><div class="elio-newsletter-copy"><p class="elio-newsletter-eyebrow">Elio Newsletter</p><h2 id="elio-newsletter-title" class="elio-newsletter-offer"><span>Get</span> <strong>5% OFF</strong> <span>your next order.</span></h2><p class="elio-newsletter-intro">Join the Elio Newsletter for news, special offers, and exclusive promo codes.</p>${formMarkup('elio-popup', 'home_popup')}<p class="elio-newsletter-terms">${newsletterTerms}</p></div></div>`;
    document.body.append(dialog);bindForm(dialog.querySelector('form'));
    const dismiss = () => { rememberPopup(popupState()?.state === 'submitted' ? 'submitted' : 'dismissed');dialog.close();show(); };
    dialog.querySelector('.elio-newsletter-close').addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault();dismiss(); });
    // Clicking the backdrop is deliberately not a dismissal action.
    dialog.showModal();rememberPopup('shown');
  }
  refreshPopup = show;
  const observer = new MutationObserver(show);observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  document.addEventListener('visibilitychange', show);window.addEventListener('hashchange', show);
  window.addEventListener('storage', event => { if (event.key === popupKey) { if (dialog?.open && popupState()?.state) dialog.close();show(); } });
  show();
}

async function initializePublicForms() {
  const settings = await getNewsletterSettings();
  for (const form of document.querySelectorAll('[data-newsletter-form]')) {
    if (!settings) {
      form.querySelectorAll('input,button').forEach(input => { input.disabled = true; });
      const status = form.querySelector('[data-newsletter-status]');if (status) status.textContent = new URLSearchParams(location.search).get('preview') === '1' ? 'Design preview. Newsletter requests are disabled here.' : 'Newsletter signup is temporarily unavailable. Please check back soon.';
    } else {
      form.querySelectorAll('input,button').forEach(input => { input.disabled = false; });bindForm(form);
    }
  }
  if (settings) schedulePopup(settings);
}

function initializeTokenPage() {
  const panel = document.querySelector('[data-newsletter-action]');if (!panel) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const actions = ['confirm', 'unsubscribe'].filter(key => params.has(key));
  if (!actions.length) return;
  panel.hidden = false;
  const action = actions[0], token = params.get(action), title = panel.querySelector('h1'), description = panel.querySelector('[data-action-description]'), status = panel.querySelector('[data-action-status]'), button = panel.querySelector('button');
  const confirm = action === 'confirm';
  title.textContent = confirm ? 'Make it official.' : 'Leave the Elio Newsletter?';
  description.textContent = confirm ? 'Confirm that you’d like to receive news, special offers, and exclusive promo codes from the Elio Newsletter. If eligible, we’ll email your personal welcome code after confirmation.' : 'You can stop Elio’s newsletter emails here. Your account and order emails will continue.';
  if (actions.length !== 1 || !/^[a-f0-9]{64}$/.test(token || '')) { status.textContent = 'This newsletter link is incomplete. You can request a new confirmation using the signup form below.';button.hidden = true;return; }
  button.textContent = confirm ? 'Confirm subscription' : 'Unsubscribe';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const label = button.textContent;button.disabled = true;button.textContent = 'One moment…';status.textContent = '';
    try {
      const result = await newsletterRequest({ action, token });
      if (result?.status !== (confirm ? 'subscribed' : 'unsubscribed')) throw new Error('We couldn’t update your subscription. Please try again.');
      title.textContent = confirm ? 'You’re on the list.' : 'You’re unsubscribed.';
      description.textContent = confirm ? 'Thanks for joining the Elio Newsletter. If eligible, your personal welcome code will arrive by email. Use it with an email-verified Elio account under the same email address.' : 'You won’t receive Elio’s newsletter updates or offers. Account and order emails are unchanged.';
      status.textContent = confirm ? 'Your subscription is confirmed.' : 'Your newsletter preference is saved.';button.hidden = true;rememberPopup('submitted');
      history.replaceState(null, '', location.pathname + (confirm ? '#confirmed' : '#unsubscribed'));
    } catch (error) { status.textContent = error.message || 'This link couldn’t be used. Please try again or request a new confirmation below.';button.disabled = false;button.textContent = label; }
  });
}

initializeTokenPage();
if (document.querySelector('[data-newsletter-form]') || document.body.hasAttribute('data-newsletter-popup')) initializePublicForms();

// Defer API calls outside the Auth callback so the SDK can release its session lock.
ready.then(() => {
  if (configured && auth?.onAuthStateChange) auth.onAuthStateChange(() => {
    activeSettings = null;
    setTimeout(() => getNewsletterSettings(true), 0);
  });
});
