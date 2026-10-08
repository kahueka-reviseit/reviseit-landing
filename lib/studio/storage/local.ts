import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { OBJECT_KEY, StudioError } from '../contracts';
import type { SignedPut, StoredObject, StudioStorage } from './types';

/**
 * Local filesystem emulation of the storage contract, for tests and isolated rehearsal only.
 * Signed uploads are HMAC tokens that, like S3 presigned URLs, can be replayed until expiry.
 * This is LOCAL EMULATION: it proves Studio's protocol, not Cloudflare R2 behaviour.
 */
export class LocalStudioStorage implements StudioStorage {
  readonly kind = 'local' as const;
  private readonly secret: Buffer;
  /** Optional fault injection for tests: called before each operation. */
  fault: ((op: 'get' | 'put' | 'delete' | 'list', key: string) => void) | null = null;
  constructor(readonly root: string, secret?: Buffer) { this.secret = secret ?? randomBytes(32); }
  private path(key: string) {
    if (!OBJECT_KEY.test(key)) throw new StudioError('Invalid object key', 'invalid');
    return join(this.root, ...key.split('/'));
  }
  async presignPut(key: string, { expiresSeconds, contentType }: { expiresSeconds: number; contentType: string }): Promise<SignedPut> {
    if (!key.startsWith('studio/uploads/')) throw new StudioError('Only provisional upload keys can be signed', 'invalid');
    this.path(key);
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();
    const payload = `${key}\n${expiresAt}\n${contentType}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex');
    const url = `studio-local://put?key=${encodeURIComponent(key)}&expires=${encodeURIComponent(expiresAt)}&type=${encodeURIComponent(contentType)}&sig=${sig}`;
    return { url, method: 'PUT', headers: { 'content-type': contentType }, expiresAt };
  }
  /** What a browser PUT to the signed URL does. Valid repeatedly until expiry, as with S3/R2. */
  async acceptSignedPut(url: string, bytes: Uint8Array, now = new Date()) {
    const u = new URL(url.replace('studio-local://', 'http://local/'));
    const key = u.searchParams.get('key') || '', expiresAt = u.searchParams.get('expires') || '', type = u.searchParams.get('type') || '';
    const want = createHmac('sha256', this.secret).update(`${key}\n${expiresAt}\n${type}`).digest();
    const got = Buffer.from(u.searchParams.get('sig') || '', 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new StudioError('Signature rejected', 'invalid');
    if (now > new Date(expiresAt)) throw new StudioError('Signed upload expired', 'invalid');
    await this.put(key, bytes, type);
  }
  async get(key: string) {
    const p = this.path(key); this.fault?.('get', key);
    try { return new Uint8Array(await readFile(p)); } catch (e: any) { if (e?.code === 'ENOENT') return null; throw new StudioError('Storage unavailable', 'storage'); }
  }
  async put(key: string, bytes: Uint8Array, _contentType: string) {
    const p = this.path(key); this.fault?.('put', key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, bytes); await rename(tmp, p);
  }
  async delete(key: string) { const p = this.path(key); this.fault?.('delete', key); await rm(p, { force: true }); }
  async list(prefix: string): Promise<StoredObject[]> {
    this.fault?.('list', prefix);
    const out: StoredObject[] = [];
    const walk = async (dir: string) => {
      let names: string[] = [];
      try { names = await readdir(dir); } catch (e: any) { if (e?.code === 'ENOENT') return; throw e; }
      for (const name of names) {
        const full = join(dir, name), s = await stat(full);
        if (s.isDirectory()) await walk(full);
        else if (!name.endsWith('.tmp')) {
          const key = relative(this.root, full).split(sep).join('/');
          if (key.startsWith(prefix)) out.push({ key, size: s.size, lastModified: s.mtime });
        }
      }
    };
    await walk(this.root);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}
