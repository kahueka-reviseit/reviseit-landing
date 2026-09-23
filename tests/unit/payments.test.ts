// @vitest-environment node
// Synthetic Stripe objects and a mocked transport: no network, no Stripe account.
import { beforeEach, expect, test, vi } from 'vitest';
import { createHmac } from 'node:crypto';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), service: vi.fn(), create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() }));
vi.mock('../../lib/auth/access', () => ({ accountContext: m.context }));
vi.mock('../../lib/supabase/config', () => ({
  authConfig: () => ({ siteUrl: 'https://teacher.example', trustedOrigins: ['https://teacher.example', 'https://admin.example'] }),
  trustedOrigin: (o: string | null) => ['https://teacher.example', 'https://admin.example'].includes(o || ''),
}));
vi.mock('../../lib/supabase/service', () => ({ serviceClient: () => ({ rpc: m.service }) }));
vi.mock('../../lib/payments/stripe', async original => ({ ...(await original<typeof import('../../lib/payments/stripe')>()), createCheckoutSession: m.create, retrieveCheckoutSession: m.retrieve, expireCheckoutSession: m.expire }));
import { verifySignature, stripeConfig } from '../../lib/payments/stripe';
import { isCheckoutRequest } from '../../lib/payments/contracts';
import { POST as checkout } from '../../app/api/teacher/checkout/route';
import { POST as webhook } from '../../app/api/stripe/webhook/route';
import { POST as payment } from '../../app/api/teacher/orders/[id]/payment/route';
const order = '00000000-0000-4000-8000-000000000100', key = '00000000-0000-4000-8000-0000000000a1';
const secret = 'whsec_syntheticSecretForTests';
const session = (over: object = {}) => ({ id: 'cs_test_Synthetic1', url: 'https://checkout.stripe.com/c/pay/cs_test_Synthetic1', livemode: false, status: 'complete', paymentStatus: 'paid', amountTotal: 10000, currency: 'zar', clientReferenceId: order, metadataOrderId: order, paymentIntent: 'pi_Synthetic1', ...over });
const sign = (body: string, t = Math.floor(Date.now() / 1000), s = secret) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`;
const checkoutBody = { requestKey: key, moduleId: 'synthetic-module', selectionRevision: 3, allocations: { 'structured:SPEC_01': 8, 'mcq:MCQ_01': 2 } };
const post = (url: string, value: unknown, origin = 'https://teacher.example') => new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(value) });
beforeEach(() => {
  vi.resetAllMocks();
  process.env.STRIPE_MODE = 'test'; process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic'; process.env.STRIPE_WEBHOOK_SECRET = secret;
  m.context.mockResolvedValue({ kind: 'authenticated', user: { id: 'teacher', email: 'teacher@school.example', email_confirmed_at: 'yes' }, account: { status: 'approved', email: 'teacher@school.example', school_id: 's', department_id: 'd' }, supabase: { rpc: m.rpc } });
  m.service.mockResolvedValue({ data: { outcome: 'paid' }, error: null });
});

test('signature: exact raw body, secret and fresh timestamp are all required', () => {
  const body = '{"id":"evt_1"}', now = 1_800_000_000;
  expect(verifySignature(body, sign(body, now), secret, now)).toBe(true);
  expect(verifySignature(body + ' ', sign(body, now), secret, now)).toBe(false);
  expect(verifySignature(body, sign(body, now, 'whsec_other'), secret, now)).toBe(false);
  expect(verifySignature(body, sign(body, now - 301), secret, now)).toBe(false);
  expect(verifySignature(body, `t=${now},v1=${'0'.repeat(64)},` + sign(body, now).split(',')[1], secret, now)).toBe(true);
  expect(verifySignature(body, null, secret, now)).toBe(false);
  expect(verifySignature(body, `t=${now},v0=${'a'.repeat(64)}`, secret, now)).toBe(false);
});
test('configuration keeps test and live credentials apart', () => {
  expect(stripeConfig()?.mode).toBe('test');
  process.env.STRIPE_MODE = 'live'; expect(stripeConfig()).toBeNull();
  process.env.STRIPE_SECRET_KEY = 'sk_live_synthetic'; expect(stripeConfig()?.mode).toBe('live');
  process.env.STRIPE_MODE = 'production'; expect(stripeConfig()).toBeNull();
});
test('hosted session uses the fixed R100 price, fixed return paths and the order as idempotency key', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ object: 'checkout.session', id: 'cs_test_Synthetic1', url: 'https://checkout.stripe.com/x', livemode: false, status: 'open', payment_status: 'unpaid' }) });
  const { createCheckoutSession: realCreate } = await vi.importActual<typeof import('../../lib/payments/stripe')>('../../lib/payments/stripe');
  await realCreate(stripeConfig()!, { orderId: order, siteUrl: 'https://teacher.example', email: 'teacher@school.example', expiresAt: new Date(1_800_000_000_000) }, fetcher as never);
  const [url, init] = fetcher.mock.calls[0]; const p = new URLSearchParams(init.body);
  expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
  expect(init.headers['Idempotency-Key']).toBe(`reviseit-checkout-${order}`);
  expect(Object.fromEntries(p)).toMatchObject({ mode: 'payment', 'line_items[0][price_data][unit_amount]': '10000', 'line_items[0][price_data][currency]': 'zar', 'line_items[0][quantity]': '1',
    client_reference_id: order, 'metadata[order_id]': order, 'adaptive_pricing[enabled]': 'false', expires_at: '1800000000',
    success_url: `https://teacher.example/teacher/orders/${order}?checkout=returned`, cancel_url: `https://teacher.example/teacher/orders/${order}?checkout=cancelled` });
});
test('the browser request cannot carry price, entitlement or other authority', () => {
  expect(isCheckoutRequest(checkoutBody)).toBe(true);
  for (const extra of [{ amount: 1 }, { entitlement: 'paid' }, { currency: 'usd' }, { orderable: true }]) expect(isCheckoutRequest({ ...checkoutBody, ...extra })).toBe(false);
  expect(isCheckoutRequest({ ...checkoutBody, allocations: JSON.parse('{"__proto__":3}') })).toBe(false);
  expect(isCheckoutRequest({ ...checkoutBody, allocations: { a: 1.5 } })).toBe(false);
});

