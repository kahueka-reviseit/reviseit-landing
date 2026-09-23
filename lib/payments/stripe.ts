import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
// Hosted Stripe Checkout through the REST API. No client library: the server
// fixes price, currency, mode and return paths; the browser supplies none.
export const PILOT_PRICE = { amountMinor: 10000, currency: 'zar' } as const;
export type StripeMode = 'test' | 'live';
export type StripeConfig = { mode: StripeMode; secretKey: string; webhookSecret: string };
export function stripeConfig(): StripeConfig | null {
  const mode = process.env.STRIPE_MODE, secretKey = process.env.STRIPE_SECRET_KEY || '', webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (mode !== 'test' && mode !== 'live') return null;
  // Test and live credentials are never interchangeable.
  const prefix = mode === 'live' ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (!prefix.test(secretKey) || !/^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(webhookSecret)) return null;
  return { mode, secretKey, webhookSecret };
}
// Stripe's documented scheme: HMAC-SHA256 over `${t}.${rawBody}` with the
// endpoint secret, compared against every v1 signature, within a tolerance.
export function verifySignature(rawBody: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header || header.length > 4096) return false;
  const parts = header.split(',').map(p => p.split('=')).filter(p => p.length === 2);
  const stamps = parts.filter(([k]) => k === 't').map(([, v]) => v);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(v => /^[a-f0-9]{64}$/.test(v));
  if (stamps.length !== 1 || !/^\d{1,12}$/.test(stamps[0]) || signatures.length === 0) return false;
  const t = Number(stamps[0]);
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${stamps[0]}.${rawBody}`, 'utf8').digest();
  return signatures.some(s => { const got = Buffer.from(s, 'hex'); return got.length === expected.length && timingSafeEqual(got, expected); });
}
export class StripeError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
type Fetcher = typeof fetch;
async function call(config: StripeConfig, method: 'GET' | 'POST', path: string, params?: URLSearchParams, idempotencyKey?: string, fetcher: Fetcher = fetch) {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.secretKey}` };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetcher(`https://api.stripe.com${path}`, { method, headers, body: params?.toString(), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  const value = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok || !value) throw new StripeError('Stripe request failed', response.status, value?.error?.code);
  return value;
}
export type CheckoutSession = { id: string; url: string | null; livemode: boolean; status: string; paymentStatus: string; amountTotal: number | null; currency: string | null; clientReferenceId: string | null; metadataOrderId: string | null; paymentIntent: string | null };
export function readSession(value: Record<string, any>): CheckoutSession {
  if (value?.object !== 'checkout.session' || typeof value.id !== 'string') throw new StripeError('Unexpected Stripe object', 502);
  return { id: value.id, url: typeof value.url === 'string' ? value.url : null, livemode: value.livemode === true, status: String(value.status), paymentStatus: String(value.payment_status),
    amountTotal: Number.isSafeInteger(value.amount_total) ? value.amount_total : null, currency: typeof value.currency === 'string' ? value.currency : null,
    clientReferenceId: typeof value.client_reference_id === 'string' ? value.client_reference_id : null,
    metadataOrderId: typeof value.metadata?.order_id === 'string' ? value.metadata.order_id : null,
    paymentIntent: typeof value.payment_intent === 'string' ? value.payment_intent : typeof value.payment_intent?.id === 'string' ? value.payment_intent.id : null };
}
// One order has exactly one hosted session. The order identifier is the
// idempotency key, so a repeated request cannot create a second session.
export async function createCheckoutSession(config: StripeConfig, input: { orderId: string; siteUrl: string; email: string; expiresAt: Date }, fetcher?: Fetcher) {
  const p = new URLSearchParams({
    mode: 'payment', 'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': PILOT_PRICE.currency, 'line_items[0][price_data][unit_amount]': String(PILOT_PRICE.amountMinor),
    'line_items[0][price_data][product_data][name]': 'Revise It assessment paper (pilot)',
    client_reference_id: input.orderId, 'metadata[order_id]': input.orderId, 'payment_intent_data[metadata][order_id]': input.orderId,
    success_url: `${input.siteUrl}/teacher/orders/${input.orderId}?checkout=returned`,
    cancel_url: `${input.siteUrl}/teacher/orders/${input.orderId}?checkout=cancelled`,
    // Keep the charge in rand at the fixed pilot price.
    'adaptive_pricing[enabled]': 'false',
    expires_at: String(Math.floor(input.expiresAt.getTime() / 1000)),
  });
  if (input.email) p.set('customer_email', input.email);
  return readSession(await call(config, 'POST', '/v1/checkout/sessions', p, `reviseit-checkout-${input.orderId}`, fetcher));
}
export async function retrieveCheckoutSession(config: StripeConfig, id: string, fetcher?: Fetcher) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{1,250}$/.test(id)) throw new StripeError('Invalid session', 400);
  return readSession(await call(config, 'GET', `/v1/checkout/sessions/${id}`, undefined, undefined, fetcher));
}
export async function expireCheckoutSession(config: StripeConfig, id: string, fetcher?: Fetcher) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{1,250}$/.test(id)) throw new StripeError('Invalid session', 400);
  return readSession(await call(config, 'POST', `/v1/checkout/sessions/${id}/expire`, new URLSearchParams(), `reviseit-expire-${id}`, fetcher));
}
// The database record function receives only verified Stripe fields.
export function sessionRecord(s: CheckoutSession) {
  return { id: s.id, clientReferenceId: s.clientReferenceId, metadataOrderId: s.metadataOrderId, livemode: s.livemode, amountTotal: s.amountTotal, currency: s.currency, paymentStatus: s.paymentStatus, status: s.status, paymentIntent: s.paymentIntent };
}
