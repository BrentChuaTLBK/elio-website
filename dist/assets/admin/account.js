import { auth, ready, initializationError, authLink, api, escapeHtml as esc, money, formatDate } from './client.js';
import { config } from './config.js';

const form = document.querySelector('#account-form');
const status = document.querySelector('#account-status');
const heading = document.querySelector('#account-heading');
const submit = document.querySelector('#account-submit');
const intro = document.querySelector('#account-intro');
const confirmPassword = form.elements.confirm_password;
const customer = document.body.dataset.accountContext === 'customer';
const newsletterModule = customer ? import('../shop/newsletter.js') : Promise.resolve(null);
const newsletterChoice = form.elements.newsletter_opt_in;
const newsletterResult = document.querySelector('#account-newsletter-result');
const newsletterStatus = document.querySelector('#account-newsletter-status');
const newsletterRetry = document.querySelector('#account-newsletter-retry');
const googleButton = document.querySelector('#google-signin');
const googleLabel = googleButton.innerHTML;
const destination = document.body.dataset.accountContext === 'customer' ? 'account.html' : 'manage.html';
const callback = new URL(document.body.dataset.accountContext === 'customer' ? 'account.html' : 'admin-account.html', location.href).href;
let mode = 'signin';
let busy = false;
let googleAvailable = false;
let resendAfter = 0;
let retryNewsletter;
const oauthNewsletterKey = 'elio-newsletter-oauth-consent-v1';

function newsletterMessage(text, error = false) {
  if (!newsletterResult) return;
  newsletterResult.hidden = !text;
  newsletterStatus.textContent = text;
  newsletterStatus.classList.toggle('is-error', error);
  newsletterRetry.hidden = !error;
}

async function activateNewsletter(session) {
  if (!customer || !session) return;
  try {
    const result = await (await newsletterModule).activateAccountNewsletter();
    if (result?.status === 'subscribed') newsletterMessage('Your newsletter subscription is confirmed. If eligible, your personal welcome code will arrive by email.');
  } catch {
    if (session.user?.user_metadata?.newsletter_opt_in === true) {
      retryNewsletter = () => activateNewsletter(session);
      newsletterMessage('Your account is ready, but we couldn’t finish your newsletter signup. You can retry here.', true);
    }
  }
}

async function saveAccountNewsletter(email, session) {
  const newsletter = await newsletterModule;
  // The successful Auth signup stored this explicit consent. Keep its popup dismissed
  // even if the optional pending-record request needs to be retried.
  newsletter.rememberNewsletterOptIn();
  try {
    await newsletter.subscribeNewsletter(email, 'account');
    newsletterMessage('Your newsletter choice is saved. Confirm your account email to finish joining; there’s no separate newsletter confirmation. If eligible, your welcome code will follow by email.');
    if (session) await activateNewsletter(session);
  } catch {
    retryNewsletter = () => saveAccountNewsletter(email, session);
    newsletterMessage('Your account signup succeeded, but we couldn’t save the newsletter request yet. You can retry here while your account verification continues.', true);
  }
}

async function saveOAuthNewsletterConsent(session) {
  try {
    const current = await auth.getSession();
    if (current.error || current.data?.session?.user?.id !== session.user.id) throw new Error('Sign in again to save your newsletter choice.');
    const result = await auth.updateUser({ data: { newsletter_opt_in: true, newsletter_consent_version: 'elio-newsletter-v1' } });
    if (result.error) throw result.error;
    (await newsletterModule).rememberNewsletterOptIn();
    await activateNewsletter({ ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, newsletter_opt_in: true } } });
  } catch {
    retryNewsletter = () => saveOAuthNewsletterConsent(session);
    newsletterMessage('Your Google sign-in succeeded, but we couldn’t save your newsletter choice. You can retry here.', true);
  }
}

