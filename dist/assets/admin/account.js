import { auth, ready, initializationError, authLink } from './client.js';
import { config } from './config.js';

const form = document.querySelector('#account-form');
const status = document.querySelector('#account-status');
const heading = document.querySelector('#account-heading');
const submit = document.querySelector('#account-submit');
const googleButton = document.querySelector('#google-signin');
const googleLabel = googleButton.innerHTML;
const destination = document.body.dataset.accountContext === 'customer' ? 'account.html' : 'manage.html';
const callback = new URL(document.body.dataset.accountContext === 'customer' ? 'account.html' : 'admin-account.html', location.href).href;
let mode = 'signin';

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
      googleButton.disabled = false;
    } else {
      googleButton.textContent = 'Google sign-in coming soon';
    }
  } catch {
    googleButton.textContent = 'Google sign-in unavailable right now';
  }
}

function message(text, error = false) {
  status.textContent = text;
  status.className = error ? 'notice danger' : 'notice';
}

function setMode(value) {
  mode = value;
  heading.textContent = { signin: 'Sign in to Elio.', signup: 'Create your Elio account.', reset: 'Reset your password.', recovery: 'Choose a new password.' }[value];
  submit.textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link', recovery: 'Save password' }[value];
  form.email.closest('label').hidden = value === 'recovery';
  form.email.required = value !== 'recovery';
  document.querySelector('#password-field').hidden = value === 'reset';
  form.password.required = value !== 'reset';
  form.password.minLength = value === 'signin' ? 0 : 12;
  form.password.autocomplete = value === 'signin' ? 'current-password' : 'new-password';
  document.querySelector('#account-mode').textContent = value === 'signin' ? 'Create an account' : 'Back to sign in';
  document.querySelector('#account-reset').hidden = value !== 'signin';
  document.querySelector('#account-provider').hidden = value === 'reset' || value === 'recovery';
}

setMode('signin');

document.querySelector('#account-mode').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
document.querySelector('#account-reset').addEventListener('click', () => setMode('reset'));
document.querySelector('#account-signout').addEventListener('click', async () => {
  const { error } = await auth.signOut();
  if (error) { message(error.message, true); return; }
  location.reload();
});

googleButton.addEventListener('click', async () => {
  googleButton.disabled = true;
  message('Opening Google…');
  try {
    await ready;
    if (initializationError) throw initializationError;
    if (!auth) throw new Error('Elio account service is unavailable.');
    const { error } = await auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback } });
    if (error) throw error;
  } catch (error) {
    message(/provider is not enabled|unsupported provider/i.test(error.message || '')
      ? 'Google sign-in is still being connected. You can use email and password now.'
      : error.message || 'Google sign-in could not start.', true);
    googleButton.disabled = false;
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  message('Connecting…');
  try {
    await ready;
    if (initializationError) throw initializationError;
    if (!auth) throw new Error('Elio account service is unavailable.');
    const email = form.email.value.trim();
    const password = form.password.value;
    let result;
    if (mode === 'signup') {
      result = await auth.signUp({ email, password, options: { emailRedirectTo: callback } });
      if (result.error) throw result.error;
      message('Check your email to verify your Elio account.');
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
      location.assign(destination);
    }
  } catch (error) {
    message(error.message || 'Unable to complete the request.', true);
  } finally { submit.disabled = false; }
});

await Promise.all([ready, updateGoogleAvailability()]);
if (initializationError) message(initializationError.message, true);
else if (auth) {
  const { data, error } = await auth.getSession();
  if (error) message(error.message, true);
  else if (authLink.failed) {
    const params = new URLSearchParams(location.hash.slice(1));
    message(params.get('error_description') || 'The sign-in link could not be used. Please try again.', true);
  } else if (authLink.recovery || authLink.type === 'recovery') setMode('recovery');
  else if (data.session) {
    form.hidden = true;
    document.querySelector('#account-provider').hidden = true;
    document.querySelector('#signed-in').hidden = false;
    message(`Signed in as ${data.session.user.email}.`);
  }
}
