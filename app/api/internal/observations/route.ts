import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { body, reply } from '../../../../lib/jobs/server';
import { isUuid } from '../../../../lib/jobs/contracts';
export const dynamic = 'force-dynamic';
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: Record<string, unknown>, expected: string[]) {
 return Object.keys(v).sort().join(',') === expected.sort().join(',');
}
export async function POST(request: Request) {
 const secret = process.env.SEMANTIC_OBSERVER_TOKEN;
 // Reusing the generation credential would collapse the observation boundary.
 if (!secret || secret.length < 32 || secret === process.env.CONTENT_WORKER_TOKEN)
  return reply({error: 'Observer gateway not configured'}, 503);
 const received = Buffer.from(request.headers.get('authorization') || '');
 const expected = Buffer.from('Bearer ' + secret);
 if (received.length !== expected.length || !timingSafeEqual(received, expected))
  return reply({error: 'Observer authentication required'}, 401);
 const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
 if (!url || !key) return reply({error: 'Observer gateway not configured'}, 503);
 let value: unknown;
 try { value = await body(request, 70000); } catch { return reply({error: 'Invalid observation request'}, 400); }
 if (!object(value) || !isUuid(value.id)) return reply({error: 'Invalid observation request'}, 400);
 let name: string, args: Record<string, unknown>;
 if (value.action === 'capture' && keys(value, ['action','id','checksHash']) && hash(value.checksHash)) {
  name = 'capture_semantic_observation'; args = {target: value.id, checks_hash: value.checksHash};
 } else if (value.action === 'record' && keys(value, ['action','id','inputHash','outcome','evidence']) && hash(value.inputHash)
  && typeof value.outcome === 'string' && ['response_received','not_sent','uncertain'].includes(value.outcome)
  && object(value.evidence) && Buffer.byteLength(JSON.stringify(value.evidence), 'utf8') <= 64000) {
  name = 'record_semantic_observation';
  args = {target: value.id, input_hash: value.inputHash, result_outcome: value.outcome, result_evidence: value.evidence};
 } else return reply({error: 'Invalid observation operation'}, 400);
 try {
  const client = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
  const result = await client.rpc(name, args);
  if (result.error) return reply({error: 'Observation operation refused'}, 409);
  return reply({result: result.data});
 } catch { return reply({error: 'Observation operation could not be confirmed'}, 503); }
}