async function finishOAuthNewsletterConsent(session) {
  if (!customer || !authLink.received || authLink.failed) return false;
  let intent;
  try { intent = JSON.parse(sessionStorage.getItem(oauthNewsletterKey) || 'null');sessionStorage.removeItem(oauthNewsletterKey); } catch { /* No stored intent means no consent. */ }
  if (intent?.provider !== 'google' || intent.callback !== callback || !Number.isFinite(intent.createdAt) || Date.now() - intent.createdAt < 0 || Date.now() - intent.createdAt > 15 * 60 * 1000) return false;
  // AMR only matches the local consent intent to this callback. The endpoint
  // independently verifies the session identity before activating anything.
  let methods;
  try { methods = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).amr; } catch { return false; }
  if (!Array.isArray(methods) || !methods.some(item => item.method === 'oauth' && item.timestamp * 1000 >= intent.createdAt - 60000 && item.timestamp * 1000 <= Date.now() + 60000)) return false;
  await saveOAuthNewsletterConsent(session);
  return true;
}

newsletterRetry?.addEventListener('click', async () => {
  if (!retryNewsletter || newsletterRetry.disabled) return;
  newsletterRetry.disabled = true;
  try { await retryNewsletter(); } finally { newsletterRetry.disabled = false; }
});

if (newsletterChoice) newsletterModule.then(module => module.getNewsletterSettings()).then(settings => {
  newsletterChoice.disabled = !settings;
  const field = document.querySelector('#account-newsletter');
  field.dataset.available = settings ? 'true' : 'false';
  field.hidden = mode !== 'signup' || !settings;
});

async function loadOrders() {
  const section = document.querySelector('#account-orders');
  if (!section) return;
  section.textContent = 'Loading your orders…';
  try {
    const orders = await api('my_orders');
    section.innerHTML = '<h2>Your orders</h2>' + (orders.length ? orders.map(order => `<a class="account-order" href="order.html#order=${encodeURIComponent(order.id)}"><strong>${esc(order.reference)}</strong><span>${esc(formatDate(order.fulfillment_date))} · ${esc(order.method)}</span><span>${esc(money(order.total_cents))} · ${esc(String(order.payment_status).replaceAll('_', ' '))}</span><span>View order →</span></a>`).join('') : '<p>No orders yet. A little Elio awaits.</p>');
  } catch {
    section.innerHTML = '<p>Your order history could not load.</p><button class="button button-secondary" type="button">Try again</button>';
    section.querySelector('button').onclick = loadOrders;
  }
}

function updateControls() {
  document.querySelectorAll('#account-tabs button, #account-recovery button, #account-back').forEach(button => { button.disabled = busy; });
  const seconds = Math.max(0, Math.ceil((resendAfter - Date.now()) / 1000));
  submit.disabled = busy || (mode === 'resend' && seconds > 0);
  submit.textContent = mode === 'resend' && seconds > 0 ? `Resend in ${seconds}s` : {
    signin: 'Sign in', signup: 'Create account', reset: 'Send reset link', recovery: 'Save password', resend: 'Resend verification',
  }[mode];
  googleButton.disabled = busy || !googleAvailable;
}

function startResendCooldown() {
  resendAfter = Date.now() + 60_000;
  updateControls();
  const timer = setInterval(() => {
    updateControls();
    if (Date.now() >= resendAfter) clearInterval(timer);
  }, 1000);
}

async function updateGoogleAvailability() {
  googleButton.disabled = true;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      cache: 'no-store',
      headers: { apikey: config.supabasePublishableKey },
    });
    if (!response.ok) throw new Error('Provider settings are unavailable.');
    const settings = await response.json();
    if (settings.external?.google) {
      googleButton.innerHTML = googleLabel;
      googleAvailable = true;
    } else {
      googleButton.textContent = 'Google sign-in coming soon';
    }
  } catch {
    googleButton.textContent = 'Google sign-in unavailable right now';
  }
  updateControls();
}

function message(text, error = false) {
  status.textContent = text;
  status.className = error ? 'notice danger' : 'notice';
}