test('checkout: foreign origins and unverified teachers are refused before admission', async () => {
  expect((await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody, 'https://evil.example'))).status).toBe(403);
  m.context.mockResolvedValue({ kind: 'authenticated', user: { email: 'teacher@school.example', email_confirmed_at: 'yes' }, account: { status: 'pending', email: 'teacher@school.example' }, supabase: { rpc: m.rpc } });
  expect((await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody))).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
test('checkout: admission runs under the teacher identity, then one hosted session is created and attached', async () => {
  m.rpc.mockResolvedValue({ data: { orderId: order, mode: 'test', status: 'creating', checkoutUrl: null, expiresAt: '2026-09-23T12:00:00Z', existing: false }, error: null });
  m.create.mockResolvedValue(session({ status: 'open', paymentStatus: 'unpaid' }));
  const r = await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody));
  expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ orderId: order, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_Synthetic1' });
  expect(m.rpc).toHaveBeenCalledWith('begin_paper_checkout', { request_key: key, target_module: 'synthetic-module', selection_revision: 3, allocations: checkoutBody.allocations });
  expect(m.create.mock.calls[0][1]).toMatchObject({ orderId: order, siteUrl: 'https://teacher.example', email: 'teacher@school.example' });
  expect(m.service).toHaveBeenCalledWith('attach_paper_checkout', { target: order, session_id: 'cs_test_Synthetic1', session_url: 'https://checkout.stripe.com/c/pay/cs_test_Synthetic1', session_livemode: false });
});
test('checkout: a repeated request resumes the recorded session without creating another', async () => {
  m.rpc.mockResolvedValue({ data: { orderId: order, mode: 'test', status: 'open', checkoutUrl: 'https://checkout.stripe.com/c/pay/existing', existing: true }, error: null });
  expect(await (await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody))).json()).toMatchObject({ checkoutUrl: 'https://checkout.stripe.com/c/pay/existing', existing: true });
  expect(m.create).not.toHaveBeenCalled();
});
test.each([['Pilot capacity unavailable', 409], ['Pilot purchasing unavailable', 503], ['Question is not available to order', 422], ['Saved selection changed or empty', 409], ['Invalid mark allocations', 422]])('checkout: database refusal %s becomes %i', async (message, status) => {
  m.rpc.mockResolvedValue({ data: null, error: { message } });
  const r = await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody)); expect(r.status).toBe(status); expect(m.create).not.toHaveBeenCalled();
});
test('checkout: a deployment in a different payment mode than the pilot allowance refuses', async () => {
  m.rpc.mockResolvedValue({ data: { orderId: order, mode: 'live', status: 'creating', checkoutUrl: null, expiresAt: '2026-09-23T12:00:00Z' }, error: null });
  expect((await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody))).status).toBe(503); expect(m.create).not.toHaveBeenCalled();
});
test('checkout: a Stripe failure reports no charge and attaches nothing', async () => {
  m.rpc.mockResolvedValue({ data: { orderId: order, mode: 'test', status: 'creating', checkoutUrl: null, expiresAt: '2026-09-23T12:00:00Z' }, error: null });
  m.create.mockRejectedValue(new Error('network'));
  const r = await checkout(post('https://teacher.example/api/teacher/checkout', checkoutBody));
  expect(r.status).toBe(503); expect(await r.text()).toContain('Nothing has been charged'); expect(m.service).not.toHaveBeenCalled();
});

