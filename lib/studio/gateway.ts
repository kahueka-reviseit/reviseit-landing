import { timingSafeEqual } from 'node:crypto';
import { blobKey, call, isSha256, isUuid, OUTPUT_TYPES, sha256, StudioError, type Rpc } from './contracts';
import type { StudioStorage } from './storage/types';
import { placeImmutable, readForWorker } from './uploads';

/**
 * Studio worker gateway. Separate bearer token (STUDIO_WORKER_TOKEN) and a closed allowlist of
 * Studio-only database functions: the Studio worker can never claim or write teacher paper orders.
 * The worker proposes outputs; it never transitions reviews. Lease fencing happens in the database.
 */
export const MAX_GATEWAY_BODY = 2_100_000;
export const MAX_CHUNK = 1_500_000;
const WORKER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const LOGICAL = /^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]+){0,4}$/;
const KINDS = ['inventory', 'task_matches', 'spec_matches', 'gap_list', 'draft_record', 'changeset_manifest', 'validation_result', 'package_file', 'page_text', 'evidence'];
const SAFE_MESSAGES = /Studio lease lost|explicit retry required|Provider request changed|not dispatchable|already settled|never dispatched|Integrity blocked|Input not available|exactly the outputs|unsettled|current settled attempt|Invalid record proposal|logical key mismatch|different path|Only (drafting|assembly)|must list exactly|Validation result|Unsafe or out-of-scope|does not resolve|already exists|Retiring|Storage cleanup in progress|Deterministic stages|must persist its change set|superseded before completion/;

export type GatewayDeps = { token: string | undefined; otherTokens?: (string | undefined)[]; rpc: Rpc | null; storage: StudioStorage | null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });

export function authorised(header: string | null, token: string | undefined) {
  if (!token || token.length < 32) return false;
  const got = Buffer.from(header || ''), want = Buffer.from('Bearer ' + token);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readBody(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_GATEWAY_BODY) throw new Error('Too large');
  const reader = request.body?.getReader(); if (!reader) throw new Error('Missing body');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > MAX_GATEWAY_BODY) { await reader.cancel(); throw new Error('Too large'); } chunks.push(r.value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const lease = (v: any) => isUuid(v.attemptId) && isUuid(v.lease);
const fenced = (v: any) => ({ p_attempt: v.attemptId, p_lease: v.lease });

export async function handleStudioGateway(request: Request, deps: GatewayDeps): Promise<Response> {
  if (!deps.token || deps.token.length < 32 || (deps.otherTokens || []).some(t => t && t === deps.token)) return json({ error: 'Studio gateway not configured' }, 503);
  if (!authorised(request.headers.get('authorization'), deps.token)) return json({ error: 'Studio worker authentication required' }, 401);
  if (!deps.rpc || !deps.storage) return json({ error: 'Studio gateway not configured' }, 503);
  const { rpc, storage } = deps;
  let v: any;
  try { v = await readBody(request); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.action !== 'string') return json({ error: 'Invalid request' }, 400);
  try {
    switch (v.action) {
      case 'claim':
        if (typeof v.worker !== 'string' || !WORKER.test(v.worker)) break;
        return json({ result: await call(rpc, 'studio_claim', { p_worker: v.worker }) });
      case 'heartbeat':
        if (!lease(v)) break;
        return json({ result: await call(rpc, 'studio_heartbeat', fenced(v)) });
      case 'read': {
        if (!lease(v) || !isUuid(v.blobId)) break;
        const offset = v.offset ?? 0, length = v.length ?? MAX_CHUNK;
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > MAX_CHUNK) break;
        const info = await call<any>(rpc, 'studio_worker_read', { ...fenced(v), p_blob: v.blobId });
        const bytes = await readForWorker(rpc, storage, info);
        return json({ result: { blobId: info.blobId, sha256: info.sha256, size: info.size, mediaType: info.mediaType, offset, content: Buffer.from(bytes.subarray(offset, offset + length)).toString('base64') } });
      }
      case 'output': {
        if (!lease(v) || typeof v.logicalKey !== 'string' || !LOGICAL.test(v.logicalKey) || v.logicalKey.length > 300 || !KINDS.includes(v.kind)
          || !(OUTPUT_TYPES as readonly string[]).includes(v.mediaType) || typeof v.content !== 'string' || v.content.length > Math.ceil(MAX_CHUNK * 4 / 3) + 4
          || (v.schema !== undefined && (typeof v.schema !== 'string' || v.schema.length > 120))
          || (v.record !== undefined && (typeof v.record !== 'object' || v.record === null || Array.isArray(v.record)))
          || (v.meta !== undefined && (typeof v.meta !== 'object' || v.meta === null || Array.isArray(v.meta)))
          || (v.providerAttemptId !== undefined && !isUuid(v.providerAttemptId))
          || (v.sha256 !== undefined && !isSha256(v.sha256))) break;
        const bytes = new Uint8Array(Buffer.from(v.content, 'base64'));
        const digest = sha256(bytes);
        if (v.sha256 !== undefined && v.sha256 !== digest) return json({ error: 'Output digest mismatch' }, 422);
        // The heartbeat is the fence that names the module; bytes go to that module's digest key.
        const ctx = await call<{ moduleId: string }>(rpc, 'studio_heartbeat', fenced(v));
        await placeImmutable(storage, blobKey(ctx.moduleId, digest), bytes, digest, v.mediaType);
        return json({ result: await call(rpc, 'studio_put_output', { ...fenced(v), p_logical_key: v.logicalKey, p_kind: v.kind, p_sha256: digest, p_size: bytes.length, p_media_type: v.mediaType,
          p_schema: v.schema ?? null, p_record: v.record ?? null, p_meta: v.meta ?? {}, p_provider_attempt: v.providerAttemptId ?? null }) });
      }
      case 'changeset':
        if (!lease(v) || !isUuid(v.validationArtifactId) || !Array.isArray(v.entries) || v.entries.length > 500
          || !v.entries.every((e: any) => e && isUuid(e.artifactId) && ['add', 'replace', 'retire'].includes(e.action) && Object.keys(e).length === 2)) break;
        return json({ result: await call(rpc, 'studio_put_changeset', { ...fenced(v), p_entries: v.entries, p_validation_artifact: v.validationArtifactId }) });
      case 'complete': {
        if (!lease(v) || !Array.isArray(v.outputs) || v.outputs.length > 500 || !v.outputs.every(isUuid)) break;
        const refs = await call<any[]>(rpc, 'studio_completion_outputs', fenced(v));
        for (const info of refs) await readForWorker(rpc, storage, info);
        return json({ result: await call(rpc, 'studio_complete', { ...fenced(v), p_outputs: v.outputs }) });
      }
      case 'fail':
        if (!lease(v) || typeof v.error !== 'string' || typeof v.retryable !== 'boolean') break;
        return json({ result: await call(rpc, 'studio_fail', { ...fenced(v), p_error: v.error.slice(0, 1000), p_retryable: v.retryable }) });
      case 'uncertain':
        if (!lease(v) || typeof v.reason !== 'string') break;
        return json({ result: await call(rpc, 'studio_mark_uncertain', { ...fenced(v), p_reason: v.reason.slice(0, 1000) }) });
      case 'provider_prepare':
        if (!lease(v) || typeof v.operation !== 'string' || !/^[a-z0-9_:.-]{1,120}$/.test(v.operation) || !isSha256(v.requestDigest)) break;
        return json({ result: await call(rpc, 'studio_provider_prepare', { ...fenced(v), p_operation: v.operation, p_request_digest: v.requestDigest }) });
      case 'provider_dispatched':
        if (!lease(v) || !isUuid(v.providerAttemptId)) break;
        return json({ result: await call(rpc, 'studio_provider_dispatched', { ...fenced(v), p_provider_attempt: v.providerAttemptId }) });
      case 'provider_result':
        if (!isUuid(v.providerAttemptId) || !['succeeded', 'failed'].includes(v.outcome) || (v.resultDigest !== undefined && !isSha256(v.resultDigest))
          || (v.providerRequestId !== undefined && (typeof v.providerRequestId !== 'string' || v.providerRequestId.length > 200))
          || (v.usage !== undefined && (typeof v.usage !== 'object' || v.usage === null || Array.isArray(v.usage)))
          || (v.attemptId !== undefined && !isUuid(v.attemptId)) || (v.lease !== undefined && !isUuid(v.lease))) break;
        return json({ result: await call(rpc, 'studio_provider_result', { p_provider_attempt: v.providerAttemptId, p_outcome: v.outcome, p_provider_request_id: v.providerRequestId ?? null,
          p_result_digest: v.resultDigest ?? null, p_usage: v.usage ?? null, p_attempt: v.attemptId ?? null, p_lease: v.lease ?? null }) });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    if (e instanceof StudioError && e.kind === 'storage') return json({ error: 'Storage unavailable' }, 503);
    const safe = (message.match(SAFE_MESSAGES) || [])[0];
    return json({ error: safe ? message.slice(0, 300) : 'Studio operation refused' }, 409);
  }
  return json({ error: 'Invalid Studio worker operation' }, 400);
}
