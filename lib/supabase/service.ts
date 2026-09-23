import 'server-only';
import { createClient } from '@supabase/supabase-js';
// Server-only privileged client for operations that have no teacher session
// (Stripe notifications) or must be recorded by the server on the teacher's
// behalf. It may call only the database functions granted to service_role.
export function serviceClient() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