const event = (type = 'checkout.session.completed', over: object = {}) => JSON.stringify({ id: 'evt_Synthetic1', object: 'event', type, livemode: false, data: { object: { id: 'cs_test_Synthetic1', amount_total: 10000, currency: 'zar', payment_intent: 'pi_Synthetic1', amount_refunded: 10000 } }, ...over });
const hook = (body: string, signature = sign(body)) => new Request('https://teacher.example/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body });
test('webhook: an unsigned or wrongly signed notification changes nothing', async () => {
  expect((await webhook(hook(event(), 't=1,v1=' + 'a'.repeat(64)))).status).toBe(400);
  expect((await webhook(hook(event(), sign(event(), undefined, 'whsec_otherSecret')))).status).toBe(400);
  expect(m.retrieve).not.toHaveBeenCalled(); expect(m.service).not.toHaveBeenCalled();
});
test('webhook: records the session as re-read from Stripe, not the notification body', async () => {
  m.retrieve.mockResolvedValue(session({ amountTotal: 100 }));
  const r = await webhook(hook(event()));
  expect(r.status).toBe(200); expect(m.retrieve.mock.calls[0][1]).toBe('cs_test_Synthetic1');
  expect(m.service).toHaveBeenCalledWith('record_stripe_checkout', expect.objectContaining({ event_id: 'evt_Synthetic1', event_type: 'checkout.session.completed', event_livemode: false, session: expect.objectContaining({ amountTotal: 100, clientReferenceId: order }) }));
});
test('webhook: a live notification at a test deployment is refused', async () => {
  const body = event('checkout.session.completed', { livemode: true });
  expect((await webhook(hook(body))).status).toBe(400); expect(m.service).not.toHaveBeenCalled();
});
test('webhook: a temporary database failure asks Stripe to retry', async () => {
  m.retrieve.mockResolvedValue(session()); m.service.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  expect((await webhook(hook(event()))).status).toBe(500);
});
test('webhook: full refunds and unrelated events', async () => {
  expect((await webhook(hook(event('charge.refunded')))).status).toBe(200);
  expect(m.service).toHaveBeenCalledWith('record_stripe_refund', { event_id: 'evt_Synthetic1', event_livemode: false, payment_intent: 'pi_Synthetic1', amount_refunded: 10000, refund_currency: 'zar' });
  m.service.mockClear(); const r = await webhook(hook(event('customer.created'))); expect(await r.json()).toMatchObject({ outcome: 'ignored' }); expect(m.service).not.toHaveBeenCalled();
});

const visible = (rows: unknown[]) => m.rpc.mockResolvedValue({ data: rows, error: null });
test('return from Stripe: the server re-reads the session before recording anything', async () => {
  visible([{ id: order, state: 'awaiting_answers' }]); m.service.mockImplementation(async (name: string) => name === 'paper_checkout_for_teacher' ? { data: { mode: 'test', status: 'open', sessionId: 'cs_test_Synthetic1' }, error: null } : { data: { outcome: 'paid' }, error: null });
  m.retrieve.mockResolvedValue(session());
  expect((await payment(post(`https://teacher.example/api/teacher/orders/${order}/payment`, { action: 'reconcile' }), { params: Promise.resolve({ id: order }) })).status).toBe(200);
  expect(m.service).toHaveBeenCalledWith('record_stripe_checkout', expect.objectContaining({ event_type: 'reconcile', session: expect.objectContaining({ paymentStatus: 'paid' }) }));
});
test('return from Stripe: another teacher cannot reconcile or cancel an order they cannot read', async () => {
  visible([]);
  expect((await payment(post(`https://teacher.example/api/teacher/orders/${order}/payment`, { action: 'cancel' }), { params: Promise.resolve({ id: order }) })).status).toBe(404);
  expect(m.service).not.toHaveBeenCalled(); expect(m.retrieve).not.toHaveBeenCalled();
});
test('cancel: an open hosted session is expired at Stripe before the checkout is cancelled', async () => {
  visible([{ id: order, state: 'awaiting_payment' }]);
  m.service.mockImplementation(async (name: string) => name === 'paper_checkout_for_teacher' ? { data: { mode: 'test', status: 'open', sessionId: 'cs_test_Synthetic1' }, error: null } : { data: { outcome: 'not-paid-yet' }, error: null });
  m.retrieve.mockResolvedValue(session({ status: 'open', paymentStatus: 'unpaid' })); m.expire.mockResolvedValue(session({ status: 'expired', paymentStatus: 'unpaid' }));
  await payment(post(`https://teacher.example/api/teacher/orders/${order}/payment`, { action: 'cancel' }), { params: Promise.resolve({ id: order }) });
  expect(m.expire).toHaveBeenCalled(); expect(m.service).toHaveBeenCalledWith('cancel_paper_checkout', { target: order, target_teacher: 'teacher' });
});
test('cancel: a session that was already paid is recorded as paid and never cancelled', async () => {
  visible([{ id: order, state: 'awaiting_payment' }]);
  m.service.mockImplementation(async (name: string) => name === 'paper_checkout_for_teacher' ? { data: { mode: 'test', status: 'open', sessionId: 'cs_test_Synthetic1' }, error: null } : { data: { outcome: 'paid' }, error: null });
  m.retrieve.mockResolvedValue(session());
  await payment(post(`https://teacher.example/api/teacher/orders/${order}/payment`, { action: 'cancel' }), { params: Promise.resolve({ id: order }) });
  expect(m.expire).not.toHaveBeenCalled(); expect(m.service).not.toHaveBeenCalledWith('cancel_paper_checkout', expect.anything());
});
