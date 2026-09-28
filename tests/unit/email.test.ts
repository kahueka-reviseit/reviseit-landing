// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
import { authTemplate, cleanText, destination, escapeHtml, renderNotification, COMPLETION_DOCUMENTS } from '../../lib/email/templates';
import { buildPayload, dispatchOnce, emailConfig, parseWebhook, sendEmail, verifyWebhook, type Payload } from '../../lib/email/delivery';
import { safeNext } from '../../lib/auth/policy';
import { documentLabels, documents } from '../../lib/jobs/contracts';
import { POST as dispatchRoute } from '../../app/api/internal/email/dispatch/route';
import { POST as webhookRoute } from '../../app/api/resend/webhook/route';

const origin = 'https://pilot.reviseit.io', order = '3f2b9c41-0000-4000-8000-000000000100';
const config = { apiKey: 're_synthetic_key_123', from: 'Revise It <notifications@auth.reviseit.io>', replyTo: 'kahueka@reviseit.io', origin };
const secret = 'whsec_' + Buffer.from('synthetic-webhook-secret-bytes!!').toString('base64');
function sign(body: string, id = 'msg_1', ts = Math.floor(Date.now() / 1000)) {
  return { id, timestamp: String(ts), signature: 'v1,' + createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64') };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('templates', () => {
  it('paper ready names the four current documents and links only to the protected paper page', () => {
    const r = renderNotification('paper_ready', { name: 'Nomsa Dlamini', curriculum: 'Grade 11 Physical Sciences', orderId: order }, origin);
    expect(r.subject).toBe('Your paper is ready');
    for (const d of COMPLETION_DOCUMENTS) { expect(r.html).toContain(d); expect(r.text).toContain(`- ${d}`); }
    expect(r.html).not.toMatch(/first-draft/i); expect(r.text).not.toMatch(/first-draft/i);
    const links = [...r.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    expect(links).toEqual([`${origin}/teacher/orders/${order}`]);
    expect(r.text).toContain(`View your documents: ${origin}/teacher/orders/${order}`);
    expect(r.html).not.toMatch(/<script|<img|<form|<input|\.docx|download\?/i);
  });
  it('the email names the documents exactly as the paper page labels them', () => {
    expect(documents.map(d => documentLabels[d])).toEqual(COMPLETION_DOCUMENTS);
    expect(documentLabels.memo).toBe('Teacher marking memorandum');
  });
  it('attention copy promises no retry, refund or date', () => {
    const r = renderNotification('paper_attention', { name: 'Nomsa', curriculum: 'Grade 10 Physical Sciences', orderId: order }, origin);
    expect(r.subject).toBe('Your paper needs our attention');
    expect(r.text).toContain('No documents were released');
    expect(`${r.html} ${r.text}`).not.toMatch(/refund|retry|automatically|within|deadline|\d+ (hours|days)/i);
  });
  it('escapes stored names and school text, and survives long or missing metadata', () => {
    const r = renderNotification('access_approved', { name: '<img src=x onerror=alert(1)> "Q"', school: 'A & B <b>High</b>', email: 't@school.example' }, origin);
    expect(r.html).not.toContain('<img src=x'); expect(r.html).toContain('&lt;img'); expect(r.html).toContain('A &amp; B &lt;b&gt;High&lt;/b&gt;');
    expect(r.subject).toBe('Your Revise It account is ready');
    const long = renderNotification('paper_ready', { name: 'x'.repeat(500), curriculum: 'y'.repeat(500), orderId: order }, origin);
    expect(long.html).toContain('…'); expect(long.subject.length).toBeLessThan(40);
    const bare = renderNotification('paper_ready', { orderId: order }, origin);
    expect(bare.text).toContain('Hello, all four documents for your paper are ready');
    expect(cleanText('a\u0000b\n\n c')).toBe('a b c');
  });
  it('refuses links to non-https origins and malformed order references', () => {
    expect(() => destination('paper_ready', 'http://pilot.reviseit.io', order)).toThrow();
    expect(() => destination('paper_ready', origin, '../admin')).toThrow();
    expect(destination('access_approved', origin + '/anything?x=1')).toBe(`${origin}/teacher`);
  });
  it('keeps font fallbacks, a light colour scheme, a hidden preheader and an accessible action', () => {
    const r = renderNotification('paper_ready', { orderId: order }, origin);
    expect(r.html).toContain("'Playfair Display', Georgia"); expect(r.html).toContain("'Source Sans 3', 'Source Sans Pro', Arial");
    expect(r.html).toContain('<meta name="color-scheme" content="light">'); expect(r.html).toContain('lang="en-ZA"');
    expect(r.html).toMatch(/display:none;max-height:0[^>]*>All four documents/);
    expect(r.html).toMatch(/<a href="[^"]+" style="[^"]*padding:14px 28px[^"]*">View your documents<\/a>/);
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });
  it('committed Supabase templates match the shared shell and keep the token-hash routes', () => {
    for (const [type, route] of [['confirmation', 'signup'], ['recovery', 'recovery']] as const) {
      const file = readFileSync(`supabase/templates/${type}.html`, 'utf8');
      expect(file).toBe(authTemplate(type));
      expect(file).toContain(`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${route}`);
      expect(file).not.toMatch(/ConfirmationURL|\{\{ \.Token \}\}/);
    }
    expect(authTemplate('recovery')).toContain('If you did not ask for this, ignore this email.');
  });
});

describe('sending through Resend', () => {
  const payload = buildPayload('00000000-0000-4000-8000-0000000000aa', 'paper_ready', 't@school.example', { orderId: order }, config);
  it('sends one recipient with the notification identity as the idempotency key and no tracking', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => json(200, { id: 'em_1' }));
    expect(await sendEmail(payload, 'abc', config.apiKey, fetcher)).toEqual({ outcome: 'accepted', id: 'em_1' });
    const [url, init] = fetcher.mock.calls[0]; const body = JSON.parse(String(init.body)); const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.resend.com/emails'); expect(headers['Idempotency-Key']).toBe('reviseit-email/abc');
    expect(body.to).toEqual(['t@school.example']); expect(body.reply_to).toBe('kahueka@reviseit.io'); expect(body.from).toBe(config.from);
    expect(body).not.toHaveProperty('templateVersion'); expect(body).not.toHaveProperty('attachments');
    expect(JSON.stringify(body)).not.toMatch(/track/i);
  });
  it('classifies failures: rate limits retry, timeouts and server errors retry as ambiguous, validation is rejected', async () => {
    expect(await sendEmail(payload, 'k', 'key', async () => json(429, { name: 'rate_limit_exceeded' }))).toMatchObject({ outcome: 'retry', ambiguous: false });
    expect(await sendEmail(payload, 'k', 'key', async () => json(503, {}))).toMatchObject({ outcome: 'retry', ambiguous: true });
    expect(await sendEmail(payload, 'k', 'key', async () => json(409, { name: 'concurrent_idempotent_requests' }))).toMatchObject({ outcome: 'retry', ambiguous: true });
    expect(await sendEmail(payload, 'k', 'key', async () => { throw new TypeError('fetch failed'); })).toMatchObject({ outcome: 'retry', ambiguous: true });
    expect(await sendEmail(payload, 'k', 'key', async () => json(422, { name: 'validation_error' }))).toMatchObject({ outcome: 'rejected' });
  });
  it('the dispatcher sends the stored snapshot, not a fresh render, and records the outcome', async () => {
    const stored = { ...payload, subject: 'Snapshot subject' };
    const calls: [string, any][] = [];
    const client = { rpc: vi.fn(async (name: string, args: any) => { calls.push([name, args]);
      if (name === 'claim_email_notifications') return { data: [{ id: 'n1', lease: 'l1', kind: 'paper_ready', recipient: 't@school.example', payload: stored, attempt: 2, metadata: { orderId: order } }], error: null };
      if (name === 'record_email_payload') return { data: args.rendered, error: null };
      return { data: 'accepted', error: null }; }) } as any;
    const fetcher = vi.fn(async () => json(200, { id: 'em_2' }));
    expect(await dispatchOnce(client, config, { fetcher })).toMatchObject({ claimed: 1, accepted: 1 });
    expect(JSON.parse(String((fetcher.mock.calls[0] as any)[1].body)).subject).toBe('Snapshot subject');
    expect(calls.at(-1)).toEqual(['complete_email_attempt', { target: 'n1', token: 'l1', outcome: 'accepted', provider_message: 'em_2', error_text: null, ambiguous_failure: false }]);
  });
  it('a Resend outage is recorded as a retry and touches nothing else', async () => {
    const client = { rpc: vi.fn(async (name: string, args: any) => name === 'claim_email_notifications'
      ? { data: [{ id: 'n1', lease: 'l1', kind: 'access_approved', recipient: 't@school.example', payload: null, attempt: 1, metadata: {} }], error: null }
      : name === 'record_email_payload' ? { data: args.rendered, error: null } : { data: 'queued', error: null }) } as any;
    expect(await dispatchOnce(client, config, { fetcher: async () => { throw new TypeError('offline'); } })).toMatchObject({ retried: 1 });
    expect(client.rpc.mock.calls.map((c: any[]) => c[0])).toEqual(['claim_email_notifications', 'record_email_payload', 'complete_email_attempt']);
  });
  it('configuration refuses malformed keys, senders and non-https origins', () => {
    expect(emailConfig({ RESEND_API_KEY: 're_synthetic_key_123', EMAIL_FROM: config.from, EMAIL_REPLY_TO: config.replyTo, SITE_URL: origin } as any)).toEqual(config);
    expect(emailConfig({ RESEND_API_KEY: 'nope', EMAIL_FROM: config.from, EMAIL_REPLY_TO: config.replyTo, SITE_URL: origin } as any)).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: 're_synthetic_key_123', EMAIL_FROM: 'bad', EMAIL_REPLY_TO: config.replyTo, SITE_URL: origin } as any)).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: 're_synthetic_key_123', EMAIL_FROM: config.from, EMAIL_REPLY_TO: config.replyTo, SITE_URL: 'http://pilot.reviseit.io' } as any)).toBeNull();
  });
});

