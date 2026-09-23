import assert from 'node:assert/strict';
const values = { SUPABASE_URL: 'https://elio.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', RESEND_API_KEY: 'test-resend-key', EMAIL_FROM: 'Elio <hello@example.test>' };
globalThis.Deno = { env: { get: name => values[name] } };
const { handle } = await import('../supabase/functions/email-worker/worker.ts');
const { renderEmail } = await import('../supabase/functions/_shared/emails.ts');
const token = 'a'.repeat(64);
const request = (credential = token, method = 'POST') => new Request('https://elio.example.test/functions/v1/email-worker', { method, headers: { 'x-worker-token': credential } });
const row = { id: 'message-id', lease_token: 'lease', event_key: 'review/order-id', to_email: 'qa@example.test', first_attempt_at: new Date().toISOString(), subject: 'Elio order review', payload: {
  event_type: 'order_review_required', settings: { site_url: 'https://eliocheesecakes.com' },
  order: { id: 'order-id', reference: 'ELIO-TEST', buyer_name: '<script>unsafe</script>', fulfillment_date: '2026-12-21', method: 'pickup', total_cents: 99000 },
} };
let calls = [], providerBodies = [], setup = {};
const actualFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (String(url).includes('api.resend.com')) {
    calls.push('send'); providerBodies.push({ body, key: options.headers['Idempotency-Key'] });
    return Response.json(setup.providerFailure ? {} : { id: 'provider-id' }, { status: setup.providerFailure ? 429 : 200 });
  }
  if (String(url).endsWith('/elio_email_worker_authorized')) { calls.push('authorize'); return Response.json(setup.authorized !== false); }
  calls.push(body.p_action);
  if (body.p_action === 'claim_emails') return Response.json(setup.empty ? [] : [{ ...row, ...(setup.old ? { first_attempt_at: '2020-01-01' } : {}) }]);
  if (body.p_action === 'prepare_email') return Response.json(setup.skip ? { skip: true } : row);
  if (body.p_action === 'email_sent' && setup.ackFailure) return Response.json({}, { status: 500 });
  if (body.p_action === 'email_failed') setup.recordedFailure = body.p_payload;
  return Response.json({});
};
let checks = 0;
async function check(name, fn) { calls = []; providerBodies = []; setup = {}; await fn(); console.log(`PASS ${name}`); checks++; }
try {
  await check('GET and missing credentials cannot perform work', async () => {
    assert.equal((await handle(request('', 'GET'))).status, 405);
    assert.equal((await handle(request(''))).status, 401);
    assert.deepEqual(calls, []);
  });
  await check('invalid private credential cannot claim messages', async () => {
    setup.authorized = false; assert.equal((await handle(request())).status, 401); assert.deepEqual(calls, ['authorize']);
  });
  await check('missing Resend settings do not consume retries', async () => {
    const key = values.RESEND_API_KEY; delete values.RESEND_API_KEY;
    assert.equal((await handle(request())).status, 503); assert.deepEqual(calls, ['authorize']); values.RESEND_API_KEY = key;
  });
  await check('empty queue still performs maintenance', async () => {
    setup.empty = true; assert.equal((await handle(request())).status, 200); assert.deepEqual(calls, ['authorize', 'maintenance', 'claim_emails']);
  });
  await check('delivery prepares the claim and acknowledges provider acceptance', async () => {
    const response = await (await handle(request())).json(); assert.equal(response.accepted, 1);
    assert.deepEqual(calls, ['authorize', 'maintenance', 'claim_emails', 'prepare_email', 'send', 'email_sent']);
    assert.equal(providerBodies[0].key, 'elio/review/order-id');
    assert.equal(providerBodies[0].body.reply_to, 'elio.cheesecakes@gmail.com');
    assert.ok(providerBodies[0].body.html.includes('&lt;script&gt;'));
    assert.ok(providerBodies[0].body.html.includes('Elio Basque Cheesecake'));
    assert.ok(!providerBodies[0].body.html.includes('The Little Baker'));
  });
  await check('revoked or stale messages are skipped before delivery', async () => {
    setup.skip = true; assert.equal((await (await handle(request())).json()).skipped, 1); assert.equal(providerBodies.length, 0);
  });
  await check('expired idempotency windows stop automatic retries', async () => {
    setup.old = true; await handle(request()); assert.equal(setup.recordedFailure.terminal, true); assert.equal(providerBodies.length, 0);
  });
  await check('provider failure records a retry without claiming sent', async () => {
    setup.providerFailure = true; await handle(request()); assert.ok(calls.includes('email_failed')); assert.ok(!calls.includes('email_sent'));
  });
  await check('acknowledgement retry retains exactly the same provider body and key', async () => {
    setup.ackFailure = true; assert.equal((await (await handle(request())).json()).acknowledgement_pending, 1);
    setup.ackFailure = false; await handle(request()); assert.deepEqual(providerBodies[0], providerBodies[1]);
  });
  await check('customer order links and HTML values are escaped', async () => {
    const email = renderEmail({ ...row.payload, event_type: 'payment_approved', order: { ...row.payload.order, access_token: 'private-order-token', items: [{ name: '<img src=x>', quantity: 1, line_total_cents: 99000, selection_labels: [], flavor_contents: [{ name: 'Vanilla', quantity: 2 }, { name: 'Matcha', quantity: 1 }] }] } });
    assert.ok(email.text.includes('https://eliocheesecakes.com/order.html#order='));
    assert.ok(email.html.includes('&lt;img src=x&gt;')); assert.ok(!email.html.includes('<img src=x>'));
    assert.ok(email.text.includes('Vanilla × 2, Matcha × 1'));
    assert.ok(email.text.includes('Please use your order page to upload payment proof'));
  });
  console.log(`Passed ${checks} mocked email-worker checks; no emails sent.`);
} finally { globalThis.fetch = actualFetch; }
