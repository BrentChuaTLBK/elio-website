// Basic consent mode: no Google script or measurement request before opting in.
export const MEASUREMENT_ID = 'G-0DJM12X1FV';
const preferenceKey = 'elio-analytics-choice-v1';
const lifetime = 180 * 24 * 60 * 60 * 1000;
const productionHosts = new Set(['eliocheesecakes.com', 'www.eliocheesecakes.com']);
const publicPages = new Map([
 ['/', 'Home'], ['/index', 'Home'], ['/story', 'Our Story'], ['/flavors', 'Flavors'], ['/box', 'The Elio box'],
 ['/order', 'Shop'], ['/newsletter', 'Newsletter'], ['/privacy', 'Privacy'], ['/terms', 'Website terms'],
]);
const publicParameters = new Set(['product', 'collection', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term']);
const denied = {analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'};
const disabledKey = `ga-disable-${MEASUREMENT_ID}`;
const browserOptOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
let choice = readChoice(), started = false, privateVisit = false, banner;

function pageDetails() {
 const url = new URL(location.href), path = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
 if(url.protocol !== 'https:' || !productionHosts.has(url.hostname) || !publicPages.has(path))return null;
 if([...url.searchParams.keys()].some(key => !publicParameters.has(key)))return null;
 // Public anchors are simple names. Order, authentication and unsubscribe links
 // carry key=value fragments and must never load the Google tag.
 if(url.hash && !/^#[a-z][a-z0-9-]*$/i.test(url.hash))return null;
 return {page_location:`https://eliocheesecakes.com${path === '/' || path === '/index' ? '/' : path + '.html'}`, page_title:`${publicPages.get(path)} · Elio Cheesecakes`};
}
function readChoice() {
 try {
  const saved = JSON.parse(localStorage.getItem(preferenceKey));
  if(saved && ['granted','denied'].includes(saved.value) && saved.expires > Date.now())return saved.value;
 } catch { /* Browser storage is optional. */ }
 return null;
}
function cleanReferrer() {
 try { const url = new URL(document.referrer);return ['https:','http:'].includes(url.protocol) ? url.origin + '/' : ''; } catch { return ''; }
}
function tag() { window.dataLayer.push(arguments); }
function clearAnalyticsCookies() {
 for(const part of document.cookie.split(';')){
  const name = part.split('=')[0].trim();
  if(!/^_ga(?:_|$)/.test(name))continue;
  for(const domain of ['', location.hostname, '.eliocheesecakes.com'])document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain ? '; Domain=' + domain : ''}`;
 }
}
function stopTracking() {
 window[disabledKey] = true;
 if(started)tag('consent', 'update', denied);
}
function startTracking() {
 const page = pageDetails();
 if(started || privateVisit || !page || browserOptOut || choice !== 'granted')return;
 started = true;
 window[disabledKey] = false;
 window.dataLayer = window.dataLayer || [];
 window.gtag = tag;
 tag('consent', 'default', denied);
 tag('consent', 'update', {...denied, analytics_storage:'granted'});
 tag('set', 'ads_data_redaction', true);
 tag('set', 'url_passthrough', false);
 tag('js', new Date());
 tag('config', MEASUREMENT_ID, {
  ...page, page_referrer:cleanReferrer(), send_page_view:false,
  allow_google_signals:false, allow_ad_personalization_signals:false,
  cookie_expires:lifetime / 1000, cookie_flags:'SameSite=Lax;Secure',
 });
 tag('event', 'page_view', {...page, page_referrer:cleanReferrer(), send_to:MEASUREMENT_ID});
 const script = document.createElement('script');
 script.async = true;script.referrerPolicy = 'no-referrer';
 script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
 document.head.append(script);
}
function updatePreferenceControls() {
 for(const control of document.querySelectorAll('[data-analytics-preference]')){
  control.disabled = browserOptOut;
  control.textContent = choice === 'granted' && !browserOptOut ? 'Turn off analytics' : 'Allow analytics';
 }
 for(const status of document.querySelectorAll('[data-analytics-status]'))status.textContent = browserOptOut
  ? 'Analytics is off because your browser requests privacy.'
  : choice === 'granted' ? 'Analytics is allowed on this browser.' : 'Analytics is off on this browser.';
}
function saveChoice(value) {
 choice = value;
 try { localStorage.setItem(preferenceKey, JSON.stringify({value, expires:Date.now() + lifetime})); } catch { /* Applies to this page even without storage. */ }
 banner?.remove();banner = null;
 if(value === 'granted'){
  // Reload only when re-enabling a tag already stopped in this document.
  if(started){location.reload();return;}
  startTracking();
 } else {stopTracking();clearAnalyticsCookies();}
 updatePreferenceControls();
 window.dispatchEvent(new Event('elio-analytics-choice'));
}
function showChoice() {
 if(choice || browserOptOut || privateVisit || !pageDetails())return;
 banner = document.createElement('section');banner.className = 'elio-analytics-choice';
 banner.setAttribute('aria-label', 'Analytics preference');
 banner.innerHTML = '<p>May we use analytics cookies to understand visits and improve Elio? <a href="privacy.html#analytics">Privacy</a></p><div><button type="button" data-analytics-choice="denied">No thanks</button><button type="button" data-analytics-choice="granted">Allow analytics</button></div>';
 banner.addEventListener('click', event => {const button = event.target.closest('[data-analytics-choice]');if(button)saveChoice(button.dataset.analyticsChoice);});
 document.body.append(banner);
}
function enterPrivateVisit() {
 privateVisit = true;stopTracking();banner?.remove();banner = null;
}

privateVisit = !pageDetails();
window[disabledKey] = true;
if(browserOptOut || choice === 'denied')clearAnalyticsCookies();
startTracking();showChoice();updatePreferenceControls();
document.addEventListener('click', event => {if(event.target.closest('[data-analytics-preference]'))saveChoice(choice === 'granted' ? 'denied' : 'granted');});
window.addEventListener('hashchange', () => {if(!pageDetails())enterPrivateVisit();});
window.addEventListener('popstate', () => {if(!pageDetails())enterPrivateVisit();});
// Checkout fires this before putting a private order token in the URL.
window.addEventListener('elio-private-order', enterPrivateVisit);
window.addEventListener('storage', event => {
 if(event.key !== preferenceKey && event.key !== null)return;
 choice = readChoice();
 if(choice !== 'granted'){stopTracking();clearAnalyticsCookies();}
 else if(!started)startTracking();
 banner?.remove();banner = null;showChoice();updatePreferenceControls();
});