const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-28T10:00:00.000Z', data: { email_id: 'em_1' } });
describe('callbacks', () => {
  it('accepts a correct signature over the raw body and rejects tampering, staleness and other secrets', () => {
    const h = sign(body);
    expect(verifyWebhook(body, h, secret)).toBe(true);
    expect(verifyWebhook(body.replace('delivered', 'bounced'), h, secret)).toBe(false);
    expect(verifyWebhook(JSON.stringify(JSON.parse(body), null, 1), h, secret)).toBe(false);
    expect(verifyWebhook(body, sign(body, 'msg_1', Math.floor(Date.now() / 1000) - 3600), secret)).toBe(false);
    expect(verifyWebhook(body, h, 'whsec_' + Buffer.from('another-secret').toString('base64'))).toBe(false);
    expect(verifyWebhook(body, { ...h, signature: 'v1,' + 'A'.repeat(44) + ' ' + h.signature }, secret)).toBe(true);
    expect(verifyWebhook(body, { ...h, id: null }, secret)).toBe(false);
  });
  it('parses only the identifiers it needs', () => {
    expect(parseWebhook(body, 'msg_1')).toEqual({ eventId: 'msg_1', type: 'email.delivered', providerId: 'em_1', occurredAt: '2026-09-28T10:00:00.000Z', bounceType: null });
    expect(parseWebhook('{"type":"x;drop"}', 'm')).toBeNull();
  });
});

