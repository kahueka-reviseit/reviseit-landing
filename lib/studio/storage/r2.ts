import { createHash, createHmac } from 'node:crypto';
import { OBJECT_KEY, StudioError } from '../contracts';
import type { SignedPut, StoredObject, StudioStorage } from './types';

/**
 * Private Cloudflare R2 (S3 API, Signature Version 4, path-style addressing). Server-side only.
 * Exercised against a local S3-compatible emulator; real-R2 behaviour is UNPROVED until a later
 * bounded test with a throwaway bucket is authorised.
 */
export type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string };
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export function amzDate(d: Date) { return d.toISOString().replace(/[:-]|\.\d{3}/g, ''); }

/** Signs an S3 request. Exported for the published-vector unit test. */
export function signV4(input: { method: string; url: URL; headers: Record<string, string>; payloadHash: string; accessKeyId: string; secretAccessKey: string; region: string; now: Date; presignExpires?: number }) {
  const { method, url, accessKeyId, secretAccessKey, region, now } = input;
  const date = amzDate(now), day = date.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const headers: Record<string, string> = { host: url.host };
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const query = new URLSearchParams(url.search);
  if (input.presignExpires !== undefined) {
    query.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256'); query.set('X-Amz-Credential', `${accessKeyId}/${scope}`);
    query.set('X-Amz-Date', date); query.set('X-Amz-Expires', String(input.presignExpires));
  } else { headers['x-amz-date'] = date; headers['x-amz-content-sha256'] = input.payloadHash; }
  const signed = Object.keys(headers).sort();
  if (input.presignExpires !== undefined) query.set('X-Amz-SignedHeaders', signed.join(';'));
  const canonicalQuery = [...query.entries()].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalPath = url.pathname.split('/').map(p => enc(decodeURIComponent(p))).join('/');
  const canonical = [method, canonicalPath, canonicalQuery, signed.map(h => `${h}:${headers[h]}\n`).join(''), signed.join(';'), input.payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  if (input.presignExpires !== undefined) {
    query.set('X-Amz-Signature', signature);
    const u = new URL(url); u.search = [...query.entries()].map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    return { url: u.toString(), headers: {} as Record<string, string>, signature };
  }
  delete headers.host;
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
  return { url: url.toString(), headers, signature };
}

export class R2StudioStorage implements StudioStorage {
  readonly kind = 'r2' as const;
  constructor(private readonly config: R2Config, private readonly fetcher: typeof fetch = fetch) {
    if (!/^https:\/\//.test(config.endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(config.endpoint)) throw new StudioError('R2 endpoint must be HTTPS (loopback HTTP only for local emulation)', 'invalid');
  }
  private url(key: string, query = '') {
    if (key && !OBJECT_KEY.test(key)) throw new StudioError('Invalid object key', 'invalid');
    return new URL(`${this.config.endpoint.replace(/\/$/, '')}/${enc(this.config.bucket)}${key ? '/' + key.split('/').map(enc).join('/') : ''}${query}`);
  }
  private async send(method: string, url: URL, body?: Uint8Array, headers: Record<string, string> = {}) {
    const payloadHash = body ? hex(body) : hex('');
    const s = signV4({ method, url, headers, payloadHash, accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, region: this.config.region || 'auto', now: new Date() });
    try { return await this.fetcher(s.url, { method, headers: s.headers, body: body ? Buffer.from(body) : undefined, redirect: 'error' }); }
    catch { throw new StudioError('Storage unavailable', 'storage'); }
  }
  async presignPut(key: string, { expiresSeconds, contentType }: { expiresSeconds: number; contentType: string }): Promise<SignedPut> {
    if (!key.startsWith('studio/uploads/')) throw new StudioError('Only provisional upload keys can be signed', 'invalid');
    const now = new Date();
    const s = signV4({ method: 'PUT', url: this.url(key), headers: { 'content-type': contentType }, payloadHash: 'UNSIGNED-PAYLOAD', accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, region: this.config.region || 'auto', now, presignExpires: expiresSeconds });
    return { url: s.url, method: 'PUT', headers: { 'content-type': contentType }, expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString() };
  }
  async get(key: string) {
    const r = await this.send('GET', this.url(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new StudioError(`Storage read refused (${r.status})`, 'storage');
    return new Uint8Array(await r.arrayBuffer());
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    // x-amz-content-sha256 carries the exact payload digest, which the service checks on receipt.
    const r = await this.send('PUT', this.url(key), bytes, { 'content-type': contentType });
    if (!r.ok) throw new StudioError(`Storage write refused (${r.status})`, 'storage');
  }
  async delete(key: string) {
    const r = await this.send('DELETE', this.url(key));
    if (!r.ok && r.status !== 404) throw new StudioError(`Storage delete refused (${r.status})`, 'storage');
  }
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = []; let token = '';
    for (let page = 0; page < 1000; page++) {
      const q = `?list-type=2&prefix=${enc(prefix)}${token ? '&continuation-token=' + enc(token) : ''}`;
      const r = await this.send('GET', this.url('', q));
      if (!r.ok) throw new StudioError(`Storage list refused (${r.status})`, 'storage');
      const xml = await r.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const tag = (t: string) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
        out.push({ key: tag('Key').replace(/&amp;/g, '&'), size: Number(tag('Size')), lastModified: new Date(tag('LastModified')) });
      }
      const next = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) return out;
      token = next.replace(/&amp;/g, '&');
    }
    throw new StudioError('Storage listing too long', 'storage');
  }
}
