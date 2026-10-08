import { call, detectType, sha256, StudioError, type Rpc } from './contracts';
import type { SignedPut, StudioStorage } from './storage/types';

/**
 * Upload, finalisation, controlled reads and explicit recovery (C02). The editor's own database
 * session (rpc) decides permission; storage credentials never leave the server.
 *
 * Order of operations, because R2 and Postgres share no transaction:
 *   1. create session -> unique provisional key, signed PUT for that key only
 *   2. read provisional bytes, hash, size and sniff type; a mismatch rejects the session
 *   3. write the VERIFIED in-memory bytes to the distinct digest key (never a server-side copy of a
 *      URL-writable key), or verify the bytes already there; re-read and verify the final object
 *   4. commit the database reference last. Any failure before 4 leaves at most an orphan object.
 */
export async function createUpload(rpc: Rpc, storage: StudioStorage, input: { moduleId: string; sha256: string; size: number; mediaType: string; filename: string; purpose: 'source' | 'revision'; command: string }) {
  const s = await call<{ sessionId: string; provisionalKey: string; expiresAt: string }>(rpc, 'studio_create_upload', {
    p_module: input.moduleId, p_sha256: input.sha256, p_size: input.size, p_media_type: input.mediaType, p_filename: input.filename, p_purpose: input.purpose, p_command: input.command,
  });
  const seconds = Math.max(1, Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 1000));
  const signed: SignedPut = await storage.presignPut(s.provisionalKey, { expiresSeconds: Math.min(seconds, 900), contentType: input.mediaType });
  return { sessionId: s.sessionId, upload: signed };
}

export type FinaliseResult = { state: 'finalised'; blobId: string; sha256: string; duplicate: boolean } | { state: 'rejected'; reason: string } | { state: 'expired' };

export async function finaliseUpload(rpc: Rpc, storage: StudioStorage, sessionId: string): Promise<FinaliseResult> {
  const session = await call<any>(rpc, 'studio_upload_session', { p_session: sessionId });
  if (session.state === 'finalised') return await call(rpc, 'studio_commit_upload', { p_session: sessionId });
  if (session.state !== 'open' && session.state !== 'verifying') return session.state === 'expired' ? { state: 'expired' } : { state: 'rejected', reason: session.rejection || session.state };
  const bytes = await storage.get(session.provisionalKey);
  if (!bytes) {
    if (session.expired) return await call(rpc, 'studio_prepare_commit', { p_session: sessionId, p_sha256: null, p_size: null, p_detected_type: null });
    throw new StudioError('Upload has not been received yet', 'invalid');
  }
  const digest = sha256(bytes);
  const prepared = await call<any>(rpc, 'studio_prepare_commit', { p_session: sessionId, p_sha256: digest, p_size: bytes.length, p_detected_type: detectType(bytes, session.mediaType) });
  if (prepared.state !== 'verifying') return prepared.state === 'finalised' ? await call(rpc, 'studio_commit_upload', { p_session: sessionId }) : prepared;
  await placeImmutable(storage, prepared.targetKey, bytes, digest, session.mediaType, async () => {
    if (prepared.existingBlob) await call(rpc, 'studio_report_integrity', { p_blob: prepared.existingBlob.id, p_state: 'corrupt', p_detail: 'Digest key holds different bytes' });
  });
  return await call(rpc, 'studio_commit_upload', { p_session: sessionId });
}

/** Write or verify exact bytes at an immutable key. Different existing bytes are never overwritten. */
export async function placeImmutable(storage: StudioStorage, key: string, bytes: Uint8Array, digest: string, mediaType: string, onConflict?: () => Promise<void>) {
  const existing = await storage.get(key);
  if (existing) {
    if (sha256(existing) === digest) return 'verified-existing' as const;
    await onConflict?.();
    throw new StudioError('Stored object differs from its digest; recorded and not overwritten', 'integrity');
  }
  await storage.put(key, bytes, mediaType);
  const check = await storage.get(key);
  if (!check || sha256(check) !== digest) throw new StudioError('Final bytes failed verification', 'integrity');
  return 'written' as const;
}

async function verifiedRead(storage: StudioStorage, info: { key: string; sha256: string; size: number }, report: (state: 'missing' | 'inaccessible' | 'corrupt', detail: string) => Promise<unknown>) {
  let bytes: Uint8Array | null;
  try { bytes = await storage.get(info.key); }
  catch { await report('inaccessible', 'Storage refused or failed the read'); throw new StudioError('Integrity blocked: bytes inaccessible', 'integrity'); }
  if (!bytes) { await report('missing', 'Committed object is missing'); throw new StudioError('Integrity blocked: bytes missing', 'integrity'); }
  if (bytes.length !== info.size || sha256(bytes) !== info.sha256) { await report('corrupt', 'Committed object digest mismatch'); throw new StudioError('Integrity blocked: bytes corrupt', 'integrity'); }
  return bytes;
}

/** Read exact revision bytes through the editor's permissions, verifying the digest on every read. */
export async function readArtifact(rpc: Rpc, storage: StudioStorage, artifactId: string) {
  const info = await call<any>(rpc, 'studio_read_artifact', { p_artifact: artifactId });
  const bytes = await verifiedRead(storage, info, (state, detail) => call(rpc, 'studio_report_integrity', { p_blob: info.blobId, p_state: state, p_detail: detail }));
  return { info, bytes };
}
export async function readBlob(rpc: Rpc, storage: StudioStorage, blobId: string) {
  const info = await call<any>(rpc, 'studio_read_blob', { p_blob: blobId });
  const bytes = await verifiedRead(storage, info, (state, detail) => call(rpc, 'studio_report_integrity', { p_blob: blobId, p_state: state, p_detail: detail }));
  return { info, bytes };
}
/** Worker-side verified read through the service gateway session. */
export async function readForWorker(rpc: Rpc, storage: StudioStorage, info: { blobId: string; key: string; sha256: string; size: number }) {
  return verifiedRead(storage, info, (state, detail) => call(rpc, 'studio_worker_report_integrity', { p_blob: info.blobId, p_state: state, p_detail: detail }));
}

/** Explicit recovery of a blob in an integrity state from bytes whose digest is independently verified. */
export async function recoverBlob(rpc: Rpc, storage: StudioStorage, blobId: string, bytes: Uint8Array, reason: string, mediaType: string) {
  const begin = await call<{ key: string; sha256: string; size: number }>(rpc, 'studio_begin_recovery', { p_blob: blobId, p_reason: reason });
  if (bytes.length !== begin.size || sha256(bytes) !== begin.sha256) throw new StudioError('Recovery bytes do not match the committed digest', 'integrity');
  await storage.put(begin.key, bytes, mediaType);
  const check = await storage.get(begin.key);
  if (!check || sha256(check) !== begin.sha256) throw new StudioError('Recovered bytes failed verification', 'integrity');
  return await call(rpc, 'studio_complete_recovery', { p_blob: blobId });
}
