import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderNotification, type Kind, type Metadata } from './templates';

/**
 * Server-side delivery for the C09 outbox (migration 026). The database decides
 * what may be sent and when; this module only renders, sends through Resend's
 * HTTP API, and records the outcome. Credentials come from server environment
 * variables and never reach the browser, logs or stored payloads.
 */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type EmailConfig = { apiKey: string; from: string; replyTo: string; origin: string };
export const RESEND_EMAILS = 'https://api.resend.com/emails';

/** Null when delivery is not configured, which leaves every notification queued. */
export function emailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY || '', from = env.EMAIL_FROM || '', replyTo = env.EMAIL_REPLY_TO || '', origin = env.SITE_URL || '';
  if (!/^re_[A-Za-z0-9_]{8,}$/.test(apiKey) || !/^[^<>\n]{1,60} <[^@\s<>]+@[^@\s<>]+>$/.test(from) || !/^[^@\s<>]+@[^@\s<>]+$/.test(replyTo)) return null;
  try { if (new URL(origin).protocol !== 'https:') return null; } catch { return null; }
  return { apiKey, from, replyTo, origin };
}

export type Payload = { from: string; to: string; reply_to: string; subject: string; html: string; text: string; headers: Record<string, string>; tags: { name: string; value: string }[]; templateVersion: string };
export function buildPayload(id: string, kind: Kind, recipient: string, meta: Metadata, config: EmailConfig): Payload {
  const r = renderNotification(kind, { ...meta, email: recipient }, config.origin);
  // A distinct reference header stops mail clients threading separate papers together.
  return { from: config.from, to: recipient, reply_to: config.replyTo, subject: r.subject, html: r.html, text: r.text,
    headers: { 'X-Entity-Ref-ID': id }, tags: [{ name: 'kind', value: kind }], templateVersion: r.templateVersion };
}

export type SendOutcome = { outcome: 'accepted'; id: string } | { outcome: 'retry'; ambiguous: boolean; error: string } | { outcome: 'rejected'; error: string };
/**
 * One send. The idempotency key is the notification's own identity, so a retry
 * after a timeout returns the original acceptance within Resend's 24-hour window.
 */
export async function sendEmail(payload: Payload, key: string, apiKey: string, fetcher: Fetcher = fetch, timeoutMs = 15000): Promise<SendOutcome> {
  const { templateVersion: _version, ...body } = payload;
  let response: Response;
  try {
    response = await fetcher(RESEND_EMAILS, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `reviseit-email/${key}` },
      body: JSON.stringify({ ...body, to: [body.to] }) });
  } catch (e) {
    return { outcome: 'retry', ambiguous: true, error: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
  let data: any = null;
  try { data = await response.json(); } catch { data = null; }
  const detail = `${response.status} ${typeof data?.name === 'string' ? data.name.slice(0, 80) : ''}`.trim();
  if (response.ok && typeof data?.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.id)) return { outcome: 'accepted', id: data.id };
  if (response.ok) return { outcome: 'retry', ambiguous: true, error: 'accepted without an identifier' };
  if (response.status === 429 || response.status === 401 || response.status === 403) return { outcome: 'retry', ambiguous: false, error: detail };
  // 409: a concurrent request with the same key may already have been accepted.
  if (response.status === 409 || response.status >= 500) return { outcome: 'retry', ambiguous: true, error: detail };
  return { outcome: 'rejected', error: detail };
}

type Claim = { id: string; lease: string; kind: Kind; recipient: string; payload: Payload | null; attempt: number; metadata: Metadata | null };
export type DispatchReport = { claimed: number; accepted: number; retried: number; rejected: number; lost: number };

/** Claims due notifications and sends each once. Safe to run concurrently and repeatedly. */
export async function dispatchOnce(client: SupabaseClient, config: EmailConfig, options: { worker?: string; max?: number; fetcher?: Fetcher } = {}): Promise<DispatchReport> {
  const report: DispatchReport = { claimed: 0, accepted: 0, retried: 0, rejected: 0, lost: 0 };
  const claim = await client.rpc('claim_email_notifications', { worker: options.worker || 'app-dispatch', max_count: options.max || 10 });
  if (claim.error) throw new Error('Email claim unavailable');
  const items = (claim.data || []) as Claim[];
  report.claimed = items.length;
  for (const item of items) {
    try {
      const rendered = item.payload || buildPayload(item.id, item.kind, item.recipient, item.metadata || {}, config);
      const stored = await client.rpc('record_email_payload', { target: item.id, token: item.lease, rendered });
      if (stored.error) { report.lost++; continue; }
      const result = await sendEmail(stored.data as Payload, item.id, config.apiKey, options.fetcher);
      const done = await client.rpc('complete_email_attempt', { target: item.id, token: item.lease, outcome: result.outcome,
        provider_message: result.outcome === 'accepted' ? result.id : null, error_text: result.outcome === 'accepted' ? null : result.error,
        ambiguous_failure: result.outcome === 'retry' ? result.ambiguous : false });
      if (done.error) { report.lost++; continue; }
      if (result.outcome === 'accepted') report.accepted++; else if (result.outcome === 'retry') report.retried++; else report.rejected++;
    } catch { report.lost++; }
  }
  return report;
}

/**
 * Resend signs callbacks with Svix: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`
 * using the base64 secret after `whsec_`. The raw body must be verified before parsing.
 */
export function verifyWebhook(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^whsec_[A-Za-z0-9+/=]+$/.test(secret) || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(' ').some(part => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const got = Buffer.from(value, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export type WebhookEvent = { eventId: string; type: string; providerId: string | null; occurredAt: string | null; bounceType: string | null };
export function parseWebhook(rawBody: string, svixId: string): WebhookEvent | null {
  let v: any;
  try { v = JSON.parse(rawBody); } catch { return null; }
  if (!v || typeof v.type !== 'string' || !/^[a-z_.]{1,60}$/.test(v.type)) return null;
  const providerId = typeof v.data?.email_id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v.data.email_id) ? v.data.email_id : null;
  const occurredAt = typeof v.created_at === 'string' && !Number.isNaN(Date.parse(v.created_at)) ? new Date(v.created_at).toISOString() : null;
  const bounceType = typeof v.data?.bounce?.type === 'string' ? v.data.bounce.type.slice(0, 40) : null;
  return { eventId: svixId.slice(0, 200), type: v.type, providerId, occurredAt, bounceType };
}