describe('routes', () => {
  beforeEach(() => { rpc.mockReset(); Object.assign(process.env, { SUPABASE_URL: 'https://synthetic.example', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', RESEND_WEBHOOK_SECRET: secret, EMAIL_DISPATCH_TOKEN: 'd'.repeat(40) }); });
  it('the webhook refuses a forged callback before touching the database and records a signed one', async () => {
    const forged = new Request('https://pilot.reviseit.io/api/resend/webhook', { method: 'POST', headers: { 'svix-id': 'msg_1', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,forged' }, body });
    expect((await webhookRoute(forged)).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
    const h = sign(body); rpc.mockResolvedValue({ data: 'delivered', error: null });
    const good = new Request('https://pilot.reviseit.io/api/resend/webhook', { method: 'POST', headers: { 'svix-id': h.id, 'svix-timestamp': h.timestamp, 'svix-signature': h.signature }, body });
    expect((await webhookRoute(good)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_email_event', { event_id: 'msg_1', event_type: 'email.delivered', provider_message: 'em_1', occurred: '2026-09-28T10:00:00.000Z', bounce: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect((await webhookRoute(new Request(good.url, { method: 'POST', headers: good.headers, body }))).status).toBe(500);
  });
  it('the dispatcher endpoint needs its own secret and a configured sender', async () => {
    const call = (auth: string) => dispatchRoute(new Request('https://pilot.reviseit.io/api/internal/email/dispatch', { method: 'POST', headers: { authorization: auth } }));
    expect((await call('Bearer wrong')).status).toBe(401);
    delete process.env.RESEND_API_KEY;
    expect((await call('Bearer ' + 'd'.repeat(40))).status).toBe(503); expect(rpc).not.toHaveBeenCalled();
  });
});

describe('signed-out return path', () => {
  it('keeps same-site teacher and account pages only', () => {
    expect(safeNext(`/teacher/orders/${order}`)).toBe(`/teacher/orders/${order}`);
    expect(safeNext('/teacher')).toBe('/teacher'); expect(safeNext('/account')).toBe('/account');
    expect(safeNext('/teacher?view=formatting')).toBe('/teacher?view=formatting');
    for (const bad of ['//evil.example/teacher', 'https://evil.example/teacher', '/\\evil.example', '/admin/accounts', '/api/teacher/session', '/teacher/../admin', '/teacher%2f..%2fadmin', '/teacherx', 'javascript:alert(1)', '/teacher/orders/a b', undefined, 42, '/teacher/' + 'a'.repeat(300)])
      expect(safeNext(bad)).toBeNull();
  });
});
