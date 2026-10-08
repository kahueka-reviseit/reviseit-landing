/**
 * Studio byte storage. Implementations: LocalStudioStorage (tests and local rehearsal) and
 * R2StudioStorage (private Cloudflare R2 through the S3 API). Credentials stay server-side.
 *
 * Contract used by the finalisation and reconciliation code:
 * - get returns null for a missing object and throws StudioError('storage') for denied/unavailable.
 * - presignPut is only ever issued for provisional upload keys. A signed URL is reusable until it
 *   expires (it is not single-use); committed evidence therefore never lives at a URL-writable key.
 * - put writes exact bytes; implementations do not claim conditional or atomic cross-key semantics.
 */
export type StoredObject = { key: string; size: number; lastModified: Date };
export type SignedPut = { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string };
export interface StudioStorage {
  readonly kind: 'local' | 'r2';
  presignPut(key: string, options: { expiresSeconds: number; contentType: string }): Promise<SignedPut>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}
