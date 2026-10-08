import { createHash } from 'node:crypto';

/**
 * Curriculum Studio shared contracts (assignment 02, addendum C1). Pure helpers: no credentials,
 * no network. The database functions in 202610080039_studio_foundation.sql are the authority for
 * transitions; these helpers only shape and check data before it reaches them.
 */
export type RpcResult = { data: unknown; error: { message: string } | null };
/** The shape of a Supabase client's rpc call, so tests can bind the real migration through PGlite. */
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

export class StudioError extends Error {
  constructor(message: string, readonly kind: 'refused' | 'integrity' | 'storage' | 'invalid' = 'refused') { super(message); }
}

export async function call<T = any>(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc(name, args);
  if (r.error) throw new StudioError(r.error.message, /Integrity blocked/.test(r.error.message) ? 'integrity' : 'refused');
  return r.data as T;
}

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
/** Every object Studio stores: provisional uploads and immutable digest-addressed blobs. */
export const OBJECT_KEY = /^studio\/(uploads|blobs)\/[a-z0-9]+(-[a-z0-9]+)*\/[A-Za-z0-9-]+$/;
export const blobKey = (moduleId: string, digest: string) => `studio/blobs/${moduleId}/${digest}`;

export const SOURCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const REVISION_TYPES = ['text/markdown', 'application/json', 'text/x-python'] as const;
export const OUTPUT_TYPES = ['application/json', 'text/markdown', 'text/plain', 'text/csv', 'image/png', 'image/svg+xml', 'application/pdf'] as const;

/**
 * Detect the byte type from content, never from a filename or the client's claim. Uploaded bytes and
 * any instructions inside documents are untrusted data; this only classifies them.
 */
export function detectType(bytes: Uint8Array, claimed: string): string | null {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (!(REVISION_TYPES as readonly string[]).includes(claimed)) return null;
  if (bytes.includes(0)) return null;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  if (claimed === 'application/json') { try { JSON.parse(text); } catch { return null; } }
  return claimed;
}

export const STAGES = ['S1_extract', 'S2_task_match', 'S3_spec_match', 'S4_prioritise', 'S5_draft', 'S6_assemble_validate', 'S7_package'] as const;
export const GATES = ['G1_inventory', 'G2_matches', 'G3_records', 'G4_content', 'G5_integration'] as const;
export type Gate = typeof GATES[number];
export const gateLabels: Record<Gate, string> = {
  G1_inventory: 'Inventory', G2_matches: 'Matches', G3_records: 'Drafted records', G4_content: 'Content judgments', G5_integration: 'Bank integration',
};
export const stageLabels: Record<typeof STAGES[number], string> = {
  S1_extract: 'Extract inventory', S2_task_match: 'Task matching', S3_spec_match: 'Specification matching', S4_prioritise: 'Prioritise gaps',
  S5_draft: 'Draft records', S6_assemble_validate: 'Assemble and validate candidate', S7_package: 'Evidence package',
};