function setMode(value) {
  mode = value;
  const emailOnly = value === 'reset' || value === 'resend';
  const newPassword = value === 'signup' || value === 'recovery';
  heading.textContent = { signin: 'Sign in to Elio.', signup: 'Make yourself at home.', reset: 'Reset your password.', recovery: 'Choose a new password.', resend: 'Confirm your email.' }[value];
  intro.textContent = {
    signin: customer ? 'A little Elio, just for you. Sign in to your account.' : 'Use your Elio account. Dashboard access is granted separately by an owner.',
    signup: customer ? 'Create your Elio account to keep your orders together and use eligible promo codes.' : 'Create your Elio account. An owner will need to grant you dashboard access.',
    reset: 'Enter your email address and we’ll send you a link to reset your password.',
    recovery: 'Choose a password for your Elio account, then enter it again to confirm.',
    resend: 'Enter the email address you used to create your Elio account.',
  }[value];
  form.email.closest('label').hidden = value === 'recovery';
  form.email.required = value !== 'recovery';
  form.email.disabled = value === 'recovery';
  document.querySelector('#password-field').hidden = emailOnly;
  form.password.required = !emailOnly;
  form.password.disabled = emailOnly;
  form.password.minLength = value === 'signin' ? 0 : 12;
  form.password.autocomplete = value === 'signin' ? 'current-password' : 'new-password';
  form.password.value = '';
  confirmPassword.value = '';
  confirmPassword.setCustomValidity('');
  confirmPassword.required = newPassword;
  confirmPassword.disabled = !newPassword;
  document.querySelector('#confirm-password-field').hidden = !newPassword;
  document.querySelector('#password-help').hidden = !newPassword;
  if (newPassword) form.password.setAttribute('aria-describedby', 'password-help');
  else form.password.removeAttribute('aria-describedby');
  const newsletter = document.querySelector('#account-newsletter');
  if (newsletter) newsletter.hidden = value !== 'signup' || newsletter.dataset.available !== 'true';
  document.querySelector('#account-provider').hidden = emailOnly || value === 'recovery';
  document.querySelector('#account-recovery').hidden = emailOnly || value === 'recovery';
  document.querySelector('#account-tabs').hidden = value === 'recovery';
  document.querySelector('#account-back').hidden = !emailOnly;
  for (const [id, tabMode] of [['account-signin', 'signin'], ['account-mode', 'signup']]) {
    const button = document.getElementById(id);
    button.classList.toggle('button-quiet', value !== tabMode);
    button.setAttribute('aria-pressed', String(value === tabMode));
  }
  message('');
  updateControls();
}

setMode('signin');

document.querySelector('#account-mode').addEventListener('click', () => setMode('signup'));
document.querySelector('#account-signin').addEventListener('click', () => setMode('signin'));
document.querySelector('#account-back').addEventListener('click', () => setMode('signin'));
document.querySelector('#account-reset').addEventListener('click', () => setMode('reset'));
document.querySelector('#account-resend').addEventListener('click', () => setMode('resend'));
function validateConfirmation() {
  confirmPassword.setCustomValidity(!confirmPassword.disabled && confirmPassword.value !== form.password.value ? 'Your passwords do not match. Please enter the same password again.' : '');
}
form.password.addEventListener('input', validateConfirmation);
confirmPassword.addEventListener('input', validateConfirmation);
document.querySelector('#account-signout').addEventListener('click', async () => {
  const { error } = await auth.signOut();
  if (error) { message(error.message, true); return; }
  location.reload();
});

googleButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  updateControls();
  message('Opening Google…');
  try {
    await ready;
    if (initializationError) throw initializationError;
    if (!auth) throw new Error('Elio account service is unavailable.');
    if (customer) {
      try {
        sessionStorage.removeItem(oauthNewsletterKey);
        if (mode === 'signup' && newsletterChoice?.checked && !newsletterChoice.disabled) sessionStorage.setItem(oauthNewsletterKey, JSON.stringify({ provider: 'google', callback, createdAt: Date.now() }));
      } catch { newsletterMessage('Your browser couldn’t save the optional newsletter choice. You can join through the newsletter form after signing in.'); }
    }
    const { error } = await auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback } });
    if (error) throw error;
  } catch (error) {
    message(/provider is not enabled|unsupported provider/i.test(error.message || '')
      ? 'Google sign-in is still being connected. You can use email and password now.'
      : error.message || 'Google sign-in could not start.', true);
    busy = false;
    updateControls();
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || (mode === 'resend' && Date.now() < resendAfter)) return;
  validateConfirmation();
  if (!form.reportValidity()) return;
  busy = true;
  updateControls();
  message('Connecting…');
  try {
    await ready;
    if (initializationError) throw initializationError;
    if (!auth) throw new Error('Elio account service is unavailable.');
    const email = form.email.value.trim();
    const password = form.password.value;
    let result;
    if (mode === 'signup') {
      const wantsNewsletter = customer && newsletterChoice?.checked && !newsletterChoice.disabled;
      const options = { emailRedirectTo: callback };
      if (wantsNewsletter) options.data = { newsletter_opt_in: true, newsletter_consent_version: 'elio-newsletter-v1' };
      result = await auth.signUp({ email, password, options });
      if (result.error) throw result.error;
      if (wantsNewsletter) await saveAccountNewsletter(email, result.data?.session);
      if (result.data?.session) { location.assign(destination); return; }
      form.password.value = '';
      confirmPassword.value = '';
      startResendCooldown();
      message('Check your email to verify your Elio account.');
    } else if (mode === 'resend') {
      result = await auth.resend({ type: 'signup', email, options: { emailRedirectTo: callback } });
      if (result.error) throw result.error;
      startResendCooldown();
      message('If your account is awaiting verification, a new confirmation link will be sent. Check your inbox and spam folder.');
    } else if (mode === 'reset') {
      result = await auth.resetPasswordForEmail(email, { redirectTo: callback });
      if (result.error) throw result.error;
      message('If an account exists for that email, a reset link will be sent.');
    } else if (mode === 'recovery') {
      result = await auth.updateUser({ password });
      if (result.error) throw result.error;
      location.assign(destination);
    } else {
      result = await auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (customer) await activateNewsletter(result.data?.session);
      location.assign(destination);
    }
  } catch (error) {
    message(error.message || 'Unable to complete the request.', true);
  } finally { busy = false; updateControls(); }
});

await Promise.all([ready, updateGoogleAvailability()]);
if (initializationError) message(initializationError.message, true);
else if (auth) {
  const { data, error } = await auth.getSession();
  if (error) message(error.message, true);
  else if (authLink.failed) {
    const params = new URLSearchParams(location.hash.slice(1));
    message(params.get('error_description') || 'The sign-in link could not be used. Please try again.', true);
  } else if (authLink.recovery && data.session) setMode('recovery');
  else if (authLink.recovery || authLink.type === 'recovery') message('This password reset link is incomplete or no longer valid. Request a new reset link.', true);
  else if (data.session) {
    heading.textContent = 'Your Elio account.';
    intro.hidden = true;
    form.hidden = true;
    document.querySelector('#account-tabs').hidden = true;
    document.querySelector('#account-recovery').hidden = true;
    document.querySelector('#account-back').hidden = true;
    document.querySelector('#account-provider').hidden = true;
    document.querySelector('#signed-in').hidden = false;
    message(`Signed in as ${data.session.user.email}.`);
    if (customer) { loadOrders();finishOAuthNewsletterConsent(data.session).then(handled => { if (!handled) activateNewsletter(data.session); }); }
    const dashboardLink = document.querySelector('#staff-dashboard');
    if (dashboardLink) {
      try {
        const access = await api('account_access');
        dashboardLink.hidden = !['owner', 'staff'].includes(access?.role);
      } catch {
        // An unavailable role lookup must not expose team navigation or block
        // the customer's account. The dashboard enforces its own permissions.
        dashboardLink.hidden = true;
      }
    }
  }
}
